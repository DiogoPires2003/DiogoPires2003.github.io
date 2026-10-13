// Renderer, post-processing, lighting, the orbit camera and the frame loop.
// Knows nothing about the rules.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { Animator, ease, lerp, type Handle } from "./anim";
import { timeUniform, type Quality } from "./materials";

export interface Stage {
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    animator: Animator;
    quality: Quality;
    /** Unit vector towards the sun, once the sky is set. */
    sunDirection: THREE.Vector3;
    /** Azimuth the camera settles at around the board. */
    restAzimuth: () => number;
    /** Uses the HDRI for background and light, and aims the sun at its brightest point. */
    setSky: (hdr: THREE.DataTexture) => void;
    /** Normalised device coords of the last pointer position, or null when it left. */
    pointer: () => THREE.Vector2 | null;
    /** Opens on the horizon looking at `lookFirst`, then swings down to the board. */
    playIntro: (duration: number, lookFirst: THREE.Vector3) => Handle;
    /** Advances and draws one frame; the loop calls it, and so can tests. */
    frame: (dt: number) => void;
    /** Screen space (CSS px) covered by the interface; the board is framed in what's left. */
    setInsets: (top: number, bottom: number) => void;
    debug: { composer: EffectComposer; bloom: UnrealBloomPass };
    dispose: () => void;
}

const FOV = 38;
/**
 * Small, numerous things (props, markers, pieces) live on this layer too: the
 * camera and the shadows see it, the sea's reflection doesn't.
 */
export const DETAIL_LAYER = 1;

/** Puts an object and its children on the detail layer. */
export function markDetail(object: THREE.Object3D) {
    object.traverse((o) => o.layers.set(DETAIL_LAYER));
}
// The camera rests looking down at about 50° from vertical.
const REST_POLAR = THREE.MathUtils.degToRad(50);
/** Low enough for long shadows, high enough to light the tiles. */
const MIN_SUN_ELEVATION = THREE.MathUtils.degToRad(16);

