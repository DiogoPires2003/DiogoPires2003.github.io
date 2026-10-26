// Checks the published cases: every puzzle has one solution, the murderer is
// the only person alone with the victim, the clue text says exactly what the
// constraints say, and the page script stays ES5 for the Kindle browser.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { validateCase, logicalSolve } from './engine.mjs';
import { SPECS } from './generator.mjs';
import { clueText } from './text.mjs';

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

describe('cellmates page', () => {
  it('only uses ES5 in its scripts', () => {
    const html = readFileSync(new URL('index.html', root), 'utf8');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) expect(() => parse(s, { ecmaVersion: 5 })).not.toThrow();
  });
});
