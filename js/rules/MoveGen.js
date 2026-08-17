/*
 * 3D Chess — MoveGen.js
 *
 * Pseudo-legal generation from the declarations in Pieces.js, plus the legality
 * filter (a move is illegal if it leaves your own king attacked).
 *
 * A Move is a plain object and is deliberately over-general so that compound
 * moves — castling now, whatever the 3D analogue of it turns out to be later —
 * need no new machinery:
 *
 *   {
 *     from, to,          indices of the primary relocation
 *     t,                 moving piece type
 *     cap,               index of the captured cell, or null.
 *                        NOT always == to (en passant captures elsewhere)
 *     capT,              captured piece type, or null
 *     extra,             [{from, to}] additional relocations (castling rook)
 *     promo,             piece type to promote to, or null
 *     double,            pawn double step (arms en passant)
 *     flag               'castle' | 'ep' | 'promo' | null
 *   }
 *
 * Because every effect is data, applyMove/undoMove stay generic: any future
 * piece that swaps places, drops a piece, or moves two units at once is
 * expressible without touching this file's apply logic.
 */

import { PIECES } from './Pieces.js';
import { pawnCaptureDirs } from './Geometry.js';
import { findKing, piecesOf, positionKey } from './Board.js';
import { Config, other } from './Config.js';

/** Which axes castling may travel along. Kept to x to mirror 2D chess. */
const CASTLE_DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
];

function mkMove(from, to, t, opts = {}) {
  return {
    from,
    to,
    t,
    cap: opts.cap ?? null,
    capT: opts.capT ?? null,
    extra: opts.extra ?? null,
    promo: opts.promo ?? null,
    double: opts.double ?? false,
    flag: opts.flag ?? null,
  };
}

/** Forward rank direction for a colour: white advances +z, black -z. */
export const forwardZ = (colour) => (colour === 'w' ? 1 : -1);

// ---------------------------------------------------------------------------
// Pseudo-legal generation
// ---------------------------------------------------------------------------

/**
 * All moves for the piece at `from`, ignoring whether they expose the king.
 * `opts.forAttack` generates only the squares the piece attacks — pawns then
 * yield their capture diagonals regardless of occupancy, and castling is
 * skipped (a king never attacks through a castle).
 */
export function pseudoMoves(state, from, opts = {}) {
  const { geo, board } = state;
  const piece = board[from];
  if (!piece) return [];
  const def = PIECES[piece.t];
  if (!def) return [];

  const out = [];
  for (const rule of def.rules) {
    if (rule.kind === 'pawn') {
      pawnMoves(state, from, piece, out, opts);
    } else if (rule.kind === 'leap') {
      leapMoves(geo, board, from, piece, rule.dirs, out);
    } else if (rule.kind === 'slide') {
      slideMoves(geo, board, from, piece, rule.dirs, rule.range ?? Infinity, out);
    }
  }

  if (def.royal && Config.castling && !opts.forAttack) {
    castleMoves(state, from, piece, out);
  }
  return out;
}

function leapMoves(geo, board, from, piece, dirs, out) {
  const { x, y, z } = geo.xyz(from);
  for (const [dx, dy, dz] of dirs) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    if (!geo.inBounds(nx, ny, nz)) continue;
    const to = geo.idx(nx, ny, nz);
    const target = board[to];
    if (target && target.c === piece.c) continue;
    out.push(mkMove(from, to, piece.t, target ? { cap: to, capT: target.t } : {}));
  }
}

function slideMoves(geo, board, from, piece, dirs, range, out) {
  const { x, y, z } = geo.xyz(from);
  for (const [dx, dy, dz] of dirs) {
    let nx = x + dx, ny = y + dy, nz = z + dz;
    for (let step = 1; step <= range; step++) {
      if (!geo.inBounds(nx, ny, nz)) break;
      const to = geo.idx(nx, ny, nz);
      const target = board[to];
      if (!target) {
        out.push(mkMove(from, to, piece.t));
      } else {
        if (target.c !== piece.c) out.push(mkMove(from, to, piece.t, { cap: to, capT: target.t }));
        break;
      }
      nx += dx; ny += dy; nz += dz;
    }
  }
}

