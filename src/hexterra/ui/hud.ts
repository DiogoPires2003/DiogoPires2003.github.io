// The game's interface: the lobby, and in play the players, your cards, the
// build costs, the actions and every dialog. Plain DOM, re-rendered from the
// session view; it never touches the rules, it only sends actions.

import type { Resource } from "../core/board";
import {
    COSTS,
    RESOURCES,
    RESOURCE_NAMES,
    TECH_NAMES,
    WIN_POINTS,
    canAfford,
    emptyHand,
    handFrom,
    handSize,
    legalColonySpots,
    legalConduitSpots,
    legalTowerSpots,
    piecesLeft,
    tradeRatio,
    victoryPoints,
    waitingOn,
    type Action,
    type BuildKind,
    type GameEvent,
    type GameState,
    type Hand,
    type TechCard,
} from "../core/game";
import type { Seat, View } from "../net/session";
import { PLAYER_COLORS, RESOURCE_ACCENT, RESOURCE_ICON } from "../render/palette";
import type { CoachView } from "./tutorial";

export type BuildMode = "colony" | "conduit" | "tower" | null;

export interface HudCallbacks {
    act: (a: Action) => void;
    /** Build mode chosen from the dock; main turns it into 3D markers. */
    setMode: (mode: BuildMode) => void;
    startLocal: (seats: Seat[]) => void;
    host: (name: string) => void;
    join: (name: string, code: string) => void;
    startHosted: () => void;
    setSeats: (seats: Seat[]) => void;
    rerollPlanet: () => void;
    leave: () => void;
    confirmDrone: () => void;
    cancelDrone: () => void;
    startTutorial: () => void;
    coachNext: () => void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function icon(r: Resource, size = 18) {
    return `<svg class="ri" viewBox="0 0 24 24" width="${size}" height="${size}" style="--c:${RESOURCE_ACCENT[r]}" aria-hidden="true"><path d="${RESOURCE_ICON[r]}"/></svg>`;
}

function costChips(cost: Partial<Hand>) {
    return RESOURCES.flatMap((r) => Array(cost[r] ?? 0).fill(r))
        .map((r) => `<span class="chip" title="${RESOURCE_NAMES[r as Resource]}">${icon(r as Resource, 14)}</span>`)
        .join("");
}

const BUILD_LABEL: Record<BuildKind, string> = { conduit: "Conducto", colony: "Colonia", tower: "Torre", tech: "Tecnología" };
const BUILD_POINTS: Record<BuildKind, string> = { conduit: "Conecta tu red", colony: "1 punto", tower: "2 puntos", tech: "Carta de tecnología" };

const TECH_HELP: Record<TechCard, string> = {
    drone: "Mueve el dron saboteador y roba una carta. Cuenta para la mayor flota.",
    printer: "Construye 2 conductos gratis.",
    extraction: "Toma 2 recursos cualesquiera del banco.",
    monopoly: "Todos te dan sus cartas del recurso que elijas.",
    science: "1 punto de influencia oculto.",
};

/** Where "back to the portfolio" goes: the page that lists the game. */
const PORTFOLIO_URL = "/projects/";

const PLANET_NAMES = ["Sintonía", "Vértice", "Aurora", "Nexo", "Cénit", "Ámbar"];

export class Hud {
    private root: HTMLElement;
    private view: View | null = null;
    private mode: BuildMode = null;
    private dialog: string | null = null;
    private lastSeq = 0;
    private draft = { give: emptyHand(), want: emptyHand(), discard: emptyHand(), picks: [] as Resource[] };
    private lobbyTab: "local" | "host" | "join" = "local";
    /** The title screen, or the game setup behind "Jugar". */
    private screen: "menu" | "setup" = new URLSearchParams(location.search).has("sala") ? "setup" : "menu";
    private localSeats: Seat[] = [
        { name: "Comandante", kind: "human" },
        { name: "IA Orión", kind: "bot" },
        { name: "IA Vega", kind: "bot" },
    ];
    private toastTimer = 0;
    /** Shown in the lobby: which planet is on the table. */
    planetLabel = "";

    constructor(
        root: HTMLElement,
        private readonly cb: HudCallbacks,
    ) {
        this.root = root;
        root.innerHTML = `
            <div class="lobby" data-lobby></div>
            <div class="game" data-game hidden>
                <div class="banner" data-banner></div>
                <div class="dice" data-dice></div>
                <aside class="players" data-players></aside>
                <aside class="costs panel" data-costs></aside>
                <div class="log" data-log></div>
                <div class="dock panel" data-dock></div>
                <div class="confirm panel" data-confirm hidden></div>
                <aside class="coach panel" data-coach hidden></aside>
                <button class="room-chip" data-room hidden></button>
            </div>
            <div class="modal-wrap" data-modal hidden></div>
            <div class="toast" data-toast></div>
            <div class="floaters" data-floaters></div>`;
        root.addEventListener("click", (e) => this.onClick(e));
        root.addEventListener("input", (e) => this.onInput(e));
        this.renderLobby();
    }

    private $(sel: string) {
        return this.root.querySelector<HTMLElement>(sel)!;
    }

    // --- Lobby ---------------------------------------------------------

