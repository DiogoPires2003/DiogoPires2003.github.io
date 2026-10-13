// What stands on each tile, so it reads as the place it is: solar farms,
// a mine, crystal outcrops, greenhouses, a frozen lake, a fallout zone.
//
// Props keep clear of the centre (the number marker) and the corners (where
// colonies go). Repeated details are instanced.

import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Terrain } from "../core/board";
import type { Rng } from "../core/rng";
import { bareMetal, ground, lamp, painted, plain } from "./materials";

export interface PropContext {
    rng: Rng;
    /** Ground height at a point in tile-local coordinates. */
    heightAt: (x: number, z: number) => number;
    sun: THREE.Vector3;
}

export interface Diorama {
    group: THREE.Group;
    update: (time: number) => void;
    /** Frees what this tile made for itself; shared geometry stays. */
    dispose?: () => void;
}

type Builder = (ctx: PropContext) => Diorama;

// --- Shared resources -----------------------------------------------------

const geoCache = new Map<string, THREE.BufferGeometry>();
function shared<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
    let g = geoCache.get(key) as T | undefined;
    if (!g) {
        g = make();
        geoCache.set(key, g);
    }
    return g;
}
const texCache = new Map<string, THREE.Texture>();
function canvasTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, color = true) {
    let t = texCache.get(key);
    if (!t) {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        draw(c.getContext("2d")!);
        t = new THREE.CanvasTexture(c);
        if (color) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        texCache.set(key, t);
    }
    return t;
}
const matCache = new Map<string, THREE.Material>();
function sharedMat<T extends THREE.Material>(key: string, make: () => T): T {
    let m = matCache.get(key) as T | undefined;
    if (!m) {
        m = make();
        matCache.set(key, m);
    }
    return m;
}

export function disposeProps() {
    for (const g of geoCache.values()) g.dispose();
    for (const t of texCache.values()) t.dispose();
    for (const m of matCache.values()) m.dispose();
    geoCache.clear();
    texCache.clear();
    matCache.clear();
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], shadows = true) {
    const o = new THREE.Mesh(g, m);
    o.castShadow = shadows;
    o.receiveShadow = true;
    return o;
}

/** Ground materials need a colour attribute; give plain geometry a white one. */
function withWhite<T extends THREE.BufferGeometry>(g: T): T {
    const n = g.attributes.position.count;
    g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    return g;
}

/** A weathered boulder: subdivided icosahedron, displaced and smoothed. */
function rockGeometry(variant: number, detail = 2) {
    return shared(`rock:${variant}:${detail}`, () => {
        const g = new THREE.IcosahedronGeometry(1, detail);
        const pos = g.attributes.position as THREE.BufferAttribute;
        const v = new THREE.Vector3();
        const s = variant * 17.3;
        // A few fracture planes per variant: the rock is cut flat where it
        // crosses them, which reads as stone rather than clay.
        const cuts = Array.from({ length: 5 }, (_, k) => {
            const a = s + k * 2.39996;
            const y = Math.sin(a * 1.7) * 0.8;
            const r = Math.sqrt(1 - y * y);
            return { n: new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r), d: 0.62 + ((k * 0.37 + variant * 0.13) % 0.25) };
        });
        for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i);
            const n =
                Math.sin(v.x * 2.1 + s) * Math.cos(v.y * 2.7 - s) * 0.16 +
                Math.sin(v.z * 4.3 + v.x * 1.7 + s) * 0.07 +
                Math.sin(v.x * 11.3 - v.y * 9.1 + v.z * 7.7 + s) * 0.03 +
                Math.sin(v.y * 23.0 + v.z * 19.0 - s) * 0.012;
            v.multiplyScalar(1 + n);
            for (const c of cuts) {
                const over = v.dot(c.n) - c.d;
                if (over > 0) v.addScaledVector(c.n, -over * 0.92);
            }
            v.y *= 0.72;
            pos.setXYZ(i, v.x, v.y, v.z);
        }
        // Drop the seams the sphere UVs introduce so the rock shades smoothly,
        // then project fresh UVs from the shape.
        g.deleteAttribute("normal");
        g.deleteAttribute("uv");
        const merged = mergeVertices(g, 1e-4);
        merged.computeVertexNormals();
        const mp = merged.attributes.position as THREE.BufferAttribute;
        const uv = new Float32Array(mp.count * 2);
        for (let i = 0; i < mp.count; i++) {
            uv[i * 2] = Math.atan2(mp.getZ(i), mp.getX(i)) / Math.PI + 1;
            uv[i * 2 + 1] = mp.getY(i) * 0.5 + 0.5;
        }
        merged.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
        return withWhite(merged);
    });
}

/** Thin cylinder between two points, for struts and lattice members. */
function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, sides = 5) {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, sides, 1, false);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.applyQuaternion(q);
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    return g;
}

