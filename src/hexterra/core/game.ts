// The rules of Hexterra as a pure reducer: `apply(state, action)` returns the
// next state or throws a RuleError. No Three.js, no DOM, no clocks: the same
// code runs the local game, the online host and the tests.

import { TERRAIN_RESOURCE, generateBoard, type Board, type Resource, type Terrain } from "./board";
import { buildTopology, otherEnd, type Topology } from "./graph";

export const RESOURCES: Resource[] = ["energy", "metal", "silicon", "biomass", "water"];
export type Hand = Record<Resource, number>;

export type BuildKind = "conduit" | "colony" | "tower" | "tech";

export const COSTS: Record<BuildKind, Partial<Hand>> = {
    conduit: { metal: 1, energy: 1 },
    colony: { metal: 1, energy: 1, biomass: 1, water: 1 },
    tower: { metal: 3, silicon: 2 },
    tech: { silicon: 1, biomass: 1, water: 1 },
};

/** Pieces each corporation owns. */
export const LIMITS = { conduit: 15, colony: 5, tower: 4 };

export type TechCard = "drone" | "printer" | "extraction" | "monopoly" | "science";
export const TECH_DECK: Record<TechCard, number> = { drone: 14, printer: 2, extraction: 2, monopoly: 2, science: 5 };

export const WIN_POINTS = 10;
export const HAND_LIMIT = 7;
export const BANK_STOCK = 19;
/** Every this many rounds an orbital event fires. */
export const EVENT_EVERY = 5;

export type OrbitalEvent = "solarStorm" | "meteor" | "alignment";

export interface Player {
    name: string;
    kind: "human" | "bot";
    /** null when redacted for another viewer. */
    hand: Hand | null;
    handCount: number;
    /** Playable tech cards; null when redacted. */
    tech: TechCard[] | null;
    /** Bought this turn: can't be played until the next. */
    newTech: TechCard[] | null;
    techCount: number;
    dronesPlayed: number;
}

export type Step =
    | "setupColony"
    | "setupConduit"
    | "roll"
    | "discard"
    | "moveDrone"
    | "steal"
    | "main"
    | "printer";

export type GameEvent =
    | { seq: number; kind: "dice"; dice: [number, number]; player: number }
    | { seq: number; kind: "production"; gains: { player: number; resource: Resource; amount: number; tile: number }[]; roll: number }
    | { seq: number; kind: "built"; what: "conduit" | "colony" | "tower"; at: number; player: number }
    | { seq: number; kind: "drone"; tile: number; player: number }
    | { seq: number; kind: "steal"; thief: number; victim: number; resource: Resource | null }
    | { seq: number; kind: "orbital"; event: OrbitalEvent; tile?: number; from?: Terrain; to?: Terrain }
    | { seq: number; kind: "tech"; player: number; card: TechCard | null }
    | { seq: number; kind: "trade"; a: number; b: number | "bank" }
    | { seq: number; kind: "win"; player: number };

export interface TradeOffer {
    from: number;
    give: Hand;
    want: Hand;
    responses: Record<number, "accept" | "reject">;
}

export interface GameState {
    version: 1;
    seed: number;
    board: Board;
    topology: Topology;
    players: Player[];
    /** vertex id → building. */
    buildings: Record<number, { owner: number; kind: "colony" | "tower" }>;
    /** edge id → owner. */
    conduits: Record<number, number>;
    drone: number;
    current: number;
    phase: "setup" | "play" | "over";
    step: Step;
    /** Index into the snake order during setup. */
    setupIndex: number;
    lastSetupColony: number | null;
    dice: [number, number] | null;
    /** Where play resumes after the drone has been moved. */
    afterDrone: "roll" | "main";
    discards: Record<number, number>;
    stealFrom: number[];
    freeConduits: number;
    playedTechThisTurn: boolean;
    bank: Hand;
    deck: TechCard[];
    round: number;
    solarStormRound: number | null;
    alignment: boolean;
    longestRoad: { owner: number | null; length: number };
    largestFleet: { owner: number | null; size: number };
    trade: TradeOffer | null;
    winner: number | null;
    events: GameEvent[];
    seq: number;
    log: { seq: number; text: string }[];
    rng: number;
}

