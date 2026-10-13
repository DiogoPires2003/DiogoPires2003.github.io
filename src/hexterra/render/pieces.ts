// Models for everything a player puts on the board, and the build effect:
// the piece is projected as a faint scan, a line sweeps up solidifying it,
// and the projection fades.
//
// Sizes are in hex units: a vertex sits HEX_SIZE from its tile's centre.
// Each corporation's colour is its livery, painted on, not lit up.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ease, lerp, type Animator } from "./anim";
import { bareMetal, curtainWall, hologram, lamp, painted, plain } from "./materials";

export interface Piece {
    group: THREE.Group;
    update?: (time: number) => void;
    dispose: () => void;
}

const WHITE = "#e3e1db";
const CONCRETE = "#8c8d8f";
const GRAPHITE = "#2c3036";

function m(g: THREE.BufferGeometry, mat: THREE.Material, shadows = true) {
    const o = new THREE.Mesh(g, mat);
    o.castShadow = shadows;
    o.receiveShadow = true;
    return o;
}

/** Collects geometry made for one piece so dispose() can free it. */
function bag() {
    const list: THREE.BufferGeometry[] = [];
    const g = <T extends THREE.BufferGeometry>(x: T) => (list.push(x), x);
    return { g, dispose: () => list.forEach((x) => x.dispose()) };
}

function lathe(profile: [number, number][], segments: number) {
    return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

/** Colonia: a domed habitat with two modules, a solar wing and a dish. */
export function createColony(color: string): Piece {
    const group = new THREE.Group();
    const { g, dispose } = bag();

    const pad = m(g(new THREE.CylinderGeometry(0.2, 0.215, 0.026, 6).translate(0, 0.013, 0)), painted(CONCRETE, 0.8, 0));
    const stripe = m(g(new THREE.CylinderGeometry(0.2015, 0.2015, 0.008, 6, 1, true).translate(0, 0.02, 0)), painted(color, 0.5, 0.1), false);
    const hab = m(
        g(lathe([[0, 0.026], [0.095, 0.026], [0.098, 0.05], [0.095, 0.075], [0.08, 0.105], [0.055, 0.125], [0.025, 0.134], [0, 0.136]], 40)),
        painted(color, 0.42, 0.15),
    );
    const windows = m(g(new THREE.CylinderGeometry(0.0965, 0.0965, 0.008, 40, 1, true).translate(0, 0.064, 0)), lamp("#ffd7a0", 1.3), false);
    const roofCap = m(g(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 24).translate(0, 0.138, 0)), painted(WHITE, 0.45, 0.2));
    group.add(pad, stripe, hab, windows, roofCap);

    // Two capsule modules docked to the hab.
    const capsule = g(new THREE.CapsuleGeometry(0.03, 0.07, 6, 16).rotateZ(Math.PI / 2));
    const cap = g(new THREE.CylinderGeometry(0.031, 0.031, 0.012, 20).rotateZ(Math.PI / 2));
    for (const a of [0.5, 2.7]) {
        const mod = new THREE.Group();
        mod.rotation.y = a;
        const body = m(capsule, painted("#c9ccd0", 0.45, 0.2));
        body.position.set(0.13, 0.058, 0);
        const ring = m(cap, painted(color, 0.5, 0.2));
        ring.position.set(0.1, 0.058, 0);
        mod.add(body, ring);
        group.add(mod);
    }

    // Solar wing on a short mast.
    const wing = new THREE.Group();
    wing.position.set(-0.1, 0.026, 0.1);
    const wmast = m(g(new THREE.CylinderGeometry(0.004, 0.004, 0.07, 8).translate(0, 0.035, 0)), bareMetal());
    const panel = m(g(new RoundedBoxGeometry(0.09, 0.004, 0.05, 1, 0.002).rotateX(-0.6).translate(0, 0.072, 0)), plain("#1b2742", 0.25, 0.4));
    wing.add(wmast, panel);
    group.add(wing);

    // Comms dish with a blinking beacon.
    const dish = new THREE.Group();
    dish.position.set(0.04, 0.13, -0.05);
    const dmast = m(g(new THREE.CylinderGeometry(0.003, 0.003, 0.05, 6).translate(0, 0.025, 0)), bareMetal());
    const bowl = m(g(new THREE.SphereGeometry(0.03, 20, 8, 0, Math.PI * 2, 0, Math.PI / 3.5).rotateX(Math.PI * 0.75).translate(0, 0.055, 0)), painted(WHITE, 0.35, 0.3));
    const beacon = m(g(new THREE.SphereGeometry(0.005, 8, 6).translate(0, 0.075, 0)), lamp("#ff4d3a", 3), false);
    dish.add(dmast, bowl, beacon);
    group.add(dish);

    group.scale.setScalar(1.3);
    return {
        group,
        update(t) {
            beacon.visible = Math.sin(t * 3 + group.position.x * 5) > 0.4;
            dish.rotation.y = Math.sin(t * 0.3 + group.position.z) * 0.8;
        },
        dispose,
    };
}

