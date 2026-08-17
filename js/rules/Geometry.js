/*
 * 3D Chess — Geometry.js
 *
 * The direction vocabulary of a 3D board. In 2D a king has 8 neighbours split
 * into 4 orthogonal + 4 diagonal. In 3D a cell has 26 neighbours, and they fall
 * into three natural families:
 *
 *   AXIAL        (6)  exactly one axis moves    (1,0,0)     — pure rook steps
 *   FACE_DIAG   (12)  exactly two axes move     (1,1,0)     — a 2D diagonal
 *                                                             inside some plane
 *   SPACE_DIAG   (8)  all three axes move       (1,1,1)     — the true 3D
 *                                                             diagonal, has no
 *                                                             2D counterpart
 *
 *   6 + 12 + 8 = 26 = ALL_DIRS
 *
 * These are the building blocks Pieces.js composes into piece movement.
 */

/** All 26 unit-ish neighbour offsets, grouped by how many axes are non-zero. */
function neighboursWithAxisCount(n) {
  const out = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const nonZero = (dx !== 0) + (dy !== 0) + (dz !== 0);
        if (nonZero === n) out.push([dx, dy, dz]);
      }
    }
  }
  return out;
}

/** 6 directions: one axis at a time. The 3D rook. */
export const AXIAL = neighboursWithAxisCount(1);

/** 12 directions: diagonals that stay inside an axis-aligned plane. */
export const FACE_DIAG = neighboursWithAxisCount(2);

/** 8 directions: the corner-to-corner diagonals through the cube's volume. */
export const SPACE_DIAG = neighboursWithAxisCount(3);

/** All 26. The 3D king's neighbourhood; the 3D queen's slide directions. */
export const ALL_DIRS = [...AXIAL, ...FACE_DIAG, ...SPACE_DIAG];

/** Every diagonal, planar and volumetric. 12 + 8 = 20. */
export const ALL_DIAG = [...FACE_DIAG, ...SPACE_DIAG];

/**
 * 24 knight offsets: every vector whose absolute components are a permutation
 * of (0, 1, 2). This is the standard generalisation — the 2D knight's (1,2) leap
 * performed inside each of the three coordinate planes, in every orientation.
 */
export const KNIGHT = (() => {
  const out = [];
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dz = -2; dz <= 2; dz++) {
        const a = [Math.abs(dx), Math.abs(dy), Math.abs(dz)].sort();
        if (a[0] === 0 && a[1] === 1 && a[2] === 2) out.push([dx, dy, dz]);
      }
    }
  }
  return out;
})();

/**
 * The 4 forward-diagonal capture directions for a pawn moving along `fz`
 * (+1 for white, -1 for black): step forward one rank while sliding one square
 * sideways in x, or one level in y.
 *
 * PLACEHOLDER: the 4 space-diagonal captures (±1, ±1, fz) are deliberately
 * excluded — that would make pawns cover 8 squares. Easy to switch on later.
 */
export function pawnCaptureDirs(fz) {
  return [
    [1, 0, fz],
    [-1, 0, fz],
    [0, 1, fz],
    [0, -1, fz],
  ];
}

/** Human-readable name for a direction family — used by MOVEMENT.md tooling. */
export function describeDirs(dirs) {
  if (dirs === AXIAL) return 'axial (6)';
  if (dirs === FACE_DIAG) return 'face diagonal (12)';
  if (dirs === SPACE_DIAG) return 'space diagonal (8)';
  if (dirs === ALL_DIAG) return 'all diagonals (20)';
  if (dirs === ALL_DIRS) return 'all directions (26)';
  if (dirs === KNIGHT) return 'knight leaps (24)';
  return `${dirs.length} directions`;
}