/** Spots inside the tile, away from the centre marker and the corners. */
function scatter(rng: Rng, count: number, minR = 0.32, maxHex = 0.74, tries = 200) {
    const out: { x: number; z: number }[] = [];
    for (let i = 0; i < tries && out.length < count; i++) {
        const x = (rng() * 2 - 1) * 0.8;
        const z = (rng() * 2 - 1) * 0.8;
        const hx = Math.max((2 * Math.abs(x)) / Math.sqrt(3), Math.abs(x) / Math.sqrt(3) + Math.abs(z));
        if (hx > maxHex || Math.hypot(x, z) < minR) continue;
        if (out.some((p) => Math.hypot(p.x - x, p.z - z) < 0.12)) continue;
        out.push({ x, z });
    }
    return out;
}

const dummy = new THREE.Object3D();

// --- Campos solares ------------------------------------------------------

function pvTexture() {
    return canvasTexture("pv", 256, 160, (ctx) => {
        ctx.fillStyle = "#c7ccd4";
        ctx.fillRect(0, 0, 256, 160);
        const cols = 8;
        const rows = 5;
        const pad = 6;
        const cw = (256 - pad * 2) / cols;
        const ch = (160 - pad * 2) / rows;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const g = ctx.createLinearGradient(0, pad + r * ch, 0, pad + (r + 1) * ch);
                g.addColorStop(0, "#1c2a4a");
                g.addColorStop(1, "#0e1630");
                ctx.fillStyle = g;
                ctx.fillRect(pad + c * cw + 1, pad + r * ch + 1, cw - 2, ch - 2);
                // Busbars.
                ctx.fillStyle = "rgba(190,200,215,0.35)";
                ctx.fillRect(pad + c * cw + cw * 0.33, pad + r * ch + 1, 1, ch - 2);
                ctx.fillRect(pad + c * cw + cw * 0.66, pad + r * ch + 1, 1, ch - 2);
            }
        }
    });
}

const solar: Builder = ({ rng, heightAt, sun }) => {
    const group = new THREE.Group();
    const spots: { x: number; z: number }[] = [];
    for (let z = -0.48; z <= 0.5; z += 0.32) {
        for (let x = -0.6; x <= 0.62; x += 0.3) {
            const hx = Math.max((2 * Math.abs(x)) / Math.sqrt(3), Math.abs(x) / Math.sqrt(3) + Math.abs(z));
            if (hx < 0.74 && Math.hypot(x, z) > 0.34) spots.push({ x, z });
        }
    }
    const panelGeo = shared("pv-panel", () => new RoundedBoxGeometry(0.28, 0.014, 0.18, 2, 0.005));
    const panelMat = sharedMat(
        "pv-mat",
        () =>
            new THREE.MeshPhysicalMaterial({
                map: pvTexture(),
                roughness: 0.22,
                metalness: 0.35,
                clearcoat: 1,
                clearcoatRoughness: 0.08,
            }),
    );
    const postGeo = shared("pv-post", () => new THREE.CylinderGeometry(0.008, 0.01, 1, 6).translate(0, 0.5, 0));
    const panels = new THREE.InstancedMesh(panelGeo, panelMat, spots.length);
    const posts = new THREE.InstancedMesh(postGeo, bareMetal("#a8adb5"), spots.length);
    panels.castShadow = posts.castShadow = true;
    panels.receiveShadow = true;
    const yaw = Math.atan2(sun.x, sun.z);
    const bases = spots.map((p) => ({ ...p, y: heightAt(p.x, p.z) }));
    bases.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1.3, 0.12, 1.3);
        dummy.updateMatrix();
        posts.setMatrixAt(i, dummy.matrix);
    });
    const setPanels = (tilt: number) => {
        bases.forEach((p, i) => {
            dummy.position.set(p.x, p.y + 0.12, p.z);
            dummy.rotation.set(0, yaw, 0, "YXZ");
            dummy.rotateX(tilt);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            panels.setMatrixAt(i, dummy.matrix);
        });
        panels.instanceMatrix.needsUpdate = true;
    };
    setPanels(0.6);
    group.add(panels, posts);

    // Inverter station with a status light.
    const station = new THREE.Group();
    const a = rng() * Math.PI * 2;
    station.position.set(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5);
    station.position.y = heightAt(station.position.x, station.position.z);
    station.rotation.y = -a;
    station.scale.setScalar(1.5);
    // Keep it inside the hexagon.
    const sx = station.position.x;
    const sz = station.position.z;
    if (Math.max((2 * Math.abs(sx)) / Math.sqrt(3), Math.abs(sx) / Math.sqrt(3) + Math.abs(sz)) > 0.72) station.position.multiplyScalar(0.8);
    const body = mesh(shared("inv-body", () => new RoundedBoxGeometry(0.16, 0.09, 0.1, 3, 0.012).translate(0, 0.045, 0)), painted("#d8d6d0", 0.5));
    const roof = mesh(shared("inv-roof", () => new RoundedBoxGeometry(0.06, 0.03, 0.06, 2, 0.006).translate(0.03, 0.105, 0)), painted("#7f858c", 0.4));
    const vent = mesh(shared("inv-vent", () => new THREE.CylinderGeometry(0.018, 0.018, 0.035, 12).translate(-0.04, 0.105, 0)), bareMetal());
    const status = mesh(shared("inv-led", () => new THREE.SphereGeometry(0.006, 8, 6).translate(0.081, 0.07, 0.03)), lamp("#7dffb0", 3), false);
    status.userData.dynamic = true;
    station.add(body, roof, vent, status);
    group.add(station);

    const phase = rng() * 10;
    return {
        group,
        update(t) {
            // Trackers creep with the sun.
            setPanels(0.6 + Math.sin(t * 0.05 + phase) * 0.06);
            status.visible = Math.sin(t * 2 + phase) > -0.6;
        },
        dispose() {
            panels.dispose();
            posts.dispose();
        },
    };
};

