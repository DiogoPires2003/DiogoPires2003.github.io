// The number marker on each productive tile: a ceramic disc on a short
// brushed-metal stem, the number printed on top. Physical, so it catches the
// sky in its clearcoat instead of glowing.

import * as THREE from "three";
import { rollWays } from "../core/board";
import { bareMetal } from "./materials";

const faces = new Map<number, THREE.CanvasTexture>();
let discGeo: THREE.BufferGeometry | null = null;
let stemGeo: THREE.BufferGeometry | null = null;
let faceGeo: THREE.BufferGeometry | null = null;
let bodyMat: THREE.MeshPhysicalMaterial | null = null;

const RADIUS = 0.23;
const STEM = 0.1;
const THICK = 0.035;

export interface Token {
    group: THREE.Group;
    /** 0 hidden, 1 in place: it rises out of the ground and spins up. */
    setPresence: (k: number) => void;
    /** 0..1: lifts and brightens while the tile is pointed at. */
    setFocus: (k: number) => void;
    dispose: () => void;
}

/** `facing` is the azimuth the camera rests at, so the number reads upright from there. */
export function createToken(n: number, facing: number): Token {
    discGeo ??= discGeometry();
    stemGeo ??= new THREE.CylinderGeometry(0.012, 0.018, STEM, 16).translate(0, STEM / 2, 0);
    faceGeo ??= new THREE.CircleGeometry(RADIUS * 0.86, 48).rotateX(-Math.PI / 2);
    bodyMat ??= new THREE.MeshPhysicalMaterial({ color: "#ece6da", roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15 });

    const faceMat = new THREE.MeshPhysicalMaterial({
        map: faceTexture(n),
        roughness: 0.4,
        clearcoat: 0.8,
        clearcoatRoughness: 0.12,
        emissive: new THREE.Color("#ffffff"),
        emissiveMap: faceTexture(n),
        emissiveIntensity: 0,
    });

    const group = new THREE.Group();
    const stem = new THREE.Mesh(stemGeo, bareMetal("#9ea3aa", 0.3));
    stem.castShadow = true;
    const head = new THREE.Group();
    head.position.y = STEM;
    const disc = new THREE.Mesh(discGeo, bodyMat);
    disc.castShadow = disc.receiveShadow = true;
    const face = new THREE.Mesh(faceGeo, faceMat);
    face.position.y = THICK + 0.0015;
    face.rotation.y = facing;
    face.receiveShadow = true;
    head.add(disc, face);
    group.add(stem, head);

    let presence = 1;
    let focus = 0;
    const apply = () => {
        group.visible = presence > 0.001;
        group.scale.setScalar(Math.max(presence, 0.001));
        head.position.y = STEM + focus * 0.05;
        head.rotation.y = (1 - presence) * Math.PI * 2;
        faceMat.emissiveIntensity = focus * 0.25;
    };

    return {
        group,
        setPresence(k) {
            presence = k;
            apply();
        },
        setFocus(k) {
            focus = k;
            apply();
        },
        dispose() {
            faceMat.dispose();
        },
    };
}

export function disposeTokens() {
    for (const t of faces.values()) t.dispose();
    faces.clear();
    discGeo?.dispose();
    stemGeo?.dispose();
    faceGeo?.dispose();
    bodyMat?.dispose();
    discGeo = stemGeo = faceGeo = null;
    bodyMat = null;
}

/** A disc with a rounded rim, turned on a lathe. */
function discGeometry() {
    const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
    const bevel = 0.01;
    pts.push(new THREE.Vector2(RADIUS - bevel, 0));
    for (let i = 0; i <= 6; i++) {
        const a = -Math.PI / 2 + (i / 6) * Math.PI;
        pts.push(new THREE.Vector2(RADIUS - bevel + Math.cos(a) * bevel, THICK / 2 + Math.sin(a) * (THICK / 2)));
    }
    pts.push(new THREE.Vector2(0, THICK));
    return new THREE.LatheGeometry(pts, 48);
}

function faceTexture(n: number): THREE.CanvasTexture {
    let t = faces.get(n);
    if (t) return t;
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const c = size / 2;
    const hot = n === 6 || n === 8;
    ctx.fillStyle = "#ece6da";
    ctx.fillRect(0, 0, size, size);
    // A fine engraved ring.
    ctx.strokeStyle = "rgba(60,52,44,0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(c, c, c - 10, 0, Math.PI * 2);
    ctx.stroke();

    const ink = hot ? "#9e2a22" : "#2b2722";
    ctx.fillStyle = ink;
    ctx.font = `700 ${n >= 10 ? 108 : 124}px "Chakra Petch", "Orbitron", ui-sans-serif, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n), c, c - 12);

    // One dot per way to roll it, so the odds read at a glance.
    const ways = rollWays(n);
    const gap = 17;
    const start = c - ((ways - 1) * gap) / 2;
    for (let i = 0; i < ways; i++) {
        ctx.beginPath();
        ctx.arc(start + i * gap, c + 62, 5.5, 0, Math.PI * 2);
        ctx.fill();
    }

    t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    faces.set(n, t);
    return t;
}

export const TOKEN_TOP = STEM + THICK;
