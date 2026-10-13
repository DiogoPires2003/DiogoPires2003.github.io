// Keeps the 3D table in step with the game state: pieces appear with their
// build effect, towers replace colonies, the drone flies, meteors reshape
// tiles. Also draws the placement markers and turns clicks into choices.

import * as THREE from "three";
import type { GameState } from "../core/game";
import { ease, lerp, type Animator } from "./anim";
import { ISLAND_CENTERS, type BoardView } from "./boardView";
import { createHarbor, type HarborModel } from "./harbor";
import { SEA_LEVEL } from "./ocean";
import { PLAYER_COLORS } from "./palette";
import { createColony, createConduit, createDrone, createTower, materialize, type Piece } from "./pieces";
import { DETAIL_LAYER, markDetail } from "./stage";
import { islandHeight } from "./terrain";

const DRONE_HOVER = 0.55;

export type Pick = { kind: "vertex"; id: number } | { kind: "edge"; id: number } | { kind: "tile"; id: number };

export interface Markers {
    kind: "vertex" | "edge" | "tile";
    ids: number[];
    color: string;
}

export class GameView {
    readonly layer = new THREE.Group();
    private buildings = new Map<number, { kind: "colony" | "tower"; piece: Piece }>();
    private conduits = new Map<number, Piece>();
    private harbors: HarborModel[] = [];
    private drone: Piece;
    private droneTile = -1;
    private flight: ReturnType<Animator["tween"]> | null = null;
    private state: GameState | null = null;
    private markerGroup = new THREE.Group();
    private markerMeshes: THREE.Mesh[] = [];
    private markers: Markers | null = null;
    private hoveredMarker: THREE.Mesh | null = null;
    private raycaster = new THREE.Raycaster();
    private markerGeo = {
        vertex: new THREE.TorusGeometry(0.1, 0.024, 10, 36).rotateX(Math.PI / 2),
        vertexHit: new THREE.SphereGeometry(0.17, 8, 6),
        edge: new THREE.CapsuleGeometry(0.034, 0.42, 4, 10).rotateZ(Math.PI / 2),
        edgeHit: new THREE.BoxGeometry(0.5, 0.14, 0.18),
    };

    constructor(
        private readonly board: BoardView,
        private readonly animator: Animator,
    ) {
        this.layer.add(this.markerGroup);
        this.drone = createDrone();
        this.drone.group.scale.setScalar(1.4);
        this.drone.group.visible = false;
        this.layer.add(this.drone.group);
        markDetail(this.layer);
        // Pieces added later join the detail layer too (skipped by reflections).
        this.layer.addEventListener("childadded", (e) => markDetail(e.child));
        this.raycaster.layers.enable(DETAIL_LAYER);
    }

    vertexPosition(s: GameState, v: number) {
        const p = s.topology.vertices[v];
        return new THREE.Vector3(p.x, this.board.groundAt(p.x, p.z), p.z);
    }

    /** Clears everything for a fresh game on `s.board`. */
    reset(s: GameState) {
        for (const b of this.buildings.values()) this.remove(b.piece);
        for (const c of this.conduits.values()) this.remove(c);
        this.buildings.clear();
        this.conduits.clear();
        for (const h of this.harbors) {
            h.group.removeFromParent();
            h.dispose();
        }
        this.harbors = [];
        for (const h of s.topology.harbors) {
            const e = s.topology.edges[h.edge];
            const a = s.topology.vertices[e.a];
            const b = s.topology.vertices[e.b];
            const mid = new THREE.Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
            const out = mid.clone().setY(0).normalize();
            // Stand the pier on the sand if there is any, else on stilts in the shallows.
            const spot = mid.clone().addScaledVector(out, 0.55);
            const deck = Math.max(islandHeight(spot.x, spot.z, ISLAND_CENTERS).y + 0.03, SEA_LEVEL + 0.1);
            const model = createHarbor(h.kind, h.ratio, mid, out, deck);
            this.harbors.push(model);
            this.layer.add(model.group);
        }
        this.droneTile = -1;
        this.drone.group.visible = false;
        this.drone.group.position.set(0, 0, 0);
        this.state = null;
    }

