# Cellmates generator

Builds the 50 cases of *Cellmates: The Midnight Express*, the grid murder
puzzle served at `/cellmates/` (from `public/cellmates/`). This folder is
not published: Astro only ships `public/` and `src/pages/`.

```sh
node tools/cellmates/build.mjs [seed]   # rewrites public/cellmates/cases.json (default seed 1930, ~2 min)
npx vitest run tools/cellmates          # validates every published case
```

## How a case is made

The code decides the logic and the text only describes it.

1. **generator.mjs** lays out rooms (long horizontal strips, like railway
   cars), places objects from each room's theme, and picks a placement with one
   person per row and column. The placement must have exactly one room with
   two people: the victim and the murderer.
2. It lists every true clue about every person, limited to the tier's clue
   types, and adds clues until the logical solver can finish the puzzle using
   only the tier's techniques. Then it removes the clues that are no longer
   needed.
3. **engine.mjs** grades the case. The solver works like a person would:
   1. naked single
   2. a row or column taken by someone pinned to it, and clues that link two people
   3. a row or column only one person can reach
   4. pairs and triples of people sharing rows or columns
   5. trial and contradiction (no case uses this)

   A case is rejected if it needs less than the tier's minimum technique. A
   backtracking counter confirms that the solution is unique.
4. **build.mjs** generates four candidates per level, orders them by score,
   casts the story and writes the clue text through **text.mjs**. Each
   constraint has one fixed phrase, so a clue can never say more or less than
   its constraints. The script then validates every case before writing.

| Tier | Levels | Grid | Clue types | Required technique |
|---|---|---|---|---|
| Rookie | 1–10 | 4×4, 5×5 | `inRoom`, `onObject` | ≤ 2 |
| Sergeant | 11–20 | 6×6 | + `nextTo`, `notInRoom` | ≤ 2 |
| Detective | 21–30 | 7×7 | + rows/columns, `notNextTo` | exactly 3 |
| Inspector | 31–40 | 8×8 | + `leftOf`, `above`, `sameRoom` | 3–4 |
| Mastermind | 41–50 | 9×9 | all | 4 |

**story.mjs** holds the theme: rooms and their objects, the recurring cast,
one-off passengers, and the title and intro of every case. Witnesses who will
kill or die in the next case or two appear in earlier cases, so the culprit
is never a stranger. Each chapter finale arrests one of the Nightjar's
accomplices, and case 50 unmasks the Nightjar.

## Case format

The format is the one in the plan, with a few extra fields:

- `role` per character
- `outro`: the text shown once the case is solved
- `finale`: true for chapter finales
- `difficulty`: `{ score, technique }`

Rows and columns are 0-based in the JSON and 1-based in clue text.

Clue semantics:

- *beside* an object means an orthogonally adjacent cell.
- *diagonally next to* a person means the two cells touch at a corner.
- *left of* and *above* mean any column to the left or any row higher up.