    renderLobby() {
        const v = this.view;
        const el = this.$("[data-lobby]");
        const online = v && v.role !== "local";
        if (this.screen === "menu" && !online) {
            el.innerHTML = this.menuCard();
            return;
        }
        const tabs = `
            <div class="tabs" role="tablist">
                ${(["local", "host", "join"] as const)
                    .map(
                        (t) =>
                            `<button role="tab" aria-selected="${this.lobbyTab === t}" data-tab="${t}" ${online ? "disabled" : ""}>${
                                { local: "Partida local", host: "Crear sala", join: "Unirse" }[t]
                            }</button>`,
                    )
                    .join("")}
            </div>`;
        let body = "";
        if (online && v) {
            body = this.roomBody(v);
        } else if (this.lobbyTab === "local") {
            body = `
                <p class="hint-text">Juega en este dispositivo: pasad el turno entre personas o deja que la IA ocupe los asientos.</p>
                <ul class="seats">${this.localSeats.map((s, i) => this.seatRow(s, i, true)).join("")}</ul>
                ${this.localSeats.length < 4 ? `<button class="btn ghost small" data-add-seat>+ Añadir jugador</button>` : ""}
                <div class="planet-row">
                    <span>Planeta <b>${esc(this.planetLabel)}</b></span>
                    <button class="btn ghost small" data-reroll>Otro planeta</button>
                </div>
                <button class="btn primary wide" data-start-local>Empezar partida</button>`;
        } else if (this.lobbyTab === "host") {
            body = `
                <p class="hint-text">Crea una sala y comparte el código. Tus amigos entran desde su navegador; los asientos libres los ocupa la IA.</p>
                <label class="field">Tu nombre<input data-name maxlength="18" value="${esc(this.savedName())}" /></label>
                <button class="btn primary wide" data-host>Crear sala</button>`;
        } else {
            const code = new URLSearchParams(location.search).get("sala") ?? "";
            body = `
                <p class="hint-text">Escribe el código que te ha pasado el anfitrión.</p>
                <label class="field">Tu nombre<input data-name maxlength="18" value="${esc(this.savedName())}" /></label>
                <label class="field">Código de sala<input data-code maxlength="6" class="code-input" value="${esc(code)}" placeholder="ABCDE" autocapitalize="characters" /></label>
                <button class="btn primary wide" data-join>Unirse</button>`;
        }
        el.innerHTML = `
            <div class="lobby-card panel">
                <h2>Nueva partida</h2>
                ${tabs}
                <div class="lobby-body">${body}</div>
                ${v?.error ? `<p class="error">${esc(v.error)}</p>` : ""}
                <div class="lobby-links">
                    ${online ? "" : `<button class="link" data-menu-back>← Menú</button>`}
                    <button class="link" data-rules>Cómo se juega</button>
                </div>
            </div>`;
    }

    private menuCard() {
        let firstTime = true;
        try {
            firstTime = !localStorage.getItem("hexterra:tutorial-done");
        } catch {
            /* fine */
        }
        const point = (r: Resource, text: string) => `<li>${icon(r, 20)}<span>${text}</span></li>`;
        return `
            <div class="lobby-card menu-card panel">
                <p class="eyebrow">Estrategia por turnos · 2 a 4 jugadores</p>
                <h1 class="menu-title">HEXTERRA</h1>
                <p class="pitch">Un planeta recién terraformado y cuatro corporaciones que quieren quedárselo. Extrae recursos, tiende conductos, funda colonias y levanta torres hasta reunir <b>${WIN_POINTS} puntos de influencia</b>.</p>
                <ul class="pitch-points">
                    ${point("energy", "Cada sector produce cuando los dados sacan su número.")}
                    ${point("metal", "Gasta recursos en conductos, colonias, torres y tecnologías.")}
                    ${point("water", "Comercia con el banco, las estaciones de la costa o los rivales.")}
                    ${point("silicon", "Cuidado con el 7: el dron saboteador se pone en marcha.")}
                </ul>
                <div class="menu-actions">
                    <button class="btn primary wide" data-play-menu>Jugar</button>
                    <button class="btn ${firstTime ? "accent" : "ghost"} wide" data-tutorial>${firstTime ? "Tutorial (recomendado)" : "Tutorial"}</button>
                </div>
                <div class="lobby-links">
                    <a class="link" href="${PORTFOLIO_URL}">← Volver al portfolio</a>
                    <button class="link" data-rules>Cómo se juega</button>
                </div>
            </div>`;
    }

    /** Back to the title screen (after leaving a game). */
    showMenu() {
        this.screen = "menu";
        this.renderLobby();
    }

    /** The spotlight coach of the tutorial; null hides it. */
    setCoach(c: CoachView | null) {
        const el = this.$("[data-coach]");
        this.root.querySelectorAll(".coach-target").forEach((n) => n.classList.remove("coach-target"));
        el.hidden = !c;
        if (!c) {
            this.coachTarget = null;
            return;
        }
        const dots = Array.from({ length: c.total }, (_, i) => `<i class="${i < c.index ? "done" : i === c.index ? "now" : ""}"></i>`).join("");
        el.innerHTML = `
            <p class="eyebrow">Tutorial · ${c.index + 1} de ${c.total}</p>
            <h3>${c.title}</h3>
            <p class="coach-text">${c.text}</p>
            <div class="coach-foot">
                <span class="dots">${dots}</span>
                ${c.next ? `<button class="btn primary small" data-coach-next>${c.index === c.total - 1 ? "Entendido" : "Siguiente"}</button>` : `<span class="waiting">Te espero…</span>`}
            </div>
            <button class="link" data-leave-ask>Salir del tutorial</button>`;
        this.coachTarget = c.target ?? null;
        this.reapplyCoachTarget();
    }

    private coachTarget: string | null = null;
    private reapplyCoachTarget() {
        if (this.coachTarget) this.root.querySelector(this.coachTarget)?.classList.add("coach-target");
    }

    /** "Are you sure?" before abandoning a game. */
    confirmLeave() {
        if (!this.view?.state) return;
        this.dialog = "leave";
        this.showStatic(`<div class="modal panel">
            <h3>¿Volver al menú?</h3>
            <p class="hint-text">${this.view.role === "local" ? "La partida se perderá." : "Saldrás de la sala; una IA ocupará tu asiento."}</p>
            <div class="row">
                <button class="btn ghost" data-close>Seguir jugando</button>
                <button class="btn primary" data-leave>Volver al menú</button>
            </div>
            <a class="link" href="${PORTFOLIO_URL}">← Salir al portfolio</a>
        </div>`, "leave");
    }