// --- Minas de asteroide ---------------------------------------------------

const asteroid: Builder = ({ rng, heightAt }) => {
    const group = new THREE.Group();
    const rockMat = ground("rocky_terrain_02", "#a59a90", { normalScale: 1.6 });

    // Boulders, half-buried.
    for (const p of scatter(rng, 4, 0.34, 0.7)) {
        if (Math.hypot(p.x - 0.32, p.z + 0.22) < 0.42) continue;
        const s = 0.07 + rng() * 0.08;
        const r = mesh(rockGeometry(Math.floor(rng() * 5)), rockMat);
        r.position.set(p.x, heightAt(p.x, p.z) + s * 0.25, p.z);
        r.scale.set(s * (0.9 + rng() * 0.4), s, s * (0.9 + rng() * 0.4));
        r.rotation.y = rng() * 6;
        group.add(r);
    }

    // Headframe over the pit: four legs, cross bracing, a sheave wheel.
    const frame = new THREE.Group();
    // Straddling the pit's shaft.
    const fx = 0.36;
    const fz = -0.26;
    frame.position.set(fx, heightAt(fx, fz), fz);
    frame.scale.setScalar(1.35);
    const latticeGeo = shared("headframe", () => {
        const parts: THREE.BufferGeometry[] = [];
        const h = 0.46;
        const w0 = 0.07;
        const w1 = 0.035;
        const corner = (i: number, y: number) => {
            const w = THREE.MathUtils.lerp(w0, w1, y / h);
            const a = Math.PI / 4 + (i * Math.PI) / 2;
            return new THREE.Vector3(Math.cos(a) * w, y, Math.sin(a) * w);
        };
        for (let i = 0; i < 4; i++) parts.push(strut(corner(i, 0), corner(i, h), 0.005));
        const levels = 5;
        for (let l = 0; l < levels; l++) {
            const y0 = (l / levels) * h;
            const y1 = ((l + 1) / levels) * h;
            for (let i = 0; i < 4; i++) {
                parts.push(strut(corner(i, y1), corner((i + 1) % 4, y1), 0.0035, 4));
                parts.push(strut(corner(i, y0), corner((i + 1) % 4, y1), 0.0028, 4));
            }
        }
        // Platform at the top.
        parts.push(new THREE.BoxGeometry(0.1, 0.008, 0.1).translate(0, h, 0));
        return mergeGeometries(parts.map((p) => p.toNonIndexed()));
    });
    const lattice = mesh(latticeGeo, painted("#9a5a32", 0.55, 0.35));
    const wheel = new THREE.Group();
    wheel.position.set(0, 0.5, 0);
    const rim = mesh(shared("sheave-rim", () => new THREE.TorusGeometry(0.045, 0.006, 8, 28)), bareMetal("#5d6066"));
    const spokes = mesh(
        shared("sheave-spokes", () =>
            mergeGeometries(
                [0, 1, 2, 3].map((i) =>
                    new THREE.BoxGeometry(0.088, 0.004, 0.004).rotateZ((i * Math.PI) / 4).toNonIndexed(),
                ),
            ),
        ),
        bareMetal("#5d6066"),
    );
    wheel.add(rim, spokes);
    wheel.userData.dynamic = true;
    const cable = mesh(shared("cable", () => new THREE.CylinderGeometry(0.0015, 0.0015, 0.62, 4).translate(0.045, 0.19, 0)), plain("#222", 0.6, 0.6));
    frame.add(lattice, wheel, cable);
    group.add(frame);

    // Conveyor from the pit to an ore heap.
    const heapX = -0.42;
    const heapZ = -0.32;
    const heap = mesh(
        shared("heap", () => {
            const g = rockGeometry(9, 2).clone();
            g.scale(1.3, 0.75, 1.1);
            return g;
        }),
        ground("rocky_terrain_02", "#6f6a66", { normalScale: 2 }),
    );
    heap.position.set(heapX, heightAt(heapX, heapZ) + 0.01, heapZ);
    heap.scale.setScalar(0.15);
    group.add(heap);
    const flecks = new THREE.InstancedMesh(shared("fleck", () => new THREE.OctahedronGeometry(0.012, 0)), bareMetal("#c8b28a", 0.2), 14);
    for (let i = 0; i < 14; i++) {
        const a = rng() * Math.PI * 2;
        const r = rng() * 0.1;
        dummy.position.set(heapX + Math.cos(a) * r, heightAt(heapX, heapZ) + 0.02 + (0.1 - r) * 0.55, heapZ + Math.sin(a) * r * 0.85);
        dummy.rotation.set(rng() * 3, rng() * 3, rng() * 3);
        dummy.scale.setScalar(0.6 + rng());
        dummy.updateMatrix();
        flecks.setMatrixAt(i, dummy.matrix);
    }
    group.add(flecks);

    const from = new THREE.Vector3(0.18, heightAt(0.18, -0.36) + 0.03, -0.36);
    const to = new THREE.Vector3(heapX + 0.05, heightAt(heapX, heapZ) + 0.16, heapZ + 0.02);
    const belt = mesh(new THREE.BoxGeometry(0.035, 0.012, from.distanceTo(to)), painted("#3b3f45", 0.6));
    belt.position.copy(from).add(to).multiplyScalar(0.5);
    belt.lookAt(to);
    group.add(belt);
    const legGeo = shared("belt-leg", () => new THREE.CylinderGeometry(0.004, 0.004, 1, 4).translate(0, 0.5, 0));
    for (const k of [0.3, 0.7]) {
        const p = from.clone().lerp(to, k);
        const g = heightAt(p.x, p.z);
        const leg = mesh(legGeo, bareMetal());
        leg.position.set(p.x, g, p.z);
        leg.scale.y = p.y - g;
        group.add(leg);
    }

    // A hauler shuttling round the pit rim.
    const truck = new THREE.Group();
    const cab = mesh(shared("truck-cab", () => new RoundedBoxGeometry(0.05, 0.035, 0.04, 2, 0.006).translate(0.035, 0.03, 0)), painted("#d6a12d", 0.45));
    const bed = mesh(shared("truck-bed", () => new RoundedBoxGeometry(0.06, 0.03, 0.045, 2, 0.004).translate(-0.02, 0.035, 0)), painted("#6c6f74", 0.5));
    const wheelsGeo = shared("truck-wheels", () =>
        mergeGeometries(
            [-0.035, 0.035].flatMap((x) =>
                [-0.024, 0.024].map((z) => new THREE.CylinderGeometry(0.012, 0.012, 0.01, 12).rotateX(Math.PI / 2).translate(x, 0.012, z).toNonIndexed()),
            ),
        ),
    );
    const wheels = mesh(wheelsGeo, plain("#1b1b1d", 0.85));
    const headlight = mesh(shared("truck-light", () => new THREE.SphereGeometry(0.004, 6, 4).translate(0.061, 0.03, 0.012)), lamp("#fff2d0", 2.5), false);
    truck.add(cab, bed, wheels, headlight);
    truck.scale.setScalar(1.7);
    truck.userData.dynamic = true;
    group.add(truck);

    const phase = rng() * 10;
    const pitC = new THREE.Vector2(0.32, -0.22);
    return {
        group,
        update(t) {
            wheel.rotation.z = t * 2;
            // Along the pit's outer rim and back, clear of the marker.
            const a = Math.sin(t * 0.25 + phase) * 0.9 + 0.2;
            const x = pitC.x + Math.cos(a) * 0.3;
            const z = pitC.y + Math.sin(a) * 0.3;
            truck.position.set(x, heightAt(x, z), z);
            const dir = Math.cos(t * 0.25 + phase) >= 0 ? 1 : -1;
            truck.rotation.y = -a - (Math.PI / 2) * dir;
        },
        dispose() {
            flecks.dispose();
            belt.geometry.dispose();
        },
    };
};

