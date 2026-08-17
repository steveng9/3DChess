# Movement rules

**Everything in this document is a placeholder.** The engine is built so that
movement can be redefined without touching move generation, legality, check
detection, the UI or the network layer.

## Where to edit

| What you want to change | File |
|---|---|
| How a piece moves | `js/rules/Pieces.js` |
| The direction vocabulary itself | `js/rules/Geometry.js` |
| Where pieces start | `js/rules/Setup.js` |
| Board size, piece values, rule toggles | `js/rules/Config.js` |

## Coordinates

The board is `x × y × z`, indexed from 0.

| Axis | Meaning | Notes |
|---|---|---|
| `x` | file | shown as letters `a`, `b`, `c`, … |
| `y` | **level** | the new third dimension, shown as `L1`, `L2`, … |
| `z` | rank | White advances `+z`, Black advances `-z` |

A cell is named file + rank + level: `(0,0,0)` is `a1L1`, `(3,2,5)` is `d6L3`.

## The direction families

A cell in 3D has 26 neighbours, and they split into three natural groups. These
are the vocabulary that `Pieces.js` composes:

| Set | Count | Shape | 2D counterpart |
|---|---|---|---|
| `AXIAL` | 6 | one axis changes — `(1,0,0)` | the rook's 4 |
| `FACE_DIAG` | 12 | two axes change — `(1,1,0)` | the bishop's 4 |
| `SPACE_DIAG` | 8 | three axes change — `(1,1,1)` | **none** — new in 3D |
| `ALL_DIRS` | 26 | all of the above | the king's 8 |
| `ALL_DIAG` | 20 | `FACE_DIAG + SPACE_DIAG` | the bishop's 4 |
| `KNIGHT` | 24 | permutations of `(0,±1,±2)` | the knight's 8 |

The 8 space diagonals are the genuinely new thing about 3D chess. Every design
decision below comes down to who gets to use them.

## Current placeholder movement

| Piece | Movement | Directions |
|---|---|---|
| King | one step, any direction | 26 |
| Queen | unlimited slide, any direction | 26 |
| Rook | unlimited slide along the axes, **including straight up and down** | 6 |
| Bishop | unlimited slide along every diagonal | 20 |
| Knight | leap two along one axis, one along another | 24 |
| Pawn | one step `+z`; captures on the 4 forward face-diagonals | — |

### Notes on the choices

**Bishop = all 20 diagonals** keeps the identity `queen = rook + bishop` exact,
which is why it was chosen. The cost is that the bishop becomes enormously
strong — close to a second queen. The main alternative is:

```js
// js/rules/Pieces.js
b: { rules: [{ kind: 'slide', dirs: FACE_DIAG, range: Infinity }] },
```

which gives the bishop 12 directions and leaves the 8 space diagonals to a new
piece — the *unicorn* of classic 3D chess variants. That would make
`queen = rook + bishop` false (6 + 12 = 18, not 26), which is a real design
decision rather than an oversight.

**Pawns capture on 4 diagonals, not 8.** The four are `(±1, 0, forward)` and
`(0, ±1, forward)` — so a pawn *can* capture one level up or down, but not
diagonally sideways-and-vertically at once. Switching to 8 would double a
pawn's coverage; edit `pawnCaptureDirs` in `js/rules/Geometry.js`.

**Pawns never move vertically on a quiet move.** They only change level by
capturing.

## Writing new movement

A piece is a list of rules. Three kinds exist:

```js
// Slide along each direction until blocked. `range` caps the distance.
{ kind: 'slide', dirs: AXIAL, range: Infinity }

// Jump straight to each offset, ignoring anything in between.
{ kind: 'leap', dirs: KNIGHT }

// Forward-only movement with sideways-only capture, double step,
// en passant and promotion. Special-cased in MoveGen.js.
{ kind: 'pawn' }
```

Rules compose. A piece that slides three cells along the axes *and* leaps like a
knight is just:

```js
myPiece: {
  rules: [
    { kind: 'slide', dirs: AXIAL, range: 3 },
    { kind: 'leap',  dirs: KNIGHT },
  ],
},
```

`dirs` is any array of `[dx, dy, dz]` — it does not have to come from
`Geometry.js`. Move generation, attack detection, pins, check and checkmate all
read these declarations, so nothing else needs updating.

Two flags matter:

- `royal: true` — losing this piece to an unavoidable attack is checkmate.
- `castles: true` — this piece is a valid castling partner for the king.

## Compound moves

Castling and en passant are not hardcoded special cases in the apply logic. A
move carries its effects as data:

```js
{
  from, to,          // the primary relocation
  cap,               // cell to empty — NOT always `to` (en passant)
  extra: [{from,to}], // additional relocations (the castling rook)
  promo,             // piece type to become
  flag,              // 'castle' | 'ep' | 'promo'
}
```

So any future compound move — a piece that swaps with a friendly piece, one
that drags another along, a three-piece rotation — is expressible without
changing `applyMove` / `undoMove`.

Castling currently travels along `±x` only, mirroring 2D chess. To let the king
castle vertically as well, extend `CASTLE_DIRS` in `js/rules/MoveGen.js`.

## Starting position

Generated, not hardcoded, so it scales with board size. The back rank lays
rooks, knights and bishops outward-in from both ends and puts the king in the
centre with the queen beside it:

| Width | Pattern |
|---|---|
| 8 | `r n b q k b n r` (exactly standard chess) |
| 6 | `r n q k n r` |
| 4 | `r q k r` |

Each side garrisons the **bottom two levels** of its two nearest ranks: majors
on the outermost rank, pawns in front. On 6×6×6 that is 12 majors + 12 pawns =
24 pieces per side, leaving the top four levels as open contested space.

## Piece values

In `js/rules/Config.js`, used only for the captured-material display:

```js
values: { p: 1, n: 3, b: 5, r: 6, q: 12, k: 0 }
```

These are guesses. A 3D board changes relative worth a lot — a rook gains a
whole axis, a knight gains 16 extra leaps, and the bishop as currently defined
is nearly a queen. Worth revisiting once movement is settled.

## Tests

`js/test/tests.js` asserts specific direction counts (26 king moves, 24 knight
leaps, and so on). Those assertions are tied to the placeholders and are
**expected to be rewritten** alongside `Pieces.js`. The suites that are not
placeholder-dependent — indexing, apply/undo integrity, check and mate
detection, serialisation, board-size independence — should keep passing
unchanged.

```
jsc -m scripts/run-tests.mjs     # jsc ships with macOS
node scripts/run-tests.mjs       # if you have Node
open tests.html                  # in the browser (needs a local server)
```
