import { describe, expect, it } from "vitest";
import { botMove } from "./bot";
import { TERRAIN_RESOURCE } from "./board";
import {
    COSTS,
    RuleError,
    WIN_POINTS,
    apply,
    canPlaceColony,
    handFrom,
    handSize,
    legalColonySpots,
    longestConduit,
    newGame,
    tradeRatio,
    victoryPoints,
    waitingOn,
    type GameState,
    type Move,
} from "./game";
import { buildTopology } from "./graph";
import { generateBoard } from "./board";

const players = (n: number, kind: "human" | "bot" = "bot") =>
    Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, kind }));

/** Plays bots until `stop` says so or nobody can move. */
function runBots(s: GameState, stop: (s: GameState) => boolean, maxMoves = 20000) {
    let moves = 0;
    let turnMoves = 0;
    let lastCurrent = s.current;
    while (!stop(s) && moves < maxMoves) {
        const who = waitingOn(s);
        if (!who.length) break;
        let move: Move | null = null;
        for (const p of who) {
            move = botMove(s, p);
            if (move) break;
        }
        if (!move) throw new Error(`No bot move at step ${s.step}`);
        if (s.current !== lastCurrent) {
            lastCurrent = s.current;
            turnMoves = 0;
        }
        // A runaway turn would be a bot bug; force it to end.
        if (++turnMoves > 60 && s.step === "main" && !s.trade) move = { type: "endTurn", player: s.current };
        s = apply(s, move);
        moves++;
    }
    return { s, moves };
}

describe("topology", () => {
    const t = buildTopology(generateBoard(42));

    it("has the vertices and edges of a 19-hex board", () => {
        expect(t.vertices).toHaveLength(54);
        expect(t.edges).toHaveLength(72);
        expect(t.edges.filter((e) => e.tiles.length === 1)).toHaveLength(30);
    });

    it("gives every vertex 2 or 3 neighbours and 1 to 3 tiles", () => {
        for (const v of t.vertices) {
            expect(v.neighbors.length).toBeGreaterThanOrEqual(2);
            expect(v.neighbors.length).toBeLessThanOrEqual(3);
            expect(v.tiles.length).toBeGreaterThanOrEqual(1);
            expect(v.tiles.length).toBeLessThanOrEqual(3);
        }
    });

    it("places nine coastal stations that never share a vertex", () => {
        expect(t.harbors).toHaveLength(9);
        expect(t.harbors.filter((h) => h.kind === "any")).toHaveLength(4);
        const ends = t.harbors.flatMap((h) => [t.edges[h.edge].a, t.edges[h.edge].b]);
        expect(new Set(ends).size).toBe(18);
        for (const h of t.harbors) expect(t.edges[h.edge].tiles).toHaveLength(1);
    });
});

describe("setup", () => {
    it("runs in snake order and pays out the second colony", () => {
        let s = newGame({ seed: 7, players: players(3) });
        const order: number[] = [];
        while (s.phase === "setup") {
            if (s.step === "setupColony") order.push(s.current);
            s = apply(s, botMove(s, s.current)!);
        }
        expect(order).toEqual([0, 1, 2, 2, 1, 0]);
        expect(s.step).toBe("roll");
        // Each player got one card per productive tile next to their second colony.
        for (let p = 0; p < 3; p++) expect(s.players[p].handCount).toBeGreaterThan(0);
    });

    it("enforces the distance rule", () => {
        let s = newGame({ seed: 7, players: players(2, "human") });
        const v = 10;
        s = apply(s, { type: "placeColony", player: 0, vertex: v });
        const n = s.topology.vertices[v].neighbors[0];
        expect(canPlaceColony(s, 1, n, true)).toBe(false);
        expect(() => apply(s, { type: "placeColony", player: 0, vertex: n })).toThrow(RuleError);
    });

    it("only lets the setup conduit leave the colony just placed", () => {
        let s = newGame({ seed: 7, players: players(2, "human") });
        s = apply(s, { type: "placeColony", player: 0, vertex: 10 });
        const far = s.topology.edges.find((e) => e.a !== 10 && e.b !== 10)!;
        expect(() => apply(s, { type: "placeConduit", player: 0, edge: far.id })).toThrow(RuleError);
        const near = s.topology.vertices[10].edges[0];
        s = apply(s, { type: "placeConduit", player: 0, edge: near });
        expect(s.current).toBe(1);
    });
});