// --- Bosques de cristal ---------------------------------------------------

function crystalGeometry() {
    return shared("crystal", () => {
        const prism = new THREE.CylinderGeometry(0.5, 0.55, 2.2, 6, 1, true).translate(0, 1.1, 0);
        const tip = new THREE.ConeGeometry(0.5, 0.8, 6, 1, true).translate(0, 2.6, 0);
        const g = mergeGeometries([prism.toNonIndexed(), tip.toNonIndexed()]);
        g.computeVertexNormals();
        return g;
    });
}

const crystal: Builder = ({ rng, heightAt }) => {
    const group = new THREE.Group();
    const mat = new THREE.MeshPhysicalMaterial({
        color: "#d9ccff",
        roughness: 0.12,
        metalness: 0,
        ior: 1.6,
        flatShading: true,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        iridescence: 0.35,
        iridescenceIOR: 1.4,
        emissive: new THREE.Color("#5b3fa8"),
        emissiveIntensity: 0.12,
        transparent: true,
        opacity: 0.9,
    });
    const rockMat = ground("aerial_ground_rock", "#8f8a98");

    const clusters = scatter(rng, 4, 0.36, 0.66);
    const shards: { m: THREE.Mesh; base: number }[] = [];
    for (const c of clusters) {
        const y = heightAt(c.x, c.z);
        const n = 4 + Math.floor(rng() * 4);
        const scale = 0.05 + rng() * 0.035;
        // A bed of rock the shards grow from.
        const bed = mesh(rockGeometry(Math.floor(rng() * 5)), rockMat);
        bed.position.set(c.x, y, c.z);
        bed.scale.set(scale * 2.2, scale * 0.9, scale * 2.2);
        group.add(bed);
        for (let i = 0; i < n; i++) {
            const s = scale * (i === 0 ? 1.3 : 0.5 + rng() * 0.6);
            const m = mesh(crystalGeometry(), mat);
            const a = rng() * Math.PI * 2;
            const off = i === 0 ? 0 : scale * (0.8 + rng());
            m.position.set(c.x + Math.cos(a) * off, y - s * 0.3, c.z + Math.sin(a) * off);
            m.scale.set(s, s * (0.9 + rng() * 0.6), s);
            m.rotation.set((rng() - 0.5) * 0.9, rng() * 6, (rng() - 0.5) * 0.9);
            group.add(m);
            shards.push({ m, base: m.scale.y });
        }
    }
    // Loose fragments in the soil.
    const frags = new THREE.InstancedMesh(crystalGeometry(), mat, 18);
    frags.castShadow = true;
    for (let i = 0; i < 18; i++) {
        const p = scatter(rng, 1, 0.3, 0.75)[0] ?? { x: 0.5, z: 0 };
        const s = 0.006 + rng() * 0.008;
        dummy.position.set(p.x, heightAt(p.x, p.z) - s, p.z);
        dummy.rotation.set((rng() - 0.5) * 2, rng() * 6, (rng() - 0.5) * 2);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        frags.setMatrixAt(i, dummy.matrix);
    }
    group.add(frags);

    // A survey post: tripod and a sensor head.
    const post = new THREE.Group();
    const pp = scatter(rng, 1, 0.4, 0.62)[0] ?? { x: -0.4, z: 0.2 };
    post.position.set(pp.x, heightAt(pp.x, pp.z), pp.z);
    post.scale.setScalar(1.5);
    const tripod = mesh(
        shared("tripod", () =>
            mergeGeometries(
                [0, 1, 2].map((i) => {
                    const a = (i / 3) * Math.PI * 2;
                    return strut(new THREE.Vector3(Math.cos(a) * 0.035, 0, Math.sin(a) * 0.035), new THREE.Vector3(0, 0.1, 0), 0.0035).toNonIndexed();
                }),
            ),
        ),
        bareMetal("#b8bcc4"),
    );
    const head = mesh(shared("sensor", () => new RoundedBoxGeometry(0.035, 0.022, 0.025, 2, 0.005).translate(0, 0.11, 0)), painted("#e4e2dc", 0.4));
    const lens = mesh(shared("lens", () => new THREE.SphereGeometry(0.006, 10, 8).translate(0, 0.112, 0.013)), lamp("#9fd8ff", 2), false);
    head.userData.dynamic = lens.userData.dynamic = true;
    post.add(tripod, head, lens);
    group.add(post);

    const phase = rng() * 10;
    return {
        group,
        update(t) {
            mat.emissiveIntensity = 0.1 + (Math.sin(t * 0.8 + phase) * 0.5 + 0.5) * 0.12;
            head.rotation.y = Math.sin(t * 0.6 + phase) * 1.2;
            lens.rotation.y = head.rotation.y;
        },
        dispose() {
            mat.dispose();
            frags.dispose();
        },
    };
};

