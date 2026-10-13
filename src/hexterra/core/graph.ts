// The board as a graph: vertices (where colonies go), edges (where conduits
// go), which tiles touch each, and the trade stations on the coast.
// Built from geometry, so ids are stable for a given board layout.

import type { Board, Resource } from "./board";
import { hexToPlane } from "./hex";
import { createRng, shuffle } from "./rng";

export interface Vertex {
    id: number;
    x: number;
    z: number;
    /** Indices into board.tiles. */
    tiles: number[];
    edges: number[];
    neighbors: number[];
}

export interface Edge {
    id: number;
    a: number;
    b: number;
    tiles: number[];
}

export type HarborKind = Resource | "any";

export interface Harbor {
    edge: number;
    kind: HarborKind;
    /** How many of the resource buy one of anything. */
    ratio: 2 | 3;
}

export interface Topology {
    vertices: Vertex[];
    edges: Edge[];
    /** For each tile, its six vertex ids, in corner order (corner k at angle k·60° from +z). */
    tileVertices: number[][];
    harbors: Harbor[];
}

const HARBOR_KINDS: HarborKind[] = ["any", "any", "any", "any", "energy", "metal", "silicon", "biomass", "water"];

/** Corner k of a pointy-top hex of size 1: (sin k·60°, cos k·60°). */
export function cornerOffset(k: number) {
    const a = (k * Math.PI) / 3;
    return { x: Math.sin(a), z: Math.cos(a) };
}

export function buildTopology(board: Board): Topology {
    const vertices: Vertex[] = [];
    const edges: Edge[] = [];
    const vByKey = new Map<string, number>();
    const eByKey = new Map<string, number>();
    const key = (x: number, z: number) => `${Math.round(x * 1000)},${Math.round(z * 1000)}`;

    const tileVertices = board.tiles.map((tile, ti) => {
        const c = hexToPlane(tile.coord, 1);
        const ids: number[] = [];
        for (let k = 0; k < 6; k++) {
            const o = cornerOffset(k);
            const x = c.x + o.x;
            const z = c.z + o.z;
            const kk = key(x, z);
            let id = vByKey.get(kk);
            if (id === undefined) {
                id = vertices.length;
                vertices.push({ id, x, z, tiles: [], edges: [], neighbors: [] });
                vByKey.set(kk, id);
            }
            vertices[id].tiles.push(ti);
            ids.push(id);
        }
        return ids;
    });

    tileVertices.forEach((ids, ti) => {
        for (let k = 0; k < 6; k++) {
            const a = ids[k];
            const b = ids[(k + 1) % 6];
            const kk = a < b ? `${a}-${b}` : `${b}-${a}`;
            let id = eByKey.get(kk);
            if (id === undefined) {
                id = edges.length;
                edges.push({ id, a: Math.min(a, b), b: Math.max(a, b), tiles: [] });
                eByKey.set(kk, id);
                vertices[a].edges.push(id);
                vertices[b].edges.push(id);
                vertices[a].neighbors.push(b);
                vertices[b].neighbors.push(a);
            }
            edges[id].tiles.push(ti);
        }
    });

    return { vertices, edges, tileVertices, harbors: placeHarbors(board.seed, vertices, edges) };
}

/**
 * Nine stations spread evenly round the coast, never two sharing a vertex:
 * four generic 3:1 and one 2:1 for each resource, shuffled by the board seed.
 */
function placeHarbors(seed: number, vertices: Vertex[], edges: Edge[]): Harbor[] {
    const coast = edges
        .filter((e) => e.tiles.length === 1)
        .map((e) => {
            const x = (vertices[e.a].x + vertices[e.b].x) / 2;
            const z = (vertices[e.a].z + vertices[e.b].z) / 2;
            return { e, angle: Math.atan2(z, x) };
        })
        .sort((p, q) => p.angle - q.angle);
    const kinds = shuffle(HARBOR_KINDS, createRng(seed ^ 0x5bd1e995));
    // Gaps of 3 and 4 edges round a 30-edge coast.
    const picks = [0, 3, 7, 10, 13, 17, 20, 23, 27].map((i) => Math.floor((i * coast.length) / 30));
    return picks.map((i, n) => ({
        edge: coast[i].e.id,
        kind: kinds[n],
        ratio: kinds[n] === "any" ? 3 : 2,
    }));
}

/** Does `edge` touch vertex `v`? */
export function edgeTouches(t: Topology, edge: number, v: number) {
    const e = t.edges[edge];
    return e.a === v || e.b === v;
}

export function otherEnd(t: Topology, edge: number, v: number) {
    const e = t.edges[edge];
    return e.a === v ? e.b : e.a;
}
