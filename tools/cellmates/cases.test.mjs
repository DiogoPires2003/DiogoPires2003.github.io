// Checks the published cases: every puzzle has one solution, the murderer is
// the only person alone with the victim, the clue text says exactly what the
// constraints say, and the page script stays ES5 for the Kindle browser.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { validateCase, logicalSolve } from './engine.mjs';
import { SPECS } from './generator.mjs';
import { clueText } from './text.mjs';
import { ROOMS } from './story.mjs';

const root = new URL('../../public/cellmates/', import.meta.url);
const data = JSON.parse(readFileSync(new URL('cases.json', root), 'utf8'));

describe('cellmates cases', () => {
  it('has 50 cases, 10 per tier', () => {
    expect(data.cases).toHaveLength(50);
    for (const tier of data.tiers) expect(data.cases.filter((c) => c.tier === tier.id)).toHaveLength(10);
  });

  for (const c of data.cases) {
    it(`${c.id} is valid and solvable at its tier`, () => {
      expect(validateCase(c)).toEqual([]);
      expect(logicalSolve(c, SPECS[c.tier].maxLevel).solved).toBe(true);
      const nameOf = (i) => c.characters.find((ch) => ch.initial === i).name;
      for (const ch of c.characters) expect(ch.clue).toBe(clueText(ch, c.roomNames, nameOf));
    });
  }
});

describe('cellmates story', () => {
  it('only mentions rooms that are on the board', () => {
    for (const c of data.cases) {
      const onBoard = Object.values(c.roomNames).map((r) => r.toLowerCase());
      for (const room of Object.keys(ROOMS)) {
        if (c.intro.toLowerCase().includes(room.toLowerCase())) expect(onBoard, c.id + ' mentions ' + room).toContain(room.toLowerCase());
      }
    }
  });

  it('never brings back the dead or the arrested, and the culprit is seen first', () => {
    const gone = new Map();
    const seen = new Set();
    for (const c of data.cases) {
      const victim = c.characters.find((ch) => ch.victim).name;
      const murderer = c.characters.find((ch) => ch.initial === c.murderer).name;
      for (const ch of c.characters) expect(gone.has(ch.name), c.id + ': ' + ch.name + ' left in ' + gone.get(ch.name)).toBe(false);
      if (c.level > 2) expect(seen.has(murderer), c.id + ': ' + murderer + ' appears for the first time as the culprit').toBe(true);
      for (const ch of c.characters) seen.add(ch.name);
      gone.set(victim, c.id);
      gone.set(murderer, c.id);
    }
  });

  it('only puts people on things you can sit, lie or stand on', () => {
    for (const c of data.cases) {
      for (const [ini, [r, col]] of Object.entries(c.solution)) {
        const o = c.objects.find((x) => x.row === r && x.col === col);
        if (o) expect(['seat', 'bunk', 'rug', 'bench', 'stool', 'suitcase'], c.id + ' ' + ini).toContain(o.type);
      }
    }
  });

  it('walks the tutorial through every person', () => {
    const c = data.cases[0];
    const steps = c.tutorial.steps.map((s) => s.initial);
    expect([...steps].sort()).toEqual(c.characters.map((ch) => ch.initial).sort());
  });
});

describe('cellmates page', () => {
  it('only uses ES5 in its scripts', () => {
    const html = readFileSync(new URL('index.html', root), 'utf8');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) expect(() => parse(s, { ecmaVersion: 5 })).not.toThrow();
  });
});