// --- Cúpulas de cultivo -----------------------------------------------------

/** Geodesic frame: the edges of a subdivided icosahedron above the ground. */
function geodesicFrame() {
    return shared("geodesic", () => {
        const ico = new THREE.IcosahedronGeometry(1, 2);
        const pos = ico.attributes.position as THREE.BufferAttribute;
        const seen = new Set<string>();
        const parts: THREE.BufferGeometry[] = [];
        const key = (v: THREE.Vector3) => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        for (let i = 0; i < pos.count; i += 3) {
            for (let e = 0; e < 3; e++) {
                a.fromBufferAttribute(pos, i + e);
                b.fromBufferAttribute(pos, i + ((e + 1) % 3));
                if (a.y < -0.02 || b.y < -0.02) continue;
                const k = [key(a), key(b)].sort().join("|");
                if (seen.has(k)) continue;
                seen.add(k);
                parts.push(strut(a.clone().setY(Math.max(a.y, 0)), b.clone().setY(Math.max(b.y, 0)), 0.012, 4).toNonIndexed());
            }
        }
        ico.dispose();
        return mergeGeometries(parts);
    });
}

const dome: Builder = ({ rng, heightAt }) => {
    const group = new THREE.Group();
    const shell = shared("dome-shell", () => new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2));
    const base = shared("dome-base", () => new THREE.CylinderGeometry(1.04, 1.08, 0.08, 40).translate(0, 0.02, 0));
    const glassMat = sharedMat(
        "dome-glass",
        () =>
            new THREE.MeshPhysicalMaterial({
                color: "#e9f6f2",
                roughness: 0.05,
                metalness: 0,
                clearcoat: 1,
                transparent: true,
                opacity: 0.26,
                depthWrite: false,
            }),
    );

    const domes = [
        { x: -0.36, z: 0.16, r: 0.25 },
        { x: 0.32, z: 0.33, r: 0.19 },
    ];
    // Lean towards the side with more room.
    if (rng() > 0.5) domes.forEach((d) => (d.x = -d.x));
    const plants = new THREE.InstancedMesh(
        shared("plant", () => withWhite(new THREE.IcosahedronGeometry(1, 1))),
        sharedMat("plant-mat", () => new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.8 })),
        domes.length * 22,
    );
    plants.castShadow = true;
    const green = new THREE.Color();
    let pi = 0;
    for (const d of domes) {
        const y = heightAt(d.x, d.z);
        const g = new THREE.Group();
        g.position.set(d.x, y, d.z);
        const glassMesh = new THREE.Mesh(shell, glassMat);
        glassMesh.scale.setScalar(d.r);
        const frameMesh = mesh(geodesicFrame(), painted("#e6e4de", 0.4, 0.3));
        frameMesh.scale.setScalar(d.r);
        const ring = mesh(base, painted("#8d9196", 0.5));
        ring.scale.set(d.r, d.r, d.r);
        g.add(ring, frameMesh, glassMesh);
        group.add(g);
        for (let i = 0; i < 22; i++) {
            const a = rng() * Math.PI * 2;
            const r = Math.sqrt(rng()) * d.r * 0.8;
            const s = d.r * (0.07 + rng() * 0.06);
            dummy.position.set(d.x + Math.cos(a) * r, y + s * 0.6, d.z + Math.sin(a) * r);
            dummy.scale.set(s, s * (1 + rng() * 0.8), s);
            dummy.rotation.set(0, rng() * 6, 0);
            dummy.updateMatrix();
            plants.setMatrixAt(pi, dummy.matrix);
            plants.setColorAt(pi, green.setHSL(0.27 + rng() * 0.08, 0.45, 0.22 + rng() * 0.12));
            pi++;
        }
    }
    group.add(plants);

    // Crop rows outside, following the furrows.
    const crops: { x: number; z: number }[] = [];
    for (let z = -0.6; z <= 0.6; z += 0.07) {
        for (let x = -0.7; x <= 0.7; x += 0.045) {
            const hx = Math.max((2 * Math.abs(x)) / Math.sqrt(3), Math.abs(x) / Math.sqrt(3) + Math.abs(z));
            if (hx > 0.76 || Math.hypot(x, z) < 0.3) continue;
            if (domes.some((d) => Math.hypot(x - d.x, z - d.z) < d.r + 0.06)) continue;
            if (z > -0.15) continue;
            crops.push({ x, z });
        }
    }
    const cropMesh = new THREE.InstancedMesh(
        shared("crop", () => withWhite(new THREE.ConeGeometry(1, 2.2, 6, 1))),
        sharedMat("crop-mat", () => new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.85 })),
        crops.length,
    );
    cropMesh.castShadow = true;
    crops.forEach((p, i) => {
        const s = 0.016 + rng() * 0.008;
        dummy.position.set(p.x, heightAt(p.x, p.z) + s, p.z);
        dummy.scale.set(s, s, s);
        dummy.rotation.set(0, rng() * 6, 0);
        dummy.updateMatrix();
        cropMesh.setMatrixAt(i, dummy.matrix);
        cropMesh.setColorAt(i, green.setHSL(0.2 + rng() * 0.06, 0.5, 0.28 + rng() * 0.08));
    });
    group.add(cropMesh);

    // Twin silos.
    const silo = new THREE.Group();
    const sp = { x: domes[0].x > 0 ? -0.5 : 0.5, z: 0.0 };
    silo.position.set(sp.x, heightAt(sp.x, sp.z), sp.z);
    silo.scale.setScalar(1.4);
    const siloGeo = shared("silo", () =>
        mergeGeometries([
            new THREE.CylinderGeometry(0.035, 0.035, 0.16, 20).translate(0, 0.08, 0).toNonIndexed(),
            new THREE.SphereGeometry(0.035, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.16, 0).toNonIndexed(),
        ]),
    );
    for (const dz of [-0.045, 0.045]) {
        const s = mesh(siloGeo, bareMetal("#c9ccd0", 0.3));
        s.position.z = dz;
        silo.add(s);
    }
    group.add(silo);

    return {
        group,
        update() {},
        dispose() {
            plants.dispose();
            cropMesh.dispose();
        },
    };
};