export type Action =
    | { type: "placeColony"; vertex: number }
    | { type: "placeConduit"; edge: number }
    | { type: "upgradeTower"; vertex: number }
    | { type: "roll" }
    | { type: "discard"; cards: Partial<Hand> }
    | { type: "moveDrone"; tile: number }
    | { type: "steal"; victim: number | null }
    | { type: "buyTech" }
    | { type: "playTech"; card: Exclude<TechCard, "science">; resources?: Resource[]; resource?: Resource }
    | { type: "bankTrade"; give: Resource; get: Resource }
    | { type: "offerTrade"; give: Partial<Hand>; want: Partial<Hand> }
    | { type: "respondTrade"; accept: boolean }
    | { type: "confirmTrade"; with: number }
    | { type: "cancelTrade" }
    | { type: "endTurn" };

export type Move = Action & { player: number };

export class RuleError extends Error {}

// --- Helpers ------------------------------------------------------------

export const emptyHand = (): Hand => ({ energy: 0, metal: 0, silicon: 0, biomass: 0, water: 0 });
export const handFrom = (p: Partial<Hand>): Hand => ({ ...emptyHand(), ...p });
export const handSize = (h: Hand) => RESOURCES.reduce((n, r) => n + h[r], 0);
export const canAfford = (h: Hand, cost: Partial<Hand>) => RESOURCES.every((r) => h[r] >= (cost[r] ?? 0));

