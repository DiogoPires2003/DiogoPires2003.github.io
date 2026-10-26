// Builds public/cellmates/cases.json: generates candidates for every tier,
// keeps ten per tier in rising difficulty, casts the story and writes the text.
//   node tools/cellmates/build.mjs [seed]
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generate, SPECS, mulberry32, shuffle } from './generator.mjs';
import { validateCase, logicalSolve } from './engine.mjs';
import { TIERS, CAST, PASSENGERS, ROLES, FIXED, CASES, OUTROS } from './story.mjs';
import { clueText } from './text.mjs';

const OUT = fileURLToPath(new URL('../../public/cellmates/cases.json', import.meta.url));
const SEED = Number(process.argv[2] || 1930);
const CANDIDATES = 4; // candidates generated per level kept

// Levels grouped by grid size and room count. Groups play in order; within a
// group, levels rise in difficulty score.
const GROUPS = {
  rookie: [{ levels: 5, size: 4, rooms: 3 }, { levels: 5, size: 5, rooms: 4 }],
  sergeant: [{ levels: 10, size: 6, rooms: [4, 5] }],
  detective: [{ levels: 10, size: 7, rooms: [5, 6] }],
  inspector: [{ levels: 10, size: 8, rooms: [6, 7], from: 0.3 }],
  mastermind: [{ levels: 10, size: 9, rooms: [7, 8, 9], from: 0.5 }],
};

// Order of predicates within one clue: where first, then what, then the rest.
const RANK = ['inRoom', 'onObject', 'nextTo', 'sameRoom', 'inRow', 'inCol', 'leftOf', 'above',
  'notInRoom', 'notNextTo', 'notInRow', 'notInCol'];

export const initialOf = (name) => (name === 'Yusuf Bey' ? 'Y' : name.split(' ').pop()[0]);

function generateTier(rng, tier) {
  const spec = SPECS[tier.id];
  const picked = [];
  for (const g of GROUPS[tier.id]) {
    const want = g.levels * CANDIDATES;
    const found = [];
    let tries = 0;
    while (found.length < want) {
      if (++tries > want * 60) throw new Error('too many failed attempts for ' + tier.id);
      const rooms = Array.isArray(g.rooms) ? g.rooms[found.length % g.rooms.length] : g.rooms;
      const c = generate(rng, { size: g.size, roomCount: rooms, roomList: tier.rooms, spec });
      if (c) found.push(c);
    }
    found.sort((a, b) => a.grade.score - b.grade.score || a.clueCount - b.clueCount);
    // Spread picks across the difficulty range (or its upper part, for the late
    // tiers); the last level of the group is the hardest found.
    const lo = Math.round((g.from || 0) * (found.length - 1)), span = found.length - 1 - lo;
    for (let k = 0; k < g.levels; k++) picked.push(found[lo + Math.round((k * span) / (g.levels - 1))]);
    process.stdout.write(`${tier.id}: ${found.length} candidates in ${tries} attempts\n`);
  }
  return picked;
}

// Decides who appears in each case: the victim, the murderer, and witnesses
// drawn from the recurring cast. People fated to kill or die soon are seated
// a case or two earlier, so the culprit is never a stranger.
function castStory(rng, puzzles) {
  const passengers = shuffle(rng, PASSENGERS);
  const role = {};
  CAST.forEach((c) => { role[c.name] = c.role; });
  passengers.forEach((p, i) => { role[p] = ROLES[i % ROLES.length]; });
  const fate = puzzles.map(() => ({}));
  let next = 0;
  for (let L = 1; L <= puzzles.length; L++) {
    const f = fate[L - 1];
    f.victim = (FIXED[L] && FIXED[L].victim) || passengers[next++];
    if (FIXED[L] && FIXED[L].murderer) f.murderer = FIXED[L].murderer;
    else {
      let j = next;
      while (initialOf(passengers[j]) === initialOf(f.victim)) j++;
      [passengers[next], passengers[j]] = [passengers[j], passengers[next]];
      f.murderer = passengers[next++];
    }
  }
  const gone = new Set();
  return puzzles.map((p, idx) => {
    const L = idx + 1;
    const { victim, murderer } = fate[idx];
    const people = [victim, murderer];
    const taken = new Set(people.map(initialOf));
    const soon = [];
    for (let d = 1; d <= 2 && idx + d < fate.length; d++) soon.push(fate[idx + d].murderer, fate[idx + d].victim);
    const aboard = shuffle(rng, CAST.filter((c) => c.from <= L).map((c) => c.name));
    // At most half the witnesses are foreshadowed; the rest come from the recurring cast.
    let foreshadowed = 0;
    const cap = Math.max(1, Math.floor((p.size - 2) / 2));
    for (const name of [...soon, ...aboard]) {
      if (people.length === p.size) break;
      const isSoon = soon.includes(name) && !CAST.some((c) => c.name === name);
      if (isSoon && foreshadowed >= cap) continue;
      if (gone.has(name) || people.includes(name) || taken.has(initialOf(name))) continue;
      const core = CAST.find((c) => c.name === name);
      if (core && core.from > L) continue;
      people.push(name);
      taken.add(initialOf(name));
      if (isSoon) foreshadowed++;
    }
    if (people.length !== p.size) throw new Error('not enough distinct initials for level ' + L);
    gone.add(victim);
    gone.add(murderer);
    return { people, victim, murderer, role };
  });
}

