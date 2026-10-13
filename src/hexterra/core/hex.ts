// Axial hex coordinates, pointy-top. Pure math: no Three.js, no DOM, so the
// rules can be tested in Node.
//
// https://www.redblobgames.com/grids/hexagons/ is the reference for the
// conventions used here.

export interface Hex {
    q: number;
    r: number;
}

const DIRECTIONS: readonly Hex[] = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
];

export function hexKey(h: Hex): string {
    return `${h.q},${h.r}`;
}

export function neighbors(h: Hex): Hex[] {
    return DIRECTIONS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }));
}

export function distance(a: Hex, b: Hex): number {
    const dq = a.q - b.q;
    const dr = a.r - b.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Every hex within `radius` steps of the origin, row by row. Radius 2 gives 19. */
export function hexesInRadius(radius: number): Hex[] {
    const out: Hex[] = [];
    for (let r = -radius; r <= radius; r++) {
        const qMin = Math.max(-radius, -r - radius);
        const qMax = Math.min(radius, -r + radius);
        for (let q = qMin; q <= qMax; q++) out.push({ q, r });
    }
    return out;
}

/**
 * Centre of a hex on the ground plane. `size` is the centre-to-corner
 * distance; corners point along ±z.
 */
export function hexToPlane(h: Hex, size: number): { x: number; z: number } {
    return {
        x: size * Math.sqrt(3) * (h.q + h.r / 2),
        z: size * 1.5 * h.r,
    };
}