    private roomBody(v: View) {
        if (v.status === "connecting") return `<p class="hint-text">Conectando…</p>`;
        if (v.status === "error") return `<p class="hint-text">No se pudo conectar.</p><button class="btn ghost" data-leave>Volver</button>`;
        const isHost = v.role === "host";
        const link = `${location.origin}${location.pathname}?sala=${v.room}`;
        return `
            <div class="room-code">
                <span>Código de sala</span>
                <strong>${v.room}</strong>
                <button class="btn ghost small" data-copy="${esc(link)}">Copiar enlace</button>
            </div>
            <ul class="seats">${v.seats.map((s, i) => this.seatRow(s, i, isHost && s.kind === "bot", v.me === i)).join("")}</ul>
            ${isHost && v.seats.length < 4 ? `<button class="btn ghost small" data-add-bot>+ Añadir IA</button>` : ""}
            ${isHost ? `<button class="btn primary wide" data-start-hosted>Empezar partida</button>` : `<p class="hint-text">Esperando a que el anfitrión empiece…</p>`}
            <button class="link" data-leave>Salir de la sala</button>`;
    }

    private seatRow(s: Seat, i: number, editable: boolean, isMe = false) {
        const color = PLAYER_COLORS[i];
        const kindToggle =
            this.view?.role !== "host" && this.view?.role !== "guest" && editable
                ? `<button class="kind" data-kind="${i}" title="Cambiar">${s.kind === "bot" ? "IA" : "Persona"}</button>`
                : `<span class="kind static">${s.kind === "bot" ? "IA" : s.online === false ? "Desconectado" : "Persona"}</span>`;
        const name =
            this.view?.role === "local" || !this.view
                ? `<input data-seat-name="${i}" maxlength="18" value="${esc(s.name)}" />`
                : `<span class="seat-name">${esc(s.name)}${isMe ? " (tú)" : ""}</span>`;
        const removable = editable && i > 0 && (this.view?.role === "host" ? s.kind === "bot" : this.localSeats.length > 2);
        return `<li style="--p:${color}"><span class="swatch"></span>${name}${kindToggle}${removable ? `<button class="x" data-remove="${i}" aria-label="Quitar">×</button>` : ""}</li>`;
    }

    private savedName() {
        try {
            return localStorage.getItem("hexterra:name") ?? "";
        } catch {
            return "";
        }
    }

    // --- In game ----------------------------------------------------------

    render(v: View) {
        const prev = this.view;
        this.view = v;
        if (v.error) this.toast(v.error);
        const playing = !!v.state;
        this.$("[data-lobby]").hidden = playing;
        this.$("[data-game]").hidden = !playing;
        this.root.closest<HTMLElement>(".hx")?.setAttribute("data-playing", String(playing));
        if (!playing) {
            // Leaving a game: close whatever dialog was open over it.
            if (prev?.state) this.closeModal();
            if (!prev || prev.status !== v.status || prev.seats !== v.seats || prev.role !== v.role || v.error) this.renderLobby();
            return;
        }
        const s = v.state!;
        // A fresh game: forget old dialogs and event cursors.
        if (!prev?.state || prev.state.seed !== s.seed) {
            this.lastSeq = 0;
            this.dialog = null;
            this.mode = null;
        }
        this.ensureMode(s, v.me);
        this.renderBanner(s, v.me);
        this.renderPlayers(s, v);
        this.renderCosts();
        this.renderDock(s, v.me);
        this.renderLog(s);
        this.renderModal(s, v.me);
        this.reapplyCoachTarget();
        const room = this.$("[data-room]");
        room.hidden = !v.room;
        room.innerHTML = v.room ? `Sala <b>${v.room}</b>` : "";
    }

    /** New events since the last render, for animations. */
    takeEvents(s: GameState): GameEvent[] {
        const fresh = s.events.filter((e) => e.seq > this.lastSeq);
        if (s.events.length) this.lastSeq = s.events[s.events.length - 1].seq;
        return fresh;
    }

    /** Drop build mode if it no longer makes sense; enter forced modes. */
    private ensureMode(s: GameState, me: number | null) {
        const mine = me !== null && s.current === me;
        let mode = this.mode;
        if (!mine || s.step !== "main" || s.trade) mode = null;
        if (mode && !this.canStartBuild(s, me!, mode)) mode = null;
        if (mode !== this.mode) {
            this.mode = mode;
            this.cb.setMode(mode);
        }
    }

    private canStartBuild(s: GameState, me: number, kind: BuildKind) {
        const h = s.players[me].hand;
        if (!h || !canAfford(h, COSTS[kind])) return false;
        const left = piecesLeft(s, me);
        if (kind === "conduit") return left.conduit > 0 && legalConduitSpots(s, me).length > 0;
        if (kind === "colony") return left.colony > 0 && legalColonySpots(s, me).length > 0;
        if (kind === "tower") return left.tower > 0 && legalTowerSpots(s, me).length > 0;
        return s.deck.length > 0;
    }