/** Torre arcológica: a glass tower in setbacks, ribbed in the owner's colour. */
export function createTower(color: string): Piece {
    const group = new THREE.Group();
    const { g, dispose } = bag();

    const podium = m(g(new THREE.CylinderGeometry(0.2, 0.22, 0.04, 6).translate(0, 0.02, 0)), painted(CONCRETE, 0.75, 0));
    const plaza = m(g(new THREE.CylinderGeometry(0.206, 0.216, 0.03, 6, 1, true).translate(0, 0.022, 0)), painted(color, 0.5, 0.1), false);
    group.add(podium, plaza);

    const tiers = [
        { r: 0.13, y0: 0.04, y1: 0.26 },
        { r: 0.1, y0: 0.27, y1: 0.47 },
        { r: 0.072, y0: 0.48, y1: 0.64 },
    ];
    const glassMat = curtainWall("#6f8597");
    const slabMat = painted(WHITE, 0.45, 0.1);
    for (const [i, t] of tiers.entries()) {
        const h = t.y1 - t.y0;
        const body = m(g(new THREE.CylinderGeometry(t.r * 0.94, t.r, h, 12).translate(0, t.y0 + h / 2, 0)), glassMat);
        body.rotation.y = i * 0.26;
        group.add(body);
        // Floor slabs: thin white bands every few storeys.
        const slabs: THREE.BufferGeometry[] = [];
        for (let y = t.y0 + 0.03; y < t.y1 - 0.01; y += 0.035) {
            const k = (y - t.y0) / h;
            const r = THREE.MathUtils.lerp(t.r, t.r * 0.94, k) + 0.003;
            slabs.push(new THREE.CylinderGeometry(r, r, 0.006, 12).translate(0, y, 0));
        }
        const slab = m(g(mergeGeometries(slabs)), slabMat);
        slab.rotation.y = body.rotation.y;
        group.add(slab);
        slabs.forEach((x) => x.dispose());
        // Setback terrace: a white deck with planting.
        const deck = m(g(new THREE.CylinderGeometry(t.r + 0.008, t.r + 0.008, 0.012, 12).translate(0, t.y1 + 0.004, 0)), slabMat);
        group.add(deck);
        // Vertical fins in the owner's colour.
        const fins: THREE.BufferGeometry[] = [];
        for (let f = 0; f < 4; f++) {
            const a = (f / 4) * Math.PI * 2 + i * 0.26;
            fins.push(new RoundedBoxGeometry(0.012, h, 0.02, 1, 0.003).translate(0, t.y0 + h / 2, 0).translate(Math.cos(a) * t.r, 0, Math.sin(a) * t.r).rotateY(0));
        }
        group.add(m(g(mergeGeometries(fins)), painted(color, 0.45, 0.25)));
        fins.forEach((x) => x.dispose());
    }
    const greens = m(
        g(
            mergeGeometries(
                tiers.slice(0, 2).flatMap((t, i) =>
                    Array.from({ length: 7 }, (_, k) => {
                        const a = (k / 7) * Math.PI * 2 + i;
                        const r = tiers[i + 1].r + (t.r - tiers[i + 1].r) * 0.55;
                        return new THREE.IcosahedronGeometry(0.009, 1).translate(Math.cos(a) * r, t.y1 + 0.016, Math.sin(a) * r);
                    }),
                ),
            ),
        ),
        plain("#47693a", 0.85),
    );
    group.add(greens);

    const crown = m(g(new THREE.CylinderGeometry(0.06, 0.074, 0.05, 12).translate(0, 0.665, 0)), painted(color, 0.4, 0.25));
    group.add(crown);
    const spire = m(g(new THREE.ConeGeometry(0.018, 0.14, 12).translate(0, 0.72, 0)), bareMetal("#c3c7cc", 0.25));
    const aviation = m(g(new THREE.SphereGeometry(0.006, 8, 6).translate(0, 0.795, 0)), lamp("#ff4030", 3.5), false);
    // A few lit windows near the top.
    const lit = m(g(new THREE.CylinderGeometry(0.0735, 0.0735, 0.01, 12, 1, true, 0, 2.2).translate(0, 0.6, 0)), lamp("#ffe0b0", 1.2), false);
    group.add(spire, aviation, lit);

    group.scale.setScalar(1.15);
    return {
        group,
        update(t) {
            aviation.visible = Math.sin(t * 2.4 + group.position.x * 3) > 0.5;
        },
        dispose,
    };
}

