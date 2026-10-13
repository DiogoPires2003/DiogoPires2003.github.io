// Turns a Board into the island: the beach the tiles sit in, a sculpted
// chunk of land per hex with its props and number marker, and the animations
// that raise tiles out of the sea and sink them again.

import * as THREE from "three";
import type { Board, Terrain, Tile } from "../core/board";
import { BOARD_RADIUS } from "../core/board";
import { hexKey, hexToPlane, hexesInRadius } from "../core/hex";
import { createRng } from "../core/rng";
import type { PbrSet } from "./assets";
import { ease, lerp, type Animator } from "./anim";
import { ground } from "./materials";
import { mergeStatic } from "./merge";
import { SEA_LEVEL } from "./ocean";
import { buildProps, type Diorama } from "./props";
import { markDetail } from "./stage";
import { buildIslandGeometry, buildTileGeometry, surfaceHeight } from "./terrain";
import { createToken, type Token } from "./token";

export const HEX_SIZE = 1;
/** Leaves a narrow crevice between tiles. */
const TILE_RADIUS = 0.965 * HEX_SIZE;
/** The beach around the tiles, where trade stations will sit. */
export const COAST_RADIUS = 5.4 * HEX_SIZE;
const SUNK = -0.95;
/** Half-width of the area the island (and the sea's depth map) covers. */
export const ISLAND_EXTENT = COAST_RADIUS + 2.4;
/** Tile centres of a full board: the island's shape doesn't depend on the deal. */
export const ISLAND_CENTERS = hexesInRadius(BOARD_RADIUS).map((h) => hexToPlane(h, HEX_SIZE));

const GROUND: Record<Terrain, { set: PbrSet; tint: string; cliff: string }> = {
    solar: { set: "aerial_sand", tint: "#f2dfae", cliff: "#cdb99a" },
    asteroid: { set: "rocky_terrain_02", tint: "#8f949c", cliff: "#8a8a8c" },
    crystal: { set: "aerial_ground_rock", tint: "#a397c0", cliff: "#9d93ad" },
    dome: { set: "farm_furrows", tint: "#b8c294", cliff: "#b3a88f" },
    ice: { set: "snow_field_aerial", tint: "#eef4f8", cliff: "#aab4bf" },
    desert: { set: "cracked_red_ground", tint: "#d0805a", cliff: "#a8735f" },
};

export interface BoardContext {
    animator: Animator;
    sun: THREE.Vector3;
    /** Azimuth the camera rests at; number markers face it. */
    facing: number;
}

class TileView {
    readonly root = new THREE.Group();
    /** Everything that moves: hover lift, rising from the sea, sinking. */
    readonly lift = new THREE.Group();
    readonly land: THREE.Mesh;
    private readonly outline: THREE.LineLoop;
    private readonly outlineMat: THREE.LineBasicMaterial;
    private readonly props: Diorama;
    private readonly token: Token | null;
    private readonly merged: THREE.BufferGeometry[];
    private hover = 0;
    private hoverTarget = 0;
    private pulse = 0;
    /** Offered as a choice (moving the drone): the outline breathes. */
    selectable = false;
    restY = 0;