function pawnMoves(state, from, piece, out, opts) {
  const { geo, board } = state;
  const { x, y, z } = geo.xyz(from);
  const fz = forwardZ(piece.c);
  const lastRank = piece.c === 'w' ? geo.dims.z - 1 : 0;
  const startRank = piece.c === 'w' ? 1 : geo.dims.z - 2;

  const pushWithPromo = (to, extras) => {
    const promo = geo.xyz(to).z === lastRank ? Config.autoPromoteTo || 'q' : null;
    out.push(mkMove(from, to, 'p', { ...extras, promo, flag: promo ? 'promo' : extras.flag ?? null }));
  };

  // Quiet advance (and double step). Suppressed when we only want attacks —
  // a pawn does not attack the square directly in front of it.
  if (!opts.forAttack) {
    if (geo.inBounds(x, y, z + fz) && !board[geo.idx(x, y, z + fz)]) {
      pushWithPromo(geo.idx(x, y, z + fz), {});

      if (Config.pawnDoubleStep && z === startRank && !piece.moved) {
        const z2 = z + 2 * fz;
        // On a very small board the double step can itself reach the last
        // rank, so it has to go through the promotion path too.
        if (geo.inBounds(x, y, z2) && !board[geo.idx(x, y, z2)]) {
          pushWithPromo(geo.idx(x, y, z2), { double: true });
        }
      }
    }
  }

  // Diagonal captures, including en passant.
  for (const [dx, dy, dz] of pawnCaptureDirs(fz)) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    if (!geo.inBounds(nx, ny, nz)) continue;
    const to = geo.idx(nx, ny, nz);

    if (opts.forAttack) {
      out.push(mkMove(from, to, 'p'));
      continue;
    }

    const target = board[to];
    if (target) {
      if (target.c !== piece.c) pushWithPromo(to, { cap: to, capT: target.t });
    } else if (Config.enPassant && state.ep && state.ep.target === to && state.ep.colour !== piece.c) {
      const victim = board[state.ep.victim];
      if (victim) {
        out.push(mkMove(from, to, 'p', { cap: state.ep.victim, capT: victim.t, flag: 'ep' }));
      }
    }
  }
}

/**
 * Castling: king steps two along an axis toward an unmoved rook that shares the
 * king's other two coordinates; the rook lands on the cell the king crossed.
 * Requires an empty corridor, a king not currently in check, and no attack on
 * either cell the king passes through or lands on.
 */
function castleMoves(state, from, king, out) {
  const { geo, board } = state;
  if (king.moved) return;
  if (isAttacked(state, from, other(king.c))) return;

  const { x, y, z } = geo.xyz(from);
  for (const [dx, dy, dz] of CASTLE_DIRS) {
    // Walk outward to find the first occupied cell.
    let nx = x + dx, ny = y + dy, nz = z + dz;
    let rookIdx = -1;
    let corridor = 0;
    while (geo.inBounds(nx, ny, nz)) {
      const i = geo.idx(nx, ny, nz);
      if (board[i]) { rookIdx = i; break; }
      corridor++;
      nx += dx; ny += dy; nz += dz;
    }
    if (rookIdx < 0 || corridor < 2) continue;         // need room for the 2-step

    const rook = board[rookIdx];
    if (!rook || rook.c !== king.c || rook.moved) continue;
    if (!PIECES[rook.t]?.castles) continue;

    const passIdx = geo.idx(x + dx, y + dy, z + dz);
    const destIdx = geo.idx(x + 2 * dx, y + 2 * dy, z + 2 * dz);
    if (isAttacked(state, passIdx, other(king.c))) continue;
    if (isAttacked(state, destIdx, other(king.c))) continue;

    out.push(mkMove(from, destIdx, king.t, {
      extra: [{ from: rookIdx, to: passIdx }],
      flag: 'castle',
    }));
  }
}