// --- Lagos de hielo ---------------------------------------------------------

function iceTexture() {
    return canvasTexture("ice-cracks", 512, 512, (ctx) => {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, 512, 512);
        ctx.strokeStyle = "rgba(120,160,180,0.55)";
        ctx.lineCap = "round";
        let seed = 7;
        const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < 26; i++) {
            let x = r() * 512;
            let y = r() * 512;
            let a = r() * Math.PI * 2;
            ctx.lineWidth = 0.6 + r() * 1.6;
            ctx.beginPath();
            ctx.moveTo(x, y);
            for (let s = 0; s < 14; s++) {
                a += (r() - 0.5) * 1.1;
                x += Math.cos(a) * 14;
                y += Math.sin(a) * 14;
                ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
    });
}

const ice: Builder = ({ rng, heightAt }) => {
    const group = new THREE.Group();
    const lakeY = heightAt(0, 0) + 0.012;
    const iceMat = sharedMat(
        "ice",
        () =>
            new THREE.MeshPhysicalMaterial({
                color: "#d6eef4",
                map: iceTexture(),
                roughness: 0.12,
                metalness: 0,
                clearcoat: 1,
                clearcoatRoughness: 0.1,

            }),
    );
    const lake = mesh(shared("lake", () => new THREE.CircleGeometry(0.56, 48).rotateX(-Math.PI / 2)), iceMat, false);
    lake.position.y = lakeY;
    group.add(lake);

    // Floes and pressure ridges.
    const floes = new THREE.InstancedMesh(
        shared("floe", () => new RoundedBoxGeometry(1, 0.35, 0.7, 2, 0.12)),
        sharedMat("floe-mat", () => new THREE.MeshPhysicalMaterial({ color: "#eef8fb", roughness: 0.3, clearcoat: 0.6, transmission: 0 })),
        9,
    );
    floes.castShadow = true;
    for (let i = 0; i < 9; i++) {
        const a = rng() * Math.PI * 2;
        const r = 0.3 + rng() * 0.2;
        const s = 0.03 + rng() * 0.035;
        dummy.position.set(Math.cos(a) * r, lakeY + s * 0.08, Math.sin(a) * r);
        dummy.rotation.set((rng() - 0.5) * 0.3, rng() * 6, (rng() - 0.5) * 0.3);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        floes.setMatrixAt(i, dummy.matrix);
    }
    group.add(floes);

    // Pump house on the bank with a pipe running into the ice.
    const a = rng() * Math.PI * 2;
    const hx = Math.cos(a) * 0.66;
    const hz = Math.sin(a) * 0.66;
    const house = new THREE.Group();
    house.position.set(hx * 0.95, heightAt(hx * 0.95, hz * 0.95), hz * 0.95);
    house.rotation.y = -a + Math.PI / 2;
    house.scale.setScalar(1.4);
    const body = mesh(shared("pump-body", () => new RoundedBoxGeometry(0.12, 0.08, 0.09, 3, 0.012).translate(0, 0.04, 0)), painted("#c9533b", 0.5));
    const roofGeo = shared("pump-roof", () => new RoundedBoxGeometry(0.13, 0.015, 0.1, 2, 0.005).translate(0, 0.085, 0));
    const roof = mesh(roofGeo, painted("#e8e6e0", 0.45));
    const win = mesh(shared("pump-win", () => new THREE.PlaneGeometry(0.03, 0.02).translate(0.02, 0.05, 0.0451)), lamp("#ffd9a0", 1.6), false);
    const stack = mesh(shared("pump-stack", () => new THREE.CylinderGeometry(0.008, 0.01, 0.07, 10).translate(-0.035, 0.12, 0)), bareMetal());
    house.add(body, roof, win, stack);
    group.add(house);
    const pipePath = new THREE.CatmullRomCurve3([
        new THREE.Vector3(house.position.x, house.position.y + 0.02, house.position.z),
        new THREE.Vector3(hx * 0.78, lakeY + 0.03, hz * 0.78),
        new THREE.Vector3(hx * 0.55, lakeY + 0.01, hz * 0.55),
        new THREE.Vector3(hx * 0.4, lakeY - 0.01, hz * 0.4),
    ]);
    const pipeGeo = new THREE.TubeGeometry(pipePath, 24, 0.008, 8, false);
    pipeGeo;
    const pipe = mesh(pipeGeo, bareMetal("#8d949c", 0.3));
    group.add(pipe);

    // Steam from the stack.
    const puffs: THREE.Sprite[] = [];
    const puffMat = sharedMat(
        "steam",
        () =>
            new THREE.SpriteMaterial({
                map: canvasTexture("puff", 64, 64, (ctx) => {
                    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
                    g.addColorStop(0, "rgba(255,255,255,0.8)");
                    g.addColorStop(1, "rgba(255,255,255,0)");
                    ctx.fillStyle = g;
                    ctx.fillRect(0, 0, 64, 64);
                }),
                transparent: true,
                depthWrite: false,
                opacity: 0.35,
            }),
    );
    const stackTop = new THREE.Vector3(-0.035, 0.16, 0);
    for (let i = 0; i < 5; i++) {
        const p = new THREE.Sprite(puffMat);
        house.add(p);
        puffs.push(p);
    }

    return {
        group,
        update(t) {
            puffs.forEach((p, i) => {
                const k = (t * 0.35 + i / puffs.length) % 1;
                p.position.copy(stackTop).add(new THREE.Vector3(k * 0.04, k * 0.16, 0));
                // The material is shared, so puffs fade by thinning out instead.
                p.scale.setScalar(0.02 + k * 0.06);
                p.visible = k < 0.92;
            });
        },
        dispose() {
            floes.dispose();
            pipeGeo.dispose();
        },
    };
};