/**
 * Conducto: a pipeline on trestles with flanges in the owner's colour, laid
 * along +x and centred, `length` long.
 */
export function createConduit(color: string, length = 0.6): Piece {
    const group = new THREE.Group();
    const { g, dispose } = bag();
    const y = 0.045;
    const pipe = m(g(new THREE.CylinderGeometry(0.024, 0.024, length, 20).rotateZ(Math.PI / 2).translate(0, y, 0)), painted(color, 0.38, 0.35));
    group.add(pipe);
    const flangeGeo = g(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 20).rotateZ(Math.PI / 2));
    const n = 4;
    for (let i = 0; i < n; i++) {
        const f = m(flangeGeo, bareMetal("#b9bec5", 0.3));
        f.position.set(-length / 2 + ((i + 0.5) / n) * length, y, 0);
        group.add(f);
    }
    // Trestles.
    const legs: THREE.BufferGeometry[] = [];
    for (const x of [-length * 0.3, length * 0.3]) {
        for (const s of [-1, 1]) {
            const a = new THREE.Vector3(x, 0, s * 0.025);
            const b = new THREE.Vector3(x, y - 0.012, 0);
            const len = a.distanceTo(b);
            const leg = new THREE.CylinderGeometry(0.004, 0.004, len, 6);
            leg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
            leg.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
            legs.push(leg);
        }
        legs.push(new THREE.BoxGeometry(0.012, 0.006, 0.06).translate(x, y - 0.018, 0));
    }
    group.add(m(g(mergeGeometries(legs)), painted(GRAPHITE, 0.6, 0.4)));
    legs.forEach((x) => x.dispose());
    return { group, dispose };
}

