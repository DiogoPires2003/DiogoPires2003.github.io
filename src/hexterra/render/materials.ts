// Shared PBR materials. Ground and metal use the Poly Haven texture sets. Emissive is kept for the
// few things that are actually lamps.

import * as THREE from "three";
import type { Assets, PbrSet } from "./assets";

/** One clock uniform shared by every shader, advanced by the stage. */
export const timeUniform = { value: 0 };

export type Quality = "high" | "low";

let assets: Assets | null = null;
let quality: Quality = "high";
const cache = new Map<string, THREE.Material>();

export function initMaterials(a: Assets, q: Quality) {
    assets = a;
    quality = q;
}

export function getQuality() {
    return quality;
}

function cached<T extends THREE.Material>(key: string, make: () => T): T {
    let m = cache.get(key) as T | undefined;
    if (!m) {
        m = make();
        cache.set(key, m);
    }
    return m;
}

export function disposeMaterials() {
    for (const m of cache.values()) m.dispose();
    cache.clear();
}

function maps(set: PbrSet) {
    if (!assets) throw new Error("initMaterials() before using textured materials");
    return assets.pbr[set];
}

/**
 * Textured ground. Geometry carries world-scaled UVs, so neighbouring tiles
 * line up; `tint` multiplies the photo to push it towards an alien palette.
 */
export function ground(set: PbrSet, tint: THREE.ColorRepresentation = "#ffffff", opts: { roughness?: number; normalScale?: number } = {}) {
    const { roughness = 1, normalScale = 1.2 } = opts;
    return cached(`ground:${set}:${tint}:${roughness}:${normalScale}`, () => {
        const m = maps(set);
        return new THREE.MeshStandardMaterial({
            color: tint,
            map: m.map,
            normalMap: m.normalMap,
            normalScale: new THREE.Vector2(normalScale, normalScale),
            roughnessMap: m.arm,
            roughness,
            aoMap: m.arm,
            aoMapIntensity: 0.8,
            metalness: 0,
            vertexColors: true,
        });
    });
}

/** Painted panels: flat colour over the metal plate's relief. */
export function painted(color: THREE.ColorRepresentation, roughness = 0.45, metalness = 0.2) {
    return cached(`painted:${color}:${roughness}:${metalness}`, () => {
        const m = maps("metal_plate");
        return new THREE.MeshStandardMaterial({
            color,
            roughness,
            metalness,
            normalMap: m.normalMap,
            normalScale: new THREE.Vector2(0.35, 0.35),
        });
    });
}

/** Bare, slightly worn metal. */
export function bareMetal(color: THREE.ColorRepresentation = "#9aa0a8", roughness = 0.38) {
    return cached(`bare:${color}:${roughness}`, () => {
        const m = maps("metal_plate");
        return new THREE.MeshStandardMaterial({
            color,
            map: m.map,
            normalMap: m.normalMap,
            normalScale: new THREE.Vector2(0.6, 0.6),
            roughnessMap: m.arm,
            roughness: roughness * 2,
            metalness: 0.9,
        });
    });
}

/** Plain smooth surface without texture, for small parts. */
export function plain(color: THREE.ColorRepresentation, roughness = 0.5, metalness = 0) {
    return cached(`plain:${color}:${roughness}:${metalness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness }));
}

/** Window glass and greenhouse panes. */
export function glass(tint: THREE.ColorRepresentation = "#dfefff", opts: { opacity?: number; roughness?: number } = {}) {
    const { opacity = 0.3, roughness = 0.06 } = opts;
    return cached(`glass:${tint}:${opacity}:${roughness}`, () =>
        // Transparent rather than transmissive: transmission re-renders the
        // whole scene behind every pane.
        new THREE.MeshPhysicalMaterial({
            color: tint,
            metalness: 0.1,
            roughness,
            clearcoat: 1,
            transparent: true,
            opacity,
            depthWrite: false,
            side: THREE.DoubleSide,
        }),
    );
}

/** Mirror-like glazing for towers: reflects the sky rather than seeing through. */
export function curtainWall(tint: THREE.ColorRepresentation = "#7d93a8") {
    return cached(`curtain:${tint}`, () =>
        new THREE.MeshPhysicalMaterial({ color: tint, metalness: 0.85, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05 }),
    );
}

/** Something that gives off light: windows, beacons, status lamps. */
export function lamp(color: THREE.ColorRepresentation, intensity = 1.6) {
    return cached(`lamp:${color}:${intensity}`, () => {
        const m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
        m.color.multiplyScalar(intensity);
        return m;
    });
}

/**
 * How a piece looks before it exists: a pale scan projection, fresnel edges
 * and fine scanlines, tinted by the owner. Not cached: each build animates
 * its own copy.
 */
export function hologram(color: THREE.ColorRepresentation): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.45) },
            uOpacity: { value: 1 },
            uTime: timeUniform,
        },
        vertexShader: /* glsl */ `
            varying vec3 vNormal;
            varying vec3 vView;
            varying float vY;
            void main() {
                vec4 world = modelMatrix * vec4(position, 1.0);
                vY = world.y;
                vNormal = normalize(mat3(modelMatrix) * normal);
                vView = normalize(cameraPosition - world.xyz);
                gl_Position = projectionMatrix * viewMatrix * world;
            }`,
        fragmentShader: /* glsl */ `
            uniform vec3 uColor;
            uniform float uOpacity;
            uniform float uTime;
            varying vec3 vNormal;
            varying vec3 vView;
            varying float vY;
            void main() {
                float fresnel = pow(max(1.0 - abs(dot(normalize(vNormal), vView)), 0.0), 2.0);
                float scan = 0.7 + 0.3 * step(0.5, fract(vY * 60.0 - uTime * 1.2));
                float a = (0.08 + fresnel * 0.55) * scan * uOpacity;
                gl_FragColor = vec4(uColor * 1.1, a);
            }`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
    });
}