    private renderBanner(s: GameState, me: number | null) {
        const el = this.$("[data-banner]");
        const cur = s.players[s.current];
        const mine = me === s.current;
        const who = (i: number) => `<b style="color:${PLAYER_COLORS[i]}">${esc(s.players[i].name)}</b>`;
        let text = "";
        if (s.phase === "over") text = s.winner === me ? "Has ganado la partida" : `${who(s.winner!)} gana la partida`;
        else if (s.step === "discard") {
            text =
                me !== null && s.discards[me] !== undefined
                    ? `Tienes más de 7 cartas: descarta ${s.discards[me]}`
                    : `Esperando descartes…`;
        } else if (s.trade && me !== null && s.trade.from !== me && !s.trade.responses[me]) text = `${who(s.trade.from)} te propone un intercambio`;
        else if (mine) {
            text = {
                setupColony: "Coloca una colonia inicial",
                setupConduit: "Coloca un conducto junto a tu colonia",
                roll: "Tu turno: tira los dados",
                discard: "",
                moveDrone: "Elige un sector para el dron saboteador",
                steal: "Elige a quién robar",
                main: this.mode ? `Elige dónde construir: ${BUILD_LABEL[this.mode].toLowerCase()}` : "Construye, comercia o pasa el turno",
                printer: `Impresora: coloca ${s.freeConduits} conducto${s.freeConduits === 1 ? "" : "s"} gratis`,
            }[s.step];
        } else {
            const what = s.phase === "setup" ? "está colonizando" : "está jugando";
            text = `${who(s.current)} ${what}${cur.kind === "bot" ? "…" : ""}`;
        }
        const round = s.phase === "play" ? `<span class="round">Ronda ${s.round}${s.round % 5 === 4 ? " · evento orbital la próxima" : ""}</span>` : "";
        el.innerHTML = `<span>${text}</span>${round}`;
        el.dataset.mine = String(mine && s.phase !== "over");

        const dice = this.$("[data-dice]");
        dice.innerHTML = s.dice ? s.dice.map((d) => `<span class="die" data-v="${d}">${pips(d)}</span>`).join("") : "";
    }

    private renderPlayers(s: GameState, v: View) {
        const el = this.$("[data-players]");
        el.innerHTML = s.players
            .map((p, i) => {
                const vp = victoryPoints(s, i, i === v.me);
                const badges = [
                    s.longestRoad.owner === i ? `<span class="badge" title="Red de conductos más larga">Red ${s.longestRoad.length}</span>` : "",
                    s.largestFleet.owner === i ? `<span class="badge" title="Mayor flota de drones">Flota ${s.largestFleet.size}</span>` : "",
                ].join("");
                const offline = v.seats[i]?.online === false;
                return `
                <div class="player panel ${s.current === i ? "active" : ""}" style="--p:${PLAYER_COLORS[i]}">
                    <div class="pname"><span class="swatch"></span>${esc(p.name)}${i === v.me ? ` <em>(tú)</em>` : ""}${p.kind === "bot" ? ` <em>${offline ? "IA (desconectado)" : "IA"}</em>` : ""}</div>
                    <div class="pstats">
                        <span class="vp" title="Puntos de influencia"><b>${vp}</b>/${WIN_POINTS}</span>
                        <span title="Cartas de recurso">${cardIcon()} ${p.handCount}</span>
                        <span title="Tecnologías">${techIcon()} ${p.techCount}</span>
                        <span title="Drones jugados">${droneIcon()} ${p.dronesPlayed}</span>
                    </div>
                    ${badges ? `<div class="badges">${badges}</div>` : ""}
                </div>`;
            })
            .join("");
    }

    /** Open by default where there's room for it. */
    private costsOpen = typeof window === "undefined" || window.innerWidth > 760;
    private renderCosts() {
        const el = this.$("[data-costs]");
        el.classList.toggle("closed", !this.costsOpen);
        el.innerHTML = `
            <button class="costs-head" data-toggle-costs aria-expanded="${this.costsOpen}">Costes de construcción <span>${this.costsOpen ? "–" : "+"}</span></button>
            <div class="costs-body">
                ${(["conduit", "colony", "tower", "tech"] as BuildKind[])
                    .map(
                        (k) => `<div class="cost-row">
                            <span class="cost-name">${BUILD_LABEL[k]}<small>${BUILD_POINTS[k]}</small></span>
                            <span class="chips">${costChips(COSTS[k])}</span>
                        </div>`,
                    )
                    .join("")}
                <div class="cost-extra">
                    <div><b>Red más larga</b> (5+ conductos seguidos) <span>2 puntos</span></div>
                    <div><b>Mayor flota</b> (3+ drones jugados) <span>2 puntos</span></div>
                    <div><b>Gana</b> quien llegue a ${WIN_POINTS} puntos en su turno.</div>
                </div>
            </div>`;
    }

    private renderDock(s: GameState, me: number | null) {
        const el = this.$("[data-dock]");
        if (me === null) {
            el.innerHTML = `<p class="hint-text">Observando la partida…</p>`;
            return;
        }
        const pl = s.players[me];
        const h = pl.hand ?? emptyHand();
        const mine = s.current === me && s.phase === "play";
        const mainStep = mine && s.step === "main" && !s.trade;
        const hand = RESOURCES.map(
            (r) => `<div class="card ${h[r] ? "" : "zero"}" style="--c:${RESOURCE_ACCENT[r]}" title="${RESOURCE_NAMES[r]}">
                ${icon(r, 22)}<b>${h[r]}</b><small>${RESOURCE_NAMES[r]}</small></div>`,
        ).join("");
        const techs = [...(pl.tech ?? []), ...(pl.newTech ?? [])];
        const build = (["conduit", "colony", "tower", "tech"] as BuildKind[])
            .map((k) => {
                const ok = mainStep && this.canStartBuild(s, me, k);
                const active = this.mode === k;
                return `<button class="build ${active ? "active" : ""}" data-build="${k}" ${ok || active ? "" : "disabled"} title="${BUILD_LABEL[k]}: ${BUILD_POINTS[k]}">
                    <span>${BUILD_LABEL[k]}</span><span class="chips">${costChips(COSTS[k])}</span></button>`;
            })
            .join("");
        const roll = mine && s.step === "roll";
        el.innerHTML = `
            <div class="hand">${hand}
                <button class="card tech-card" data-open="tech" ${techs.length ? "" : "disabled"} title="Tus tecnologías">${techIcon(22)}<b>${techs.length}</b><small>Tecnología</small></button>
            </div>
            <div class="actions">
                ${roll ? `<button class="btn primary roll" data-roll>${diceIcon()} Tirar dados</button>` : build}
                <div class="row">
                    <button class="btn ghost" data-open="trade" ${mainStep ? "" : "disabled"}>Comerciar</button>
                    <button class="btn ${mainStep ? "primary" : "ghost"}" data-end ${mainStep ? "" : "disabled"}>Fin del turno</button>
                </div>
            </div>`;
    }

