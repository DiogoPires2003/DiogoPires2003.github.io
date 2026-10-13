import { describe, expect, it } from "vitest";
import {
    NUMBER_TOKENS,
    TERRAIN_COUNTS,
    generateBoard,
    hasAdjacentHotNumbers,
    rollWays,
    type Terrain,
} from "./board";
import { distance, hexKey, hexesInRadius, neighbors } from "./hex";

const SEEDS = Array.from({ length: 200 }, (_, i) => i * 7919 + 1);

describe("hex grid", () => {
    it("has 19 distinct hexes within radius 2", () => {
        const hexes = hexesInRadius(2);
        expect(hexes).toHaveLength(19);
        expect(new Set(hexes.map(hexKey)).size).toBe(19);
        expect(hexes.every((h) => distance(h, { q: 0, r: 0 }) <= 2)).toBe(true);
    });

    it("gives every hex six neighbours one step away", () => {
        const ns = neighbors({ q: 1, r: -1 });
        expect(ns).toHaveLength(6);
        expect(ns.every((n) => distance(n, { q: 1, r: -1 }) === 1)).toBe(true);
    });
});

describe("generateBoard", () => {
    it("is deterministic for a seed", () => {
        expect(generateBoard(42)).toEqual(generateBoard(42));
    });

    it("changes with the seed", () => {
        expect(generateBoard(1).tiles).not.toEqual(generateBoard(2).tiles);
    });

    it.each(SEEDS)("follows the setup rules (seed %i)", (seed) => {
        const { tiles } = generateBoard(seed);
        expect(tiles).toHaveLength(19);

        const counts = {} as Record<Terrain, number>;
        for (const t of tiles) counts[t.terrain] = (counts[t.terrain] ?? 0) + 1;
        expect(counts).toEqual(TERRAIN_COUNTS);

        const desert = tiles.filter((t) => t.terrain === "desert");
        expect(desert).toHaveLength(1);
        expect(desert[0].number).toBeNull();

        const numbers = tiles
            .filter((t) => t.terrain !== "desert")
            .map((t) => t.number as number)
            .sort((a, b) => a - b);
        expect(numbers).toEqual([...NUMBER_TOKENS]);
        expect(numbers).not.toContain(7);

        expect(hasAdjacentHotNumbers(tiles)).toBe(false);
    });
});

describe("hasAdjacentHotNumbers", () => {
    it("flags a 6 next to an 8", () => {
        expect(
            hasAdjacentHotNumbers([
                { coord: { q: 0, r: 0 }, terrain: "solar", number: 6 },
                { coord: { q: 1, r: 0 }, terrain: "ice", number: 8 },
            ]),
        ).toBe(true);
    });

    it("ignores a 6 two steps from an 8", () => {
        expect(
            hasAdjacentHotNumbers([
                { coord: { q: 0, r: 0 }, terrain: "solar", number: 6 },
                { coord: { q: 2, r: 0 }, terrain: "ice", number: 8 },
            ]),
        ).toBe(false);
    });
});

describe("rollWays", () => {
    it("counts two-dice combinations", () => {
        expect([2, 6, 7, 8, 12].map(rollWays)).toEqual([1, 5, 6, 5, 1]);
        expect(rollWays(1)).toBe(0);
    });
});
