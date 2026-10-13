// Ground geometry: each tile is a chunk of land with a sculpted top and
// rock strata down its sides, and the island underneath them is a beach that
// shelves into the sea.

import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Terrain } from "../core/board";
import { createRng } from "../core/rng";
import { SEA_LEVEL } from "./ocean";

/** World units per texture repeat on the ground. */
const UV_SCALE = 0.42;
const SKIRT_BOTTOM = -0.55;

// --- Noise ---------------------------------------------------------------

function makeNoise(seed: number) {
    const rng = createRng(seed);
    const perm = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    const p = new Uint8Array(512);
    for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
    const grad = (h: number, x: number, y: number) => {
        const a = (h / 256) * Math.PI * 2;
        return Math.cos(a) * x + Math.sin(a) * y;
    };
    const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
    const noise = (x: number, y: number) => {
        const xi = Math.floor(x) & 255;
        const yi = Math.floor(y) & 255;
        const xf = x - Math.floor(x);
        const yf = y - Math.floor(y);
        const u = fade(xf);
        const v = fade(yf);
        const aa = p[p[xi] + yi];
        const ab = p[p[xi] + yi + 1];
        const ba = p[p[xi + 1] + yi];
        const bb = p[p[xi + 1] + yi + 1];
        const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf));
        const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1));
        return x1 + v * (x2 - x1);
    };
    const fbm = (x: number, y: number, octaves = 5) => {
        let v = 0;
        let a = 0.5;
        let f = 1;
        for (let i = 0; i < octaves; i++) {
            v += a * noise(x * f, y * f);
            f *= 2.03;
            a *= 0.5;
        }
        return v;
    };
    return { noise, fbm };
}

const world = makeNoise(1337);

// --- Tile surfaces ------------------------------------------------------

export interface TileShape {
    /** Height of the tile's rim; the interior is sculpted around it. */
    base: number;
    /** Local height offset at (x, z) within the tile, before the rim blend. */
    relief: (x: number, z: number, wx: number, wz: number) => number;
    /** Multiplies the ground texture: darker in hollows, lighter on crests. */
    shade: (x: number, z: number, h: number) => number;
}

/** 0 at the centre, 1 on the hexagon's edge (pointy-top, corners on ±z, circumradius 1). */
function hexRadius(x: number, z: number) {
    const ax = Math.abs(x);
    const az = Math.abs(z);
    return Math.max((2 * ax) / Math.sqrt(3), ax / Math.sqrt(3) + az);
}

export const TILE_SHAPES: Record<Terrain, TileShape> = {
    // A level plateau with a little wind-blown texture: room for the panels.
    solar: {
        base: 0.22,
        relief: (_x, _z, wx, wz) => world.fbm(wx * 1.6, wz * 1.6, 3) * 0.025,
        shade: (_x, _z, h) => 0.92 + h * 2,
    },
    // Broken ground around a terraced open pit, off-centre so the marker
    // stands on solid rock.
    asteroid: {
        base: 0.3,
        relief: (x, z, wx, wz) => {
            const rough = world.fbm(wx * 2.4 + 9, wz * 2.4, 5) * 0.11;
            const d = Math.hypot(x - 0.32, z + 0.22);
            const pit = d < 0.36 ? -Math.ceil((0.36 - d) / 0.07) * 0.035 : 0;
            return rough * (d < 0.4 ? 0.2 : 1) + pit;
        },
        shade: (_x, _z, h) => 0.8 + h * 1.6,
    },
    // Rolling, stony ground that the crystals push up through.
    crystal: {
        base: 0.26,
        relief: (_x, _z, wx, wz) => world.fbm(wx * 1.8 + 31, wz * 1.8, 4) * 0.08,
        shade: (_x, _z, h) => 0.85 + h * 1.5,
    },
    // Flat, tilled farmland.
    dome: {
        base: 0.2,
        relief: (_x, _z, wx, wz) => world.fbm(wx * 1.2 + 55, wz * 1.2, 2) * 0.012,
        shade: () => 1,
    },
    // Snowy banks around a frozen lake basin.
    ice: {
        base: 0.17,
        relief: (x, z, wx, wz) => {
            const r = Math.hypot(x, z);
            const basin = -0.07 * (1 - THREE.MathUtils.smoothstep(r, 0.38, 0.62));
            return basin + world.fbm(wx * 2 + 77, wz * 2, 4) * 0.035 * THREE.MathUtils.smoothstep(r, 0.45, 0.7);
        },
        shade: (x, z) => 0.85 + THREE.MathUtils.smoothstep(Math.hypot(x, z), 0.4, 0.75) * 0.2,
    },
    // Dunes of scorched sand pocked by two craters.
    desert: {
        base: 0.2,
        relief: (x, z, wx, wz) => {
            const dunes = Math.sin(wx * 4.2 + world.noise(wx, wz) * 2) * 0.012 + world.fbm(wx * 1.5 + 101, wz * 1.5, 4) * 0.04;
            const crater = (cx: number, cz: number, r: number) => {
                const d = Math.hypot(x - cx, z - cz) / r;
                return d < 1 ? -0.06 * (1 - d * d) : d < 1.35 ? 0.025 * Math.sin(((d - 1) / 0.35) * Math.PI) : 0;
            };
            return dunes + crater(-0.38, 0.2, 0.22) + crater(0.3, 0.42, 0.14);
        },
        shade: (_x, _z, h) => 0.82 + h * 2.2,
    },
};

