// Trade stations on the coast: a pier on stilts with a loading crane, and a
// floating sign that says what it trades and at what rate.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Resource } from "../core/board";
import type { HarborKind } from "../core/graph";
import { bareMetal, painted } from "./materials";
import { RESOURCE_ICON, RESOURCE_ACCENT } from "./palette";

const deckGeo = new RoundedBoxGeometry(0.34, 0.03, 0.2, 2, 0.01);
const legGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.4, 8).translate(0, -0.2, 0);
const mastGeo = new THREE.BoxGeometry(0.025, 0.24, 0.025).translate(0, 0.12, 0);
const boomGeo = new THREE.BoxGeometry(0.2, 0.018, 0.018).translate(0.07, 0, 0);
const crateGeo = new RoundedBoxGeometry(0.06, 0.05, 0.05, 1, 0.006);

export interface HarborModel {
    group: THREE.Group;
    dispose: () => void;
}

/**
 * `from` is the coastal edge's midpoint on land, `out` the direction to sea.
 * The pier stands on the beach just off that edge.
 */
export function createHarbor(kind: HarborKind, ratio: number, from: THREE.Vector3, out: THREE.Vector3, deckY: number): HarborModel {
    const group = new THREE.Group();
    const pier = new THREE.Group();
    const pos = from.clone().addScaledVector(out, 0.55);
    pier.position.set(pos.x, deckY, pos.z);
    pier.rotation.y = Math.atan2(out.x, out.z);
    const concrete = painted("#9a9a96", 0.85, 0);
    const deck = new THREE.Mesh(deckGeo, concrete);
    deck.castShadow = deck.receiveShadow = true;
    pier.add(deck);
    for (const [x, z] of [
        [-0.14, -0.08],
        [0.14, -0.08],
        [-0.14, 0.08],
        [0.14, 0.08],
    ]) {
        const leg = new THREE.Mesh(legGeo, bareMetal("#6e7378", 0.5));
        leg.position.set(x, 0, z);
        pier.add(leg);
    }
    const accent = kind === "any" ? "#c9b48a" : RESOURCE_ACCENT[kind];
    const mast = new THREE.Mesh(mastGeo, painted(accent, 0.5, 0.2));
    mast.position.set(-0.1, 0.015, 0.05);
    mast.castShadow = true;
    const boom = new THREE.Mesh(boomGeo, painted(accent, 0.5, 0.2));
    boom.position.set(-0.1, 0.24, 0.05);
    boom.rotation.y = 0.6;
    boom.castShadow = true;
    pier.add(mast, boom);
    for (let i = 0; i < 3; i++) {
        const crate = new THREE.Mesh(crateGeo, painted(i === 1 ? accent : "#5f6a73", 0.6, 0.2));
        crate.position.set(0.05 + (i % 2) * 0.07, 0.04 + (i === 2 ? 0.05 : 0), -0.03 + (i === 2 ? 0.0 : 0));
        crate.castShadow = true;
        pier.add(crate);
    }

    const signTex = signTexture(kind, ratio);
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTex, transparent: true, depthWrite: false }));
    sign.scale.set(0.62, 0.31, 1);
    sign.position.set(pos.x, deckY + 0.45, pos.z);
    sign.renderOrder = 5;
    group.add(pier, sign);

    return {
        group,
        dispose() {
            signTex.dispose();
            sign.material.dispose();
        },
    };
}

function signTexture(kind: HarborKind, ratio: number) {
    const w = 256;
    const h = 128;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "rgba(18, 22, 30, 0.82)";
    ctx.beginPath();
    ctx.roundRect(6, 6, w - 12, h - 12, 22);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 2;
    ctx.stroke();

    const accent = kind === "any" ? "#e8e2d6" : RESOURCE_ACCENT[kind as Resource];
    // Icon on the left.
    ctx.save();
    ctx.translate(26, 32);
    ctx.scale(2.6, 2.6);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.7;
    ctx.lineCap = ctx.lineJoin = "round";
    if (kind === "any") {
        ctx.font = "600 18px 'Chakra Petch', sans-serif";
        ctx.fillStyle = accent;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("?", 12, 12.5);
        ctx.beginPath();
        ctx.arc(12, 12, 10, 0, Math.PI * 2);
        ctx.stroke();
    } else {
        ctx.stroke(new Path2D(RESOURCE_ICON[kind]));
    }
    ctx.restore();

    ctx.fillStyle = "#f0ece4";
    ctx.font = "700 54px 'Chakra Petch', sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(`${ratio}:1`, 112, h / 2 + 2);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
}
