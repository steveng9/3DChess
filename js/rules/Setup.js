/*
 * 3D Chess — Setup.js
 *
 * >>> STARTING POSITIONS ARE PLACEHOLDERS. Edit freely. <<<
 *
 * The layout generalises 2D chess and scales with board size:
 *
 *   White occupies the two nearest ranks (z = 0, 1) on the lowest levels.
 *   Black mirrors it on the two farthest ranks (z = N-1, N-2).
 *
 *   z = 0     majors, one row per occupied level
 *   z = 1     pawns,  one row per occupied level
 *
 * Only the bottom two levels (y = 0, 1) are garrisoned, which on a 6x6x6 board
 * gives each side 12 majors + 12 pawns = 24 pieces — comparable in density to
 * the 16 pieces of standard chess — and leaves the upper four levels open as
 * contested space.
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

  const levels = Math.min(ARMY_LEVELS, dims.y);
  const hasPawnRow = dims.z >= 4; // otherwise the two armies would collide

  const place = (x, y, z, t, c) => {
    board[geo.idx(x, y, z)] = { t, c, moved: false };
  };

  for (let level = 0; level < levels; level++) {
    const pattern = level === 0 ? backRankPattern(dims.x) : supportRankPattern(dims.x);

    for (let x = 0; x < dims.x; x++) {
      // Majors on the outermost rank of each side.
      place(x, level, 0, pattern[x], 'w');
      place(x, level, dims.z - 1, pattern[x], 'b');

      if (hasPawnRow) {
        place(x, level, 1, 'p', 'w');
        place(x, level, dims.z - 2, 'p', 'b');
      }
    }
  }

  return { board, geo };
}

/** An empty board — handy for tests and for building custom positions. */
export function emptyPosition(dims) {
  return { board: emptyBoard(dims), geo: makeGeometry(dims) };
}