/**
 * One tile: a subdivided hexagon whose height follows the terrain shape,
 * dropping to a softly rounded rim, plus a skirt of cliff down its sides.
 * Group 0 is the top, group 1 the sides.
 */
export function buildTileGeometry(terrain: Terrain, center: { x: number; z: number }, radius: number, detail = 16): THREE.BufferGeometry {
    const shape = TILE_SHAPES[terrain];
    const corners = Array.from({ length: 6 }, (_, i) => {
        const a = (i * Math.PI) / 3;
        return new THREE.Vector2(Math.sin(a) * radius, Math.cos(a) * radius);
    });

    const heightAt = (x: number, z: number) => surfaceHeight(terrain, center, radius, x, z);

    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const push = (x: number, z: number) => {
        const y = heightAt(x, z);
        pos.push(x, y, z);
        uv.push((x + center.x) * UV_SCALE, (z + center.z) * UV_SCALE);
        const s = shape.shade(x, z, y - shape.base);
        col.push(s, s, s);
    };

    // Six fan sectors, each subdivided into a triangular lattice.
    const top: number[] = [];
    let index = 0;
    const N = detail;
    for (let s = 0; s < 6; s++) {
        const c0 = corners[s];
        const c1 = corners[(s + 1) % 6];
        const rowStart: number[] = [];
        for (let a = 0; a <= N; a++) {
            rowStart.push(index);
            for (let b = 0; b <= a; b++) {
                const x = (c0.x * a) / N + ((c1.x - c0.x) * b) / N;
                const z = (c0.y * a) / N + ((c1.y - c0.y) * b) / N;
                push(x, z);
                index++;
            }
        }
        for (let a = 0; a < N; a++) {
            for (let b = 0; b <= a; b++) {
                const i0 = rowStart[a] + b;
                const i1 = rowStart[a + 1] + b;
                const i2 = rowStart[a + 1] + b + 1;
                top.push(i0, i1, i2);
                if (b < a) top.push(i0, i2, i0 + 1);
            }
        }
    }

    // Skirt: walk the rim and drop each edge vertex to the bottom.
    const side: number[] = [];
    const rim: THREE.Vector3[] = [];
    for (let s = 0; s < 6; s++) {
        const c0 = corners[s];
        const c1 = corners[(s + 1) % 6];
        for (let b = 0; b < N; b++) {
            const x = c0.x + ((c1.x - c0.x) * b) / N;
            const z = c0.y + ((c1.y - c0.y) * b) / N;
            rim.push(new THREE.Vector3(x, heightAt(x, z), z));
        }
    }
    let perimeter = 0;
    const skirtStart = index;
    for (let i = 0; i <= rim.length; i++) {
        const p = rim[i % rim.length];
        if (i > 0) perimeter += p.distanceTo(rim[i - 1]);
        // Strata bulge in and out a little so the cliff isn't a clean extrusion.
        const out = 1 + world.noise((p.x + center.x) * 6, (p.z + center.z) * 6) * 0.025;
        const steps = 6;
        for (let k = 0; k <= steps; k++) {
            const t = k / steps;
            const y = THREE.MathUtils.lerp(p.y - 0.004, SKIRT_BOTTOM, t);
            const bulge = k === 0 ? 1 : out * (1 - 0.03 * Math.sin(t * Math.PI));
            pos.push(p.x * bulge, y, p.z * bulge);
            uv.push(perimeter * 0.9, y * 0.9);
            col.push(1, 1, 1);
        }
        index += steps + 1;
    }
    for (let i = 0; i < rim.length; i++) {
        for (let k = 0; k < 6; k++) {
            const a = skirtStart + i * 7 + k;
            const b = a + 7;
            side.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }

    let geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geometry.setIndex([...top, ...side]);
    // Fuse the duplicated spoke vertices so normals are smooth across sectors.
    // The index keeps its length and order, so the groups stay valid.
    geometry = mergeVertices(geometry, 1e-4);
    geometry.clearGroups();
    geometry.addGroup(0, top.length, 0);
    geometry.addGroup(top.length, side.length, 1);
    geometry.computeVertexNormals();
    return geometry;
}

/** Height of a tile's top at a local point: what the mesh shows and props stand on. */
export function surfaceHeight(terrain: Terrain, center: { x: number; z: number }, radius: number, x: number, z: number) {
    const shape = TILE_SHAPES[terrain];
    const r = hexRadius(x / radius, z / radius);
    // Interior relief fades out before the rim so neighbours meet cleanly,
    // then the edge rolls over like weathered stone.
    const interior = shape.relief(x, z, x + center.x, z + center.z) * (1 - THREE.MathUtils.smoothstep(r, 0.78, 0.97));
    const roll = r > 0.9 ? -Math.pow((r - 0.9) / 0.1, 2) * 0.035 : 0;
    return shape.base + interior + roll;
}

// --- The island ---------------------------------------------------------

/**
 * The beach and rock shelf the tiles sit in. Flat under the tiles, then
 * shelving down past the waterline with a ragged outline.
 */
/** Height of the beach and seabed around the tiles, and how far past them a point is. */
export function islandHeight(x: number, z: number, tileCenters: { x: number; z: number }[]) {
    let d = Infinity;
    for (const c of tileCenters) d = Math.min(d, Math.hypot(x - c.x, z - c.z));
    // Distance past the tiles' edge, roughened.
    const edge = d - 0.92 + world.fbm(x * 0.9, z * 0.9, 4) * 0.45;
    const beach = THREE.MathUtils.smoothstep(edge, 0, 1.6);
    let y = THREE.MathUtils.lerp(0.04, SEA_LEVEL - 0.55, beach);
    y += world.fbm(x * 3 + 5, z * 3, 3) * 0.04 * (1 - beach);
    // Ripples in the sand below the waterline.
    y += Math.sin(x * 9 + world.noise(x * 2, z * 2) * 3) * 0.006 * beach;
    return { y, edge };
}

/**
 * The island's height sampled on a grid, for the sea shader to know how
 * deep the water is: shallows and surf follow the real shoreline.
 */
export function bakeIslandHeight(tileCenters: { x: number; z: number }[], extent: number, size = 256): THREE.DataTexture {
    const data = new Uint16Array(size * size);
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            const x = ((i + 0.5) / size - 0.5) * extent * 2;
            const z = ((j + 0.5) / size - 0.5) * extent * 2;
            data[j * size + i] = THREE.DataUtils.toHalfFloat(islandHeight(x, z, tileCenters).y);
        }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
}

export function buildIslandGeometry(tileCenters: { x: number; z: number }[], extent: number): THREE.BufferGeometry {
    const segments = 120;
    const geometry = new THREE.PlaneGeometry(extent * 2, extent * 2, segments, segments).rotateX(-Math.PI / 2);
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const uv = geometry.attributes.uv as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const { y, edge } = islandHeight(x, z, tileCenters);
        pos.setY(i, y);
        uv.setXY(i, x * UV_SCALE * 1.4, z * UV_SCALE * 1.4);
        // Wet sand is darker, and so are the crevices between tiles.
        const wet = THREE.MathUtils.smoothstep(SEA_LEVEL + 0.06 - y, 0, 0.08);
        const crevice = 1 - THREE.MathUtils.smoothstep(edge, -0.1, 0.15);
        const s = (1 - wet * 0.45) * (1 - crevice * 0.6);
        colors.set([s, s * 0.98, s * 0.95], i * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
}