export function createStage(canvas: HTMLCanvasElement, fitRadius: number): Stage {
    const coarse = matchMedia("(pointer: coarse)").matches;
    const quality: Quality = coarse || Math.min(screen.width, screen.height) < 700 ? "low" : "high";

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    // Retina at full resolution costs four times the pixels for little gain on
    // a soft, filmic image; start lower and let the frame-time governor decide.
    const maxRatio = Math.min(window.devicePixelRatio, quality === "low" ? 1.25 : 1.5);
    let pixelRatio = maxRatio;
    renderer.setPixelRatio(pixelRatio);
    // AgX keeps highlights soft and colours natural instead of punchy.
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    // Most of the scene is still; refresh shadows a few times a second, not every frame.
    renderer.shadowMap.autoUpdate = false;
    renderer.localClippingEnabled = true;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2("#2a3448", 0.018);

    const hemi = new THREE.HemisphereLight("#9bb4d6", "#3a2d2a", 0.35);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight("#ffd2a8", 3.2);
    sun.castShadow = true;
    const shadowSize = quality === "low" ? 1024 : 2048;
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    const s = fitRadius * 1.05;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.5, far: 60 });
    sun.shadow.radius = 5;
    sun.shadow.blurSamples = 8;
    sun.shadow.camera.layers.enable(DETAIL_LAYER);
    sun.shadow.bias = -0.0006;
    scene.add(sun, sun.target);
    const sunDirection = new THREE.Vector3(-0.4, 0.4, -1).normalize();
    // Where the camera rests around the board, chosen from the sun.
    let restAzimuth = 0;

    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 600);
    camera.layers.enable(DETAIL_LAYER);
    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 0.25, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.enablePan = false;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 0.8;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = THREE.MathUtils.degToRad(80);
    controls.minDistance = fitRadius * 0.45;

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality === "low" ? 2 : 4 });
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    // Only lamps cross the threshold; the scene itself never blooms.
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.18, 0.4, 1.15);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const animator = new Animator();
    let touched = false;
    let introRunning = false;
    controls.addEventListener("start", () => (touched = true));

    const insets = { top: 0, bottom: 0 };
    const fitDistance = () => {
        const h = canvas.clientHeight || 1;
        const free = Math.max(0.35, (h - insets.top - insets.bottom) / h);
        // Only the uncovered band of the screen counts towards fitting the board.
        const vHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * free);
        const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * camera.aspect);
        // In portrait the width is what limits; let the beach run off the
        // sides so the tiles themselves get the screen.
        const margin = camera.aspect < 1 ? 0.8 : 0.92;
        return (fitRadius / Math.sin(Math.min(vHalf, hHalf))) * margin;
    };
    const restPosition = (out: THREE.Vector3) =>
        out.setFromSphericalCoords(fitDistance(), REST_POLAR, restAzimuth).add(controls.target);

    const resize = () => {
        const { clientWidth: w, clientHeight: h } = canvas;
        if (w === 0 || h === 0) return;
        renderer.setSize(w, h, false);
        composer.setSize(w, h);
        camera.aspect = w / h;
        // Shift the picture so the board centres in the band the HUD leaves free.
        const shift = (insets.bottom - insets.top) / 2;
        if (shift) camera.setViewOffset(w, h, 0, shift, w, h);
        else camera.clearViewOffset();
        camera.updateProjectionMatrix();
        controls.maxDistance = Math.max(fitDistance() * 1.35, controls.minDistance);
        // Thin the haze as the camera backs off, so a phone's wider framing
        // isn't washed out.
        (scene.fog as THREE.FogExp2).density = 0.25 / fitDistance();
        if (!touched && !introRunning) restPosition(camera.position);
        controls.update();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const setSky = (hdr: THREE.DataTexture) => {
        const pmrem = new THREE.PMREMGenerator(renderer);
        scene.environment = pmrem.fromEquirectangular(hdr).texture;
        scene.environmentIntensity = 0.6;
        pmrem.dispose();
        scene.background = hdr;
        scene.backgroundIntensity = 0.42;

        const { direction, horizon } = analyseSky(hdr);
        const elevation = Math.max(Math.asin(direction.y), MIN_SUN_ELEVATION);
        const azimuth = Math.atan2(direction.x, direction.z);
        sunDirection.setFromSphericalCoords(1, Math.PI / 2 - elevation, azimuth);
        sun.position.copy(sunDirection).multiplyScalar(25);
        // Face the sunset, a little off-axis: the sun sits beyond the board
        // and draws its glitter across the water towards the camera.
        restAzimuth = azimuth + Math.PI + THREE.MathUtils.degToRad(28);
        (scene.fog as THREE.FogExp2).color.copy(horizon);
        if (!touched && !introRunning) restPosition(camera.position);
        controls.update();
    };

    const ndc = new THREE.Vector2();
    let hasPointer = false;
    const onMove = (e: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        hasPointer = true;
    };
    const onLeave = () => (hasPointer = false);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onMove);
    canvas.addEventListener("pointerleave", onLeave);

    const playIntro = (duration: number, lookFirst: THREE.Vector3): Handle => {
        introRunning = true;
        controls.enabled = false;
        const end = restPosition(new THREE.Vector3());
        const endRadius = end.distanceTo(controls.target);
        // Start low over the water, gazing out at `lookFirst`, then swing
        // round and rise, the gaze tipping down onto the island.
        const lookAzimuth = Math.atan2(lookFirst.x, lookFirst.z);
        // Stand on the far side of the island from what we look at.
        let startAzimuth = lookAzimuth + Math.PI;
        // Take the short way round to the resting azimuth.
        startAzimuth = restAzimuth + THREE.MathUtils.euclideanModulo(startAzimuth - restAzimuth + Math.PI, Math.PI * 2) - Math.PI;
        const start = new THREE.Spherical(endRadius * 2.4, THREE.MathUtils.degToRad(85), startAzimuth);
        const look = new THREE.Vector3();
        const horizonLook = lookFirst.clone().multiplyScalar(60);
        horizonLook.y = Math.min(horizonLook.y, 14);
        const sph = new THREE.Spherical();
        return animator.tween({
            duration,
            ease: ease.inOutCubic,
            onUpdate: (k) => {
                sph.set(lerp(start.radius, endRadius, k), lerp(start.phi, REST_POLAR, ease.inOutQuint(k)), lerp(start.theta, restAzimuth, k));
                camera.position.setFromSpherical(sph).add(controls.target);
                look.lerpVectors(horizonLook, controls.target, ease.inOutCubic(Math.min(k * 1.25, 1)));
                camera.lookAt(look);
            },
            onComplete: () => {
                introRunning = false;
                controls.enabled = true;
                restPosition(camera.position);
                controls.update();
            },
        });
    };

    // Frame-time governor: if frames run long, drop the resolution a notch;
    // if there's plenty of headroom, bring it back.
    let frameCount = 0;
    let avg = 1 / 60;
    let lastGovern = 0;
    const govern = (dt: number) => {
        avg += (dt - avg) * 0.05;
        if (animator.time - lastGovern < 2) return;
        lastGovern = animator.time;
        let next = pixelRatio;
        if (avg > 1 / 42) next = Math.max(0.75, pixelRatio - 0.25);
        else if (avg < 1 / 57 && pixelRatio < maxRatio) next = Math.min(maxRatio, pixelRatio + 0.25);
        if (next !== pixelRatio) {
            pixelRatio = next;
            renderer.setPixelRatio(pixelRatio);
            composer.setPixelRatio(pixelRatio);
            resize();
        }
    };

    const frame = (dt: number) => {
        animator.update(dt);
        timeUniform.value = animator.time;
        if (!introRunning) controls.update();
        if (frameCount++ % 4 === 0) renderer.shadowMap.needsUpdate = true;
        composer.render(dt);
    };
    const timer = new THREE.Timer();
    timer.connect(document);
    renderer.setAnimationLoop((now) => {
        timer.update(now);
        const dt = timer.getDelta();
        govern(dt);
        // Clamp so a tab coming back from sleep does not jump every animation.
        frame(Math.min(dt, 1 / 20));
    });

    return {
        renderer,
        scene,
        camera,
        controls,
        animator,
        quality,
        sunDirection,
        restAzimuth: () => restAzimuth,
        setSky,
        pointer: () => (hasPointer ? ndc : null),
        playIntro,
        frame,
        setInsets(top, bottom) {
            if (Math.abs(top - insets.top) < 4 && Math.abs(bottom - insets.bottom) < 4) return;
            insets.top = top;
            insets.bottom = bottom;
            resize();
        },
        debug: { composer, bloom },
        dispose() {
            renderer.setAnimationLoop(null);
            timer.dispose();
            observer.disconnect();
            canvas.removeEventListener("pointermove", onMove);
            canvas.removeEventListener("pointerdown", onMove);
            canvas.removeEventListener("pointerleave", onLeave);
            controls.dispose();
            composer.dispose();
            target.dispose();
            scene.environment?.dispose();
            renderer.dispose();
        },
    };
}

