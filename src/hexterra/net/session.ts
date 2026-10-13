// Sessions connect the UI to a game. One authority (GameHost) owns the state
// and runs the bots; locally it lives in this tab, online it lives in the
// host's tab and guests talk to it over WebRTC (PeerJS) with a room code.
// Static hosting is enough: PeerJS's public broker only brokers the
// handshake, then the browsers talk directly.

import type { DataConnection, Peer as PeerType } from "peerjs";
import { botMove } from "../core/bot";
import { RuleError, apply, newGame, redact, waitingOn, type Action, type GameState, type Move } from "../core/game";
import { randomSeed } from "../core/rng";

export interface Seat {
    name: string;
    kind: "human" | "bot";
    /** Online only: which connection plays this seat ("host" for the host). */
    peer?: string;
    online?: boolean;
}

export interface View {
    /** The game as this client may see it; null while in the lobby. */
    state: GameState | null;
    /** The seat this client controls right now, if any. */
    me: number | null;
    seats: Seat[];
    /** Room code when online. */
    room: string | null;
    role: "local" | "host" | "guest";
    status: "lobby" | "playing" | "connecting" | "error";
    error?: string;
}

export interface Session {
    subscribe(fn: (view: View) => void): () => void;
    /** Sends an action as the seat this client controls. */
    act(action: Action): void;
    /** Host / local only: deals the board for `seed`. */
    start?(seed?: number): void;
    setSeats?(seats: Seat[]): void;
    dispose(): void;
}

type Listener = (v: View) => void;

// --- The authority ----------------------------------------------------------

/** Pace of bot moves, so people can follow them. */
const BOT_DELAY: Partial<Record<GameState["step"], number>> = {
    setupColony: 650,
    setupConduit: 450,
    roll: 700,
    discard: 400,
    moveDrone: 900,
    steal: 600,
    main: 650,
    printer: 500,
};

export class GameHost {
    state: GameState | null = null;
    private timer = 0;
    private botTurnMoves = 0;
    private lastCurrent = -1;
    onChange: (state: GameState) => void = () => {};
    onError: (seat: number, message: string) => void = () => {};

    start(seats: Seat[], seed = randomSeed()) {
        this.state = newGame({ seed, players: seats.map((s) => ({ name: s.name, kind: s.kind })) });
        this.changed();
    }

    /** Applies a move if legal; reports the rule broken otherwise. */
    move(m: Move): boolean {
        if (!this.state) return false;
        try {
            this.state = apply(this.state, m);
        } catch (e) {
            if (e instanceof RuleError) {
                this.onError(m.player, e.message);
                return false;
            }
            throw e;
        }
        this.changed();
        return true;
    }

    /** A seat whose person left: a bot takes over so the game can go on. */
    handOver(seat: number) {
        if (!this.state) return;
        this.state = structuredClone(this.state);
        this.state.players[seat].kind = "bot";
        this.changed();
    }

    private changed() {
        this.onChange(this.state!);
        this.scheduleBots();
    }

    private scheduleBots() {
        clearTimeout(this.timer);
        const s = this.state;
        if (!s || s.phase === "over") return;
        const bot = waitingOn(s).find((p) => s.players[p].kind === "bot");
        if (bot === undefined) return;
        const delay = s.trade ? 500 : (BOT_DELAY[s.step] ?? 600);
        this.timer = window.setTimeout(() => {
            const cur = this.state!;
            if (cur.current !== this.lastCurrent) {
                this.lastCurrent = cur.current;
                this.botTurnMoves = 0;
            }
            let m = botMove(cur, bot);
            // A bot stuck in a loop ends its turn rather than freezing the table.
            if (m && ++this.botTurnMoves > 40 && cur.step === "main" && !cur.trade && bot === cur.current) {
                m = { type: "endTurn", player: bot };
            }
            if (!m || !this.move(m)) {
                if (cur.step === "main" && bot === cur.current) this.move({ type: "endTurn", player: bot });
            }
        }, delay);
    }

    dispose() {
        clearTimeout(this.timer);
    }
}

/** In hot-seat play, the person the UI should be for: whoever must act. */
function hotSeatViewer(s: GameState): number | null {
    const humans = waitingOn(s).filter((p) => s.players[p].kind === "human");
    if (humans.length) return humans[0];
    // Between human moves (bots playing), keep showing the last human seat.
    return null;
}

// --- Local (hot-seat + bots) ------------------------------------------------

export class LocalSession implements Session {
    private host = new GameHost();
    private listeners = new Set<Listener>();
    private seats: Seat[];
    private lastViewer: number | null = null;
    private error: string | undefined;

