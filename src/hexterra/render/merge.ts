// Collapses the still parts of a prop group into one mesh per material, so a
// tile costs a handful of draw calls instead of dozens.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Merges every plain Mesh under `root` that isn't (or isn't inside) an object
 * flagged `userData.dynamic`. Instanced meshes, sprites and lines are left as
 * they are. Returns the merged geometries, which the caller owns.
 */
export function mergeStatic(root: THREE.Object3D): THREE.BufferGeometry[] {
    root.updateMatrixWorld(true);
    const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const buckets = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[]; shadow: boolean; meshes: THREE.Mesh[] }>();

    const visit = (o: THREE.Object3D) => {
        if (o.userData.dynamic) return;
        if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && !Array.isArray(o.material)) {
            const g = o.geometry as THREE.BufferGeometry;
            const attrs = Object.keys(g.attributes).sort().join(",");
            const key = `${o.material.uuid}|${attrs}|${g.index ? "i" : "n"}`;
            let b = buckets.get(key);
            if (!b) {
                b = { material: o.material, geos: [], shadow: false, meshes: [] };
                buckets.set(key, b);
            }
            const copy = g.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, o.matrixWorld));
            b.geos.push(copy);
            b.shadow ||= o.castShadow;
            b.meshes.push(o);
        }
        for (const c of o.children) visit(c);
    };
    for (const c of root.children) visit(c);

    const owned: THREE.BufferGeometry[] = [];
    for (const b of buckets.values()) {
        if (b.meshes.length < 2) {
            b.geos.forEach((g) => g.dispose());
            continue;
        }
        const merged = mergeGeometries(b.geos);
        b.geos.forEach((g) => g.dispose());
        if (!merged) continue;
        for (const m of b.meshes) m.removeFromParent();
        const mesh = new THREE.Mesh(merged, b.material);
        mesh.castShadow = b.shadow;
        mesh.receiveShadow = true;
        root.add(mesh);
        owned.push(merged);
    }
    return owned;
}
