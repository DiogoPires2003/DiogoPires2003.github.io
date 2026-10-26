// Generates the logic of one case: rooms, objects, a placement, a victim and
// murderer, and a set of formal clues that the logical solver can finish using
// only the techniques allowed for the tier.
import { BLOCKING, buildBoard, countSolutions, logicalSolve, binaryOk } from './engine.mjs';
import { ROOMS } from './story.mjs';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
export function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const BASE = ['inRoom', 'onObject'];
const SERGEANT = ['nextTo', 'notInRoom'];
const DETECTIVE = ['inRow', 'inCol', 'notInRow', 'notInCol', 'notNextTo'];
const INSPECTOR = ['leftOf', 'above', 'sameRoom'];

// Per-tier rules. minLevel: the puzzle must need at least this solver technique.
export const SPECS = {
  rookie: { types: BASE, newTypes: null, minLevel: 0, maxLevel: 2, prune: 0.5 },
  sergeant: { types: [...BASE, ...SERGEANT], newTypes: SERGEANT, minLevel: 0, maxLevel: 2, prune: 0.85 },
  detective: { types: [...BASE, ...SERGEANT, ...DETECTIVE], newTypes: DETECTIVE, minLevel: 3, maxLevel: 3, prune: 1 },
  inspector: { types: [...BASE, ...SERGEANT, ...DETECTIVE, ...INSPECTOR], newTypes: INSPECTOR, minLevel: 3, maxLevel: 4, prune: 1 },
  mastermind: { types: [...BASE, ...SERGEANT, ...DETECTIVE, ...INSPECTOR], newTypes: null, minLevel: 4, maxLevel: 4, prune: 1 },
};

// Grows `count` connected rooms from random seeds. Horizontal growth is
// favoured so rooms come out long and narrow, like railway cars.
function makeRooms(rng, n, count) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const grid = new Array(n * n).fill(-1);
    const cells = Array.from({ length: count }, () => []);
    for (const [k, i] of shuffle(rng, [...Array(n * n).keys()]).slice(0, count).entries()) { grid[i] = k; cells[k].push(i); }
    let left = n * n - count;
    while (left > 0) {
      // Smaller rooms grow first, so sizes stay balanced.
      const k = cells.map((c, idx) => [c.length + rng() * 3, idx]).sort((a, b) => a[0] - b[0])[0][1];
      const options = [];
      for (const i of cells[k]) {
        const r = Math.floor(i / n), c = i % n;
        for (const [dr, dc, w] of [[0, 1, 3], [0, -1, 3], [1, 0, 1], [-1, 0, 1]]) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && rr < n && cc >= 0 && cc < n && grid[rr * n + cc] === -1) for (let t = 0; t < w; t++) options.push(rr * n + cc);
        }
      }
      if (!options.length) {
        // This room is boxed in; let any room with a free neighbour grow instead.
        const any = [];
        cells.forEach((cs, idx) => cs.forEach((i) => {
          const r = Math.floor(i / n), c = i % n;
          for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            const rr = r + dr, cc = c + dc;
            if (rr >= 0 && rr < n && cc >= 0 && cc < n && grid[rr * n + cc] === -1) any.push([idx, rr * n + cc]);
          }
        }));
        const [idx, cell] = pick(rng, any);
        grid[cell] = idx; cells[idx].push(cell); left--;
        continue;
      }
      const cell = pick(rng, options);
      grid[cell] = k; cells[k].push(cell); left--;
    }
    const sizes = cells.map((c) => c.length);
    if (Math.min(...sizes) >= 2 && Math.max(...sizes) <= Math.ceil((2.2 * n * n) / count)) return grid;
  }
  throw new Error('could not lay out rooms');
}

function makeObjects(rng, n, grid, names) {
  const objects = new Array(n * n).fill(null);
  const standTotal = Math.round(n * 1.6), blockTotal = Math.round(n * 0.7);
  const place = (kind) => {
    for (let tries = 0; tries < 100; tries++) {
      const i = Math.floor(rng() * n * n);
      const list = ROOMS[names[grid[i]]][kind];
      if (objects[i] || !list.length) continue;
      objects[i] = pick(rng, list);
      return;
    }
  };
  for (let k = 0; k < blockTotal; k++) place('block');
  for (let k = 0; k < standTotal; k++) place('stand');
  return objects;
}

// A random one-per-row-and-column placement with exactly one room holding two
// people (victim and murderer). Prefers placements with people on objects.
function makePlacement(rng, n, grid, objects) {
  let best = null, bestScore = -1;
  for (let t = 0; t < 400; t++) {
    const perm = shuffle(rng, [...Array(n).keys()]);
    const cells = perm.map((c, r) => r * n + c);
    if (cells.some((i) => objects[i] && BLOCKING.includes(objects[i]))) continue;
    const byRoom = {};
    cells.forEach((i, k) => { (byRoom[grid[i]] = byRoom[grid[i]] || []).push(k); });
    const pairs = Object.values(byRoom).filter((ks) => ks.length === 2);
    if (!pairs.length) continue;
    const onObj = cells.filter((i) => objects[i]).length;
    const score = Math.min(onObj, Math.ceil(n / 2)) + rng();
    if (score > bestScore) { bestScore = score; best = { cells, pairs }; }
  }
  return best;
}

