// What hangs in the dusk sky over the HDRI: a gas giant with its ring, lit
// from the same sun as the board, and a scatter of stars where the sky has
// already gone dark.

import * as THREE from "three";
import { timeUniform } from "./materials";

const NOISE = /* glsl */ `
    float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }
    float noise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
            mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
            mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
            f.z);
    }
    float fbm(vec3 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 6; i++) {
            v += a * noise(p);
            p *= 2.03;
            a *= 0.5;
        }
        return v;
    }
`;

/**
 * Where the gas giant hangs: opposite-ish the setting sun, so it shows its
 * lit face, and low enough to sit over the horizon.
 */
export function planetDirection(sunDirection: THREE.Vector3): THREE.Vector3 {
    const azimuth = Math.atan2(sunDirection.x, sunDirection.z) + THREE.MathUtils.degToRad(145);
    return new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(74), azimuth);
}

export function createSky(sunDirection: THREE.Vector3): THREE.Group {
    const sky = new THREE.Group();
    sky.add(stars(), planet(sunDirection));
    return sky;
}

function stars() {
    const count = 1800;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
        // Upper hemisphere only.
        v.randomDirection();
        v.y = Math.abs(v.y);
        v.multiplyScalar(500).toArray(positions, i * 3);
        seeds[i] = Math.random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("seed", new THREE.BufferAttribute(seeds, 1));
    const material = new THREE.ShaderMaterial({
        uniforms: { uTime: timeUniform },
        vertexShader: /* glsl */ `
            attribute float seed;
            uniform float uTime;
            varying float vAlpha;
            void main() {
                // The dusk glow near the horizon drowns them out.
                float h = normalize(position).y;
                float twinkle = 0.7 + 0.3 * sin(uTime * (0.5 + seed * 2.0) + seed * 50.0);
                vAlpha = smoothstep(0.35, 0.85, h) * twinkle * (0.25 + 0.75 * seed);
                gl_PointSize = mix(1.0, 2.2, pow(seed, 8.0));
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: /* glsl */ `
            varying float vAlpha;
            void main() {
                float d = length(gl_PointCoord - 0.5);
                gl_FragColor = vec4(vec3(0.9, 0.93, 1.0), smoothstep(0.5, 0.1, d) * vAlpha);
            }`,
        transparent: true,
        depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    points.renderOrder = -9;
    return points;
}

function planet(sunDirection: THREE.Vector3) {
    const group = new THREE.Group();
    group.position.copy(planetDirection(sunDirection)).multiplyScalar(420);
    const radius = 70;
    const light = { value: sunDirection.clone() };

    const surface = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 64, 40),
        new THREE.ShaderMaterial({
            uniforms: { uTime: timeUniform, uLight: light },
            vertexShader: /* glsl */ `
                varying vec3 vNormal;
                varying vec3 vPos;
                varying vec3 vView;
                void main() {
                    vNormal = normalize(mat3(modelMatrix) * normal);
                    vPos = position;
                    vec4 world = modelMatrix * vec4(position, 1.0);
                    vView = normalize(cameraPosition - world.xyz);
                    gl_Position = projectionMatrix * viewMatrix * world;
                }`,
            fragmentShader: /* glsl */ `
                uniform float uTime;
                uniform vec3 uLight;
                varying vec3 vNormal;
                varying vec3 vPos;
                varying vec3 vView;
                ${NOISE}
                void main() {
                    vec3 p = normalize(vPos);
                    // Latitude bands, sheared by slow turbulence.
                    float turb = fbm(p * 4.0 + vec3(uTime * 0.004, 0.0, 0.0));
                    float lat = p.y * 9.0 + turb * 2.2;
                    float bands = sin(lat) * 0.5 + 0.5;
                    float fine = fbm(vec3(p.x * 2.0, lat * 1.6, p.z * 2.0));
                    vec3 cream = vec3(0.78, 0.70, 0.60);
                    vec3 rust = vec3(0.55, 0.38, 0.30);
                    vec3 slate = vec3(0.42, 0.48, 0.55);
                    vec3 col = mix(rust, cream, smoothstep(0.25, 0.75, bands));
                    col = mix(col, slate, smoothstep(0.55, 0.8, fine) * 0.6);
                    // A storm, like any respectable giant.
                    vec2 spot = vec2(atan(p.z, p.x), p.y) - vec2(1.1, -0.28);
                    float storm = smoothstep(0.16, 0.0, length(spot * vec2(0.8, 2.2)));
                    col = mix(col, vec3(0.62, 0.33, 0.25), storm * 0.7);

                    vec3 n = normalize(vNormal);
                    float diffuse = smoothstep(-0.12, 0.6, dot(n, uLight));
                    float rim = pow(clamp(1.0 - dot(n, vView), 0.0, 1.0), 4.0);
                    vec3 lit = col * (0.06 + diffuse * 0.9) + vec3(0.55, 0.65, 0.85) * rim * 0.35 * smoothstep(-0.3, 0.3, dot(n, uLight));
                    gl_FragColor = vec4(lit, 1.0);
                }`,
        }),
    );
    surface.rotation.z = 0.35;

    const inner = radius * 1.4;
    const outer = radius * 2.3;
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(inner, outer, 180, 1),
        new THREE.ShaderMaterial({
            uniforms: { uInner: { value: inner }, uOuter: { value: outer }, uLight: light },
            vertexShader: /* glsl */ `
                varying float vR;
                void main() {
                    vR = length(position.xy);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }`,
            fragmentShader: /* glsl */ `
                uniform float uInner;
                uniform float uOuter;
                varying float vR;
                float hash(float x) { return fract(sin(x * 127.1) * 43758.5453); }
                void main() {
                    float t = (vR - uInner) / (uOuter - uInner);
                    // Many thin ringlets of varying density, plus a clear gap.
                    float ringlet = hash(floor(t * 140.0)) * 0.6 + hash(floor(t * 37.0)) * 0.4;
                    float density = ringlet * smoothstep(0.0, 0.05, t) * smoothstep(1.0, 0.9, t);
                    density *= 1.0 - smoothstep(0.015, 0.0, abs(t - 0.58)) * 0.95;
                    vec3 col = mix(vec3(0.72, 0.66, 0.58), vec3(0.55, 0.52, 0.5), t);
                    gl_FragColor = vec4(col * 0.85, density * 0.55);
                }`,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
        }),
    );
    ring.rotation.set(-Math.PI / 2 + 0.38, 0.12, 0.35);

    group.add(surface, ring);
    return group;
}