// ---------------------------------------------------------------------------
// Attack detection
// ---------------------------------------------------------------------------

/**
 * If (ddx,ddy,ddz) is a positive integer multiple of (dx,dy,dz), return that
 * multiple; otherwise -1. Used to test "does this slider's ray point at the
 * target" without walking the ray.
 */
function stepsAlong(ddx, ddy, ddz, dx, dy, dz) {
  let n = -1;
  const check = (d, dd) => {
    if (d === 0) return dd === 0;
    if (dd % d !== 0) return false;
    const k = dd / d;
    if (k <= 0) return false;
    if (n === -1) n = k;
    else if (n !== k) return false;
    return true;
  };
  if (!check(dx, ddx) || !check(dy, ddy) || !check(dz, ddz)) return -1;
  return n;
}

/**
 * Does the piece at `from` attack `target`?
 *
 * Written as a direct test rather than "generate every move and search the
 * list": on a 216-cell board the generate-and-search version runs inside the
 * legality filter for every candidate move and turns move generation into
 * millions of operations. This reads the same rule declarations, so Pieces.js
 * stays freely editable.
 */
export function attacksTarget(state, from, target) {
  const { geo, board } = state;
  const piece = board[from];
  if (!piece) return false;
  const def = PIECES[piece.t];
  if (!def) return false;

  const { x, y, z } = geo.xyz(from);
  const t = geo.xyz(target);
  const ddx = t.x - x, ddy = t.y - y, ddz = t.z - z;

  for (const rule of def.rules) {
    if (rule.kind === 'pawn') {
      for (const [dx, dy, dz] of pawnCaptureDirs(forwardZ(piece.c))) {
        if (dx === ddx && dy === ddy && dz === ddz) return true;
      }
    } else if (rule.kind === 'leap') {
      for (const [dx, dy, dz] of rule.dirs) {
        if (dx === ddx && dy === ddy && dz === ddz) return true;
      }
    } else if (rule.kind === 'slide') {
      const range = rule.range ?? Infinity;
      for (const [dx, dy, dz] of rule.dirs) {
        const n = stepsAlong(ddx, ddy, ddz, dx, dy, dz);
        if (n < 1 || n > range) continue;
        let clear = true;
        for (let s = 1; s < n; s++) {
          if (board[geo.idx(x + dx * s, y + dy * s, z + dz * s)]) { clear = false; break; }
        }
        if (clear) return true;
      }
    }
  }
  return false;
}

/** Is `target` attacked by any piece of colour `byColour`? */
export function isAttacked(state, target, byColour) {
  const { board } = state;
  for (let i = 0; i < board.length; i++) {
    const p = board[i];
    if (!p || p.c !== byColour) continue;
    if (attacksTarget(state, i, target)) return true;
  }
  return false;
}

export function inCheck(state, colour) {
  const king = findKing(state.board, colour);
  if (king < 0) return false;
  return isAttacked(state, king, other(colour));
}

// ---------------------------------------------------------------------------
// Apply / undo
// ---------------------------------------------------------------------------

/**
 * Apply `m` to `state` in place and return an undo record. Every board cell the
 * move touches is snapshotted, so undo is exact regardless of how exotic the
 * move's effects are.
 */
