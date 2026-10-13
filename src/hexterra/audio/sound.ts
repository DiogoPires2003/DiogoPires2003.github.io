// All of Hexterra's sound, synthesised with Web Audio: no files to download,
// nothing to license. A generative ambient score (pads, a soft bass and a
// sparse arpeggio through reverb and echo) and a small kit of effects.
//
// Browsers only allow audio after a user gesture, so nothing plays until the
// first click or key press.

export type Sfx =
    | "tick"
    | "dice"
    | "colony"
    | "conduit"
    | "tower"
    | "materialize"
    | "produce"
    | "turn"
    | "seven"
    | "drone"
    | "steal"
    | "trade"
    | "tech"
    | "orbital"
    | "win"
    | "lose"
    | "error"
    | "terraform";

const PREFS_KEY = "hexterra:audio";

/** MIDI note → Hz. */
const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);

// D dorian, slow: Dm9 · Bbmaj7 · Fmaj7/A · C6/9. Each chord as MIDI notes.
const PROGRESSION = [
    { bass: 38, pad: [62, 65, 69, 72, 76] },
    { bass: 34, pad: [58, 62, 65, 69, 74] },
    { bass: 33, pad: [60, 65, 69, 72, 77] },
    { bass: 36, pad: [60, 64, 67, 69, 74] },
];
const CHORD_SECONDS = 9;

export class Sound {
    private ctx: AudioContext | null = null;
    private master!: GainNode;
    private musicBus!: GainNode;
    private sfxBus!: GainNode;
    private reverb!: ConvolverNode;
    private echo!: DelayNode;
    private noise!: AudioBuffer;
    private musicTimer = 0;
    private nextChordAt = 0;
    private chord = 0;
    musicOn = true;
    sfxOn = true;
    private listeners = new Set<() => void>();

    constructor() {
        try {
            const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
            if (typeof saved.music === "boolean") this.musicOn = saved.music;
            if (typeof saved.sfx === "boolean") this.sfxOn = saved.sfx;
        } catch {
            /* no storage: defaults */
        }
        const unlock = () => {
            this.ensure();
            void this.ctx?.resume();
            window.removeEventListener("pointerdown", unlock);
            window.removeEventListener("keydown", unlock);
        };
        window.addEventListener("pointerdown", unlock);
        window.addEventListener("keydown", unlock);
        document.addEventListener("visibilitychange", () => {
            if (!this.ctx) return;
            if (document.hidden) void this.ctx.suspend();
            else void this.ctx.resume();
        });
    }

    onChange(fn: () => void) {
        this.listeners.add(fn);
    }

