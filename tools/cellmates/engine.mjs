// Cellmates puzzle engine: board model, constraint checks, a backtracking
// solution counter and a human-style logical solver that grades difficulty.
// Shared by the generator and the test that validates public/cellmates/cases.json.

// People can stand on these...
export const OCCUPIABLE = ['seat', 'bunk', 'rug', 'window', 'lamp', 'suitcase'];
// ...but never on these.
export const BLOCKING = ['table', 'piano', 'stove', 'trunk', 'mailsack', 'crate', 'coal', 'basin', 'desk', 'firebox'];


export function buildBoard(p) {
  const n = p.size;
  const room = new Array(n * n);
  const obj = new Array(n * n).fill(null);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) room[r * n + c] = p.rooms[r][c];
  for (const o of p.objects) obj[o.row * n + o.col] = o.type;
  const blocked = obj.map((t) => t !== null && BLOCKING.includes(t));
  // For each cell, the set of object types on orthogonal neighbours.
  const beside = [];
  for (let i = 0; i < n * n; i++) {
    const r = Math.floor(i / n), c = i % n, s = new Set();
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n && obj[rr * n + cc]) s.add(obj[rr * n + cc]);
    }
    beside.push(s);
  }
  return { n, room, obj, blocked, beside };
}

export const isBinary = (con) => con.person !== undefined;

// Unary constraint test for a single cell.
export function unaryOk(B, con, i) {
  const n = B.n, r = Math.floor(i / n), c = i % n;
  switch (con.type) {
    case 'inRoom': return B.room[i] === con.room;
    case 'notInRoom': return B.room[i] !== con.room;
    case 'onObject': return B.obj[i] === con.object;
    case 'nextTo': return B.beside[i].has(con.object);
    case 'notNextTo': return !B.beside[i].has(con.object);
    case 'inRow': return r === con.row;
    case 'inCol': return c === con.col;
    case 'notInRow': return r !== con.row;
    case 'notInCol': return c !== con.col;
  }
  throw new Error('Unknown unary constraint ' + con.type);
}

// Binary constraint test: owner at a, referenced person at b.
export function binaryOk(B, con, a, b) {
  const n = B.n;
  const ra = Math.floor(a / n), ca = a % n, rb = Math.floor(b / n), cb = b % n;
  const touching = Math.max(Math.abs(ra - rb), Math.abs(ca - cb)) === 1;
  switch (con.type) {
    case 'nextTo': return touching;
    case 'notNextTo': return !touching;
    case 'sameRoom': return B.room[a] === B.room[b];
    case 'leftOf': return ca < cb;
    case 'above': return ra < rb;
  }
  throw new Error('Unknown binary constraint ' + con.type);
}

function setup(p) {
  const B = buildBoard(p);
  const n = B.n;
  const ids = {};
  p.characters.forEach((ch, k) => { ids[ch.initial] = k; });
  const cand = p.characters.map((ch) => {
    const s = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) {
      if (B.blocked[i]) continue;
      if (ch.constraints.every((con) => isBinary(con) || unaryOk(B, con, i))) s[i] = 1;
    }
    return s;
  });
  const bins = [];
  p.characters.forEach((ch, k) => {
    for (const con of ch.constraints) {
      if (!isBinary(con)) continue;
      if (ids[con.person] === undefined) throw new Error('Unknown person ' + con.person);
      bins.push({ a: k, b: ids[con.person], con });
    }
  });
  return { B, n, cand, bins };
}

// Counts solutions (up to `limit`) by backtracking.
export function countSolutions(p, limit = 2) {
  const { B, n, cand, bins } = setup(p);
  const m = cand.length;
  const order = [...Array(m).keys()].sort((x, y) => sum(cand[x]) - sum(cand[y]));
  const pos = new Array(m).fill(-1);
  const rowUsed = new Uint8Array(n), colUsed = new Uint8Array(n);
  let count = 0;
  const first = [];
  function ok(k, i) {
    for (const { a, b, con } of bins) {
      if (a === k && pos[b] >= 0 && !binaryOk(B, con, i, pos[b])) return false;
      if (b === k && pos[a] >= 0 && !binaryOk(B, con, pos[a], i)) return false;
    }
    return true;
  }
  (function go(d) {
    if (count >= limit) return;
    if (d === m) { count++; if (!first.length) first.push(pos.slice()); return; }
    const k = order[d];
    for (let i = 0; i < n * n; i++) {
      if (!cand[k][i]) continue;
      const r = Math.floor(i / n), c = i % n;
      if (rowUsed[r] || colUsed[c] || !ok(k, i)) continue;
      pos[k] = i; rowUsed[r] = 1; colUsed[c] = 1;
      go(d + 1);
      pos[k] = -1; rowUsed[r] = 0; colUsed[c] = 0;
      if (count >= limit) return;
    }
  })(0);
  return { count, first: first[0] };
}

