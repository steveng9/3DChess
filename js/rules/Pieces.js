/*
 * 3D Chess — Pieces.js
 *
 * >>> THIS IS THE FILE TO EDIT WHEN REAL 3D MOVEMENT IS DECIDED. <<<
 *
 * Everything below is a PLACEHOLDER: the most obvious generalisation of each
 * 2D piece into three dimensions. MoveGen.js reads these declarations and needs
 * no changes when they are rewritten.
 *
 * A piece is declared as a list of movement rules. Each rule is one of:
 *
 *   { kind: 'slide', dirs: [[dx,dy,dz], ...], range: Infinity }
 *       Ray-cast along each direction until blocked. Captures the first enemy.
 *
 *   { kind: 'leap', dirs: [[dx,dy,dz], ...] }
 *       Jump directly to each offset, ignoring anything in between.
 *
 *   { kind: 'pawn' }
 *       Special-cased in MoveGen: forward-only movement, sideways-only capture,
 *       optional double step, en passant, promotion.
 *
 * `range` caps a slide (range 1 makes it a single step). Omit for unlimited.
 */

import { AXIAL, FACE_DIAG, SPACE_DIAG, ALL_DIAG, ALL_DIRS, KNIGHT } from './Geometry.js';

export const PIECE_TYPES = ['k', 'q', 'r', 'b', 'n', 'p'];

export const PIECE_NAMES = {
  k: 'King',
  q: 'Queen',
  r: 'Rook',
  b: 'Bishop',
  n: 'Knight',
  p: 'Pawn',
};

/**
 * Unicode glyphs, used to build the sprite textures on the 3D board. Solid
 * glyphs for both colours — the sprite is tinted light or dark, so an outlined
 * white glyph would read as a hole at this size.
 */
export const PIECE_GLYPHS = {
  k: '♚',
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟',
};

export const PIECES = {
  // ---- King ------------------------------------------------------------
  // One step to any of the 26 neighbouring cells. The direct analogue of the
  // 2D king's 8 neighbours.
  k: {
    rules: [{ kind: 'leap', dirs: ALL_DIRS }],
    royal: true,
  },

  // ---- Queen -----------------------------------------------------------
  // Slides without limit along all 26 directions, so that (as in 2D)
  // queen = rook + bishop exactly.
  q: {
    rules: [{ kind: 'slide', dirs: ALL_DIRS, range: Infinity }],
  },

  // ---- Rook ------------------------------------------------------------
  // Slides along the 6 axial directions. Includes straight up and down, which
  // is the only genuinely new rook move in 3D.
  r: {
    rules: [{ kind: 'slide', dirs: AXIAL, range: Infinity }],
    castles: true,
  },

  // ---- Bishop ----------------------------------------------------------
  // Slides along all 20 diagonals: the 12 planar ones plus the 8 through the
  // cube's volume.
  //
  // PLACEHOLDER NOTE: giving the bishop all 20 keeps the identity
  // queen = rook + bishop intact, but makes it very strong (it is roughly a
  // second queen). The main alternative is FACE_DIAG only (12 directions),
  // leaving the 8 space diagonals to a new piece — the "unicorn" of classic
  // 3D chess variants. Change `ALL_DIAG` to `FACE_DIAG` below to try that.
  b: {
    rules: [{ kind: 'slide', dirs: ALL_DIAG, range: Infinity }],
  },

  // ---- Knight ----------------------------------------------------------
  // 24 leaps: (0, ±1, ±2) in every axis permutation.
  n: {
    rules: [{ kind: 'leap', dirs: KNIGHT }],
  },

  // ---- Pawn ------------------------------------------------------------
  // Advances one cell along +z (white) / -z (black). Never sideways, never
  // vertically on a quiet move. Captures onto the 4 forward face-diagonals:
  // (±1, 0, forward) and (0, ±1, forward) — so it does gain the ability to
  // capture up and down a level. Double step from its starting rank, en
  // passant against that double step, promotion on the far rank.
  p: {
    rules: [{ kind: 'pawn' }],
  },
};

/** Direction sets re-exported so Setup/UI can describe pieces without importing Geometry. */
export const DIR_SETS = { AXIAL, FACE_DIAG, SPACE_DIAG, ALL_DIAG, ALL_DIRS, KNIGHT };

/** Short prose description of a piece's movement, shown in the in-game help panel. */
export const PIECE_HELP = {
  k: 'One step to any of the 26 adjacent cells.',
  q: 'Slides any distance along all 26 directions.',
  r: 'Slides any distance along the 6 axes — including straight up and down.',
  b: 'Slides any distance along all 20 diagonals (12 planar, 8 through the volume).',
  n: '24 leaps: two along one axis, one along another, jumping over anything.',
  p: 'Steps one cell forward. Captures onto the 4 forward diagonals, which includes one level up or down.',
};
