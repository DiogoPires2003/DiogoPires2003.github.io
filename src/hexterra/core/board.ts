// Board generation. Same seed, same board.

import { hexKey, hexesInRadius, neighbors, type Hex } from "./hex";
import { createRng, shuffle, type Rng } from "./rng";

export type Resource = "energy" | "metal" | "silicon" | "biomass" | "water";

export type Terrain =
    | "solar" // Campos solares
    | "asteroid" // Minas de asteroide
    | "crystal" // Bosques de cristal
    | "dome" // Cúpulas de cultivo
    | "ice" // Lagos de hielo
    | "desert"; // Desierto radiactivo

export const TERRAIN_RESOURCE: Record<Terrain, Resource | null> = {
    solar: "energy",
    asteroid: "metal",
    crystal: "silicon",
    dome: "biomass",
    ice: "water",
    desert: null,
};

export const BOARD_RADIUS = 2;

// Metal, Energy and Biomass go into most builds, so they get the extra tile.
// Silicon only feeds towers and tech, and stays scarce.
export const TERRAIN_COUNTS: Record<Terrain, number> = {
    solar: 4,
    asteroid: 4,
    dome: 4,
    ice: 3,
    crystal: 3,
    desert: 1,
};

// One token per productive tile: 2 and 12 once, 3-6 and 8-11 twice, no 7.
export const NUMBER_TOKENS: readonly number[] = [
    2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12,
];

/** 6 and 8 are the likeliest rolls; two of them side by side is too rich. */
const HOT_NUMBERS = new Set([6, 8]);
const MAX_NUMBER_ATTEMPTS = 1000;

export interface Tile {
    coord: Hex;
    terrain: Terrain;
    /** null on the desert. */
    number: number | null;
}

export interface Board {
    seed: number;
    tiles: Tile[];
}

export function generateBoard(seed: number): Board {
    const rng = createRng(seed);
    const coords = hexesInRadius(BOARD_RADIUS);
    const terrains = shuffle(
        (Object.keys(TERRAIN_COUNTS) as Terrain[]).flatMap((t) =>
            Array<Terrain>(TERRAIN_COUNTS[t]).fill(t),
        ),
        rng,
    );
    if (terrains.length !== coords.length) {
        throw new Error(`${terrains.length} terrains for ${coords.length} hexes`);
    }

    const tiles: Tile[] = coords.map((coord, i) => ({
        coord,
        terrain: terrains[i],
        number: null,
    }));
    assignNumbers(tiles, rng);
    return { seed, tiles };
}

function assignNumbers(tiles: Tile[], rng: Rng) {
    const productive = tiles.filter((t) => t.terrain !== "desert");
    if (productive.length !== NUMBER_TOKENS.length) {
        throw new Error(`${NUMBER_TOKENS.length} tokens for ${productive.length} tiles`);
    }

    for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt++) {
        const tokens = shuffle(NUMBER_TOKENS, rng);
        productive.forEach((t, i) => (t.number = tokens[i]));
        if (!hasAdjacentHotNumbers(tiles)) return;
    }
    throw new Error("Could not place number tokens without adjacent 6/8");
}

export function hasAdjacentHotNumbers(tiles: readonly Tile[]): boolean {
    const byKey = new Map(tiles.map((t) => [hexKey(t.coord), t]));
    return tiles.some(
        (t) =>
            t.number !== null &&
            HOT_NUMBERS.has(t.number) &&
            neighbors(t.coord).some((n) => {
                const other = byKey.get(hexKey(n))?.number;
                return other != null && HOT_NUMBERS.has(other);
            }),
    );
}

/** Ways two dice can roll `n`, out of 36: the dots under each number. */
export function rollWays(n: number): number {
    return n < 2 || n > 12 ? 0 : 6 - Math.abs(7 - n);
}
