// A tiny tween system driven by the render loop, so every animation shares
// one clock and stops when the tab sleeps.

export type Ease = (t: number) => number;

export const ease = {
    linear: (t: number) => t,
    outCubic: (t: number) => 1 - (1 - t) ** 3,
    inCubic: (t: number) => t ** 3,
    inOutCubic: (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
    outQuint: (t: number) => 1 - (1 - t) ** 5,
    inOutQuint: (t: number) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2),
    outExpo: (t: number) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
    /** Overshoots a little, then settles: things that land. */
    outBack: (t: number) => {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
    },
} satisfies Record<string, Ease>;

export interface TweenOptions {
    duration: number;
    delay?: number;
    ease?: Ease;
    onUpdate: (k: number) => void;
    onComplete?: () => void;
}

interface Tween extends Required<Omit<TweenOptions, "onComplete">> {
    elapsed: number;
    onComplete?: () => void;
    resolve: () => void;
}

export interface Handle {
    /** Jumps to the end state and fires onComplete. */
    finish: () => void;
    done: Promise<void>;
}

export type Tick = (time: number, dt: number) => void;

export class Animator {
    private tweens = new Set<Tween>();
    private ticks = new Set<Tick>();
    time = 0;

    tween(opts: TweenOptions): Handle {
        let resolve!: () => void;
        const done = new Promise<void>((r) => (resolve = r));
        const t: Tween = {
            delay: 0,
            ease: ease.outCubic,
            ...opts,
            elapsed: 0,
            resolve,
        };
        this.tweens.add(t);
        return {
            done,
            finish: () => {
                if (!this.tweens.delete(t)) return;
                t.onUpdate(1);
                t.onComplete?.();
                t.resolve();
            },
        };
    }

    /** Runs every frame until the returned function is called. */
    every(tick: Tick): () => void {
        this.ticks.add(tick);
        return () => this.ticks.delete(tick);
    }

    update(dt: number) {
        this.time += dt;
        for (const t of this.tweens) {
            t.elapsed += dt;
            const local = t.elapsed - t.delay;
            if (local < 0) continue;
            const k = Math.min(local / t.duration, 1);
            t.onUpdate(t.ease(k));
            if (k === 1) {
                this.tweens.delete(t);
                t.onComplete?.();
                t.resolve();
            }
        }
        for (const tick of this.ticks) tick(this.time, dt);
    }

    finishAll() {
        for (const t of [...this.tweens]) {
            this.tweens.delete(t);
            t.onUpdate(1);
            t.onComplete?.();
            t.resolve();
        }
    }
}

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export const prefersReducedMotion = () =>
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