    private save() {
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify({ music: this.musicOn, sfx: this.sfxOn }));
        } catch {
            /* fine */
        }
        this.listeners.forEach((fn) => fn());
    }

    setMusic(on: boolean) {
        this.musicOn = on;
        this.save();
        if (!this.ctx) return;
        this.ramp(this.musicBus.gain, on ? 0.55 : 0, 1.2);
        if (on) this.startMusic();
    }

    setSfx(on: boolean) {
        this.sfxOn = on;
        this.save();
        if (this.ctx) this.ramp(this.sfxBus.gain, on ? 0.9 : 0, 0.1);
    }

    /**
     * Tries to start sound right away. Returns true if the browser let it play;
     * false means it is waiting for a click or key press.
     */
    async tryStart(): Promise<boolean> {
        this.ensure();
        if (!this.ctx) return false;
        if (this.ctx.state !== "running") {
            // Some browsers allow it outright (a site you've played before); give them a moment.
            await Promise.race([this.ctx.resume(), new Promise((r) => setTimeout(r, 250))]);
        }
        return this.ctx.state === "running";
    }

    /** Call from inside a click or key handler. */
    unlock() {
        this.ensure();
        return this.ctx?.resume() ?? Promise.resolve();
    }

    /** Builds the audio graph (it plays once the browser allows sound). */
    private ensure() {
        if (this.ctx) return;
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        this.ctx = ctx;

        this.master = ctx.createGain();
        this.master.gain.value = 0.8;
        // A gentle limiter so stacked effects never clip.
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -10;
        limiter.knee.value = 8;
        limiter.ratio.value = 6;
        this.master.connect(limiter).connect(ctx.destination);

        this.musicBus = ctx.createGain();
        this.musicBus.gain.value = 0;
        this.sfxBus = ctx.createGain();
        this.sfxBus.gain.value = this.sfxOn ? 0.9 : 0;
        this.musicBus.connect(this.master);
        this.sfxBus.connect(this.master);

        this.reverb = ctx.createConvolver();
        this.reverb.buffer = impulse(ctx, 4.5, 2.6);
        const wet = ctx.createGain();
        wet.gain.value = 0.55;
        this.reverb.connect(wet).connect(this.master);

        // Ping-pong-ish echo for the arpeggio.
        this.echo = ctx.createDelay(2);
        this.echo.delayTime.value = 0.42;
        const feedback = ctx.createGain();
        feedback.gain.value = 0.38;
        const echoTone = ctx.createBiquadFilter();
        echoTone.type = "lowpass";
        echoTone.frequency.value = 2600;
        this.echo.connect(echoTone).connect(feedback).connect(this.echo);
        echoTone.connect(this.reverb);

        this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

        if (this.musicOn) {
            this.ramp(this.musicBus.gain, 0.55, 4);
            this.startMusic();
        }
    }

    private ramp(p: AudioParam, to: number, seconds: number) {
        const t = this.ctx!.currentTime;
        p.cancelScheduledValues(t);
        p.setValueAtTime(p.value, t);
        p.linearRampToValueAtTime(to, t + seconds);
    }

    // --- Music ------------------------------------------------------------

    private startMusic() {
        if (!this.ctx || this.musicTimer) return;
        this.nextChordAt = this.ctx.currentTime + 0.1;
        // Schedule a little ahead on a coarse timer; Web Audio keeps the beat.
        this.musicTimer = window.setInterval(() => this.scheduleMusic(), 250);
        this.scheduleMusic();
    }

    private scheduleMusic() {
        const ctx = this.ctx!;
        if (!this.musicOn) {
            clearInterval(this.musicTimer);
            this.musicTimer = 0;
            return;
        }
        while (this.nextChordAt < ctx.currentTime + 1) {
            const at = this.nextChordAt;
            const chord = PROGRESSION[this.chord % PROGRESSION.length];
            this.padChord(chord.pad, at, CHORD_SECONDS);
            this.bassNote(chord.bass, at, CHORD_SECONDS);
            this.arpeggio(chord.pad, at, CHORD_SECONDS);
            this.chord++;
            this.nextChordAt += CHORD_SECONDS;
        }
    }

    private padChord(notes: number[], at: number, len: number) {
        const ctx = this.ctx!;
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.Q.value = 0.7;
        // The filter breathes open and closed over the chord.
        filter.frequency.setValueAtTime(420, at);
        filter.frequency.linearRampToValueAtTime(1100 + Math.random() * 500, at + len * 0.5);
        filter.frequency.linearRampToValueAtTime(500, at + len + 3);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, at);
        env.gain.linearRampToValueAtTime(0.055, at + 3);
        env.gain.setValueAtTime(0.055, at + len - 1);
        env.gain.linearRampToValueAtTime(0, at + len + 3.5);
        filter.connect(env);
        env.connect(this.musicBus);
        env.connect(this.reverb);
        for (const n of notes) {
            for (const detune of [-7, 7]) {
                const o = ctx.createOscillator();
                o.type = "sawtooth";
                o.frequency.value = hz(n);
                o.detune.value = detune + (Math.random() - 0.5) * 4;
                o.connect(filter);
                o.start(at);
                o.stop(at + len + 4);
            }
        }
    }

    private bassNote(n: number, at: number, len: number) {
        const ctx = this.ctx!;
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = hz(n);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, at);
        env.gain.linearRampToValueAtTime(0.12, at + 1.5);
        env.gain.setValueAtTime(0.12, at + len - 1.5);
        env.gain.linearRampToValueAtTime(0, at + len + 1);
        o.connect(env).connect(this.musicBus);
        o.start(at);
        o.stop(at + len + 1.2);
    }

    /** A few soft plucks per chord, never on a fixed grid. */
    private arpeggio(notes: number[], at: number, len: number) {
        const ctx = this.ctx!;
        const count = 3 + Math.floor(Math.random() * 4);
        for (let i = 0; i < count; i++) {
            const t = at + 1 + Math.random() * (len - 2);
            const n = notes[Math.floor(Math.random() * notes.length)] + (Math.random() < 0.4 ? 12 : 0);
            const o = ctx.createOscillator();
            o.type = "triangle";
            o.frequency.value = hz(n);
            const env = ctx.createGain();
            env.gain.setValueAtTime(0, t);
            env.gain.linearRampToValueAtTime(0.035, t + 0.01);
            env.gain.exponentialRampToValueAtTime(0.0005, t + 1.8);
            o.connect(env);
            env.connect(this.musicBus);
            env.connect(this.echo);
            o.start(t);
            o.stop(t + 2);
        }
    }

    // --- Effects -----------------------------------------------------------

    play(name: Sfx, opts: { delay?: number; pitch?: number; volume?: number } = {}) {
        if (!this.ctx || !this.sfxOn) return;
        const t = this.ctx.currentTime + (opts.delay ?? 0);
        const v = opts.volume ?? 1;
        const p = opts.pitch ?? 0;
        switch (name) {
            case "tick":
                this.tone(t, { f: 1900, type: "sine", gain: 0.04 * v, decay: 0.04 });
                break;
            case "dice":
                for (let i = 0; i < 7; i++) {
                    const at = t + i * 0.055 + Math.random() * 0.03;
                    this.burst(at, { f: 1800 + Math.random() * 1600, q: 6, gain: 0.22 * v * (1 - i * 0.08), decay: 0.035 });
                }
                this.tone(t + 0.45, { f: 160, to: 90, type: "sine", gain: 0.25 * v, decay: 0.12 });
                break;
            case "conduit":
                this.burst(t, { f: 900, q: 3, gain: 0.25 * v, decay: 0.08 });
                this.tone(t, { f: 330, to: 300, type: "triangle", gain: 0.12 * v, decay: 0.25, reverb: 0.3 });
                break;
            case "colony":
                this.tone(t, { f: 130, to: 65, type: "sine", gain: 0.35 * v, decay: 0.3 });
                this.tone(t + 0.08, { f: hz(76 + p), type: "triangle", gain: 0.1 * v, decay: 0.5, reverb: 0.5 });
                this.tone(t + 0.18, { f: hz(81 + p), type: "triangle", gain: 0.1 * v, decay: 0.7, reverb: 0.5 });
                break;
            case "tower":
                this.tone(t, { f: 110, to: 55, type: "sine", gain: 0.4 * v, decay: 0.45 });
                [74, 78, 81, 86].forEach((n, i) => this.tone(t + 0.1 + i * 0.09, { f: hz(n + p), type: "triangle", gain: 0.09 * v, decay: 0.9, reverb: 0.6 }));
                break;
            case "materialize":
                this.tone(t, { f: 900, to: 2400, type: "sine", gain: 0.03 * v, decay: 0.9, attack: 0.25, reverb: 0.7, tremolo: 18 });
                break;
            case "produce": {
                // A small bell, pitched per resource.
                const n = 84 + p;
                this.tone(t, { f: hz(n), type: "sine", gain: 0.07 * v, decay: 1.1, reverb: 0.5 });
                this.tone(t, { f: hz(n) * 2.76, type: "sine", gain: 0.02 * v, decay: 0.5 });
                break;
            }
            case "turn":
                this.tone(t, { f: hz(74), type: "sine", gain: 0.09 * v, decay: 0.9, reverb: 0.5 });
                this.tone(t + 0.14, { f: hz(81), type: "sine", gain: 0.09 * v, decay: 1.2, reverb: 0.5 });
                break;
            case "seven":
                this.tone(t, { f: 70, to: 52, type: "sawtooth", gain: 0.12 * v, decay: 1.2, filter: 400, attack: 0.08 });
                this.burst(t, { f: 500, q: 0.8, gain: 0.12 * v, decay: 0.9, attack: 0.3 });
                break;
            case "drone":
                this.burst(t, { f: 700, to: 1800, q: 2, gain: 0.26 * v, decay: 1.2, attack: 0.4 });
                this.tone(t, { f: 180, to: 240, type: "sawtooth", gain: 0.07 * v, decay: 1.3, filter: 1100, tremolo: 40 });
                break;
            case "steal":
                this.tone(t, { f: hz(79), to: hz(67), type: "triangle", gain: 0.09 * v, decay: 0.25 });
                break;
            case "trade":
                this.tone(t, { f: hz(79), type: "sine", gain: 0.07 * v, decay: 0.25 });
                this.tone(t + 0.09, { f: hz(86), type: "sine", gain: 0.07 * v, decay: 0.4, reverb: 0.3 });
                break;
            case "tech":
                [86, 91, 93, 98].forEach((n, i) => this.tone(t + i * 0.05, { f: hz(n), type: "sine", gain: 0.04 * v, decay: 0.6, reverb: 0.6 }));
                break;
            case "orbital":
                this.tone(t, { f: 55, type: "sine", gain: 0.25 * v, decay: 3, attack: 1.4 });
                this.burst(t, { f: 300, to: 1200, q: 1, gain: 0.08 * v, decay: 2.6, attack: 1.6 });
                this.tone(t + 1.2, { f: hz(69), type: "triangle", gain: 0.06 * v, decay: 2.5, reverb: 0.8 });
                break;
            case "win":
                [62, 66, 69, 74, 78, 81].forEach((n, i) => this.tone(t + i * 0.12, { f: hz(n), type: "triangle", gain: 0.08 * v, decay: 2.2, reverb: 0.7 }));
                this.tone(t, { f: hz(38), type: "sine", gain: 0.2 * v, decay: 3, attack: 0.3 });
                break;
            case "lose":
                [69, 65, 62].forEach((n, i) => this.tone(t + i * 0.22, { f: hz(n), type: "triangle", gain: 0.07 * v, decay: 1.6, reverb: 0.7 }));
                break;
            case "error":
                this.tone(t, { f: 180, type: "square", gain: 0.05 * v, decay: 0.08, filter: 900 });
                this.tone(t + 0.1, { f: 150, type: "square", gain: 0.05 * v, decay: 0.1, filter: 900 });
                break;
            case "terraform":
                this.burst(t, { f: 160, q: 0.7, gain: 0.25 * v, decay: 2.4, attack: 0.6 });
                this.tone(t, { f: 45, type: "sine", gain: 0.25 * v, decay: 2.5, attack: 0.8 });
                break;
        }
    }

    private tone(
        t: number,
        o: { f: number; to?: number; type: OscillatorType; gain: number; decay: number; attack?: number; reverb?: number; filter?: number; tremolo?: number },
    ) {
        const ctx = this.ctx!;
        const osc = ctx.createOscillator();
        osc.type = o.type;
        osc.frequency.setValueAtTime(o.f, t);
        if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.decay);
        const env = ctx.createGain();
        const attack = o.attack ?? 0.005;
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(o.gain, t + attack);
        env.gain.exponentialRampToValueAtTime(0.0001, t + attack + o.decay);
        let node: AudioNode = osc;
        if (o.filter) {
            const f = ctx.createBiquadFilter();
            f.type = "lowpass";
            f.frequency.value = o.filter;
            node = node.connect(f);
        }
        if (o.tremolo) {
            const trem = ctx.createGain();
            const lfo = ctx.createOscillator();
            const depth = ctx.createGain();
            lfo.frequency.value = o.tremolo;
            depth.gain.value = 0.5;
            trem.gain.value = 0.5;
            lfo.connect(depth).connect(trem.gain);
            lfo.start(t);
            lfo.stop(t + attack + o.decay + 0.1);
            node = node.connect(trem);
        }
        node.connect(env);
        env.connect(this.sfxBus);
        if (o.reverb) {
            const send = ctx.createGain();
            send.gain.value = o.reverb;
            env.connect(send).connect(this.reverb);
        }
        osc.start(t);
        osc.stop(t + attack + o.decay + 0.05);
    }

    private burst(t: number, o: { f: number; to?: number; q: number; gain: number; decay: number; attack?: number }) {
        const ctx = this.ctx!;
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.Q.value = o.q;
        filter.frequency.setValueAtTime(o.f, t);
        if (o.to) filter.frequency.exponentialRampToValueAtTime(o.to, t + (o.attack ?? 0) + o.decay);
        const env = ctx.createGain();
        const attack = o.attack ?? 0.003;
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(o.gain, t + attack);
        env.gain.exponentialRampToValueAtTime(0.0001, t + attack + o.decay);
        src.connect(filter).connect(env).connect(this.sfxBus);
        src.start(t, Math.random() * 1.5);
        src.stop(t + attack + o.decay + 0.05);
    }
}

/** A stereo reverb tail: decaying noise. */
function impulse(ctx: AudioContext, seconds: number, decay: number) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
    }
    return buf;
}

/** Pitch offset (semitones) of each resource's production bell. */
export const RESOURCE_PITCH = { energy: 0, metal: -5, silicon: 7, biomass: 3, water: 10 } as const;