    private renderLog(s: GameState) {
        this.$("[data-log]").innerHTML = s.log
            .slice(-5)
            .map((l) => `<p>${esc(l.text)}</p>`)
            .join("");
    }

    // --- Dialogs ------------------------------------------------------------

    /** Which dialog is showing and the markup last written for it. */
    private modalKey = "";
    private modalHtml = "";

    private renderModal(s: GameState, me: number | null) {
        let key = "";
        let html = "";
        // Dialogs the game forces open first, then the ones the player opened.
        if (s.phase === "over") [key, html] = ["victory", this.victory(s, me)];
        else if (me !== null && s.step === "discard" && s.discards[me] !== undefined) [key, html] = ["discard", this.discardDialog(s, me)];
        else if (me !== null && s.step === "steal" && s.current === me) [key, html] = ["steal", this.stealDialog(s)];
        else if (me !== null && s.trade && s.trade.from !== me && !s.trade.responses[me]) [key, html] = ["incoming", this.incomingTrade(s, me)];
        else if (me !== null && s.trade && s.trade.from === me) [key, html] = ["pending", this.pendingTrade(s)];
        else if (this.dialog === "trade" && me !== null && s.current === me && s.step === "main") [key, html] = ["trade", this.tradeDialog(s, me)];
        else if (this.dialog === "tech" && me !== null) [key, html] = ["tech", this.techDialog(s, me)];
        else if (this.dialog === "rules") [key, html] = ["rules", rulesDialog()];
        else if (this.dialog === "leave") return;
        else this.dialog = null;
        this.setModal(key, html);
    }

    /**
     * Shows a dialog. The same dialog updating (a counter changing, a bot
     * answering) is patched in place without replaying its entrance, and only
     * when its markup actually changed.
     */
    private setModal(key: string, html: string) {
        const wrap = this.$("[data-modal]");
        wrap.hidden = !html;
        wrap.classList.toggle("settled", !!key && key === this.modalKey);
        this.modalKey = key;
        if (html === this.modalHtml) return;
        this.modalHtml = html;
        const scroll = wrap.querySelector(".modal")?.scrollTop ?? 0;
        wrap.innerHTML = html;
        const modal = wrap.querySelector(".modal");
        if (modal) modal.scrollTop = scroll;
    }

    private closeModal() {
        this.dialog = null;
        this.setModal("", "");
    }

    private stepper(group: "give" | "want" | "discard", r: Resource, max: number) {
        const n = this.draft[group][r];
        return `<div class="stepper" style="--c:${RESOURCE_ACCENT[r]}">
            ${icon(r, 20)}<span class="sname">${RESOURCE_NAMES[r]}</span>
            <button data-step="${group}:${r}:-1" ${n <= 0 ? "disabled" : ""} aria-label="Menos">−</button>
            <b>${n}</b>
            <button data-step="${group}:${r}:1" ${n >= max ? "disabled" : ""} aria-label="Más">+</button>
        </div>`;
    }

    private discardDialog(s: GameState, me: number) {
        const need = s.discards[me];
        const h = s.players[me].hand!;
        const chosen = handSize(this.draft.discard);
        return `<div class="modal panel">
            <h3>Descarta ${need} cartas</h3>
            <p class="hint-text">El dron saboteador ha salido y tienes más de 7 cartas.</p>
            ${RESOURCES.map((r) => this.stepper("discard", r, Math.min(h[r], this.draft.discard[r] + need - chosen))).join("")}
            <button class="btn primary wide" data-discard ${chosen === need ? "" : "disabled"}>Descartar (${chosen}/${need})</button>
        </div>`;
    }

    private stealDialog(s: GameState) {
        return `<div class="modal panel">
            <h3>¿A quién robas?</h3>
            <div class="choices">${s.stealFrom
                .map(
                    (i) => `<button class="btn ghost wide" data-steal="${i}" style="--p:${PLAYER_COLORS[i]}"><span class="swatch"></span>${esc(s.players[i].name)} · ${s.players[i].handCount} cartas</button>`,
                )
                .join("")}</div>
        </div>`;
    }

    private techDialog(s: GameState, me: number) {
        const pl = s.players[me];
        const ready = pl.tech ?? [];
        const fresh = pl.newTech ?? [];
        const canPlay = (c: TechCard) =>
            c !== "science" && s.current === me && !s.playedTechThisTurn && (s.step === "main" || (s.step === "roll" && c === "drone")) && !s.trade;
        const row = (c: TechCard, isNew: boolean, i: number) => {
            let extra = "";
            if (c === "extraction" && canPlay(c) && !isNew)
                extra = `<div class="pick">${RESOURCES.map((r) => `<button class="pickr ${this.draft.picks.filter((x) => x === r).length ? "on" : ""}" data-pick="${r}" title="${RESOURCE_NAMES[r]}">${icon(r, 18)}${this.draft.picks.filter((x) => x === r).length || ""}</button>`).join("")}</div>`;
            if (c === "monopoly" && canPlay(c) && !isNew)
                extra = `<div class="pick">${RESOURCES.map((r) => `<button class="pickr" data-monopoly="${r}" title="${RESOURCE_NAMES[r]}">${icon(r, 18)}</button>`).join("")}</div>`;
            const playBtn =
                isNew || !canPlay(c) || c === "monopoly"
                    ? ""
                    : `<button class="btn primary small" data-play="${c}" ${c === "extraction" && this.draft.picks.length !== 2 ? "disabled" : ""}>Usar</button>`;
            return `<div class="tech-row" data-i="${i}">
                <div><b>${TECH_NAMES[c]}</b>${isNew ? ` <em>nueva: úsala el próximo turno</em>` : ""}<p>${TECH_HELP[c]}</p>${extra}</div>
                ${playBtn}
            </div>`;
        };
        return `<div class="modal panel wide-modal">
            <h3>Tus tecnologías</h3>
            ${ready.length + fresh.length === 0 ? `<p class="hint-text">Aún no tienes ninguna.</p>` : ""}
            ${ready.map((c, i) => row(c, false, i)).join("")}${fresh.map((c, i) => row(c, true, 100 + i)).join("")}
            <p class="hint-text">Solo puedes usar una tecnología por turno. El Dron se puede usar antes de tirar.</p>
            <button class="btn ghost wide" data-close>Cerrar</button>
        </div>`;
    }