/**
 * Finds the sun in an equirectangular HDRI (its brightest texel) and the
 * average colour of the horizon, for fog.
 */
function analyseSky(hdr: THREE.DataTexture): { direction: THREE.Vector3; horizon: THREE.Color } {
    const { width, height, data } = hdr.image as { width: number; height: number; data: ArrayLike<number> };
    const half = hdr.type === THREE.HalfFloatType;
    const read = (i: number) => (half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
    let best = -1;
    let bestX = 0;
    let bestY = 0;
    // Only look above the horizon, every other texel: plenty for a 1k map.
    for (let y = 0; y < height / 2; y += 2) {
        for (let x = 0; x < width; x += 2) {
            const i = (y * width + x) * 4;
            const l = read(i) * 0.2126 + read(i + 1) * 0.7152 + read(i + 2) * 0.0722;
            if (l > best) {
                best = l;
                bestX = x;
                bestY = y;
            }
        }
    }
    // three samples equirect maps with u = atan(z, x) / 2π + 0.5 and row 0 at the top.
    const angle = ((bestX + 0.5) / width - 0.5) * Math.PI * 2;
    const elevation = (0.5 - (bestY + 0.5) / height) * Math.PI;
    const direction = new THREE.Vector3(Math.cos(angle) * Math.cos(elevation), Math.sin(elevation), Math.sin(angle) * Math.cos(elevation));

    const horizon = new THREE.Color(0, 0, 0);
    const row = Math.floor(height * 0.47);
    let n = 0;
    for (let x = 0; x < width; x += 8) {
        const i = (row * width + x) * 4;
        horizon.r += read(i);
        horizon.g += read(i + 1);
        horizon.b += read(i + 2);
        n++;
    }
    horizon.multiplyScalar(0.3 / n);
    return { direction, horizon };
}