function assemble(p, cast, L, tier) {
  const story = CASES[L - 1];
  // Map temporary ids to people: victim and murderer are fixed, the rest shuffled.
  const ids = p.characters.map((c) => c.initial);
  const others = ids.filter((id) => id !== p.victim && id !== p.murderer);
  const nameOf = { [p.victim]: cast.victim, [p.murderer]: cast.murderer };
  others.forEach((id, k) => { nameOf[id] = cast.people[2 + k]; });
  const ini = (id) => initialOf(nameOf[id]);
  const remap = (con) => (con.person ? { ...con, person: ini(con.person) } : con);
  const characters = p.characters
    .map((ch) => {
      const c = { initial: ini(ch.initial), name: nameOf[ch.initial], role: cast.role[nameOf[ch.initial]] };
      if (ch.initial === p.victim) c.victim = true;
      c.constraints = ch.constraints.map(remap).sort((a, b) => RANK.indexOf(a.type) - RANK.indexOf(b.type));
      return c;
    })
    .sort((a, b) => (a.initial < b.initial ? -1 : 1));
  const byInitial = Object.fromEntries(characters.map((c) => [c.initial, c.name]));
  for (const c of characters) c.clue = clueText(c, p.roomNames, (i) => byInitial[i]);
  const fill = (s) => s.replaceAll('{victim}', cast.victim).replaceAll('{murderer}', cast.murderer);
  return {
    id: 'case-' + String(L).padStart(2, '0'),
    level: L,
    tier: tier.id,
    title: story.title,
    intro: fill(story.intro),
    outro: fill(story.outro || OUTROS[(L - 1) % OUTROS.length]),
    finale: !!story.outro,
    ...(story.tutorial ? { tutorial: story.tutorial } : {}),
    size: p.size,
    rooms: p.rooms,
    roomNames: p.roomNames,
    objects: p.objects,
    characters: characters.map(({ initial, name, role, victim, clue, constraints }) => (
      victim ? { initial, name, role, victim, clue, constraints } : { initial, name, role, clue, constraints })),
    solution: Object.fromEntries(Object.entries(p.solution).map(([id, rc]) => [ini(id), rc]).sort()),
    murderer: ini(p.murderer),
    difficulty: { score: p.grade.score, technique: p.grade.maxUsed },
  };
}

function main() {
  const rng = mulberry32(SEED);
  const puzzles = [];
  for (const tier of TIERS) puzzles.push(...generateTier(rng, tier));
  const casts = castStory(rng, puzzles);
  const cases = puzzles.map((p, i) => assemble(p, casts[i], i + 1, TIERS.find((t) => i + 1 <= t.levels[1])));
  for (const c of cases) {
    const errs = validateCase(c);
    if (!logicalSolve(c, SPECS[c.tier].maxLevel).solved) errs.push('not solvable with tier techniques');
    if (errs.length) throw new Error(c.id + ': ' + errs.join('; '));
  }
  const data = {
    title: 'Cellmates: The Midnight Express',
    seed: SEED,
    tiers: TIERS.map(({ id, name, leg, levels }) => ({ id, name, leg, levels })),
    cases,
  };
  writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');
  for (const c of cases) console.log(c.id, c.size + 'x' + c.size, 'score', c.difficulty.score, 'technique', c.difficulty.technique, c.title);
}

main();
