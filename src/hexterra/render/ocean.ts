// The sea around the island. A planar reflection (Reflector) gives true
// mirror images of the island and the sky; on top of it the shader adds
// procedural swell, a sun glitter path, shallow turquoise shelves and foam
// that laps at the shore.

import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { timeUniform, type Quality } from "./materials";

/** Same as stage's DETAIL_LAYER; repeated here so the sea doesn't depend on the stage. */
const DETAIL_LAYER = 1;

export const SEA_LEVEL = -0.12;

export interface Ocean {
    mesh: Reflector;
    /** Set when the scene fog or sun change. */
    sync: (scene: THREE.Scene, sunDirection: THREE.Vector3) => void;
    dispose: () => void;
}

/**
 * `seabed` is the island height baked over ±`extent` (see bakeIslandHeight):
 * it tells the shader how deep the water is everywhere near the island.
 */
export function createOcean(seabed: THREE.DataTexture, extent: number, quality: Quality): Ocean {
    const uniforms = {
        color: { value: null },
        tDiffuse: { value: null },
        textureMatrix: { value: null },
        uTime: timeUniform,
        uSun: { value: new THREE.Vector3(0, 0.3, -1).normalize() },
        uSunColor: { value: new THREE.Color("#ffd9b0") },
        uDeep: { value: new THREE.Color("#06141c") },
        uShallow: { value: new THREE.Color("#2d7a78") },
        uSeabed: { value: seabed },
        uExtent: { value: extent },
        uSeaLevel: { value: SEA_LEVEL },
        uFogColor: { value: new THREE.Color("#2a3448") },
        uFogDensity: { value: 0.018 },
    };

    const shader = {
        name: "HexterraOcean",
        uniforms,
        vertexShader: /* glsl */ `
            uniform mat4 textureMatrix;
            varying vec4 vMirror;
            varying vec3 vWorld;
            void main() {
                vMirror = textureMatrix * vec4(position, 1.0);
                vec4 world = modelMatrix * vec4(position, 1.0);
                vWorld = world.xyz;
                gl_Position = projectionMatrix * viewMatrix * world;
            }`,
        fragmentShader: /* glsl */ `
            uniform sampler2D tDiffuse;
            uniform float uTime;
            uniform vec3 uSun;
            uniform vec3 uSunColor;
            uniform vec3 uDeep;
            uniform vec3 uShallow;
            uniform sampler2D uSeabed;
            uniform float uExtent;
            uniform float uSeaLevel;
            uniform vec3 uFogColor;
            uniform float uFogDensity;
            varying vec4 vMirror;
            varying vec3 vWorld;

            float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float noise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                vec2 u = f * f * (3.0 - 2.0 * f);
                return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
            }

            // Swell: a handful of directional waves, differentiated analytically,
            // plus a ripple layer from noise.
            vec3 waveNormal(vec2 p, float t) {
                vec2 grad = vec2(0.0);
                const int N = 6;
                vec2 dirs[N];
                dirs[0] = normalize(vec2(1.0, 0.3));
                dirs[1] = normalize(vec2(0.7, 1.0));
                dirs[2] = normalize(vec2(-0.6, 1.0));
                dirs[3] = normalize(vec2(-1.0, -0.2));
                dirs[4] = normalize(vec2(0.2, -1.0));
                dirs[5] = normalize(vec2(1.0, -0.8));
                for (int i = 0; i < N; i++) {
                    float k = 3.0 + float(i) * 2.6;
                    float amp = 0.011 / k;
                    float w = sqrt(9.8 * k) * 0.55;
                    float ph = dot(dirs[i], p) * k - t * w;
                    grad += dirs[i] * cos(ph) * amp * k;
                }
                // Two layers of ripples drifting across each other.
                float e = 0.04;
                vec2 q = p * 6.0 + vec2(t * 0.3, -t * 0.22);
                float n0 = noise(q);
                grad += vec2(noise(q + vec2(e, 0.0)) - n0, noise(q + vec2(0.0, e)) - n0) / e * 0.011;
                vec2 r = p * 13.0 - vec2(t * 0.45, t * 0.35);
                float r0 = noise(r);
                grad += vec2(noise(r + vec2(e, 0.0)) - r0, noise(r + vec2(0.0, e)) - r0) / e * 0.005;
                return normalize(vec3(-grad.x, 1.0, -grad.y));
            }

            void main() {
                vec2 p = vWorld.xz;
                float dist = length(cameraPosition - vWorld);
                vec3 n = waveNormal(p, uTime);
                // Far away the swell averages out; keep the horizon calm.
                n = normalize(mix(n, vec3(0.0, 1.0, 0.0), smoothstep(10.0, 60.0, dist)));
                vec3 v = normalize(cameraPosition - vWorld);

                vec2 distortion = n.xz * 0.025 / (1.0 + dist * 0.05);
                vec3 reflection = texture2D(tDiffuse, vMirror.xy / vMirror.w + distortion).rgb;

                float cosT = clamp(dot(v, n), 0.0, 1.0);
                float fresnel = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);

                // How deep the water is over the island's slopes.
                vec2 suv = p / (2.0 * uExtent) + 0.5;
                float inside = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
                float bed = mix(-10.0, texture2D(uSeabed, clamp(suv, 0.0, 1.0)).r, inside);
                float depth = max(uSeaLevel - bed, 0.0);
                float shelf = exp(-depth * 4.5);
                vec3 body = mix(uDeep, uShallow, shelf * 0.9);
                float sunDiffuse = clamp(dot(n, uSun), 0.0, 1.0);
                vec3 water = body * (0.35 + 0.65 * sunDiffuse) * uSunColor * 0.6;

                vec3 col = mix(water, reflection, fresnel);

                // Glitter path towards the sun.
                vec3 h = normalize(uSun + v);
                float spec = pow(clamp(dot(n, h), 0.0, 1.0), 380.0) * 5.0;
                col += uSunColor * spec;

                // Surf: a line where the water meets the sand, and bands of
                // foam rolling in over the shallows, broken up by noise.
                float lap = sin(depth * 70.0 + uTime * 1.8) * 0.5 + 0.5;
                float foamNoise = noise(p * 14.0 + uTime * 0.25) * 0.6 + noise(p * 5.0 - uTime * 0.15) * 0.4;
                float foam = smoothstep(0.12, 0.0, depth) * smoothstep(0.35, 0.8, lap * 0.55 + foamNoise * 0.6);
                foam = max(foam, smoothstep(0.025, 0.0, depth) * (0.5 + 0.5 * foamNoise));
                col = mix(col, vec3(0.86, 0.9, 0.91) * (0.45 + 0.55 * sunDiffuse), clamp(foam, 0.0, 0.85));
                // Clear water over sand: let the shelf show through near the beach.
                col = mix(col, uShallow * 1.3, smoothstep(0.08, 0.0, depth) * 0.35 * (1.0 - foam));

                float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
                gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
            }`,
    };

    const size = quality === "low" ? 256 : 512;
    const mesh = new Reflector(new THREE.CircleGeometry(160, 96), {
        shader,
        textureWidth: size,
        textureHeight: size,
        clipBias: 0.003,
        multisample: quality === "low" ? 0 : 4,
    });
    mesh.rotation.x = -Math.PI / 2;
    // Refresh the mirror image every other frame: the swell's distortion
    // hides the lag, and it halves the cost of the second scene render.
    const reflect = mesh.onBeforeRender.bind(mesh);
    let odd = false;
    const mirror = mesh as unknown as { getReflectionCamera: (c: THREE.Camera) => THREE.Camera };
    mesh.onBeforeRender = (...args) => {
        odd = !odd;
        if (!odd) return;
        // The mirror camera is a clone of the main one, layers included:
        // keep small details out of the reflection.
        mirror.getReflectionCamera(args[2]).layers.disable(DETAIL_LAYER);
        reflect(...args);
    };
    mesh.position.y = SEA_LEVEL;
    mesh.receiveShadow = true;

    return {
        mesh,
        sync(scene, sun) {
            uniforms.uSun.value.copy(sun);
            const fog = scene.fog as THREE.FogExp2 | null;
            if (fog) {
                uniforms.uFogColor.value.copy(fog.color);
                uniforms.uFogDensity.value = fog.density;
            }
        },
        dispose() {
            mesh.dispose();
            mesh.geometry.dispose();
        },
    };
}
