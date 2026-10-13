// Look of each terrain and of the players. Plain data, so the Astro page can
// draw the legend at build time without pulling Three.js in.

import type { Resource, Terrain } from "../core/board";

export interface TerrainStyle {
    label: string;
    resource: string;
    /** Accent for the HUD: muted, taken from the terrain's own colours. */
    accent: string;
    /** SVG path data for a 24×24 stroked icon. */
    icon: string;
}

export const TERRAIN_STYLE: Record<Terrain, TerrainStyle> = {
    solar: { label: "Campos solares", resource: "Energía", accent: "#d9b45a", icon: "M13 2 4 14h7l-1 8 9-12h-7z" },
    asteroid: { label: "Minas de asteroide", resource: "Metal", accent: "#c08a64", icon: "M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10" },
    crystal: { label: "Bosques de cristal", resource: "Silicio", accent: "#a99bd6", icon: "M12 2 6 9l6 13 6-13zM6 9h12M9.5 9 12 22l2.5-13" },
    dome: { label: "Cúpulas de cultivo", resource: "Biomasa", accent: "#8fb873", icon: "M5 19C5 11 11 5 20 5c0 9-6 15-14 15M5 19l7-7" },
    ice: { label: "Lagos de hielo", resource: "Agua", accent: "#8cc3d4", icon: "M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" },
    desert: { label: "Desierto radiactivo", resource: "—", accent: "#c97a5a", icon: "M12 3 2 20h20zM12 9v5M12 17h.01" },
};

export const LEGEND_ORDER: Terrain[] = ["solar", "asteroid", "crystal", "dome", "ice", "desert"];

/** Livery of each corporation, in seat order: paint, not neon. */
export const PLAYER_COLORS = ["#2f7fa8", "#b4485c", "#6f9a3c", "#d08a2e"];

/** Resource → the icon and accent of the terrain that produces it. */
export const RESOURCE_ICON: Record<Resource, string> = {
    energy: TERRAIN_STYLE.solar.icon,
    metal: TERRAIN_STYLE.asteroid.icon,
    silicon: TERRAIN_STYLE.crystal.icon,
    biomass: TERRAIN_STYLE.dome.icon,
    water: TERRAIN_STYLE.ice.icon,
};

export const RESOURCE_ACCENT: Record<Resource, string> = {
    energy: TERRAIN_STYLE.solar.accent,
    metal: TERRAIN_STYLE.asteroid.accent,
    silicon: TERRAIN_STYLE.crystal.accent,
    biomass: TERRAIN_STYLE.dome.accent,
    water: TERRAIN_STYLE.ice.accent,
};