    private tradeTab: "bank" | "players" = "bank";
    private tradeDialog(s: GameState, me: number) {
        const h = s.players[me].hand!;
        if (this.tradeTab === "bank") {
            const give = RESOURCES.find((r) => this.draft.give[r] > 0) ?? null;
            const get = RESOURCES.find((r) => this.draft.want[r] > 0) ?? null;
            const ratio = give ? tradeRatio(s, me, give) : null;
            return `<div class="modal panel wide-modal">
                <h3>Comerciar</h3>
                ${tradeTabs(this.tradeTab)}
                <p class="hint-text">Cambia con el banco a 4:1, o mejor si tienes una colonia en una estación de comercio de la costa.</p>
                <div class="bank-grid">
                    <div><h4>Das</h4>${RESOURCES.map((r) => {
                        const ra = tradeRatio(s, me, r);
                        return `<button class="pickrow ${give === r ? "on" : ""}" data-bank-give="${r}" ${h[r] >= ra ? "" : "disabled"}>${icon(r, 18)} ${RESOURCE_NAMES[r]} <span>${ra}:1 · tienes ${h[r]}</span></button>`;
                    }).join("")}</div>
                    <div><h4>Recibes</h4>${RESOURCES.map(
                        (r) => `<button class="pickrow ${get === r ? "on" : ""}" data-bank-get="${r}" ${r === give || s.bank[r] <= 0 ? "disabled" : ""}>${icon(r, 18)} ${RESOURCE_NAMES[r]} <span>banco ${s.bank[r]}</span></button>`,
                    ).join("")}</div>
                </div>
                <button class="btn primary wide" data-bank-trade ${give && get && ratio ? "" : "disabled"}>${give && get ? `Cambiar ${ratio} ${RESOURCE_NAMES[give]} por 1 ${RESOURCE_NAMES[get]}` : "Elige qué das y qué recibes"}</button>
                <button class="btn ghost wide" data-close>Cerrar</button>
            </div>`;
        }
        const ok = handSize(this.draft.give) > 0 && handSize(this.draft.want) > 0;
        return `<div class="modal panel wide-modal">
            <h3>Comerciar</h3>
            ${tradeTabs(this.tradeTab)}
            <div class="bank-grid">
                <div><h4>Ofreces</h4>${RESOURCES.map((r) => this.stepper("give", r, h[r])).join("")}</div>
                <div><h4>Pides</h4>${RESOURCES.map((r) => this.stepper("want", r, 9)).join("")}</div>
            </div>
            <button class="btn primary wide" data-offer ${ok ? "" : "disabled"}>Proponer a todos</button>
            <button class="btn ghost wide" data-close>Cerrar</button>
        </div>`;
    }

    private pendingTrade(s: GameState) {
        const t = s.trade!;
        const rows = s.players
            .map((p, i) => {
                if (i === t.from) return "";
                const r = t.responses[i];
                const state = r === "accept" ? "acepta" : r === "reject" ? "rechaza" : "pensando…";
                return `<div class="resp" style="--p:${PLAYER_COLORS[i]}"><span class="swatch"></span>${esc(p.name)} <em>${state}</em>
                    ${r === "accept" ? `<button class="btn primary small" data-confirm="${i}">Cerrar trato</button>` : ""}</div>`;
            })
            .join("");
        return `<div class="modal panel">
            <h3>Tu oferta</h3>
            <div class="offer">${handLine(t.give)} <span>por</span> ${handLine(t.want)}</div>
            ${rows}
            <button class="btn ghost wide" data-cancel-trade>Retirar oferta</button>
        </div>`;
    }

    private incomingTrade(s: GameState, me: number) {
        const t = s.trade!;
        const can = canAfford(s.players[me].hand!, t.want);
        return `<div class="modal panel">
            <h3>${esc(s.players[t.from].name)} propone</h3>
            <div class="offer">Te da ${handLine(t.give)} <span>a cambio de</span> ${handLine(t.want)}</div>
            <div class="row">
                <button class="btn primary" data-respond="yes" ${can ? "" : "disabled"}>${can ? "Aceptar" : "No tienes esas cartas"}</button>
                <button class="btn ghost" data-respond="no">Rechazar</button>
            </div>
        </div>`;
    }

    private victory(s: GameState, me: number | null) {
        const rows = s.players
            .map((p, i) => ({ p, i, vp: victoryPoints(s, i, true) }))
            .sort((a, b) => b.vp - a.vp)
            .map(({ p, i, vp }) => `<div class="resp" style="--p:${PLAYER_COLORS[i]}"><span class="swatch"></span>${esc(p.name)}<em>${vp} puntos</em></div>`)
            .join("");
        return `<div class="modal panel">
            <p class="eyebrow">Fin de la partida</p>
            <h3>${s.winner === me ? "¡Has ganado!" : `Gana ${esc(s.players[s.winner!].name)}`}</h3>
            ${rows}
            <button class="btn primary wide" data-leave>Nueva partida</button>
        </div>`;
    }

    // --- Events -------------------------------------------------------------