function rand(s: GameState): number {
    // mulberry32, stepped in the state so the host's dice are reproducible.
    s.rng = (s.rng + 0x6d2b79f5) >>> 0;
    let t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function fail(msg: string): never {
    throw new RuleError(msg);
}

type EventInput = GameEvent extends infer E ? (E extends GameEvent ? Omit<E, "seq"> : never) : never;

function emit(s: GameState, e: EventInput) {
    s.seq++;
    s.events.push({ ...e, seq: s.seq } as GameEvent);
    if (s.events.length > 40) s.events.splice(0, s.events.length - 40);
}

function log(s: GameState, text: string) {
    s.seq++;
    s.log.push({ seq: s.seq, text });
    if (s.log.length > 60) s.log.splice(0, s.log.length - 60);
}

export const RESOURCE_NAMES: Record<Resource, string> = {
    energy: "Energía",
    metal: "Metal",
    silicon: "Silicio",
    biomass: "Biomasa",
    water: "Agua",
};

export const TECH_NAMES: Record<TechCard, string> = {
    drone: "Dron",
    printer: "Impresora de conductos",
    extraction: "Extracción orbital",
    monopoly: "Monopolio de datos",
    science: "Avance científico",
};

const hand = (s: GameState, p: number) => s.players[p].hand!;

function pay(s: GameState, p: number, cost: Partial<Hand>) {
    const h = hand(s, p);
    for (const r of RESOURCES) {
        const n = cost[r] ?? 0;
        h[r] -= n;
        s.bank[r] += n;
    }
    syncCounts(s, p);
}

function gain(s: GameState, p: number, r: Resource, n: number) {
    hand(s, p)[r] += n;
    s.bank[r] -= n;
    syncCounts(s, p);
}

function syncCounts(s: GameState, p: number) {
    const pl = s.players[p];
    pl.handCount = handSize(pl.hand!);
    pl.techCount = pl.tech!.length + pl.newTech!.length;
}

// --- Setup ----------------------------------------------------------------

export interface NewGameOptions {
    seed: number;
    players: { name: string; kind: "human" | "bot" }[];
}

export function newGame({ seed, players }: NewGameOptions): GameState {
    if (players.length < 2 || players.length > 4) fail("Hacen falta entre 2 y 4 jugadores");
    const board = generateBoard(seed);
    const s: GameState = {
        version: 1,
        seed,
        board,
        topology: buildTopology(board),
        players: players.map((p) => ({
            name: p.name,
            kind: p.kind,
            hand: emptyHand(),
            handCount: 0,
            tech: [],
            newTech: [],
            techCount: 0,
            dronesPlayed: 0,
        })),
        buildings: {},
        conduits: {},
        drone: board.tiles.findIndex((t) => t.terrain === "desert"),
        current: 0,
        phase: "setup",
        step: "setupColony",
        setupIndex: 0,
        lastSetupColony: null,
        dice: null,
        afterDrone: "main",
        discards: {},
        stealFrom: [],
        freeConduits: 0,
        playedTechThisTurn: false,
        bank: handFrom(Object.fromEntries(RESOURCES.map((r) => [r, BANK_STOCK]))),
        deck: [],
        round: 0,
        solarStormRound: null,
        alignment: false,
        longestRoad: { owner: null, length: 0 },
        largestFleet: { owner: null, size: 0 },
        trade: null,
        winner: null,
        events: [],
        seq: 0,
        log: [],
        rng: (seed ^ 0x9e3779b9) >>> 0,
    };
    const deck = (Object.keys(TECH_DECK) as TechCard[]).flatMap((c) => Array<TechCard>(TECH_DECK[c]).fill(c));
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rand(s) * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    s.deck = deck;
    log(s, "Empieza la colonización. Cada corporación coloca dos colonias y dos conductos.");
    return s;
}

/** Seat that places at each setup step: 0,1,…,n-1,n-1,…,0. */
export function setupSeat(n: number, index: number) {
    return index < n ? index : 2 * n - 1 - index;
}

// --- Queries --------------------------------------------------------------

export function victoryPoints(s: GameState, p: number, includeHidden = true): number {
    let vp = 0;
    for (const b of Object.values(s.buildings)) if (b.owner === p) vp += b.kind === "tower" ? 2 : 1;
    if (s.longestRoad.owner === p) vp += 2;
    if (s.largestFleet.owner === p) vp += 2;
    if (includeHidden) {
        const pl = s.players[p];
        vp += [...(pl.tech ?? []), ...(pl.newTech ?? [])].filter((c) => c === "science").length;
    }
    return vp;
}

export function piecesLeft(s: GameState, p: number) {
    let colony = LIMITS.colony;
    let tower = LIMITS.tower;
    let conduit = LIMITS.conduit;
    for (const b of Object.values(s.buildings)) {
        if (b.owner !== p) continue;
        if (b.kind === "colony") colony--;
        else tower--;
    }
    for (const o of Object.values(s.conduits)) if (o === p) conduit--;
    return { colony, tower, conduit };
}

/** Distance rule: the vertex and its neighbours are empty. */
function vertexFree(s: GameState, v: number) {
    if (s.buildings[v]) return false;
    return s.topology.vertices[v].neighbors.every((n) => !s.buildings[n]);
}

function touchesOwnConduit(s: GameState, p: number, v: number) {
    return s.topology.vertices[v].edges.some((e) => s.conduits[e] === p);
}

export function canPlaceColony(s: GameState, p: number, v: number, setup = s.phase === "setup"): boolean {
    if (!s.topology.vertices[v] || !vertexFree(s, v)) return false;
    if (setup) return true;
    return touchesOwnConduit(s, p, v);
}

export function canPlaceConduit(s: GameState, p: number, edge: number): boolean {
    const e = s.topology.edges[edge];
    if (!e || s.conduits[edge] !== undefined) return false;
    if (s.phase === "setup") return s.lastSetupColony !== null && (e.a === s.lastSetupColony || e.b === s.lastSetupColony);
    // Connects through an end that is ours, or open and reached by our conduit.
    return [e.a, e.b].some((v) => {
        const b = s.buildings[v];
        if (b) return b.owner === p;
        return s.topology.vertices[v].edges.some((o) => o !== edge && s.conduits[o] === p);
    });
}

export function legalColonySpots(s: GameState, p: number) {
    return s.topology.vertices.filter((v) => canPlaceColony(s, p, v.id)).map((v) => v.id);
}

export function legalConduitSpots(s: GameState, p: number) {
    return s.topology.edges.filter((e) => canPlaceConduit(s, p, e.id)).map((e) => e.id);
}

export function legalTowerSpots(s: GameState, p: number) {
    return Object.entries(s.buildings)
        .filter(([, b]) => b.owner === p && b.kind === "colony")
        .map(([v]) => Number(v));
}

/** Best ratio this player gets when giving `r` to the bank. */
export function tradeRatio(s: GameState, p: number, r: Resource): number {
    let ratio = 4;
    for (const h of s.topology.harbors) {
        const e = s.topology.edges[h.edge];
        const owns = [e.a, e.b].some((v) => s.buildings[v]?.owner === p);
        if (!owns) continue;
        if (h.kind === r) ratio = Math.min(ratio, 2);
        else if (h.kind === "any") ratio = Math.min(ratio, 3);
    }
    return ratio;
}

/** Players with a building on `tile`, other than `p`, who hold cards. */
export function stealTargets(s: GameState, p: number, tile: number) {
    const owners = new Set<number>();
    for (const v of s.topology.tileVertices[tile]) {
        const b = s.buildings[v];
        if (b && b.owner !== p) owners.add(b.owner);
    }
    return [...owners].filter((o) => s.players[o].handCount > 0).sort();
}

/** Longest simple trail of `p`'s conduits, not passing through rivals' buildings. */
export function longestConduit(s: GameState, p: number): number {
    const mine = Object.entries(s.conduits)
        .filter(([, o]) => o === p)
        .map(([e]) => Number(e));
    if (!mine.length) return 0;
    const used = new Set<number>();
    let best = 0;
    const walk = (v: number, len: number) => {
        best = Math.max(best, len);
        const b = s.buildings[v];
        if (len > 0 && b && b.owner !== p) return;
        for (const e of s.topology.vertices[v].edges) {
            if (used.has(e) || s.conduits[e] !== p) continue;
            used.add(e);
            walk(otherEnd(s.topology, e, v), len + 1);
            used.delete(e);
        }
    };
    const starts = new Set<number>();
    for (const e of mine) {
        starts.add(s.topology.edges[e].a);
        starts.add(s.topology.edges[e].b);
    }
    for (const v of starts) walk(v, 0);
    return best;
}

// --- Reducer --------------------------------------------------------------

/** Who has to act now: the current player, or players owing discards. */
export function waitingOn(s: GameState): number[] {
    if (s.phase === "over") return [];
    if (s.step === "discard") return Object.keys(s.discards).map(Number);
    if (s.trade) {
        const pending = s.players.map((_, i) => i).filter((i) => i !== s.trade!.from && !s.trade!.responses[i]);
        if (pending.length) return pending;
    }
    return [s.current];
}

export function apply(state: GameState, move: Move): GameState {
    if (state.phase === "over") fail("La partida ha terminado");
    const s: GameState = structuredClone(state);
    const p = move.player;
    if (!s.players[p]) fail("Jugador desconocido");
    const isCurrent = p === s.current;

    switch (move.type) {
        case "placeColony": {
            if (!isCurrent) fail("No es tu turno");
            if (s.phase === "setup") {
                if (s.step !== "setupColony") fail("Ahora toca colocar un conducto");
                if (!canPlaceColony(s, p, move.vertex, true)) fail("No puedes fundar una colonia ahí");
                s.buildings[move.vertex] = { owner: p, kind: "colony" };
                s.lastSetupColony = move.vertex;
                // The second colony yields one of each neighbouring resource.
                if (s.setupIndex >= s.players.length) {
                    for (const t of s.topology.vertices[move.vertex].tiles) {
                        const r = TERRAIN_RESOURCE[s.board.tiles[t].terrain];
                        if (r && s.bank[r] > 0) gain(s, p, r, 1);
                    }
                }
                s.step = "setupConduit";
            } else {
                mainStep(s);
                if (piecesLeft(s, p).colony <= 0) fail("No te quedan colonias");
                if (!canAfford(hand(s, p), COSTS.colony)) fail("No tienes recursos para una colonia");
                if (!canPlaceColony(s, p, move.vertex)) fail("No puedes fundar una colonia ahí");
                pay(s, p, COSTS.colony);
                s.buildings[move.vertex] = { owner: p, kind: "colony" };
                updateLongestRoad(s);
            }
            emit(s, { kind: "built", what: "colony", at: move.vertex, player: p });
            log(s, `${s.players[p].name} funda una colonia.`);
            break;
        }

        case "placeConduit": {
            if (!isCurrent) fail("No es tu turno");
            if (s.phase === "setup") {
                if (s.step !== "setupConduit") fail("Primero coloca una colonia");
                if (!canPlaceConduit(s, p, move.edge)) fail("El conducto debe salir de tu última colonia");
                s.conduits[move.edge] = p;
                emit(s, { kind: "built", what: "conduit", at: move.edge, player: p });
                advanceSetup(s);
                break;
            }
            const free = s.step === "printer";
            if (!free) mainStep(s);
            if (piecesLeft(s, p).conduit <= 0) fail("No te quedan conductos");
            if (!free && !canAfford(hand(s, p), COSTS.conduit)) fail("No tienes recursos para un conducto");
            if (!canPlaceConduit(s, p, move.edge)) fail("El conducto debe conectar con tu red");
            if (!free) pay(s, p, COSTS.conduit);
            s.conduits[move.edge] = p;
            emit(s, { kind: "built", what: "conduit", at: move.edge, player: p });
            if (free) {
                s.freeConduits--;
                if (s.freeConduits <= 0 || legalConduitSpots(s, p).length === 0 || piecesLeft(s, p).conduit <= 0) {
                    s.freeConduits = 0;
                    s.step = "main";
                }
            }
            updateLongestRoad(s);
            break;
        }

        case "upgradeTower": {
            if (!isCurrent) fail("No es tu turno");
            mainStep(s);
            const b = s.buildings[move.vertex];
            if (!b || b.owner !== p || b.kind !== "colony") fail("Solo puedes mejorar tus colonias");
            if (piecesLeft(s, p).tower <= 0) fail("No te quedan torres");
            if (!canAfford(hand(s, p), COSTS.tower)) fail("No tienes recursos para una torre");
            pay(s, p, COSTS.tower);
            b.kind = "tower";
            emit(s, { kind: "built", what: "tower", at: move.vertex, player: p });
            log(s, `${s.players[p].name} levanta una torre arcológica.`);
            break;
        }

        case "roll": {
            if (!isCurrent || s.step !== "roll") fail("Ahora no puedes tirar");
            const dice: [number, number] = [1 + Math.floor(rand(s) * 6), 1 + Math.floor(rand(s) * 6)];
            s.dice = dice;
            const total = dice[0] + dice[1];
            emit(s, { kind: "dice", dice, player: p });
            log(s, `${s.players[p].name} saca un ${total}.`);
            if (total === 7) {
                s.discards = {};
                s.players.forEach((pl, i) => {
                    if (pl.handCount > HAND_LIMIT) s.discards[i] = Math.floor(pl.handCount / 2);
                });
                s.afterDrone = "main";
                s.step = Object.keys(s.discards).length ? "discard" : "moveDrone";
            } else {
                produce(s, total);
                s.step = "main";
            }
            break;
        }

        case "discard": {
            if (s.step !== "discard" || s.discards[p] === undefined) fail("No tienes que descartar");
            const cards = handFrom(move.cards);
            if (handSize(cards) !== s.discards[p]) fail(`Debes descartar ${s.discards[p]} cartas`);
            if (!canAfford(hand(s, p), cards)) fail("No tienes esas cartas");
            pay(s, p, cards);
            delete s.discards[p];
            log(s, `${s.players[p].name} descarta ${handSize(cards)} cartas.`);
            if (!Object.keys(s.discards).length) s.step = "moveDrone";
            break;
        }

        case "moveDrone": {
            if (!isCurrent || s.step !== "moveDrone") fail("Ahora no puedes mover el dron");
            if (!s.board.tiles[move.tile]) fail("Sector desconocido");
            if (move.tile === s.drone) fail("El dron tiene que cambiar de sector");
            s.drone = move.tile;
            emit(s, { kind: "drone", tile: move.tile, player: p });
            log(s, `${s.players[p].name} envía el dron saboteador.`);
            s.stealFrom = stealTargets(s, p, move.tile);
            s.step = s.stealFrom.length ? "steal" : s.afterDrone;
            break;
        }

        case "steal": {
            if (!isCurrent || s.step !== "steal") fail("Ahora no puedes robar");
            if (move.victim === null || !s.stealFrom.includes(move.victim)) fail("Elige a quién robar");
            const vh = hand(s, move.victim);
            const pool = RESOURCES.flatMap((r) => Array<Resource>(vh[r]).fill(r));
            const r = pool.length ? pool[Math.floor(rand(s) * pool.length)] : null;
            if (r) {
                vh[r]--;
                hand(s, p)[r]++;
                syncCounts(s, move.victim);
                syncCounts(s, p);
            }
            emit(s, { kind: "steal", thief: p, victim: move.victim, resource: r });
            log(s, `${s.players[p].name} roba una carta a ${s.players[move.victim].name}.`);
            s.stealFrom = [];
            s.step = s.afterDrone;
            break;
        }

        case "buyTech": {
            if (!isCurrent) fail("No es tu turno");
            mainStep(s);
            if (!s.deck.length) fail("No quedan tecnologías");
            if (!canAfford(hand(s, p), COSTS.tech)) fail("No tienes recursos para una tecnología");
            pay(s, p, COSTS.tech);
            const card = s.deck.pop()!;
            s.players[p].newTech!.push(card);
            syncCounts(s, p);
            emit(s, { kind: "tech", player: p, card: null });
            log(s, `${s.players[p].name} investiga una tecnología.`);
            break;
        }

        case "playTech": {
            if (!isCurrent) fail("No es tu turno");
            if (s.playedTechThisTurn) fail("Solo una tecnología por turno");
            if (s.step !== "main" && !(s.step === "roll" && move.card === "drone")) fail("Ahora no puedes usar tecnologías");
            const pl = s.players[p];
            const i = pl.tech!.indexOf(move.card);
            if (i < 0) fail("No tienes esa tecnología lista");
            pl.tech!.splice(i, 1);
            s.playedTechThisTurn = true;
            syncCounts(s, p);
            emit(s, { kind: "tech", player: p, card: move.card });
            log(s, `${pl.name} usa ${TECH_NAMES[move.card]}.`);
            if (move.card === "drone") {
                pl.dronesPlayed++;
                updateLargestFleet(s);
                s.afterDrone = s.step === "roll" ? "roll" : "main";
                s.step = "moveDrone";
            } else if (move.card === "printer") {
                s.freeConduits = Math.min(2, piecesLeft(s, p).conduit);
                s.step = s.freeConduits && legalConduitSpots(s, p).length ? "printer" : "main";
            } else if (move.card === "extraction") {
                const rs = move.resources ?? [];
                if (rs.length !== 2) fail("Elige dos recursos");
                for (const r of rs) {
                    if (s.bank[r] <= 0) fail(`El banco no tiene ${RESOURCE_NAMES[r]}`);
                    gain(s, p, r, 1);
                }
            } else if (move.card === "monopoly") {
                const r = move.resource;
                if (!r) fail("Elige un recurso");
                let total = 0;
                s.players.forEach((o, j) => {
                    if (j === p) return;
                    total += o.hand![r];
                    hand(s, p)[r] += o.hand![r];
                    o.hand![r] = 0;
                    syncCounts(s, j);
                });
                syncCounts(s, p);
                log(s, `${pl.name} se queda con ${total} de ${RESOURCE_NAMES[r]}.`);
            }
            break;
        }

        case "bankTrade": {
            if (!isCurrent) fail("No es tu turno");
            mainStep(s);
            if (move.give === move.get) fail("Elige recursos distintos");
            const ratio = tradeRatio(s, p, move.give);
            if (hand(s, p)[move.give] < ratio) fail(`Necesitas ${ratio} de ${RESOURCE_NAMES[move.give]}`);
            if (s.bank[move.get] <= 0) fail("El banco no tiene ese recurso");
            pay(s, p, { [move.give]: ratio });
            gain(s, p, move.get, 1);
            emit(s, { kind: "trade", a: p, b: "bank" });
            log(s, `${s.players[p].name} cambia ${ratio} ${RESOURCE_NAMES[move.give]} por 1 ${RESOURCE_NAMES[move.get]}.`);
            break;
        }

        case "offerTrade": {
            if (!isCurrent) fail("No es tu turno");
            mainStep(s);
            const give = handFrom(move.give);
            const want = handFrom(move.want);
            if (!handSize(give) || !handSize(want)) fail("Ofrece algo y pide algo");
            if (RESOURCES.some((r) => give[r] && want[r])) fail("No puedes dar y pedir lo mismo");
            if (!canAfford(hand(s, p), give)) fail("No tienes lo que ofreces");
            s.trade = { from: p, give, want, responses: {} };
            log(s, `${s.players[p].name} propone un intercambio.`);
            break;
        }

        case "respondTrade": {
            const t = s.trade;
            if (!t || p === t.from) fail("No hay oferta que responder");
            if (move.accept && !canAfford(hand(s, p), t.want)) fail("No tienes lo que piden");
            t.responses[p] = move.accept ? "accept" : "reject";
            break;
        }

        case "confirmTrade": {
            const t = s.trade;
            if (!t || p !== t.from) fail("No hay oferta tuya");
            if (t.responses[move.with] !== "accept") fail("Ese jugador no ha aceptado");
            if (!canAfford(hand(s, p), t.give) || !canAfford(hand(s, move.with), t.want)) fail("Alguien ya no tiene las cartas");
            for (const r of RESOURCES) {
                hand(s, p)[r] += t.want[r] - t.give[r];
                hand(s, move.with)[r] += t.give[r] - t.want[r];
            }
            syncCounts(s, p);
            syncCounts(s, move.with);
            s.trade = null;
            emit(s, { kind: "trade", a: p, b: move.with });
            log(s, `${s.players[p].name} y ${s.players[move.with].name} intercambian recursos.`);
            break;
        }

        case "cancelTrade": {
            if (!s.trade || p !== s.trade.from) fail("No hay oferta tuya");
            s.trade = null;
            break;
        }

        case "endTurn": {
            if (!isCurrent) fail("No es tu turno");
            if (s.phase !== "play" || s.step !== "main") fail("Antes termina lo que estás haciendo");
            s.trade = null;
            const pl = s.players[p];
            pl.tech!.push(...pl.newTech!);
            pl.newTech = [];
            s.playedTechThisTurn = false;
            s.dice = null;
            s.current = (s.current + 1) % s.players.length;
            if (s.current === 0) startRound(s);
            s.step = "roll";
            break;
        }

        default:
            fail("Acción desconocida");
    }

    checkWin(s);
    return s;
}

function mainStep(s: GameState) {
    if (s.phase !== "play" || s.step !== "main") fail("Ahora no puedes hacer eso");
}

function advanceSetup(s: GameState) {
    const n = s.players.length;
    s.setupIndex++;
    s.lastSetupColony = null;
    if (s.setupIndex >= 2 * n) {
        s.phase = "play";
        s.current = 0;
        s.step = "roll";
        s.round = 1;
        log(s, "Colonización completada. ¡Comienza la partida!");
        return;
    }
    s.current = setupSeat(n, s.setupIndex);
    s.step = "setupColony";
}

function produce(s: GameState, roll: number) {
    const double = s.alignment;
    s.alignment = false;
    const storm = s.solarStormRound === s.round;
    const owed = new Map<string, { player: number; resource: Resource; amount: number; tile: number }>();
    const totals = emptyHand();
    s.board.tiles.forEach((tile, ti) => {
        if (tile.number !== roll || ti === s.drone) return;
        const r = TERRAIN_RESOURCE[tile.terrain];
        if (!r || (storm && r === "energy")) return;
        for (const v of s.topology.tileVertices[ti]) {
            const b = s.buildings[v];
            if (!b) continue;
            const n = (b.kind === "tower" ? 2 : 1) * (double ? 2 : 1);
            const k = `${b.owner}:${r}:${ti}`;
            const prev = owed.get(k);
            owed.set(k, { player: b.owner, resource: r, amount: (prev?.amount ?? 0) + n, tile: ti });
            totals[r] += n;
        }
    });
    // If the bank can't cover a resource for everyone, nobody gets it
    // (unless only one corporation is owed it: they take what's left).
    const gains: { player: number; resource: Resource; amount: number; tile: number }[] = [];
    for (const r of RESOURCES) {
        const entries = [...owed.values()].filter((o) => o.resource === r);
        if (!entries.length) continue;
        const owners = new Set(entries.map((e) => e.player));
        if (totals[r] <= s.bank[r]) gains.push(...entries);
        else if (owners.size === 1) {
            let left = s.bank[r];
            for (const e of entries) {
                const n = Math.min(e.amount, left);
                left -= n;
                if (n) gains.push({ ...e, amount: n });
            }
        }
    }
    for (const g of gains) gain(s, g.player, g.resource, g.amount);
    emit(s, { kind: "production", gains, roll });
    if (double) log(s, "La alineación planetaria duplica la producción.");
}

function startRound(s: GameState) {
    s.round++;
    if (s.round % EVENT_EVERY !== 0) return;
    const events: OrbitalEvent[] = ["solarStorm", "meteor", "alignment"];
    const ev = events[Math.floor(rand(s) * events.length)];
    if (ev === "solarStorm") {
        s.solarStormRound = s.round;
        emit(s, { kind: "orbital", event: ev });
        log(s, "Evento orbital: tormenta solar. La Energía no produce esta ronda.");
    } else if (ev === "alignment") {
        s.alignment = true;
        emit(s, { kind: "orbital", event: ev });
        log(s, "Evento orbital: alineación planetaria. La próxima tirada produce el doble.");
    } else {
        const candidates = s.board.tiles.map((t, i) => ({ t, i })).filter(({ t, i }) => t.terrain !== "desert" && i !== s.drone);
        const { t, i } = candidates[Math.floor(rand(s) * candidates.length)];
        const options = (["solar", "asteroid", "crystal", "dome", "ice"] as Terrain[]).filter((x) => x !== t.terrain);
        const to = options[Math.floor(rand(s) * options.length)];
        const from = t.terrain;
        t.terrain = to;
        emit(s, { kind: "orbital", event: ev, tile: i, from, to });
        log(s, `Evento orbital: lluvia de meteoritos. Un sector de ${RESOURCE_NAMES[TERRAIN_RESOURCE[from]!]} pasa a producir ${RESOURCE_NAMES[TERRAIN_RESOURCE[to]!]}.`);
    }
}

function updateLongestRoad(s: GameState) {
    const lengths = s.players.map((_, i) => longestConduit(s, i));
    const holder = s.longestRoad.owner;
    const best = Math.max(...lengths);
    if (holder !== null && lengths[holder] >= best && lengths[holder] >= 5) {
        s.longestRoad.length = lengths[holder];
        return;
    }
    const leaders = lengths.map((l, i) => ({ l, i })).filter((x) => x.l === best && best >= 5);
    const next = leaders.length === 1 ? leaders[0].i : null;
    if (next !== holder) {
        s.longestRoad = { owner: next, length: next === null ? 0 : best };
        if (next !== null) log(s, `${s.players[next].name} tiene ahora la red de conductos más larga.`);
    }
}

function updateLargestFleet(s: GameState) {
    s.players.forEach((pl, i) => {
        if (pl.dronesPlayed >= 3 && pl.dronesPlayed > s.largestFleet.size && s.largestFleet.owner !== i) {
            s.largestFleet = { owner: i, size: pl.dronesPlayed };
            log(s, `${pl.name} tiene ahora la mayor flota de drones.`);
        } else if (s.largestFleet.owner === i) {
            s.largestFleet.size = pl.dronesPlayed;
        }
    });
}

function checkWin(s: GameState) {
    if (s.phase !== "play") return;
    // You can only win on your own turn.
    if (victoryPoints(s, s.current) >= WIN_POINTS) {
        s.phase = "over";
        s.winner = s.current;
        emit(s, { kind: "win", player: s.current });
        log(s, `${s.players[s.current].name} alcanza ${victoryPoints(s, s.current)} puntos de influencia y gana.`);
    }
}

/** A copy safe to send to `viewer`: other players' cards become counts. */
export function redact(s: GameState, viewer: number | null): GameState {
    const out: GameState = structuredClone(s);
    out.players.forEach((pl, i) => {
        if (i === viewer) return;
        pl.hand = null;
        pl.tech = null;
        pl.newTech = null;
    });
    out.deck = out.deck.map(() => "drone");
    out.rng = 0;
    return out;
}

export type { Board, Resource, Terrain };
