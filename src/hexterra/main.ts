// Entry point for /hexterra/: wires the session (rules), the 3D table and
// the interface together.

import * as THREE from "three";
import { TERRAIN_RESOURCE, generateBoard, rollWays } from "./core/board";
import {
    RESOURCE_NAMES,
    legalColonySpots,
    legalConduitSpots,
    legalTowerSpots,
    type GameEvent,
    type GameState,
} from "./core/game";
import { randomSeed } from "./core/rng";
import { RESOURCE_PITCH, Sound } from "./audio/sound";
import { GuestSession, HostSession, LocalSession, normaliseRoomCode, type Session, type View } from "./net/session";
import { prefersReducedMotion } from "./render/anim";
import { loadAssets } from "./render/assets";
import { BoardView, COAST_RADIUS, ISLAND_CENTERS, ISLAND_EXTENT } from "./render/boardView";
import { GameView, type Markers, type Pick } from "./render/gameView";
import { initMaterials } from "./render/materials";
import { createOcean } from "./render/ocean";
import { PLAYER_COLORS, TERRAIN_STYLE } from "./render/palette";
import { createSky, planetDirection } from "./render/sky";
import { createStage, type Stage } from "./render/stage";
import { bakeIslandHeight } from "./render/terrain";
import { Hud, PLANET_NAMES, icon, type BuildMode } from "./ui/hud";
import { TUTORIAL_SEED, Tutorial } from "./ui/tutorial";

/** `?seed=123` reproduces a board; anything else gets a fresh one. */
function seedFromUrl(): number {
    const raw = new URLSearchParams(location.search).get("seed");
    const seed = raw === null ? NaN : Number(raw);
    return Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32 ? seed : randomSeed();
}

const planetName = (seed: number) => `${PLANET_NAMES[seed % PLANET_NAMES.length]} ${(seed % 900) + 100}`;