    private onInput(e: Event) {
        const t = e.target as HTMLInputElement;
        if (t.dataset.seatName !== undefined) this.localSeats[Number(t.dataset.seatName)].name = t.value;
        if (t.dataset.name !== undefined) {
            try {
                localStorage.setItem("hexterra:name", t.value);
            } catch {
                /* private mode: fine */
            }
        }
        if (t.dataset.code !== undefined) t.value = t.value.toUpperCase();
    }

    private onClick(e: MouseEvent) {
        const el = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
        if (!el || el.disabled) return;
        const d = el.dataset;
        const s = this.view?.state;
        const act = (a: Action) => this.cb.act(a);

        if (d.playMenu !== undefined) {
            this.screen = "setup";
            return this.renderLobby();
        }
        if (d.menuBack !== undefined) {
            this.screen = "menu";
            return this.renderLobby();
        }
        if (d.tutorial !== undefined) return this.cb.startTutorial();
        if (d.coachNext !== undefined) return this.cb.coachNext();
        if (d.leaveAsk !== undefined) return this.confirmLeave();
        if (d.droneOk !== undefined) return this.cb.confirmDrone();
        if (d.droneCancel !== undefined) return this.cb.cancelDrone();
        if (d.tab) {
            this.lobbyTab = d.tab as typeof this.lobbyTab;
            this.renderLobby();
        } else if (d.addSeat !== undefined) {
            this.localSeats.push({ name: `IA ${["Orión", "Vega", "Lira", "Sirio"][this.localSeats.length]}`, kind: "bot" });
            this.renderLobby();
        } else if (d.addBot !== undefined && this.view) {
            const seats = [...this.view.seats, { name: `IA ${["Orión", "Vega", "Lira", "Sirio"][this.view.seats.length]}`, kind: "bot" as const }];
            this.cb.setSeats(seats);
        } else if (d.remove !== undefined) {
            const i = Number(d.remove);
            if (this.view && this.view.role === "host") this.cb.setSeats(this.view.seats.filter((_, j) => j !== i));
            else {
                this.localSeats.splice(i, 1);
                this.renderLobby();
            }
        } else if (d.kind !== undefined) {
            const seat = this.localSeats[Number(d.kind)];
            seat.kind = seat.kind === "bot" ? "human" : "bot";
            if (seat.kind === "human" && seat.name.startsWith("IA ")) seat.name = `Jugador ${Number(d.kind) + 1}`;
            this.renderLobby();
        } else if (d.reroll !== undefined) this.cb.rerollPlanet();
        else if (d.startLocal !== undefined) {
            if (!this.localSeats.some((x) => x.kind === "human")) return this.toast("Hace falta al menos una persona");
            this.cb.startLocal(this.localSeats.map((x, i) => ({ ...x, name: x.name.trim() || `Jugador ${i + 1}` })));
        } else if (d.host !== undefined) this.cb.host(this.inputValue("[data-name]") || "Anfitrión");
        else if (d.join !== undefined) {
            const code = this.inputValue("[data-code]");
            if (code.length < 5) return this.toast("El código tiene 5 caracteres");
            this.cb.join(this.inputValue("[data-name]") || "Invitado", code);
        } else if (d.startHosted !== undefined) this.cb.startHosted();
        else if (d.copy) {
            void navigator.clipboard?.writeText(d.copy).then(() => this.toast("Enlace copiado"));
        } else if (d.leave !== undefined) {
            this.closeModal();
            this.cb.leave();
        }
        else if (d.rules !== undefined) {
            this.dialog = "rules";
            this.showStatic(rulesDialog(), "rules");
        } else if (d.toggleCosts !== undefined) {
            this.costsOpen = !this.costsOpen;
            this.renderCosts();
        } else if (d.close !== undefined) {
            this.closeModal();
            this.resetDraft();
            if (s) this.renderModal(s, this.view!.me);
        } else if (!s) return;
        else if (d.roll !== undefined) act({ type: "roll" });
        else if (d.end !== undefined) act({ type: "endTurn" });
        else if (d.build) {
            const k = d.build as BuildKind;
            if (k === "tech") return act({ type: "buyTech" });
            this.mode = this.mode === k ? null : k;
            this.cb.setMode(this.mode);
            this.rerender();
        } else if (d.open) {
            this.dialog = d.open;
            this.resetDraft();
            this.rerender();
        } else if (d.step) {
            const [g, r, delta] = d.step.split(":") as ["give" | "want" | "discard", Resource, string];
            this.draft[g][r] = Math.max(0, this.draft[g][r] + Number(delta));
            if (g === "give" && this.draft.give[r]) this.draft.want[r] = 0;
            if (g === "want" && this.draft.want[r]) this.draft.give[r] = 0;
            this.rerender();
        } else if (d.discard !== undefined) {
            act({ type: "discard", cards: { ...this.draft.discard } });
            this.resetDraft();
        } else if (d.steal) act({ type: "steal", victim: Number(d.steal) });
        else if (d.tradeTab) {
            this.tradeTab = d.tradeTab as typeof this.tradeTab;
            this.resetDraft();
            this.rerender();
        } else if (d.bankGive) {
            this.draft.give = handFrom({ [d.bankGive]: 1 });
            if (this.draft.want[d.bankGive as Resource]) this.draft.want = emptyHand();
            this.rerender();
        } else if (d.bankGet) {
            this.draft.want = handFrom({ [d.bankGet]: 1 });
            this.rerender();
        } else if (d.bankTrade !== undefined) {
            const give = RESOURCES.find((r) => this.draft.give[r] > 0)!;
            const get = RESOURCES.find((r) => this.draft.want[r] > 0)!;
            act({ type: "bankTrade", give, get });
            this.draft.give = emptyHand();
            this.draft.want = emptyHand();
        } else if (d.offer !== undefined) {
            act({ type: "offerTrade", give: { ...this.draft.give }, want: { ...this.draft.want } });
            this.dialog = null;
            this.resetDraft();
        } else if (d.confirm) act({ type: "confirmTrade", with: Number(d.confirm) });
        else if (d.cancelTrade !== undefined) act({ type: "cancelTrade" });
        else if (d.respond) act({ type: "respondTrade", accept: d.respond === "yes" });
        else if (d.pick) {
            const r = d.pick as Resource;
            if (this.draft.picks.length >= 2) this.draft.picks = [];
            this.draft.picks.push(r);
            this.rerender();
        } else if (d.play) {
            const card = d.play as Exclude<TechCard, "science">;
            act(card === "extraction" ? { type: "playTech", card, resources: [...this.draft.picks] } : { type: "playTech", card });
            this.dialog = null;
            this.resetDraft();
        } else if (d.monopoly) {
            act({ type: "playTech", card: "monopoly", resource: d.monopoly as Resource });
            this.dialog = null;
        }
    }