    constructor(
        readonly tile: Tile,
        index: number,
        seed: number,
        ctx: BoardContext,
    ) {
        const center = hexToPlane(tile.coord, HEX_SIZE);
        this.root.position.set(center.x, 0, center.z);
        this.root.add(this.lift);
        const look = GROUND[tile.terrain];
        const heightAt = (x: number, z: number) => surfaceHeight(tile.terrain, center, TILE_RADIUS, x, z);

        this.land = new THREE.Mesh(buildTileGeometry(tile.terrain, center, TILE_RADIUS), [
            ground(look.set, look.tint),
            ground("cliff_side", look.cliff, { normalScale: 1.6 }),
        ]);
        this.land.castShadow = this.land.receiveShadow = true;
        this.land.userData.tileView = this;

        // A fine line traced just inside the rim, shown on hover.
        const ring: THREE.Vector3[] = [];
        for (let s = 0; s < 6; s++) {
            const a0 = (s * Math.PI) / 3;
            const a1 = ((s + 1) * Math.PI) / 3;
            for (let k = 0; k < 8; k++) {
                const t = k / 8;
                const x = lerp(Math.sin(a0), Math.sin(a1), t) * TILE_RADIUS * 0.93;
                const z = lerp(Math.cos(a0), Math.cos(a1), t) * TILE_RADIUS * 0.93;
                ring.push(new THREE.Vector3(x, heightAt(x, z) + 0.012, z));
            }
        }
        this.outlineMat = new THREE.LineBasicMaterial({ color: "#f4efe6", transparent: true, opacity: 0, depthWrite: false });
        this.outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring), this.outlineMat);
        this.outline.visible = false;

        this.props = buildProps(tile.terrain, { rng: createRng(seed * 31 + index), heightAt, sun: ctx.sun });
        this.merged = mergeStatic(this.props.group);
        markDetail(this.props.group);

        this.lift.add(this.land, this.outline, this.props.group);

        this.token = tile.number === null ? null : createToken(tile.number, ctx.facing);
        if (this.token) {
            this.token.group.position.y = heightAt(0, 0) - 0.005;
            markDetail(this.token.group);
            this.lift.add(this.token.group);
        }
    }

    setHover(on: boolean) {
        this.hoverTarget = on ? 1 : 0;
    }

    update(time: number, dt: number) {
        this.hover += (this.hoverTarget - this.hover) * (1 - Math.exp(-dt * 12));
        this.pulse = Math.max(0, this.pulse - dt * 0.8);
        this.lift.position.y = this.restY + this.hover * 0.05;
        const invite = this.selectable ? 0.35 + 0.25 * Math.sin(time * 4) : 0;
        const glow = Math.max(this.hover, this.pulse, invite);
        this.outline.visible = glow > 0.01;
        this.outlineMat.opacity = glow * 0.75;
        this.token?.setFocus(Math.max(this.hover, this.pulse));
        this.props.update(time);
    }

    /** Rises from the sea, then the props settle and the marker comes up. */
    enter(animator: Animator, delay: number, fast: boolean, splash: (x: number, z: number, delay: number) => void) {
        const rise = fast ? 0.9 : 1.4;
        this.restY = SUNK;
        this.props.group.scale.setScalar(0.001);
        this.token?.setPresence(0);
        splash(this.root.position.x, this.root.position.z, delay + rise * 0.35);
        animator.tween({
            delay,
            duration: rise,
            ease: ease.outCubic,
            onUpdate: (k) => (this.restY = lerp(SUNK, 0, k)),
        });
        animator.tween({
            delay: delay + rise * 0.7,
            duration: 0.7,
            ease: ease.outBack,
            onUpdate: (k) => this.props.group.scale.set(1, Math.max(k, 0.001), 1),
        });
        if (this.token) {
            const token = this.token;
            animator.tween({ delay: delay + rise + 0.15, duration: 0.7, ease: ease.outBack, onUpdate: (k) => token.setPresence(k) });
        }
    }

    exit(animator: Animator, delay: number, splash: (x: number, z: number, delay: number) => void): Promise<void> {
        this.hoverTarget = 0;
        const token = this.token;
        if (token) animator.tween({ delay, duration: 0.3, ease: ease.inCubic, onUpdate: (k) => token.setPresence(1 - k) });
        splash(this.root.position.x, this.root.position.z, delay + 0.45);
        return animator.tween({
            delay: delay + 0.1,
            duration: 0.75,
            ease: ease.inCubic,
            onUpdate: (k) => (this.restY = lerp(0, SUNK, k)),
        }).done;
    }

    /** A soft highlight, as production will use. */
    flash() {
        this.pulse = 1;
    }

    dispose() {
        this.land.geometry.dispose();
        this.outline.geometry.dispose();
        this.outlineMat.dispose();
        this.props.dispose?.();
        this.merged.forEach((g) => g.dispose());
        this.token?.dispose();
    }
}

export class BoardView {
    readonly group = new THREE.Group();
    private readonly tilesGroup = new THREE.Group();
    private views: TileView[] = [];
    private hovered: TileView | null = null;
    private readonly raycaster = new THREE.Raycaster();
    private readonly island: THREE.Mesh;
    private readonly splashes: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = [];
    private readonly splashGeo = new THREE.RingGeometry(0.75, 1, 64).rotateX(-Math.PI / 2);

    constructor(private readonly ctx: BoardContext) {
        this.island = new THREE.Mesh(buildIslandGeometry(ISLAND_CENTERS, ISLAND_EXTENT), ground("coast_sand_01", "#d6c7ae"));
        this.island.receiveShadow = true;
        this.group.add(this.island, this.tilesGroup);
    }

    /**
     * Swaps in a new board. With `animate`, the old tiles sink and the new
     * ones rise out of the sea from the centre outwards.
     */
    async setBoard(board: Board, opts: { animate: boolean; fast?: boolean }) {
        const old = this.views;
        this.views = [];
        this.setHovered(null);
        const splash = (x: number, z: number, delay: number) => this.splash(x, z, delay);
        if (opts.animate && old.length) {
            await Promise.all(old.map((v) => v.exit(this.ctx.animator, ringOrder(v.tile) * 0.06, splash)));
        }
        for (const v of old) {
            this.tilesGroup.remove(v.root);
            v.dispose();
        }
        this.views = board.tiles.map((tile, i) => new TileView(tile, i, board.seed, this.ctx));
        for (const v of this.views) {
            this.tilesGroup.add(v.root);
            if (opts.animate) v.enter(this.ctx.animator, ringOrder(v.tile) * (opts.fast ? 0.05 : 0.09), !!opts.fast, splash);
        }
    }

