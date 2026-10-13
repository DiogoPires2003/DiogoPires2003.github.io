// Loads the HDRI and the PBR texture sets in public/hexterra (CC0, Poly Haven;
// see CREDITS.md there). Everything is fetched up front so the intro never
// shows untextured ground.

import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";

export const PBR_SETS = [
    "cliff_side",
    "aerial_sand",
    "rocky_terrain_02",
    "aerial_ground_rock",
    "farm_furrows",
    "snow_field_aerial",
    "cracked_red_ground",
    "coast_sand_01",
    "metal_plate",
] as const;
export type PbrSet = (typeof PBR_SETS)[number];

export interface PbrMaps {
    map: THREE.Texture;
    normalMap: THREE.Texture;
    /** AO in R, roughness in G, metalness in B, as three expects. */
    arm: THREE.Texture;
}

export interface Assets {
    /** The dusk sky, equirectangular, for background and lighting. */
    sky: THREE.DataTexture;
    pbr: Record<PbrSet, PbrMaps>;
    dispose: () => void;
}

const BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/hexterra`;

export async function loadAssets(renderer: THREE.WebGLRenderer, onProgress: (k: number) => void): Promise<Assets> {
    const manager = new THREE.LoadingManager();
    manager.onProgress = (_url, loaded, total) => onProgress(loaded / total);
    const textures = new THREE.TextureLoader(manager);
    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    const load = (url: string, color: boolean) =>
        textures.loadAsync(url).then((t) => {
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.anisotropy = anisotropy;
            if (color) t.colorSpace = THREE.SRGBColorSpace;
            return t;
        });

    const skyPromise = new HDRLoader(manager).loadAsync(`${BASE}/sky.hdr`).then((t) => {
        t.mapping = THREE.EquirectangularReflectionMapping;
        return t;
    });
    const sets = await Promise.all(
        PBR_SETS.map(async (name) => {
            const [map, normalMap, arm] = await Promise.all([
                load(`${BASE}/tex/${name}_diff.jpg`, true),
                load(`${BASE}/tex/${name}_nor.jpg`, false),
                load(`${BASE}/tex/${name}_arm.jpg`, false),
            ]);
            return [name, { map, normalMap, arm }] as const;
        }),
    );
    const sky = await skyPromise;
    const pbr = Object.fromEntries(sets) as Record<PbrSet, PbrMaps>;
    return {
        sky,
        pbr,
        dispose() {
            sky.dispose();
            for (const s of Object.values(pbr)) {
                s.map.dispose();
                s.normalMap.dispose();
                s.arm.dispose();
            }
        },
    };
}