export function applyMove(state, m) {
  const undo = {
    cells: [],
    ep: state.ep,
    turn: state.turn,
    halfmove: state.halfmove,
    fullmove: state.fullmove,
  };
  // Piece objects are treated as immutable — every write below installs a
  // fresh object rather than mutating one — so snapshotting the reference is
  // both correct and cheaper than copying.
  const touch = (i) => undo.cells.push([i, state.board[i]]);

  if (m.cap !== null) { touch(m.cap); state.board[m.cap] = null; }
  touch(m.from);
  touch(m.to);

  const mover = state.board[m.from];
  state.board[m.from] = null;
  state.board[m.to] = { t: m.promo || mover.t, c: mover.c, moved: true };

  for (const e of m.extra || []) {
    touch(e.from);
    touch(e.to);
    const p = state.board[e.from];
    state.board[e.from] = null;
    state.board[e.to] = { t: p.t, c: p.c, moved: true };
  }

  // Arm en passant on a double step: the crossed cell becomes capturable.
  if (m.double) {
    const a = state.geo.xyz(m.from);
    const b = state.geo.xyz(m.to);
    state.ep = {
      target: state.geo.idx(a.x, a.y, (a.z + b.z) / 2),
      victim: m.to,
      colour: mover.c,
    };
  } else {
    state.ep = null;
  }

  state.halfmove = (m.cap !== null || m.t === 'p') ? 0 : state.halfmove + 1;
  if (state.turn === 'b') state.fullmove++;
  state.turn = other(state.turn);
  return undo;
}

export function undoMove(state, undo) {
  for (let i = undo.cells.length - 1; i >= 0; i--) {
    const [idx, piece] = undo.cells[i];
    state.board[idx] = piece;
  }
  state.ep = undo.ep;
  state.turn = undo.turn;
  state.halfmove = undo.halfmove;
  state.fullmove = undo.fullmove;
}

// ---------------------------------------------------------------------------
// Legal moves
// ---------------------------------------------------------------------------

/** Pseudo-legal moves for `from`, filtered to those that do not expose the king. */
export function legalMoves(state, from) {
  const piece = state.board[from];
  if (!piece) return [];
  const colour = piece.c;
  const out = [];
  for (const m of pseudoMoves(state, from)) {
    const undo = applyMove(state, m);
    const ok = !inCheck(state, colour);
    undoMove(state, undo);
    if (ok) out.push(m);
  }
  return out;
}

/** Every legal move available to `colour`. */
export function allLegalMoves(state, colour) {
  const out = [];
  for (const i of piecesOf(state.board, colour)) {
    out.push(...legalMoves(state, i));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Terminal states
// ---------------------------------------------------------------------------

/**
 * Status of the position for the side to move.
 * Returns { over, result, reason } where result is 'w' | 'b' | 'draw' | null.
 */
export function gameStatus(state, history = []) {
  const colour = state.turn;
  const moves = allLegalMoves(state, colour);
  const check = inCheck(state, colour);

  if (moves.length === 0) {
    return check
      ? { over: true, result: other(colour), reason: 'checkmate', check }
      : { over: true, result: 'draw', reason: 'stalemate', check };
  }

  if (state.halfmove >= Config.halfmoveDrawLimit) {
    return { over: true, result: 'draw', reason: 'fifty-move rule', check };
  }

  const key = positionKey(state.board, state.turn, state.ep);
  let repeats = 0;
  for (const k of history) if (k === key) repeats++;
  if (repeats >= Config.repetitionDrawLimit) {
    return { over: true, result: 'draw', reason: 'threefold repetition', check };
  }

  if (insufficientMaterial(state)) {
    return { over: true, result: 'draw', reason: 'insufficient material', check };
  }

  return { over: false, result: null, reason: check ? 'check' : null, check };
}

/** Kings alone, or a king plus one lone knight/bishop, cannot force mate. */
export function insufficientMaterial(state) {
  const counts = { w: [], b: [] };
  for (const p of state.board) {
    if (!p || p.t === 'k') continue;
    counts[p.c].push(p.t);
  }
  const trivial = (arr) => arr.length === 0 || (arr.length === 1 && (arr[0] === 'n' || arr[0] === 'b'));
  return trivial(counts.w) && trivial(counts.b);
}