function sum(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }

// Technique weights for the difficulty score.
//  1 naked single: someone has one possible cell left
//  2 direct links: someone pinned to one row/column blocks it for others; clues between two people
//  3 hidden single: a row/column only one person can still reach
//  4 subsets: k people share exactly k rows/columns
//  5 hypothesis: try a cell and reach a contradiction
export const WEIGHTS = [0, 1, 2, 5, 12, 30];

// Human-style solver limited to techniques up to `maxLevel`.
export function logicalSolve(p, maxLevel = 5) {
  const S = setup(p);
  const steps = [0, 0, 0, 0, 0, 0];
  const res = propagate(S, S.cand, maxLevel, steps);
  const score = steps.reduce((acc, s, l) => acc + s * WEIGHTS[l], 0);
  let maxUsed = 0;
  steps.forEach((s, l) => { if (s) maxUsed = l; });
  return { solved: res === 'solved', contradiction: res === 'contradiction', steps, score, maxUsed };
}

function rowsOf(n, s) { const m = new Uint8Array(n); for (let i = 0; i < s.length; i++) if (s[i]) m[Math.floor(i / n)] = 1; return m; }
function colsOf(n, s) { const m = new Uint8Array(n); for (let i = 0; i < s.length; i++) if (s[i]) m[i % n] = 1; return m; }

function propagate(S, cand, maxLevel, steps) {
  const { B, n, bins } = S;
  const m = cand.length;
  const lineOf = [(i) => Math.floor(i / n), (i) => i % n];
  const done = new Uint8Array(m);

  // Removes cells matching `pred` from person k; returns true if anything changed.
  function prune(k, pred) {
    let ch = false;
    for (let i = 0; i < n * n; i++) if (cand[k][i] && pred(i)) { cand[k][i] = 0; ch = true; }
    return ch;
  }

  for (;;) {
    for (let k = 0; k < m; k++) if (!sum(cand[k])) return 'contradiction';
    if (done.every((d) => d)) return 'solved';

    // Level 1: naked single.
    let progress = false;
    for (let k = 0; k < m && !progress; k++) {
      if (done[k] || sum(cand[k]) !== 1) continue;
      const i = cand[k].indexOf(1);
      done[k] = 1;
      for (let o = 0; o < m; o++) if (o !== k) prune(o, (j) => lineOf[0](j) === lineOf[0](i) || lineOf[1](j) === lineOf[1](i));
      steps[1]++;
      progress = true;
    }
    if (progress) continue;
    if (maxLevel < 2) return 'stuck';

    // Level 2a: someone confined to a single row or column keeps everyone else out of it.
    for (let k = 0; k < m && !progress; k++) {
      if (done[k]) continue;
      for (let d = 0; d < 2 && !progress; d++) {
        const lines = d === 0 ? rowsOf(n, cand[k]) : colsOf(n, cand[k]);
        if (sum(lines) !== 1) continue;
        const L = lines.indexOf(1);
        let ch = false;
        for (let o = 0; o < m; o++) if (o !== k && prune(o, (j) => lineOf[d](j) === L)) ch = true;
        if (ch) { steps[2]++; progress = true; }
      }
    }
    if (progress) continue;

    // Level 2b: clues linking two people (arc consistency).
    for (const { a, b, con } of bins) {
      if (progress) break;
      const supported = (x, other, xIsOwner) => {
        for (let y = 0; y < n * n; y++) {
          if (!cand[other][y]) continue;
          if (lineOf[0](x) === lineOf[0](y) || lineOf[1](x) === lineOf[1](y)) continue;
          if (xIsOwner ? binaryOk(B, con, x, y) : binaryOk(B, con, y, x)) return true;
        }
        return false;
      };
      let ch = prune(a, (x) => !supported(x, b, true));
      if (prune(b, (y) => !supported(y, a, false))) ch = true;
      if (ch) { steps[2]++; progress = true; }
    }
    if (progress) continue;
    if (maxLevel < 3) return 'stuck';

    // Level 3: hidden single — a row/column that only one person can still reach.
    for (let d = 0; d < 2 && !progress; d++) {
      for (let L = 0; L < n && !progress; L++) {
        const who = [];
        for (let k = 0; k < m; k++) {
          for (let i = 0; i < n * n; i++) if (cand[k][i] && lineOf[d](i) === L) { who.push(k); break; }
        }
        if (!who.length) return 'contradiction';
        if (who.length === 1 && prune(who[0], (i) => lineOf[d](i) !== L)) { steps[3]++; progress = true; }
      }
    }
    if (progress) continue;
    if (maxLevel < 4) return 'stuck';

    // Level 4: naked subsets — 2 or 3 unsettled people whose options span exactly that many rows/columns.
    const open = [...Array(m).keys()].filter((k) => !done[k]);
    outer: for (let size = 2; size <= Math.min(3, open.length - 2); size++) {
      for (const group of combos(open, size)) {
        for (let d = 0; d < 2; d++) {
          const lines = new Uint8Array(n);
          for (const k of group) { const ls = d === 0 ? rowsOf(n, cand[k]) : colsOf(n, cand[k]); for (let L = 0; L < n; L++) if (ls[L]) lines[L] = 1; }
          if (sum(lines) !== size) continue;
          let ch = false;
          for (const o of open) if (!group.includes(o) && prune(o, (i) => lines[lineOf[d](i)])) ch = true;
          if (ch) { steps[4]++; progress = true; break outer; }
        }
      }
    }
    if (progress) continue;
    if (maxLevel < 5) return 'stuck';

    // Level 5: hypothesis — place someone and see whether levels 1–4 collapse.
    for (let k = 0; k < m && !progress; k++) {
      if (done[k]) continue;
      for (let i = 0; i < n * n && !progress; i++) {
        if (!cand[k][i]) continue;
        const copy = cand.map((s) => s.slice());
        copy[k].fill(0); copy[k][i] = 1;
        if (propagate(S, copy, 4, [0, 0, 0, 0, 0, 0]) === 'contradiction') {
          cand[k][i] = 0; steps[5]++; progress = true;
        }
      }
    }
    if (!progress) return 'stuck';
  }
}