    constructor(seats: Seat[]) {
        this.seats = seats;
        this.host.onChange = () => this.emit();
        this.host.onError = (_seat, msg) => {
            this.error = msg;
            this.emit();
            this.error = undefined;
        };
    }

    subscribe(fn: Listener) {
        this.listeners.add(fn);
        fn(this.view());
        return () => this.listeners.delete(fn);
    }

    setSeats(seats: Seat[]) {
        this.seats = seats;
        this.emit();
    }

    start(seed?: number) {
        this.host.start(this.seats, seed);
    }

    act(action: Action) {
        const s = this.host.state;
        if (!s) return;
        const me = this.viewer(s);
        if (me === null) return;
        this.host.move({ ...action, player: me } as Move);
    }

    private viewer(s: GameState) {
        const v = hotSeatViewer(s);
        if (v !== null) this.lastViewer = v;
        return v ?? this.lastViewer ?? s.players.findIndex((p) => p.kind === "human");
    }

    private view(): View {
        const s = this.host.state;
        const me = s ? this.viewer(s) : null;
        return {
            // Only the hand of whoever is at the screen is shown.
            state: s ? redact(s, me) : null,
            me,
            seats: this.seats,
            room: null,
            role: "local",
            status: s ? "playing" : "lobby",
            error: this.error,
        };
    }

    private emit() {
        const v = this.view();
        for (const fn of this.listeners) fn(v);
    }

    dispose() {
        this.host.dispose();
        this.listeners.clear();
    }
}

// --- Online -----------------------------------------------------------------

const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const PEER_PREFIX = "hexterra-v1-";

export function newRoomCode() {
    return Array.from({ length: 5 }, () => ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]).join("");
}

export function normaliseRoomCode(code: string) {
    return code
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 5);
}

type ToHost = { t: "hello"; name: string } | { t: "act"; action: Action };
type ToGuest =
    | { t: "lobby"; seats: Seat[]; you: number }
    | { t: "state"; state: GameState; seats: Seat[]; you: number }
    | { t: "error"; message: string }
    | { t: "full" };

async function createPeer(id?: string): Promise<PeerType> {
    const { Peer } = await import("peerjs");
    return new Promise((resolve, reject) => {
        const peer = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
        peer.once("open", () => resolve(peer));
        peer.once("error", (e) => reject(e));
    });
}

export class HostSession implements Session {
    private host = new GameHost();
    private listeners = new Set<Listener>();
    private peer: PeerType | null = null;
    private conns = new Map<string, DataConnection>();
    private seats: Seat[];
    private status: View["status"] = "connecting";
    private error: string | undefined;
    readonly room: string;

    constructor(hostName: string, room = newRoomCode()) {
        this.room = room;
        this.seats = [{ name: hostName, kind: "human", peer: "host", online: true }];
        this.host.onChange = () => this.broadcast();
        this.host.onError = (seat, msg) => {
            const peerId = this.seats[seat]?.peer;
            if (peerId === "host") {
                this.error = msg;
                this.emit();
                this.error = undefined;
            } else if (peerId) this.conns.get(peerId)?.send({ t: "error", message: msg } satisfies ToGuest);
        };
        void this.open();
    }

    private async open() {
        try {
            this.peer = await createPeer(PEER_PREFIX + this.room);
        } catch (e) {
            this.status = "error";
            this.error = `No se pudo abrir la sala (${(e as Error).message ?? e}). Prueba de nuevo.`;
            this.emit();
            return;
        }
        this.status = "lobby";
        this.emit();
        this.peer.on("connection", (conn) => this.accept(conn));
    }

    private accept(conn: DataConnection) {
        conn.on("data", (raw) => {
            const msg = raw as ToHost;
            if (msg.t === "hello") {
                if (this.host.state) {
                    // Rejoining: take back a seat with the same name that a bot is minding.
                    const i = this.seats.findIndex((s) => s.name === msg.name && !s.online && s.peer !== "host");
                    if (i < 0) return conn.send({ t: "full" } satisfies ToGuest);
                    this.seats[i] = { ...this.seats[i], peer: conn.peer, online: true, kind: "human" };
                    this.host.state.players[i].kind = "human";
                } else {
                    if (this.seats.length >= 4) return conn.send({ t: "full" } satisfies ToGuest);
                    this.seats.push({ name: msg.name.slice(0, 18) || "Invitado", kind: "human", peer: conn.peer, online: true });
                }
                this.conns.set(conn.peer, conn);
                this.broadcast();
            } else if (msg.t === "act") {
                const seat = this.seats.findIndex((s) => s.peer === conn.peer);
                if (seat >= 0) this.host.move({ ...msg.action, player: seat } as Move);
            }
        });
        conn.on("close", () => this.drop(conn.peer));
        conn.on("error", () => this.drop(conn.peer));
    }