describe("play", () => {
    const afterSetup = (seed = 11, n = 3) => runBots(newGame({ seed, players: players(n) }), (s) => s.phase === "play").s;

    it("produces 1 per colony and 2 per tower, never on the drone's tile", () => {
        const base = afterSetup();
        // Find a roll other than 7 and compute what it should pay.
        for (let roll = 2; roll <= 12; roll++) {
            if (roll === 7) continue;
            const expected = base.players.map(() => 0);
            base.board.tiles.forEach((t, ti) => {
                if (t.number !== roll || ti === base.drone || !TERRAIN_RESOURCE[t.terrain]) return;
                for (const v of base.topology.tileVertices[ti]) {
                    const b = base.buildings[v];
                    if (b) expected[b.owner] += b.kind === "tower" ? 2 : 1;
                }
            });
            // Drive the rng until the dice show `roll`.
            for (let attempt = 0; attempt < 400; attempt++) {
                const s = structuredClone(base);
                s.rng = attempt * 7919;
                const next = apply(s, { type: "roll", player: s.current });
                if (next.dice![0] + next.dice![1] !== roll) continue;
                next.players.forEach((pl, i) => expect(pl.handCount - base.players[i].handCount).toBe(expected[i]));
                break;
            }
        }
    });

    it("makes players over the limit discard half on a 7", () => {
        let s = afterSetup();
        s.players[1].hand = handFrom({ metal: 5, water: 4 });
        s.players[1].handCount = 9;
        for (let attempt = 0; ; attempt++) {
            const t = structuredClone(s);
            t.rng = attempt * 104729;
            const next = apply(t, { type: "roll", player: t.current });
            if (next.dice![0] + next.dice![1] !== 7) continue;
            s = next;
            break;
        }
        expect(s.step).toBe("discard");
        expect(s.discards[1]).toBe(4);
        expect(() => apply(s, { type: "discard", player: 1, cards: { metal: 3 } })).toThrow(RuleError);
        s = apply(s, { type: "discard", player: 1, cards: { metal: 4 } });
        expect(s.players[1].handCount).toBe(5);
    });

    it("charges building costs and refuses what you can't afford", () => {
        let s = afterSetup();
        s.step = "main";
        const p = s.current;
        s.players[p].hand = handFrom({});
        s.players[p].handCount = 0;
        expect(() => apply(s, { type: "buyTech", player: p })).toThrow(RuleError);
        s.players[p].hand = handFrom(COSTS.tech);
        s.players[p].handCount = 3;
        s = apply(s, { type: "buyTech", player: p });
        expect(s.players[p].handCount).toBe(0);
        expect(s.players[p].newTech).toHaveLength(1);
        // New tech can't be played the same turn.
        const card = s.players[p].newTech![0];
        if (card !== "science") expect(() => apply(s, { type: "playTech", player: p, card })).toThrow(RuleError);
    });

    it("trades 4:1 with the bank without a station", () => {
        let s = afterSetup();
        s.step = "main";
        const p = s.current;
        s.buildings = Object.fromEntries(Object.entries(s.buildings).filter(([, b]) => b.owner !== p));
        s.players[p].hand = handFrom({ metal: 4 });
        s.players[p].handCount = 4;
        expect(tradeRatio(s, p, "metal")).toBe(4);
        s = apply(s, { type: "bankTrade", player: p, give: "metal", get: "water" });
        expect(s.players[p].hand).toEqual(handFrom({ water: 1 }));
    });

    it("measures the longest conduit through open vertices only", () => {
        const s = afterSetup();
        const p = 0;
        s.conduits = {};
        s.buildings = {};
        // A straight-ish chain of five edges along vertex neighbours.
        let v = s.topology.vertices.find((x) => !s.buildings[x.id])!.id;
        const used = new Set<number>();
        for (let i = 0; i < 5; i++) {
            const e = s.topology.vertices[v].edges.find((e) => !used.has(e))!;
            used.add(e);
            s.conduits[e] = p;
            v = s.topology.edges[e].a === v ? s.topology.edges[e].b : s.topology.edges[e].a;
        }
        expect(longestConduit(s, p)).toBe(5);
        // A rival colony on an inner vertex cuts the trail.
        const chain = [...used];
        const inner = s.topology.edges[chain[2]].a;
        const cut = [s.topology.edges[chain[1]], s.topology.edges[chain[2]]].every((e) => e.a === inner || e.b === inner)
            ? inner
            : s.topology.edges[chain[2]].b;
        s.buildings[cut] = { owner: 1, kind: "colony" };
        expect(longestConduit(s, p)).toBeLessThan(5);
    });
});

describe("full games between bots", () => {
    it.each([1, 2, 3, 42, 99, 1234, 77777, 31337])("seed %i plays to a winner", (seed) => {
        for (const n of [2, 3, 4]) {
            const { s, moves } = runBots(newGame({ seed: seed + n, players: players(n) }), (s) => s.phase === "over");
            expect(s.phase, `seed ${seed} with ${n} players stalled after ${moves} moves at ${s.step}`).toBe("over");
            expect(victoryPoints(s, s.winner!)).toBeGreaterThanOrEqual(WIN_POINTS);
            // Cards are conserved: bank plus hands is always 19 of each.
            for (const r of ["energy", "metal", "silicon", "biomass", "water"] as const) {
                expect(s.bank[r] + s.players.reduce((t, pl) => t + pl.hand![r], 0)).toBe(19);
            }
            for (const pl of s.players) expect(handSize(pl.hand!)).toBe(pl.handCount);
            expect(legalColonySpots(s, 0)).toBeDefined();
        }
    });
});