function* combos(arr, k, start = 0, acc = []) {
  if (acc.length === k) { yield acc.slice(); return; }
  for (let i = start; i < arr.length; i++) { acc.push(arr[i]); yield* combos(arr, k, i + 1, acc); acc.pop(); }
}

// People sharing each room in a full placement.
export function roomCounts(p, placement) {
  const B = buildBoard(p);
  const counts = {};
  for (const ch of p.characters) {
    const [r, c] = placement[ch.initial];
    const room = B.room[r * B.n + c];
    (counts[room] = counts[room] || []).push(ch.initial);
  }
  return counts;
}

// Full validation of a finished case. Returns a list of problems (empty = valid).
export function validateCase(p) {
  const errs = [];
  const n = p.size;
  const B = buildBoard(p);
  if (p.characters.length !== n) errs.push('character count must equal size');
  const initials = p.characters.map((c) => c.initial);
  if (new Set(initials).size !== initials.length) errs.push('duplicate initials');
  if (initials.includes('X')) errs.push('initial X is reserved for marks');
  const sol = p.solution;
  const rows = new Set(), cols = new Set();
  for (const ch of p.characters) {
    const [r, c] = sol[ch.initial];
    rows.add(r); cols.add(c);
    if (B.blocked[r * n + c]) errs.push(ch.initial + ' stands on a blocking object');
    for (const con of ch.constraints) {
      const ok = isBinary(con)
        ? binaryOk(B, con, r * n + c, sol[con.person][0] * n + sol[con.person][1])
        : unaryOk(B, con, r * n + c);
      if (!ok) errs.push(ch.initial + ' violates ' + JSON.stringify(con));
    }
  }
  if (rows.size !== n || cols.size !== n) errs.push('solution is not one per row and column');
  const { count } = countSolutions(p, 2);
  if (count !== 1) errs.push('expected a unique solution, found ' + count);
  const victim = p.characters.filter((c) => c.victim);
  if (victim.length !== 1) errs.push('need exactly one victim');
  else {
    const [vr, vc] = sol[victim[0].initial];
    const together = roomCounts(p, sol)[B.room[vr * n + vc]];
    if (together.length !== 2 || !together.includes(p.murderer)) errs.push('murderer must be alone with the victim');
  }
  return errs;
}
