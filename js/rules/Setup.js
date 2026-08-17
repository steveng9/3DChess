/*
 * 3D Chess — Setup.js
 *
 * >>> STARTING POSITIONS ARE PLACEHOLDERS. Edit freely. <<<
 *
 * The two armies start at opposite ends of the cube's body diagonal — as far
 * apart as the board allows:
 *
 *   White   nearest ranks (z = 0, 1)      on the LOWEST levels  (y = 0, 1)
 *   Black   farthest ranks (z = N-1, N-2) on the HIGHEST levels (y = N-1, N-2)
 *
 *   z = 0     majors, one row per occupied level
 *   z = 1     pawns,  one row per occupied level
 *
 * On a 6x6x6 board that gives each side 12 majors + 12 pawns = 24 pieces —
 * comparable in density to the 16 of standard chess — and leaves the middle of
 * the cube open as contested space.
 *
 * CONSEQUENCE WORTH KNOWING: because the armies are offset in y as well as z,
 * the pawn walls do not face each other. A white pawn on level 1 advances the
 * length of the board without ever meeting a black pawn on level 5. Whether
 * that is a feature or a problem is a rules question — see MOVEMENT.md.
 *
 * The back-rank pattern is generated, not hardcoded, so it degrades sensibly:
 *   width 8 -> r n b q k b n r     (exactly standard chess)
 *   width 6 -> r n q k n r
 *   width 4 -> r q k r
 */

import { emptyBoard, makeGeometry } from './Board.js';

/** How many levels each side garrisons. */
const ARMY_LEVELS = 2;

/**
 * Back-rank ordering for a row of `width` cells. Rooks, knights and bishops are
 * laid outward-in from both ends; the king takes the centre with the queen
 * beside it.
 */
export function backRankPattern(width) {
  const out = new Array(width).fill(null);
  const order = ['r', 'n', 'b'];

  let lo = 0;
  let hi = width - 1;
  let oi = 0;
  // Stop while at least two central cells remain free for the royals.
  while (hi - lo >= 3 && oi < order.length) {
    out[lo++] = order[oi];
    out[hi--] = order[oi];
    oi++;
  }

  const kingX = Math.floor(width / 2);
  const queenX = kingX - 1;
  for (let i = lo; i <= hi; i++) {
    if (i === kingX) out[i] = 'k';
    else if (i === queenX) out[i] = 'q';
    else out[i] = order[oi % order.length];
  }
  return out;
}

/** Upper-level rows get the same shape, but no second king or queen. */
export function supportRankPattern(width) {
  return backRankPattern(width).map((t) => (t === 'k' || t === 'q' ? 'b' : t));
}

/**
 * Build the initial board for the given dimensions.
 * Returns { board, geo }.
 */
export function startingPosition(dims) {
  const geo = makeGeometry(dims);
  const board = emptyBoard(dims);

  // Each side needs its own levels, so the two garrisons must fit in y without
  // meeting in the middle.
  const levels = Math.max(1, Math.min(ARMY_LEVELS, Math.floor(dims.y / 2)));
  const hasPawnRow = dims.z >= 4; // otherwise the two armies would collide in z

  const place = (x, y, z, t, c) => {
    board[geo.idx(x, y, z)] = { t, c, moved: false };
  };

  for (let level = 0; level < levels; level++) {
    const pattern = level === 0 ? backRankPattern(dims.x) : supportRankPattern(dims.x);

    // White builds up from the bottom level, Black down from the top, so the
    // armies sit at opposite ends of the cube's body diagonal.
    const wy = level;
    const by = dims.y - 1 - level;

    for (let x = 0; x < dims.x; x++) {
      // Majors on the outermost rank of each side.
      place(x, wy, 0, pattern[x], 'w');
      place(x, by, dims.z - 1, pattern[x], 'b');

      if (hasPawnRow) {
        place(x, wy, 1, 'p', 'w');
        place(x, by, dims.z - 2, 'p', 'b');
      }
    }
  }

  return { board, geo };
}

/** An empty board — handy for tests and for building custom positions. */
export function emptyPosition(dims) {
  return { board: emptyBoard(dims), geo: makeGeometry(dims) };
}
