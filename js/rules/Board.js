/*
 * 3D Chess — Board.js
 *
 * The board is a flat array of length dims.x * dims.y * dims.z. A cell holds
 * null or a piece object { t, c, moved }:
 *   t = type ('k','q','r','b','n','p')
 *   c = colour ('w' | 'b')
 *   moved = has this piece moved yet (needed for castling and pawn double step)
 *
 * Indices are packed as ((z * dims.y) + y) * dims.x + x, so a whole y-level or
 * z-rank is a contiguous-ish stride — convenient for the layer-slicing UI.
 */

/** Create an index<->coordinate helper bound to a set of dimensions. */
export function makeGeometry(dims) {
  const { x: DX, y: DY, z: DZ } = dims;
  const size = DX * DY * DZ;

  return {
    dims: { x: DX, y: DY, z: DZ },
    size,
    idx: (x, y, z) => ((z * DY) + y) * DX + x,
    xyz(i) {
      const x = i % DX;
      const y = Math.floor(i / DX) % DY;
      const z = Math.floor(i / (DX * DY));
      return { x, y, z };
    },
    inBounds: (x, y, z) => x >= 0 && x < DX && y >= 0 && y < DY && z >= 0 && z < DZ,
  };
}

/** An empty board array for the given dimensions. */
export function emptyBoard(dims) {
  return new Array(dims.x * dims.y * dims.z).fill(null);
}

export function clonePiece(p) {
  return p ? { t: p.t, c: p.c, moved: p.moved } : null;
}

export function cloneBoard(board) {
  return board.map(clonePiece);
}

/**
 * Algebraic-ish name for a cell: file letter, level number, rank number.
 * (0,0,0) -> "a1L1", (3,2,5) -> "d6L3". Files are letters, ranks are the
 * trailing digits, levels are the "L" component.
 */
export function cellName(geo, i) {
  const { x, y, z } = geo.xyz(i);
  return `${String.fromCharCode(97 + x)}${z + 1}L${y + 1}`;
}

/** Parse a cell name back to an index, or -1 if it does not fit the board. */
export function parseCellName(geo, name) {
  const m = /^([a-z])(\d+)L(\d+)$/i.exec(name.trim());
  if (!m) return -1;
  const x = m[1].toLowerCase().charCodeAt(0) - 97;
  const z = parseInt(m[2], 10) - 1;
  const y = parseInt(m[3], 10) - 1;
  return geo.inBounds(x, y, z) ? geo.idx(x, y, z) : -1;
}

/** Every index holding a piece of the given colour. */
export function piecesOf(board, colour) {
  const out = [];
  for (let i = 0; i < board.length; i++) {
    const p = board[i];
    if (p && p.c === colour) out.push(i);
  }
  return out;
}

/** Index of `colour`'s royal piece, or -1 if it has somehow left the board. */
export function findKing(board, colour) {
  for (let i = 0; i < board.length; i++) {
    const p = board[i];
    if (p && p.c === colour && p.t === 'k') return i;
  }
  return -1;
}

/** Compact string of the whole position — used for threefold repetition. */
export function positionKey(board, turn, ep) {
  let s = turn + '|' + (ep ? ep.target : -1) + '|';
  for (let i = 0; i < board.length; i++) {
    const p = board[i];
    s += p ? p.c + p.t + (p.moved ? '1' : '0') : '.';
  }
  return s;
}