    /** Brings the 3D table in line with `s`, animating what changed. */
    sync(s: GameState, animate: boolean) {
        const prev = this.state;
        this.state = s;

        // Meteors: a tile changed its terrain.
        if (prev) {
            s.board.tiles.forEach((t, i) => {
                if (prev.board.tiles[i].terrain !== t.terrain) void this.board.replaceTile(i, t, s.seed + i);
            });
        }

        for (const [key, b] of Object.entries(s.buildings)) {
            const v = Number(key);
            const have = this.buildings.get(v);
            if (have?.kind === b.kind) continue;
            if (have) this.fadeOut(have.piece);
            const color = PLAYER_COLORS[b.owner];
            const piece = b.kind === "tower" ? createTower(color) : createColony(color);
            piece.group.position.copy(this.vertexPosition(s, v));
            piece.group.rotation.y = (v * 2.399) % (Math.PI * 2);
            this.layer.add(piece.group);
            this.buildings.set(v, { kind: b.kind, piece });
            if (animate) void materialize(piece, color, this.animator);
        }

        for (const [key, owner] of Object.entries(s.conduits)) {
            const id = Number(key);
            if (this.conduits.has(id)) continue;
            const e = s.topology.edges[id];
            const a = this.vertexPosition(s, e.a);
            const b = this.vertexPosition(s, e.b);
            const color = PLAYER_COLORS[owner];
            const piece = createConduit(color);
            piece.group.position.copy(a).add(b).multiplyScalar(0.5);
            piece.group.position.y = Math.max(a.y, b.y) - 0.01;
            piece.group.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
            this.layer.add(piece.group);
            this.conduits.set(id, piece);
            if (animate) void materialize(piece, color, this.animator);
        }

        if (s.drone !== this.droneTile) {
            this.flyDrone(s.drone, animate && this.droneTile >= 0);
            this.droneTile = s.drone;
        }
    }

    /**
     * Flies the drone to `tile` as a preview, before the move is confirmed;
     * null sends it back to where the game says it is.
     */
    previewDrone(tile: number | null) {
        const s = this.state;
        if (!s) return;
        const target = tile ?? s.drone;
        if (target === this.droneTile) return;
        this.flyDrone(target, true);
        this.droneTile = target;
    }

    private flyDrone(tile: number, animate: boolean) {
        const to = this.board.anchor(tile);
        to.y += DRONE_HOVER;
        const d = this.drone.group;
        d.visible = true;
        if (!animate) {
            d.position.copy(to);
            return;
        }
        const from = d.position.clone();
        this.flight?.finish();
        this.flight = this.animator.tween({
            duration: 1.2,
            ease: ease.inOutCubic,
            onUpdate: (k) => {
                d.position.set(lerp(from.x, to.x, k), lerp(from.y, to.y, k) + Math.sin(k * Math.PI) * 1.1, lerp(from.z, to.z, k));
                d.rotation.z = Math.sin(k * Math.PI) * 0.25 * Math.sign(to.x - from.x);
            },
        });
    }

    private fadeOut(piece: Piece) {
        this.animator.tween({
            duration: 0.5,
            ease: ease.inCubic,
            onUpdate: (k) => piece.group.scale.setScalar(Math.max(1 - k, 0.001)),
            onComplete: () => this.remove(piece),
        });
    }

    private remove(piece: Piece) {
        piece.group.removeFromParent();
        piece.dispose();
    }

    update(time: number) {
        this.drone.update?.(time);
        for (const b of this.buildings.values()) b.piece.update?.(time);
        for (const c of this.conduits.values()) c.update?.(time);
        for (const m of this.markerMeshes) {
            const base = m === this.hoveredMarker ? 1.35 : 1;
            m.scale.setScalar(base * (1 + Math.sin(time * 4 + m.position.x * 3) * 0.06));
        }
    }