export async function startHexterra(root: HTMLElement) {
    const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel);
    const canvas = $<HTMLCanvasElement>("canvas")!;
    const bootBar = $("[data-boot-progress]");
    const tip = $("[data-tip]")!;
    const reduced = prefersReducedMotion();
    const sound = new Sound();
    setupAudioControls(root, sound);

    let stage: Stage;
    try {
        // Frame the tiles and the stations; the outer beach may run off-screen.
        stage = createStage(canvas, COAST_RADIUS * 0.9);
    } catch (err) {
        console.error(err);
        root.dataset.state = "no-webgl";
        return;
    }
    const { scene, camera, animator } = stage;

    const [assets] = await Promise.all([
        loadAssets(stage.renderer, (k) => bootBar?.style.setProperty("--progress", String(k))),
        // The markers are printed from canvases: the font must be ready first.
        Promise.race([document.fonts.load('700 120px "Chakra Petch"'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {}),
    ]);
    initMaterials(assets, stage.quality);
    stage.setSky(assets.sky);

    scene.add(createSky(stage.sunDirection));
    const ocean = createOcean(bakeIslandHeight(ISLAND_CENTERS, ISLAND_EXTENT), ISLAND_EXTENT, stage.quality);
    scene.add(ocean.mesh);

    const board = new BoardView({ animator, sun: stage.sunDirection, facing: stage.restAzimuth() });
    scene.add(board.group);
    const table = new GameView(board, animator);
    scene.add(table.layer);

    // --- Session and interface ------------------------------------------

    let session: Session | null = null;
    let unsubscribe: (() => void) | null = null;
    let view: View | null = null;
    let shownSeed = -1;
    let previewSeed = seedFromUrl();
    let mode: BuildMode = null;
    let lastMe: number | null = null;
    /** Sector picked for the drone but not yet confirmed. */
    let droneChoice: number | null = null;
    let tutorial: Tutorial | null = null;
    let swapping: Promise<void> = Promise.resolve();

    root.addEventListener("click", (e) => {
        const b = (e.target as HTMLElement).closest("button");
        if (b && !b.disabled) sound.play("tick");
    });
    const hud = new Hud($("[data-ui]")!, {
        act: (a) => session?.act(a),
        setMode: (m) => {
            mode = m;
            refreshMarkers();
        },
        startLocal: (seats) => {
            open(new LocalSession(seats));
            session!.start!(previewSeed);
        },
        host: (name) => open(new HostSession(name)),
        join: (name, code) => open(new GuestSession(normaliseRoomCode(code), name)),
        startHosted: () => session?.start?.(previewSeed),
        setSeats: (seats) => session?.setSeats?.(seats),
        rerollPlanet: () => {
            previewSeed = randomSeed();
            showBoard(previewSeed, true);
            hud.planetLabel = planetName(previewSeed);
    hud.renderLobby();
    if (import.meta.env.DEV) {
        Object.assign(window, {
            __hexterra: {
                stage,
                table,
                sound,
                get view() {
                    return view;
                },
                act: (a: Parameters<Session["act"]>[0]) => session?.act(a),
                /** Plays one move for this seat the way a bot would (tests only). */
                autoplay: async () => {
                    const { botMove } = await import("./core/bot");
                    const v = view;
                    if (!v?.state || v.me === null) return false;
                    const m = botMove(v.state, v.me);
                    if (!m) return false;
                    const { player: _p, ...action } = m;
                    session?.act(action as Parameters<Session["act"]>[0]);
                    return true;
                },
                /** Screen point of a vertex / edge midpoint / tile, for tests that click the board. */
                screenOf: (kind: "vertex" | "edge" | "tile", id: number) => {
                    const s = view!.state!;
                    let p: THREE.Vector3;
                    if (kind === "tile") p = table.tileWorld(id);
                    else if (kind === "vertex") p = table.vertexPosition(s, id);
                    else {
                        const e = s.topology.edges[id];
                        p = table.vertexPosition(s, e.a).add(table.vertexPosition(s, e.b)).multiplyScalar(0.5);
                    }
                    return table.project(p.add(new THREE.Vector3(0, 0.05, 0)), camera, canvas);
                },
            },
        });
    }
            hud.renderLobby();
        },
        leave: () => {
            tutorial = null;
            hud.setCoach(null);
            unsubscribe?.();
            session?.dispose();
            session = null;
            view = null;
            mode = null;
            table.setMarkers(null);
            hud.render({ state: null, me: null, seats: [], room: null, role: "local", status: "lobby" });
            hud.showMenu();
            showBoard(previewSeed, true);
        },
        confirmDrone: () => {
            if (droneChoice === null) return;
            const tile = droneChoice;
            setDroneChoice(null, false);
            session?.act({ type: "moveDrone", tile });
        },
        cancelDrone: () => setDroneChoice(null),
        startTutorial: () => {
            tutorial = new Tutorial();
            open(
                new LocalSession([
                    { name: "Comandante", kind: "human" },
                    { name: "IA Orión", kind: "bot" },
                ]),
            );
            session!.start!(TUTORIAL_SEED);
        },
        coachNext: () => {
            const s = view?.state;
            if (!tutorial || !s || view?.me == null) return;
            showCoach(tutorial.advance(s, view.me));
        },
    });

    root.addEventListener("hexterra:menu", () => hud.confirmLeave());

    function showCoach(c: ReturnType<Tutorial["update"]>) {
        hud.setCoach(c);
        if (tutorial?.finished) {
            try {
                localStorage.setItem("hexterra:tutorial-done", "1");
            } catch {
                /* fine */
            }
        }
    }

    function setDroneChoice(tile: number | null, flyBack = true) {
        droneChoice = tile;
        if (tile !== null || flyBack) table.previewDrone(tile);
        const t = tile === null ? null : board.tileAt(tile);
        hud.setDroneChoice(t ? `${TERRAIN_STYLE[t.terrain].label}${t.number ? ` (${t.number})` : ""}` : null);
    }
    hud.planetLabel = planetName(previewSeed);
    hud.renderLobby();
    if (import.meta.env.DEV) {
        Object.assign(window, {
            __hexterra: {
                stage,
                table,
                sound,
                get view() {
                    return view;
                },
                act: (a: Parameters<Session["act"]>[0]) => session?.act(a),
                /** Plays one move for this seat the way a bot would (tests only). */
                autoplay: async () => {
                    const { botMove } = await import("./core/bot");
                    const v = view;
                    if (!v?.state || v.me === null) return false;
                    const m = botMove(v.state, v.me);
                    if (!m) return false;
                    const { player: _p, ...action } = m;
                    session?.act(action as Parameters<Session["act"]>[0]);
                    return true;
                },
                /** Screen point of a vertex / edge midpoint / tile, for tests that click the board. */
                screenOf: (kind: "vertex" | "edge" | "tile", id: number) => {
                    const s = view!.state!;
                    let p: THREE.Vector3;
                    if (kind === "tile") p = table.tileWorld(id);
                    else if (kind === "vertex") p = table.vertexPosition(s, id);
                    else {
                        const e = s.topology.edges[id];
                        p = table.vertexPosition(s, e.a).add(table.vertexPosition(s, e.b)).multiplyScalar(0.5);
                    }
                    return table.project(p.add(new THREE.Vector3(0, 0.05, 0)), camera, canvas);
                },
            },
        });
    }

    function open(s: Session) {
        unsubscribe?.();
        session?.dispose();
        session = s;
        unsubscribe = s.subscribe(onView);
    }

    /** Puts `seed`'s board on the table, sinking the old one if needed. */
    function showBoard(seed: number, animate: boolean, state?: GameState) {
        if (seed === shownSeed) return swapping;
        shownSeed = seed;
        const b = state?.board ?? generateBoard(seed);
        swapping = swapping.then(async () => {
            if (animate && !reduced) sound.play("terraform");
            await board.setBoard(b, { animate: animate && !reduced, fast: true });
        });
        return swapping;
    }

    let wasMyTurn = false;
    function onView(v: View) {
        view = v;
        const s = v.state;
        if (v.error) sound.play("error");
        const myTurn = !!s && v.me !== null && s.current === v.me && s.phase !== "over" && (s.step === "roll" || s.step === "setupColony");
        if (myTurn && !wasMyTurn) sound.play("turn", { delay: 0.3 });
        wasMyTurn = myTurn;
        if (s) {
            if (s.seed !== shownSeed || !tableReady) {
                tableReady = true;
                const isNew = s.seed !== shownSeed;
                void showBoard(s.seed, true, s).then(() => {
                    table.reset(s);
                    table.sync(view?.state ?? s, false);
                    if (isNew) hud.takeEvents(s);
                    refreshMarkers();
                });
            } else {
                table.sync(s, !reduced);
                for (const e of hud.takeEvents(s)) playEvent(s, e);
            }
            handoff(v);
        }
        hud.render(v);
        if (tutorial && s && v.me !== null) showCoach(tutorial.update(s, v.me, s.events));
        // A pending drone choice only lives while it's still ours to make.
        if (droneChoice !== null && !(s && s.step === "moveDrone" && s.current === v.me)) setDroneChoice(null, false);
        refreshMarkers();
        frameBoard();
    }

    /** Keeps the island clear of the panels: the camera frames the free band. */
    function frameBoard() {
        const playing = !!view?.state;
        const h = canvas.clientHeight;
        if (!playing) return stage.setInsets(0, 0);
        const dock = $("[data-dock]")?.getBoundingClientRect();
        const players = $("[data-players]")?.getBoundingClientRect();
        const banner = $("[data-banner]")?.getBoundingClientRect();
        const narrow = canvas.clientWidth <= 760;
        const top = narrow ? Math.max(players?.bottom ?? 0, banner?.bottom ?? 0) : (banner?.bottom ?? 0);
        const bottom = dock ? h - dock.top : 0;
        root.style.setProperty("--dock-h", `${bottom}px`);
        stage.setInsets(top + 8, bottom + 8);
    }
    window.addEventListener("resize", () => requestAnimationFrame(frameBoard));
    let tableReady = false;

    /** In hot-seat play with several people, hide the hand until the next person is ready. */
    function handoff(v: View) {
        const s = v.state!;
        const humans = s.players.filter((p) => p.kind === "human").length;
        if (v.role !== "local" || humans < 2 || v.me === null) return;
        if (lastMe !== null && v.me !== lastMe && s.phase !== "over") {
            const pass = $("[data-handoff]")!;
            pass.innerHTML = `<div class="modal panel"><p class="eyebrow">Pasa el dispositivo</p><h3 style="color:${PLAYER_COLORS[v.me]}">Turno de ${s.players[v.me].name}</h3><button class="btn primary wide" data-handoff-ok>Estoy listo</button></div>`;
            pass.hidden = false;
        }
        lastMe = v.me;
    }
    $("[data-handoff]")!.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest("[data-handoff-ok]")) $("[data-handoff]")!.hidden = true;
    });

    function refreshMarkers() {
        const s = view?.state;
        const me = view?.me ?? null;
        if (!s || me === null || s.current !== me || s.phase === "over" || !$("[data-handoff]")!.hidden) return table.setMarkers(null);
        const color = PLAYER_COLORS[me];
        let m: Markers | null = null;
        if (s.step === "setupColony") m = { kind: "vertex", ids: legalColonySpots(s, me), color };
        else if (s.step === "setupConduit" || s.step === "printer") m = { kind: "edge", ids: legalConduitSpots(s, me), color };
        else if (s.step === "moveDrone") m = { kind: "tile", ids: s.board.tiles.map((_, i) => i).filter((i) => i !== s.drone), color };
        else if (s.step === "main" && !s.trade) {
            if (mode === "colony") m = { kind: "vertex", ids: legalColonySpots(s, me), color };
            else if (mode === "conduit") m = { kind: "edge", ids: legalConduitSpots(s, me), color };
            else if (mode === "tower") m = { kind: "vertex", ids: legalTowerSpots(s, me), color };
        }
        table.setMarkers(m);
    }

    function choose(p: Pick) {
        const s = view?.state;
        if (!s || !session) return;
        // The drone flies over as a preview; the move is sent on Confirmar.
        if (p.kind === "tile") setDroneChoice(p.id);
        else if (p.kind === "edge") session.act({ type: "placeConduit", edge: p.id });
        else if (s.step === "main" && mode === "tower") session.act({ type: "upgradeTower", vertex: p.id });
        else session.act({ type: "placeColony", vertex: p.id });
        if (s.step === "main") {
            mode = null;
            hud.clearMode();
        }
    }

    // --- Event animations -------------------------------------------------

    function playEvent(s: GameState, e: GameEvent) {
        const me = view?.me ?? null;
        if (e.kind === "dice") {
            sound.play("dice");
            if (e.dice[0] + e.dice[1] === 7) sound.play("seven", { delay: 0.55 });
        } else if (e.kind === "production") {
            e.gains.slice(0, 6).forEach((g, i) =>
                sound.play("produce", { delay: 0.55 + i * 0.1, pitch: RESOURCE_PITCH[g.resource], volume: g.player === me ? 1 : 0.45 }),
            );
        } else if (e.kind === "built") {
            sound.play(e.what, { volume: e.player === me ? 1 : 0.6 });
            if (!reduced) sound.play("materialize", { delay: 0.1 });
        } else if (e.kind === "drone") sound.play("drone");
        else if (e.kind === "steal") sound.play("steal");
        else if (e.kind === "trade") sound.play("trade");
        else if (e.kind === "tech") sound.play("tech");
        else if (e.kind === "orbital") sound.play("orbital");
        else if (e.kind === "win") sound.play(e.player === me ? "win" : "lose", { delay: 0.4 });
        if (e.kind === "production") {
            board.pulse(e.roll);
            e.gains.forEach((g, i) => {
                const at = table.project(table.tileWorld(g.tile).add(new THREE.Vector3(0, 0.6, 0)), camera, canvas);
                if (at.visible)
                    hud.floater(at.x, at.y, `<span style="--p:${PLAYER_COLORS[g.player]}">+${g.amount} ${icon(g.resource, 16)}</span>`, i * 90);
            });
            if (!e.gains.length && e.roll !== 7) hud.toast(`Sale un ${e.roll}: nadie produce`);
        } else if (e.kind === "orbital") {
            const text = {
                solarStorm: "Tormenta solar: la Energía no produce esta ronda",
                meteor: "Lluvia de meteoritos: un sector cambia de recurso",
                alignment: "Alineación planetaria: la próxima tirada produce el doble",
            }[e.event];
            hud.toast(`Evento orbital · ${text}`);
        } else if (e.kind === "steal" && view?.me !== null && (e.thief === view?.me || e.victim === view?.me) && e.resource) {
            hud.toast(e.thief === view.me ? `Robas 1 ${RESOURCE_NAMES[e.resource]}` : `${s.players[e.thief].name} te roba 1 ${RESOURCE_NAMES[e.resource]}`);
        } else if (e.kind === "dice" && e.dice[0] + e.dice[1] === 7) {
            hud.toast("¡Un 7! El dron saboteador se pone en marcha");
        }
    }

    // --- Pointer: hover, clicks, tooltip ------------------------------------

    let down: { x: number; y: number; t: number } | null = null;
    canvas.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY, t: performance.now() }));
    canvas.addEventListener("pointerup", (e) => {
        if (!down) return;
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        const quick = performance.now() - down.t < 450;
        down = null;
        if (moved > 8 || !quick) return;
        const pick = table.hover(stage.pointer(), camera);
        if (pick) choose(pick);
    });
    window.addEventListener("keydown", (e) => {
        if (droneChoice !== null && (e.key === "Escape" || e.key === "Enter")) {
            if (e.key === "Enter") {
                const tile = droneChoice;
                setDroneChoice(null, false);
                session?.act({ type: "moveDrone", tile });
            } else setDroneChoice(null);
            return;
        }
        if (e.key === "Escape" && mode) {
            mode = null;
            hud.clearMode();
            refreshMarkers();
        }
    });

    let lastPointer = { x: 0, y: 0 };
    canvas.addEventListener("pointermove", (e) => (lastPointer = { x: e.clientX, y: e.clientY }));

    animator.every((time, dt) => {
        ocean.sync(scene, stage.sunDirection);
        board.update(time, dt);
        table.update(time);
        const ndc = stage.pointer();
        const pick = table.hover(ndc, camera);
        canvas.style.cursor = pick ? "pointer" : "";
        // Hovering a tile with nothing to choose shows what it is.
        const tileIndex = pick ? null : board.pick(ndc, camera);
        const tile = tileIndex === null ? null : board.tileAt(tileIndex);
        if (tile && root.dataset.phase === "play") {
            const style = TERRAIN_STYLE[tile.terrain];
            const r = TERRAIN_RESOURCE[tile.terrain];
            const ways = tile.number ? rollWays(tile.number) : 0;
            const drone = view?.state?.drone === tileIndex ? " · dron saboteador" : "";
            tip.innerHTML = `<b>${style.label}</b><span>${r ? `${RESOURCE_NAMES[r]} · ${tile.number} (${Math.round((ways / 36) * 100)}%)` : "Sin producción"}${drone}</span>`;
            tip.style.transform = `translate(${lastPointer.x + 16}px, ${lastPointer.y + 16}px)`;
            tip.hidden = false;
        } else tip.hidden = true;
    });

    // --- Start ---------------------------------------------------------------

    // Music should be there from the first shot. If the browser blocks sound
    // until someone interacts, end the loading screen on an "Entrar" button:
    // that click is the interaction, and the intro starts with the music.
    if (!(await sound.tryStart())) {
        root.dataset.state = "gate";
        const enter = $<HTMLButtonElement>("[data-enter]")!;
        enter.focus();
        await new Promise<void>((resolve) => {
            const go = () => {
                void sound.unlock();
                window.removeEventListener("keydown", onKey);
                resolve();
            };
            const onKey = (e: KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") go();
            };
            enter.addEventListener("click", go, { once: true });
            window.addEventListener("keydown", onKey);
        });
    }

    root.dataset.state = "ready";
    root.dataset.phase = reduced ? "play" : "intro";
    const skip = () => {
        if (root.dataset.phase === "intro") animator.finishAll();
    };
    canvas.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", skip);
    if (!reduced) {
        const intro = stage.playIntro(6, planetDirection(stage.sunDirection));
        await new Promise((r) => setTimeout(r, 1200));
        shownSeed = previewSeed;
        await board.setBoard(generateBoard(previewSeed), { animate: true });
        await intro.done;
    } else {
        shownSeed = previewSeed;
        await board.setBoard(generateBoard(previewSeed), { animate: false });
    }
    root.dataset.phase = "play";

    // Arriving through an invite link goes straight to the join tab.
    if (new URLSearchParams(location.search).has("sala")) $<HTMLButtonElement>('[data-tab="join"]')?.click();
}

/** The two speaker toggles in the corner: music and effects, remembered. */
function setupAudioControls(root: HTMLElement, sound: Sound) {
    const music = root.querySelector<HTMLButtonElement>("[data-toggle-music]");
    const sfx = root.querySelector<HTMLButtonElement>("[data-toggle-sfx]");
    const sync = () => {
        music?.setAttribute("aria-pressed", String(sound.musicOn));
        sfx?.setAttribute("aria-pressed", String(sound.sfxOn));
        if (music) music.title = sound.musicOn ? "Silenciar música" : "Activar música";
        if (sfx) sfx.title = sound.sfxOn ? "Silenciar efectos" : "Activar efectos";
    };
    music?.addEventListener("click", () => sound.setMusic(!sound.musicOn));
    root.querySelector("[data-game-menu]")?.addEventListener("click", () => root.dispatchEvent(new CustomEvent("hexterra:menu")));
    sfx?.addEventListener("click", () => sound.setSfx(!sound.sfxOn));
    sound.onChange(sync);
    sync();
}