    private inputValue(sel: string) {
        return (this.root.querySelector<HTMLInputElement>(sel)?.value ?? "").trim();
    }

    private resetDraft() {
        this.draft = { give: emptyHand(), want: emptyHand(), discard: emptyHand(), picks: [] };
    }

    private rerender() {
        if (this.view) this.render({ ...this.view, error: undefined });
    }

    private showStatic(html: string, key = "static") {
        this.setModal(key, html);
    }

    /** The "send the drone here?" bar; null hides it. */
    setDroneChoice(label: string | null) {
        const el = this.$("[data-confirm]");
        el.hidden = !label;
        if (!label) return;
        el.innerHTML = `<p>Enviar el dron a <b>${esc(label)}</b></p>
            <div class="row">
                <button class="btn ghost" data-drone-cancel>Cancelar</button>
                <button class="btn primary" data-drone-ok>Confirmar</button>
            </div>`;
    }

    /** Called by main when a build mode was cancelled from the board. */
    clearMode() {
        this.mode = null;
        this.rerender();
    }

    toast(msg: string) {
        const t = this.$("[data-toast]");
        t.textContent = msg;
        t.classList.add("show");
        clearTimeout(this.toastTimer);
        this.toastTimer = window.setTimeout(() => t.classList.remove("show"), 2600);
    }

    /** A "+2" chip rising from a point on screen. */
    floater(x: number, y: number, html: string, delay = 0) {
        const el = document.createElement("div");
        el.className = "floater";
        el.innerHTML = html;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.animationDelay = `${delay}ms`;
        this.$("[data-floaters]").append(el);
        setTimeout(() => el.remove(), 2200 + delay);
    }

    /** Who must act now, for whoever drives turn-passing in hot-seat. */
    static waiting(s: GameState) {
        return waitingOn(s);
    }
}

function tradeTabs(active: "bank" | "players") {
    return `<div class="tabs small">
        <button data-trade-tab="bank" aria-selected="${active === "bank"}">Banco y estaciones</button>
        <button data-trade-tab="players" aria-selected="${active === "players"}">Con jugadores</button>
    </div>`;
}

function handLine(h: Hand) {
    return `<span class="hand-line">${RESOURCES.filter((r) => h[r])
        .map((r) => `<span class="chip">${icon(r, 14)}${h[r]}</span>`)
        .join("")}</span>`;
}

function pips(n: number) {
    const spots: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
    return Array.from({ length: 9 }, (_, i) => `<i class="${spots[n].includes(i) ? "on" : ""}"></i>`).join("");
}

const cardIcon = (s = 14) =>
    `<svg viewBox="0 0 24 24" width="${s}" height="${s}" class="mi" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/></svg>`;
const techIcon = (s = 14) =>
    `<svg viewBox="0 0 24 24" width="${s}" height="${s}" class="mi" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/></svg>`;
const droneIcon = (s = 14) =>
    `<svg viewBox="0 0 24 24" width="${s}" height="${s}" class="mi" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2.5"/><circle cx="19" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M7 7l3 3M17 7l-3 3M7 17l3-3M17 17l-3-3"/></svg>`;
const diceIcon = () =>
    `<svg viewBox="0 0 24 24" width="18" height="18" class="mi" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="15" r="1.2"/><circle cx="15" cy="9" r="1.2"/><circle cx="9" cy="15" r="1.2"/></svg>`;

function rulesDialog() {
    return `<div class="modal panel wide-modal rules">
        <h3>Cómo se juega</h3>
        <p>Cada corporación coloniza el planeta. Gana quien llegue primero a <b>${WIN_POINTS} puntos de influencia</b> durante su turno.</p>
        <h4>Preparación</h4>
        <p>Por turnos (1-2-3-4-4-3-2-1) cada jugador coloca 2 colonias y un conducto junto a cada una. La segunda colonia da un recurso de cada sector que toca.</p>
        <h4>Tu turno</h4>
        <ol>
            <li><b>Tira los dados.</b> Cada sector con ese número produce: 1 recurso por colonia y 2 por torre a su alrededor. El sector con el dron no produce.</li>
            <li><b>Comercia</b> con el banco (4:1, o 3:1 y 2:1 en las estaciones de la costa) o propón cambios a los demás.</li>
            <li><b>Construye</b> y usa como mucho una tecnología. Luego pasa el turno.</li>
        </ol>
        <h4>Si sale un 7</h4>
        <p>Quien tenga más de 7 cartas descarta la mitad. Después mueves el dron saboteador a otro sector y robas una carta a alguien con un edificio allí.</p>
        <h4>Construir</h4>
        <p>Los conductos van en las aristas y deben conectar con tu red. Las colonias van en los vértices, conectadas a tus conductos y sin otra colonia a un paso. Una torre mejora una colonia tuya.</p>
        <h4>Eventos orbitales</h4>
        <p>Cada 5 rondas ocurre algo: una tormenta solar apaga la Energía una ronda, una lluvia de meteoritos cambia un sector de recurso, o una alineación planetaria duplica la siguiente producción.</p>
        <button class="btn ghost wide" data-close>Entendido</button>
    </div>`;
}

export { PLANET_NAMES };