// --- Desierto radiactivo ----------------------------------------------------

function hazardTexture() {
    return canvasTexture("hazard", 256, 128, (ctx) => {
        ctx.fillStyle = "#b58f2a";
        ctx.fillRect(0, 0, 256, 128);
        // Grime.
        for (let i = 0; i < 400; i++) {
            ctx.fillStyle = `rgba(60,40,20,${Math.random() * 0.12})`;
            ctx.fillRect(Math.random() * 256, Math.random() * 128, 3 + Math.random() * 8, 2 + Math.random() * 6);
        }
        ctx.fillStyle = "#1d1b18";
        ctx.fillRect(0, 50, 256, 28);
        ctx.fillStyle = "#b58f2a";
        for (let x = -30; x < 256; x += 26) {
            ctx.beginPath();
            ctx.moveTo(x, 78);
            ctx.lineTo(x + 13, 78);
            ctx.lineTo(x + 26, 50);
            ctx.lineTo(x + 13, 50);
            ctx.fill();
        }
    });
}

const desert: Builder = ({ rng, heightAt }) => {
    const group = new THREE.Group();

    // Barrels, some upright, some toppled, a few leaking into the crater.
    const barrelGeo = shared("barrel", () => {
        const body = new THREE.CylinderGeometry(0.5, 0.5, 1.4, 20, 1);
        const ribs = [-0.35, 0.35].map((y) => new THREE.TorusGeometry(0.505, 0.03, 6, 20).rotateX(Math.PI / 2).translate(0, y, 0));
        return mergeGeometries([body.toNonIndexed(), ...ribs.map((r) => r.toNonIndexed())]);
    });
    const barrelMat = sharedMat(
        "barrel-mat",
        () => new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.6, metalness: 0.4 }),
    );
    const cx = -0.38;
    const cz = 0.2;
    for (let i = 0; i < 7; i++) {
        const a = rng() * Math.PI * 2;
        const r = 0.24 + rng() * 0.12;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        if (Math.hypot(x, z) < 0.3) continue;
        const b = mesh(barrelGeo, barrelMat);
        const s = 0.04;
        b.scale.setScalar(s);
        const toppled = rng() > 0.55;
        b.position.set(x, heightAt(x, z) + (toppled ? s * 0.5 : s * 0.7), z);
        b.rotation.set(toppled ? Math.PI / 2 : (rng() - 0.5) * 0.2, rng() * 6, toppled ? 0 : (rng() - 0.5) * 0.2);
        group.add(b);
    }

    // What fell here: a lander's hull, broken and half sunk in the sand.
    const wreck = new THREE.Group();
    const wp = { x: 0.42, z: -0.28 };
    wreck.position.set(wp.x, heightAt(wp.x, wp.z) - 0.02, wp.z);
    wreck.rotation.set(0.25, rng() * 6, -0.18);
    wreck.scale.setScalar(1.5);
    const rust = bareMetal("#8a5a44", 0.55);
    const hull = mesh(shared("wreck-hull", () => new THREE.CylinderGeometry(0.07, 0.09, 0.16, 16, 1, true, 0, Math.PI * 1.4).rotateZ(Math.PI / 2)), rust);
    const nose = mesh(shared("wreck-nose", () => new THREE.SphereGeometry(0.07, 16, 10, 0, Math.PI * 1.2, 0, Math.PI / 2).rotateZ(-Math.PI / 2).translate(0.08, 0, 0)), rust);
    const fin = mesh(shared("wreck-fin", () => new RoundedBoxGeometry(0.08, 0.005, 0.05, 1, 0.002).rotateZ(0.6).translate(-0.09, 0.04, 0.04)), painted("#5c5f63", 0.6, 0.5));
    const strutA = mesh(shared("wreck-strut", () => strut(new THREE.Vector3(-0.05, -0.02, 0.06), new THREE.Vector3(-0.12, -0.08, 0.12), 0.006)), bareMetal());
    wreck.add(hull, nose, fin, strutA);
    group.add(wreck);

    // The crater pool gives off a faint, sickly light.
    const pool = mesh(
        shared("pool", () => new THREE.CircleGeometry(0.075, 32).rotateX(-Math.PI / 2)),
        sharedMat("pool-mat", () => new THREE.MeshStandardMaterial({ color: "#2b3318", emissive: new THREE.Color("#7f9a2a"), emissiveIntensity: 0.35, roughness: 0.08 })),
        false,
    );
    pool.position.set(cx, heightAt(cx, cz) + 0.012, cz);
    group.add(pool);

    // Warning signs around the zone.
    const signGeo = shared("sign", () =>
        mergeGeometries([
            new THREE.CylinderGeometry(0.003, 0.003, 0.1, 6).translate(0, 0.05, 0).toNonIndexed(),
            new THREE.CylinderGeometry(0.022, 0.022, 0.003, 3).rotateX(Math.PI / 2).rotateZ(Math.PI / 6 + Math.PI).translate(0, 0.105, 0).toNonIndexed(),
        ]),
    );
    const signMat = painted("#c9a227", 0.55, 0.2);
    for (const p of scatter(rng, 3, 0.45, 0.72)) {
        const s = mesh(signGeo, signMat);
        s.position.set(p.x, heightAt(p.x, p.z), p.z);
        s.rotation.set((rng() - 0.5) * 0.25, Math.atan2(-p.x, -p.z), (rng() - 0.5) * 0.25);
        group.add(s);
    }

    const phase = rng() * 10;
    const poolMat = pool.material as THREE.MeshStandardMaterial;
    return {
        group,
        update(t) {
            poolMat.emissiveIntensity = 0.28 + Math.sin(t * 0.7 + phase) * 0.1;
        },
    };
};

const BUILDERS: Record<Terrain, Builder> = { solar, asteroid, crystal, dome, ice, desert };

export function buildProps(terrain: Terrain, ctx: PropContext): Diorama {
    return BUILDERS[terrain](ctx);
}