/** Dron saboteador: a ducted quad in graphite, red sensor sweeping the ground. */
export function createDrone(): Piece {
    const group = new THREE.Group();
    const body = new THREE.Group();
    group.add(body);
    const { g, dispose } = bag();

    const hull = m(
        g(lathe([[0, -0.03], [0.05, -0.026], [0.075, -0.01], [0.08, 0.005], [0.06, 0.025], [0.025, 0.035], [0, 0.036]], 32).scale(1, 1, 1.35)),
        painted(GRAPHITE, 0.35, 0.6),
    );
    const accent = m(g(new THREE.TorusGeometry(0.079, 0.004, 6, 40).rotateX(Math.PI / 2).scale(1, 1, 1.35)), painted("#8e2a2a", 0.4, 0.3), false);
    const eye = m(g(new THREE.SphereGeometry(0.014, 16, 12).translate(0, -0.012, 0.1)), lamp("#ff3b2f", 2.4), false);
    body.add(hull, accent, eye);

    const rotors: THREE.Object3D[] = [];
    const duct = g(new THREE.TorusGeometry(0.05, 0.008, 10, 32).rotateX(Math.PI / 2));
    const blade = g(new RoundedBoxGeometry(0.09, 0.003, 0.014, 1, 0.0015));
    const arm = g(new RoundedBoxGeometry(0.09, 0.01, 0.016, 1, 0.004));
    for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2;
        const armMesh = m(arm, painted("#4a5058", 0.4, 0.5));
        armMesh.position.set(Math.cos(a) * 0.09, 0.005, Math.sin(a) * 0.09);
        armMesh.rotation.y = -a;
        const hub = new THREE.Group();
        hub.position.set(Math.cos(a) * 0.15, 0.01, Math.sin(a) * 0.15);
        const ductMesh = m(duct, painted(GRAPHITE, 0.4, 0.5));
        const blades = m(blade, bareMetal("#c7ccd2", 0.25), false);
        const blades2 = m(blade, bareMetal("#c7ccd2", 0.25), false);
        blades2.rotation.y = Math.PI / 2;
        const spin = new THREE.Group();
        spin.add(blades, blades2);
        rotors.push(spin);
        hub.add(ductMesh, spin);
        body.add(armMesh, hub);
    }

    // A faint scan cone from the sensor to the ground.
    const coneMat = new THREE.MeshBasicMaterial({
        color: "#ff5a4a",
        transparent: true,
        opacity: 0.07,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    const cone = new THREE.Mesh(g(new THREE.ConeGeometry(0.22, 0.6, 32, 1, true).translate(0, -0.3, 0)), coneMat);
    cone.position.set(0, -0.012, 0.06);
    group.add(cone);

    return {
        group,
        update(t) {
            body.position.y = Math.sin(t * 1.8) * 0.02;
            body.rotation.z = Math.sin(t * 1.1) * 0.05;
            body.rotation.x = Math.sin(t * 0.9) * 0.04;
            body.rotation.y = Math.sin(t * 0.3) * 0.7;
            cone.rotation.y = body.rotation.y;
            cone.position.set(Math.sin(body.rotation.y) * 0.06, -0.012 + body.position.y, Math.cos(body.rotation.y) * 0.06);
            for (const r of rotors) r.rotation.y += 0.7;
        },
        dispose() {
            dispose();
            coneMat.dispose();
        },
    };
}

/**
 * Plays the build effect on a piece already placed in the scene. Resolves when
 * the piece is solid.
 */
export async function materialize(piece: Piece, color: string, animator: Animator): Promise<void> {
    const group = piece.group;
    group.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(group);
    const bottom = box.min.y - 0.01;
    const top = box.max.y + 0.01;

    const center = box.getCenter(new THREE.Vector3());

    // A hologram twin built from the same geometry, rooted at the piece's
    // foot so it can grow and swell in place.
    const holoMat = hologram(color);
    const holo = new THREE.Group();
    holo.position.set(center.x, bottom, center.z);
    const toFoot = new THREE.Matrix4().makeTranslation(-center.x, -bottom, -center.z);
    const solids: { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[] }[] = [];
    const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), bottom);
    group.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const twin = new THREE.Mesh(o.geometry, holoMat);
        twin.applyMatrix4(toFoot.clone().multiply(o.matrixWorld));
        holo.add(twin);
        const original = o.material;
        if (original instanceof THREE.ShaderMaterial) {
            // Custom shaders skip the clipping chunks: hold them back instead.
            o.visible = false;
            solids.push({ mesh: o, original });
            return;
        }
        const clipped = (Array.isArray(original) ? original : [original]).map((mat) => {
            const c = mat.clone();
            c.clippingPlanes = [clip];
            return c;
        });
        o.material = clipped.length === 1 ? clipped[0] : clipped;
        solids.push({ mesh: o, original });
    });
    // Twins are placed in world space, so the layer the piece lives in must
    // not be transformed itself.
    group.parent?.add(holo);

    // The scan ring that rides the clip height.
    const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.75 + 0.06;
    const ringGeo = new THREE.RingGeometry(width * 0.92, width, 32).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.5).multiplyScalar(1.4),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.set(center.x, bottom, center.z);
    group.parent?.add(ringMesh);

    // 1. The hologram flickers in, growing from the ground.
    holo.scale.y = 0.001;
    await animator.tween({
        duration: 0.45,
        ease: ease.outBack,
        onUpdate: (k) => {
            holo.scale.y = Math.max(k, 0.001);
            holoMat.uniforms.uOpacity.value = Math.min(k * 1.3, 1) * (0.7 + Math.random() * 0.3);
        },
    }).done;
    holoMat.uniforms.uOpacity.value = 1;

    // 2. The scan sweeps up, leaving solid matter behind.
    await animator.tween({
        duration: 0.85,
        ease: ease.inOutCubic,
        onUpdate: (k) => {
            const h = lerp(bottom, top, k);
            clip.constant = h;
            ringMesh.position.y = h;
            ringMat.opacity = Math.sin(k * Math.PI) * 0.55 + 0.05;
        },
    }).done;

    // 3. Restore the real materials and let the hologram fade off.
    for (const { mesh, original } of solids) {
        if (mesh.material !== original) {
            const clipped = mesh.material;
            for (const c of Array.isArray(clipped) ? clipped : [clipped]) c.dispose();
            mesh.material = original;
        }
        mesh.visible = true;
    }
    ringMesh.removeFromParent();
    ringGeo.dispose();
    ringMat.dispose();
    await animator.tween({
        duration: 0.4,
        ease: ease.outCubic,
        onUpdate: (k) => {
            holoMat.uniforms.uOpacity.value = 1 - k;
            holo.scale.setScalar(1 + k * 0.08);
        },
    }).done;
    holo.removeFromParent();
    holoMat.dispose();
}
