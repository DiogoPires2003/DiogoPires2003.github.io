// The guided first game: a coach panel that explains one thing at a time,
// points at the part of the screen it's talking about, and moves on when the
// player has done what it asked. It only reads the game; the player plays it.

import type { GameEvent, GameState } from "../core/game";

export interface CoachView {
    title: string;
    text: string;
    /** CSS selector of the element to spotlight, if any. */
    target?: string;
    /** Show a "Siguiente" button: the step waits for it rather than for a move. */
    next?: boolean;
    /** Position in the lesson, for the progress dots. */
    index: number;
    total: number;
}

interface Progress {
    colonies: number;
    conduits: number;
    rolled: number;
    builtInPlay: number;
    traded: number;
    turnsEnded: number;
    sevens: number;
}

interface Step {
    title: string;
    text: (s: GameState, me: number) => string;
    target?: string;
    /** Done when this returns true. Steps without it wait for "Siguiente". */
    done?: (p: Progress, s: GameState, me: number) => boolean;
}

const STEPS: Step[] = [
    {
        title: "Bienvenida, comandante",
        text: () =>
            "Tu corporación llega a un planeta recién terraformado. Cada <b>sector hexagonal</b> produce un recurso: Energía, Metal, Silicio, Biomasa o Agua. El primero en reunir <b>10 puntos de influencia</b> gana.",
    },
    {
        title: "Números y probabilidad",
        text: () =>
            "Cada sector tiene un número. Cuando los dados suman ese número, el sector produce. Los puntos bajo el número indican lo probable que es: el <b>6</b> y el <b>8</b> (en rojo) son los que más salen. Pasa el cursor por un sector para ver qué produce.",
    },
    {
        title: "Tu primera colonia",
        text: () =>
            "Haz clic en uno de los <b>anillos blancos</b> para fundar una colonia. Las colonias van en las esquinas y cobran de los tres sectores que tocan: busca números buenos y recursos variados.",
        done: (p) => p.colonies >= 1,
    },
    {
        title: "Un conducto",
        text: () => "Ahora coloca un <b>conducto</b> en una de las aristas marcadas, junto a tu colonia. Los conductos conectan tu red y te dejan expandirte.",
        done: (p) => p.conduits >= 1,
    },
    {
        title: "Segunda colonia",
        text: () =>
            "Tu rival ya ha colocado la suya. Funda tu <b>segunda colonia</b> y su conducto. Esta te da al momento un recurso de cada sector que toque.",
        done: (p) => p.colonies >= 2 && p.conduits >= 2,
    },
    {
        title: "Tu mano",
        text: () =>
            "Abajo están tus <b>cartas de recurso</b>. Con ellas construyes: arriba a la izquierda tienes la tabla de <b>costes de construcción</b>. Una colonia da 1 punto y una torre, 2.",
        target: "[data-dock] .hand",
    },
    {
        title: "Tira los dados",
        text: () => "Es tu turno. Pulsa <b>Tirar dados</b>: todos los sectores con ese número producen para las colonias que los tocan.",
        target: "[data-roll]",
        done: (p) => p.rolled >= 1,
    },
    {
        title: "Construir o comerciar",
        text: () =>
            "Si te llega, elige algo en la barra de construir y colócalo en el tablero. Si no, abre <b>Comerciar</b>: el banco te cambia 4 iguales por 1 de lo que quieras (3:1 o 2:1 si tienes colonia en una estación de la costa). Cuando acabes, pasa el turno.",
        target: "[data-dock] .actions",
        done: (p) => p.builtInPlay >= 1 || p.traded >= 1 || p.turnsEnded >= 1,
    },
    {
        title: "Pasa el turno",
        text: () => "Pulsa <b>Fin del turno</b>. Mientras juegan los demás también puedes cobrar: cualquier tirada puede activar tus sectores.",
        target: "[data-end]",
        done: (p) => p.turnsEnded >= 1,
    },
    {
        title: "El dron saboteador",
        text: () =>
            "Si sale un <b>7</b>, nadie produce: quien tenga más de 7 cartas descarta la mitad, y quien tiró mueve el <b>dron saboteador</b> a otro sector, que deja de producir, y roba una carta a un vecino. Podrás elegir y confirmar dónde lo envías.",
    },
    {
        title: "Tecnologías y eventos",
        text: () =>
            "Las <b>tecnologías</b> dan drones, conductos gratis, recursos o puntos ocultos. Y cada 5 rondas ocurre un <b>evento orbital</b> que sacude el planeta. Ya sabes lo básico: sigue esta partida hasta el final o vuelve al menú cuando quieras.",
    },
];

export class Tutorial {
    private step = 0;
    private seen = 0;
    private progress: Progress = { colonies: 0, conduits: 0, rolled: 0, builtInPlay: 0, traded: 0, turnsEnded: 0, sevens: 0 };
    private lastCurrent: number | null = null;

    /** Feeds the moves that just happened; returns what the coach should show. */
    update(s: GameState, me: number, events: GameEvent[]): CoachView | null {
        for (const e of events) {
            if (e.seq <= this.seen) continue;
            this.seen = e.seq;
            if (e.kind === "built" && e.player === me) {
                if (e.what === "colony") this.progress.colonies++;
                if (e.what === "conduit") this.progress.conduits++;
                if (s.phase !== "setup" && !(e.what === "conduit" && this.progress.conduits <= 2)) this.progress.builtInPlay++;
            }
            if (e.kind === "dice" && e.player === me) this.progress.rolled++;
            if (e.kind === "dice" && e.dice[0] + e.dice[1] === 7) this.progress.sevens++;
            if (e.kind === "trade" && (e.a === me || e.b === me)) this.progress.traded++;
        }
        if (s.phase === "play" && this.lastCurrent === me && s.current !== me) this.progress.turnsEnded++;
        this.lastCurrent = s.current;

        // Skip ahead past any steps the player has already done.
        while (this.step < STEPS.length && STEPS[this.step].done?.(this.progress, s, me)) this.step++;
        return this.view(s, me);
    }

    /** "Siguiente" pressed. */
    advance(s: GameState, me: number): CoachView | null {
        if (this.step < STEPS.length && !STEPS[this.step].done) this.step++;
        while (this.step < STEPS.length && STEPS[this.step].done?.(this.progress, s, me)) this.step++;
        return this.view(s, me);
    }

    get finished() {
        return this.step >= STEPS.length;
    }

    private view(s: GameState, me: number): CoachView | null {
        const step = STEPS[this.step];
        if (!step) return null;
        return {
            title: step.title,
            text: step.text(s, me),
            target: step.target,
            next: !step.done,
            index: this.step,
            total: STEPS.length,
        };
    }
}

/** A board with friendly openings for the first game. */
export const TUTORIAL_SEED = 20251013;