    // --- Markers ---------------------------------------------------------

    setMarkers(markers: Markers | null) {
        // Without a state there is nowhere to put them; try again after sync.
        if (!this.state) markers = null;
        const same =
            markers && this.markers && markers.kind === this.markers.kind && markers.color === this.markers.color && markers.ids.join() === this.markers.ids.join();
        if (same) return;
        this.markers = markers;
        for (const m of this.markerMeshes) {
            m.removeFromParent();
            (m.material as THREE.Material).dispose();
        }
        this.markerMeshes = [];
        this.hoveredMarker = null;
        this.board.setSelectable(markers?.kind === "tile" ? markers.ids : []);
        const s = this.state;
        if (!markers || !s || markers.kind === "tile") return;
        for (const id of markers.ids) {
            const mat = new THREE.MeshBasicMaterial({ color: "#f4efe6", transparent: true, opacity: 0.85, depthWrite: false });
            let m: THREE.Mesh;
            if (markers.kind === "vertex") {
                m = new THREE.Mesh(this.markerGeo.vertex, mat);
                m.position.copy(this.vertexPosition(s, id)).add(new THREE.Vector3(0, 0.04, 0));
                const hit = new THREE.Mesh(this.markerGeo.vertexHit, new THREE.MeshBasicMaterial({ visible: false }));
                m.add(hit);
            } else {
                const e = s.topology.edges[id];
                const a = this.vertexPosition(s, e.a);
                const b = this.vertexPosition(s, e.b);
                m = new THREE.Mesh(this.markerGeo.edge, mat);
                m.position.copy(a).add(b).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.05, 0));
                m.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
                const hit = new THREE.Mesh(this.markerGeo.edgeHit, new THREE.MeshBasicMaterial({ visible: false }));
                m.add(hit);
            }
            m.userData.pick = { kind: markers.kind, id } satisfies Pick;
            m.renderOrder = 20;
            this.markerGroup.add(m);
            this.markerMeshes.push(m);
        }
        markDetail(this.markerGroup);
    }

    /** What's under the pointer among the offered choices; highlights it. */
    hover(ndc: THREE.Vector2 | null, camera: THREE.Camera): Pick | null {
        const markers = this.markers;
        if (!markers || !ndc) {
            this.setHover(null);
            return null;
        }
        if (markers.kind === "tile") {
            const t = this.board.pick(ndc, camera, false);
            const ok = t !== null && markers.ids.includes(t);
            this.board.pick(ok ? ndc : null, camera);
            return ok ? { kind: "tile", id: t! } : null;
        }
        this.raycaster.setFromCamera(ndc, camera);
        const hits = this.raycaster.intersectObjects(this.markerMeshes, true);
        let mesh = hits[0]?.object as THREE.Mesh | undefined;
        while (mesh && !mesh.userData.pick) mesh = mesh.parent as THREE.Mesh | undefined;
        this.setHover(mesh ?? null, markers.color);
        return (mesh?.userData.pick as Pick | undefined) ?? null;
    }

    private setHover(mesh: THREE.Mesh | null, color = "#f4efe6") {
        if (this.hoveredMarker === mesh) return;
        if (this.hoveredMarker) (this.hoveredMarker.material as THREE.MeshBasicMaterial).color.set("#f4efe6");
        if (mesh) (mesh.material as THREE.MeshBasicMaterial).color.set(color);
        this.hoveredMarker = mesh;
    }

    /** Screen position (CSS px) of a world point, for floating labels. */
    project(world: THREE.Vector3, camera: THREE.Camera, canvas: HTMLCanvasElement) {
        const v = world.clone().project(camera);
        const r = canvas.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, visible: v.z < 1 };
    }

    tileWorld(tile: number) {
        return this.board.anchor(tile);
    }
}