// Every true clue about each person, restricted to the tier's clue types.
function cluePool(p, B, ids, cells, spec, victim, murderer) {
  const n = p.size;
  const pool = [];
  const allowed = new Set(spec.types);
  const presentObjects = [...new Set(p.objects.map((o) => o.type))];
  const add = (k, con) => { if (allowed.has(con.type)) pool.push({ k, con }); };
  ids.forEach((id, k) => {
    const i = cells[k], r = Math.floor(i / n), c = i % n;
    add(k, { type: 'inRoom', room: B.room[i] });
    for (const room of Object.keys(p.roomNames)) if (room !== B.room[i]) add(k, { type: 'notInRoom', room });
    if (B.obj[i] && !BLOCKING.includes(B.obj[i])) add(k, { type: 'onObject', object: B.obj[i] });
    for (const o of presentObjects) add(k, { type: B.beside[i].has(o) ? 'nextTo' : 'notNextTo', object: o });
    add(k, { type: 'inRow', row: r });
    add(k, { type: 'inCol', col: c });
    for (let x = 0; x < n; x++) {
      if (x !== r) add(k, { type: 'notInRow', row: x });
      if (x !== c) add(k, { type: 'notInCol', col: x });
    }
    ids.forEach((other, o) => {
      if (o === k) return;
      const j = cells[o];
      const touching = binaryOk(B, { type: 'nextTo' }, i, j);
      add(k, { type: touching ? 'nextTo' : 'notNextTo', person: other });
      const pair = (k === victim && o === murderer) || (k === murderer && o === victim);
      if (B.room[i] === B.room[j] && !pair) add(k, { type: 'sameRoom', person: other });
      if (c < j % n) add(k, { type: 'leftOf', person: other });
      if (r < Math.floor(j / n)) add(k, { type: 'above', person: other });
    });
  });
  return pool;
}

function weight(con, spec) {
  let w = 1;
  if (spec.newTypes && spec.newTypes.includes(con.type)) w *= 4;
  if (con.type === 'notInRow' || con.type === 'notInCol' || con.type === 'notInRoom') w *= 0.5;
  if (con.type === 'notNextTo') w *= con.person ? 0.3 : 0.6;
  if (con.type === 'inRow' || con.type === 'inCol') w *= 0.6;
  return w;
}

// Weighted random order (Efraimidis–Spirakis).
function weightedOrder(rng, items, w) {
  return items.map((it) => [Math.pow(rng(), 1 / w(it)), it]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
}

// One attempt at a case of the given size. Returns null if it fails the tier's rules.
export function generate(rng, { size: n, roomCount, roomList, spec }) {
  const grid = makeRooms(rng, n, roomCount);
  const letters = 'ABCDEFGHI';
  const names = shuffle(rng, roomList).slice(0, roomCount);
  const objects = makeObjects(rng, n, grid, names);
  const placement = makePlacement(rng, n, grid, objects);
  if (!placement) return null;
  const { cells, pairs } = placement;
  const pair = shuffle(rng, pick(rng, pairs));
  const victim = pair[0], murderer = pair[1];

  // Temporary ids; real initials are assigned when the case is cast.
  const ids = cells.map((_, k) => 'p' + k);
  const p = {
    size: n,
    rooms: Array.from({ length: n }, (_, r) => grid.slice(r * n, r * n + n).map((k) => letters[k]).join('')),
    roomNames: Object.fromEntries(names.map((nm, k) => [letters[k], nm])),
    objects: [],
    characters: ids.map((id) => ({ initial: id, constraints: [] })),
  };
  objects.forEach((t, i) => { if (t) p.objects.push({ row: Math.floor(i / n), col: i % n, type: t }); });
  const B = buildBoard(p);

  const pool = weightedOrder(rng, cluePool(p, B, ids, cells, spec, victim, murderer), (x) => weight(x.con, spec));
  const used = new Set();
  // Everyone starts with one clue so every character has something to say.
  ids.forEach((_, k) => {
    const idx = pool.findIndex((x, j) => x.k === k && !used.has(j));
    used.add(idx);
    p.characters[k].constraints.push(pool[idx].con);
  });
  const solved = () => logicalSolve(p, spec.maxLevel).solved;
  for (let j = 0; j < pool.length && !solved(); j++) {
    if (used.has(j)) continue;
    const { k, con } = pool[j];
    used.add(j);
    p.characters[k].constraints.push(con);
  }
  if (!solved()) return null;

  // Drop clues that are no longer needed, as far as the tier's pruning allows.
  const owned = [];
  p.characters.forEach((ch, k) => ch.constraints.forEach((con) => owned.push([k, con])));
  for (const [k, con] of shuffle(rng, owned)) {
    const list = p.characters[k].constraints;
    if (list.length < 2 || rng() > spec.prune) continue;
    const at = list.indexOf(con);
    list.splice(at, 1);
    if (!solved()) list.splice(at, 0, con);
  }

  if (p.characters.some((ch) => ch.constraints.length > 3)) return null;
  if (spec.minLevel > 1 && logicalSolve(p, spec.minLevel - 1).solved) return null;
  if (spec.newTypes && !p.characters.some((ch) => ch.constraints.some((c) => spec.newTypes.includes(c.type)))) return null;
  if (countSolutions(p, 2).count !== 1) return null;

  const grade = logicalSolve(p, spec.maxLevel);
  const solution = Object.fromEntries(ids.map((id, k) => [id, [Math.floor(cells[k] / n), cells[k] % n]]));
  const clueCount = p.characters.reduce((s, ch) => s + ch.constraints.length, 0);
  return { ...p, solution, victim: ids[victim], murderer: ids[murderer], grade, clueCount };
}