    update(time: number, dt: number) {
        for (const v of this.views) v.update(time, dt);
    }

    /** Index of the tile under the pointer, if any, and highlights it. */
    pick(ndc: THREE.Vector2 | null, camera: THREE.Camera, highlight = true): number | null {
        if (!ndc) {
            this.setHovered(null);
            return null;
        }
        this.raycaster.setFromCamera(ndc, camera);
        const hit = this.raycaster.intersectObjects(
            this.views.map((v) => v.land),
            false,
        )[0];
        const view = (hit?.object.userData.tileView as TileView | undefined) ?? null;
        this.setHovered(highlight ? view : null);
        return view ? this.views.indexOf(view) : null;
    }

    tileAt(index: number): Tile | null {
        return this.views[index]?.tile ?? null;
    }

    /** Tiles offered as a choice get a breathing outline. */
    setSelectable(indices: number[]) {
        const set = new Set(indices);
        this.views.forEach((v, i) => (v.selectable = set.has(i)));
    }

    /** Swaps one tile for another in place: the old one sinks, the new one rises. */
    async replaceTile(index: number, tile: Tile, seed: number) {
        const old = this.views[index];
        if (!old) return;
        const splash = (x: number, z: number, delay: number) => this.splash(x, z, delay);
        const next = new TileView(tile, index, seed + 1000, this.ctx);
        this.views[index] = next;
        await old.exit(this.ctx.animator, 0, splash);
        this.tilesGroup.remove(old.root);
        old.dispose();
        this.tilesGroup.add(next.root);
        next.enter(this.ctx.animator, 0, false, splash);
    }

    private setHovered(view: TileView | null) {
        if (view === this.hovered) return;
        this.hovered?.setHover(false);
        view?.setHover(true);
        this.hovered = view;
    }

    /** Highlights every tile showing `n`, as production will. */
    pulse(n: number) {
        for (const v of this.views) if (v.tile.number === n) v.flash();
    }

    /** Height of the highest tile touching a point: where a piece there rests. */
    groundAt(x: number, z: number): number {
        let y = 0;
        for (const v of this.views) {
            const lx = x - v.root.position.x;
            const lz = z - v.root.position.z;
            if (lx * lx + lz * lz < (HEX_SIZE * 1.05) ** 2) {
                // Sample just inside the tile towards the point.
                const k = Math.min(1, (TILE_RADIUS * 0.85) / Math.hypot(lx, lz));
                y = Math.max(y, surfaceHeight(v.tile.terrain, v.root.position, TILE_RADIUS, lx * k, lz * k));
            }
        }
        return y;
    }

    /** World position of a tile's top centre. */
    anchor(which: Tile | number, out = new THREE.Vector3()): THREE.Vector3 {
        const view =
            typeof which === "number" ? this.views[which] : this.views.find((v) => hexKey(v.tile.coord) === hexKey(which.coord));
        if (!view) throw new Error("Tile not on the board");
        const tile = view.tile;
        const y = surfaceHeight(tile.terrain, view.root.position, TILE_RADIUS, 0, 0);
        return out.set(view.root.position.x, y, view.root.position.z);
    }

    /** A ring of foam spreading on the water where a tile breaks the surface. */
    private splash(x: number, z: number, delay: number) {
        const mat = new THREE.MeshBasicMaterial({ color: "#e8eef0", transparent: true, opacity: 0, depthWrite: false });
        const mesh = new THREE.Mesh(this.splashGeo, mat);
        mesh.position.set(x, SEA_LEVEL + 0.01, z);
        mesh.visible = false;
        this.group.add(mesh);
        const entry = { mesh, mat };
        this.splashes.push(entry);
        this.ctx.animator.tween({
            delay,
            duration: 1.6,
            ease: ease.outCubic,
            onUpdate: (k) => {
                mesh.visible = true;
                mesh.scale.setScalar(0.9 + k * 1.1);
                mat.opacity = (1 - k) * 0.5;
            },
            onComplete: () => {
                mesh.removeFromParent();
                mat.dispose();
                this.splashes.splice(this.splashes.indexOf(entry), 1);
            },
        });
    }

    dispose() {
        for (const v of this.views) v.dispose();
        for (const s of this.splashes) s.mat.dispose();
        this.splashGeo.dispose();
        this.island.geometry.dispose();
    }
}

/** Centre first, then ring by ring, sweeping round each ring. */
function ringOrder(t: Tile): number {
    const { q, r } = t.coord;
    const ringN = (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
    const { x, z } = hexToPlane(t.coord, 1);
    const angle = (Math.atan2(z, x) + Math.PI) / (Math.PI * 2);
    return ringN === 0 ? 0 : (ringN - 1) * 6 + 1 + angle * ringN * 6;
}