    private drop(peerId: string) {
        this.conns.delete(peerId);
        const i = this.seats.findIndex((s) => s.peer === peerId);
        if (i < 0) return;
        if (this.host.state) {
            this.seats[i] = { ...this.seats[i], online: false };
            this.host.handOver(i);
        } else {
            this.seats.splice(i, 1);
            this.broadcast();
        }
    }

    setSeats(seats: Seat[]) {
        if (this.host.state) return;
        // The host may add or remove bots; people stay.
        this.seats = [...this.seats.filter((s) => s.kind === "human"), ...seats.filter((s) => s.kind === "bot")].slice(0, 4);
        this.broadcast();
    }

    start(seed?: number) {
        if (this.seats.length < 2) {
            this.error = "Hacen falta al menos 2 jugadores (añade una IA).";
            this.emit();
            this.error = undefined;
            return;
        }
        this.status = "playing";
        this.host.start(this.seats, seed);
    }

    act(action: Action) {
        this.host.move({ ...action, player: 0 } as Move);
    }

    subscribe(fn: Listener) {
        this.listeners.add(fn);
        fn(this.view());
        return () => this.listeners.delete(fn);
    }

    private view(): View {
        const s = this.host.state;
        return {
            state: s ? redact(s, 0) : null,
            me: 0,
            seats: this.seats,
            room: this.room,
            role: "host",
            status: this.status,
            error: this.error,
        };
    }

    private emit() {
        const v = this.view();
        for (const fn of this.listeners) fn(v);
    }

    private broadcast() {
        const s = this.host.state;
        this.seats.forEach((seat, i) => {
            if (!seat.peer || seat.peer === "host") return;
            const conn = this.conns.get(seat.peer);
            if (!conn?.open) return;
            const msg: ToGuest = s ? { t: "state", state: redact(s, i), seats: this.seats, you: i } : { t: "lobby", seats: this.seats, you: i };
            conn.send(msg);
        });
        this.emit();
    }

    dispose() {
        this.host.dispose();
        this.peer?.destroy();
        this.listeners.clear();
    }
}

export class GuestSession implements Session {
    private listeners = new Set<Listener>();
    private peer: PeerType | null = null;
    private conn: DataConnection | null = null;
    private state: GameState | null = null;
    private seats: Seat[] = [];
    private me: number | null = null;
    private status: View["status"] = "connecting";
    private error: string | undefined;

    constructor(
        readonly room: string,
        private readonly name: string,
    ) {
        void this.connect();
    }

    private async connect() {
        try {
            this.peer = await createPeer();
        } catch (e) {
            return this.fail(`No se pudo conectar (${(e as Error).message ?? e}).`);
        }
        const conn = this.peer.connect(PEER_PREFIX + this.room, { reliable: true });
        this.conn = conn;
        const timeout = window.setTimeout(() => this.fail("No se encuentra la sala. Revisa el código."), 12000);
        this.peer.on("error", (e) => {
            if ((e as { type?: string }).type === "peer-unavailable") this.fail("No existe ninguna sala con ese código.");
        });
        conn.on("open", () => {
            clearTimeout(timeout);
            conn.send({ t: "hello", name: this.name } satisfies ToHost);
        });
        conn.on("data", (raw) => {
            const msg = raw as ToGuest;
            if (msg.t === "lobby") {
                this.seats = msg.seats;
                this.me = msg.you;
                this.status = "lobby";
            } else if (msg.t === "state") {
                this.state = msg.state;
                this.seats = msg.seats;
                this.me = msg.you;
                this.status = "playing";
            } else if (msg.t === "error") {
                this.error = msg.message;
                this.emit();
                this.error = undefined;
                return;
            } else if (msg.t === "full") {
                return this.fail("La sala está llena o la partida ya empezó.");
            }
            this.emit();
        });
        conn.on("close", () => this.fail("Se perdió la conexión con el anfitrión."));
    }

    private fail(message: string) {
        this.status = "error";
        this.error = message;
        this.emit();
    }

    act(action: Action) {
        this.conn?.send({ t: "act", action } satisfies ToHost);
    }

    subscribe(fn: Listener) {
        this.listeners.add(fn);
        fn(this.view());
        return () => this.listeners.delete(fn);
    }

    private view(): View {
        return { state: this.state, me: this.me, seats: this.seats, room: this.room, role: "guest", status: this.status, error: this.error };
    }

    private emit() {
        const v = this.view();
        for (const fn of this.listeners) fn(v);
    }

    dispose() {
        this.peer?.destroy();
        this.listeners.clear();
    }
}
