/*
 * 3D Chess — tests.js
 *
 * Unit tests for the rules engine. No DOM, no network, no Three.js — this file
 * imports only from js/rules/, so it stays valid while the movement placeholders
 * in Pieces.js are being rewritten. Tests that assert specific direction counts
 * are marked PLACEHOLDER and are expected to be updated alongside Pieces.js.
 *
 * Run by opening tests.html.
 */

import { Config, setBoardSize } from '../rules/Config.js';
import { AXIAL, FACE_DIAG, SPACE_DIAG, ALL_DIRS, KNIGHT } from '../rules/Geometry.js';
import { makeGeometry, emptyBoard, cellName, parseCellName, findKing } from '../rules/Board.js';
import { startingPosition, backRankPattern } from '../rules/Setup.js';
import {
  pseudoMoves, legalMoves, allLegalMoves, isAttacked, inCheck,
  applyMove, undoMove, gameStatus,
} from '../rules/MoveGen.js';
import { GameState } from '../rules/GameState.js';

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------

const results = [];
let current = null;

function suite(name, fn) {
  current = { name, tests: [] };
  results.push(current);
  fn();
}

function test(name, fn) {
  const t = { name, pass: true, error: null };
  try {
    fn();
  } catch (err) {
    t.pass = false;
    t.error = err.message || String(err);
  }
  current.tests.push(t);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'expected'}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

function deepEq(a, b, msg) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg || 'expected'}: got ${sa}, want ${sb}`);
}

// ---------------------------------------------------------------------------
// Helpers for building positions by hand
// ---------------------------------------------------------------------------

/**
 * A bare state with an empty board. Pass pieces as
 * { 'x,y,z': 'wk' } — colour letter then type letter.
 */
function position(dims, pieces, turn = 'w') {
  const geo = makeGeometry(dims);
  const board = emptyBoard(dims);
  for (const [key, spec] of Object.entries(pieces)) {
    const [x, y, z] = key.split(',').map(Number);
    // Key order matches every other piece factory so the JSON-based deepEq
    // comparisons below stay meaningful.
    board[geo.idx(x, y, z)] = { t: spec[1], c: spec[0], moved: spec.length > 2 && spec[2] === 'm' };
  }
  return { geo, board, turn, ep: null, halfmove: 0, fullmove: 1 };
}

const at = (st, x, y, z) => st.geo.idx(x, y, z);

/** Destination coordinates of a move list, as sorted "x,y,z" strings. */
function destSet(st, moves) {
  return moves.map((m) => {
    const { x, y, z } = st.geo.xyz(m.to);
    return `${x},${y},${z}`;
  }).sort();
}

const D6 = { x: 6, y: 6, z: 6 };

// ===========================================================================
// Geometry
// ===========================================================================

suite('Geometry — direction families', () => {
  test('axial has 6 directions', () => eq(AXIAL.length, 6));
  test('face diagonals have 12 directions', () => eq(FACE_DIAG.length, 12));
  test('space diagonals have 8 directions', () => eq(SPACE_DIAG.length, 8));
  test('all directions sum to 26 (the king neighbourhood)', () => {
    eq(ALL_DIRS.length, 26);
    eq(AXIAL.length + FACE_DIAG.length + SPACE_DIAG.length, 26);
  });
  test('knight has 24 leaps, each a permutation of (0,1,2)', () => {
    eq(KNIGHT.length, 24);
    for (const d of KNIGHT) {
      const a = d.map(Math.abs).sort();
      deepEq(a, [0, 1, 2], 'knight offset shape');
    }
  });
  test('no direction is the zero vector', () => {
    for (const d of [...ALL_DIRS, ...KNIGHT]) {
      assert(d.some((v) => v !== 0), 'zero vector found');
    }
  });
});

// ===========================================================================
// Board indexing
// ===========================================================================

suite('Board — coordinates', () => {
  test('idx and xyz round-trip over the whole board', () => {
    const geo = makeGeometry(D6);
    for (let i = 0; i < geo.size; i++) {
      const { x, y, z } = geo.xyz(i);
      eq(geo.idx(x, y, z), i, `round trip at ${i}`);
    }
  });

  test('inBounds rejects out-of-range coordinates', () => {
    const geo = makeGeometry(D6);
    assert(geo.inBounds(0, 0, 0));
    assert(geo.inBounds(5, 5, 5));
    assert(!geo.inBounds(-1, 0, 0));
    assert(!geo.inBounds(0, 6, 0));
  });

  test('cell names round-trip', () => {
    const geo = makeGeometry(D6);
    eq(cellName(geo, geo.idx(0, 0, 0)), 'a1L1');
    eq(cellName(geo, geo.idx(3, 2, 5)), 'd6L3');
    for (let i = 0; i < geo.size; i++) {
      eq(parseCellName(geo, cellName(geo, i)), i, `parse round trip at ${i}`);
    }
  });

  test('non-cubic dimensions index correctly', () => {
    const geo = makeGeometry({ x: 3, y: 8, z: 4 });
    eq(geo.size, 96);
    for (let i = 0; i < geo.size; i++) {
      const { x, y, z } = geo.xyz(i);
      eq(geo.idx(x, y, z), i);
    }
  });
});

// ===========================================================================
// Starting position
// ===========================================================================

suite('Setup — starting position', () => {
  test('back rank on width 8 reproduces standard chess', () => {
    deepEq(backRankPattern(8), ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r']);
  });

  test('back rank scales down sensibly', () => {
    deepEq(backRankPattern(6), ['r', 'n', 'q', 'k', 'n', 'r']);
    deepEq(backRankPattern(4), ['r', 'q', 'k', 'r']);
  });

  test('each side gets exactly one king', () => {
    for (const n of [4, 5, 6, 7, 8]) {
      const { board } = startingPosition({ x: n, y: n, z: n });
      const kings = { w: 0, b: 0 };
      for (const p of board) if (p && p.t === 'k') kings[p.c]++;
      eq(kings.w, 1, `white kings on ${n}`);
      eq(kings.b, 1, `black kings on ${n}`);
    }
  });

  test('armies are mirror images and do not overlap', () => {
    const { board, geo } = startingPosition(D6);
    let w = 0;
    let b = 0;
    for (const p of board) { if (p?.c === 'w') w++; else if (p?.c === 'b') b++; }
    eq(w, b, 'equal piece counts');
    eq(w, 24, 'expected 24 pieces per side on 6x6x6');

    for (let x = 0; x < 6; x++) {
      for (let y = 0; y < 2; y++) {
        eq(board[geo.idx(x, y, 0)].c, 'w');
        eq(board[geo.idx(x, y, 5)].c, 'b');
        eq(board[geo.idx(x, y, 1)].t, 'p');
        eq(board[geo.idx(x, y, 4)].t, 'p');
      }
    }
  });

  test('no piece starts in check', () => {
    setBoardSize(6);
    const gs = new GameState(D6);
    assert(!gs.inCheck('w'), 'white not in check');
    assert(!gs.inCheck('b'), 'black not in check');
  });
});

// ===========================================================================
// Movement — PLACEHOLDER rules
// ===========================================================================

suite('Movement (PLACEHOLDER rules)', () => {
  test('rook on an empty board slides along all 6 axes', () => {
    const st = position(D6, { '2,2,2': 'wr' });
    const moves = pseudoMoves(st, at(st, 2, 2, 2));
    // 5 reachable cells along each of 3 axes = 15... per axis: 2 left + 3 right
    eq(moves.length, 15, 'rook move count on 6x6x6 from (2,2,2)');
    for (const m of moves) {
      const { x, y, z } = st.geo.xyz(m.to);
      const differing = (x !== 2) + (y !== 2) + (z !== 2);
      eq(differing, 1, 'rook moves change exactly one axis');
    }
  });

  test('rook is blocked by a friendly piece and captures an enemy', () => {
    const st = position(D6, { '0,0,0': 'wr', '0,0,2': 'wp', '3,0,0': 'bp' });
    const dests = destSet(st, pseudoMoves(st, at(st, 0, 0, 0)));
    assert(dests.includes('0,0,1'), 'can reach the cell before the friendly');
    assert(!dests.includes('0,0,2'), 'cannot capture own piece');
    assert(!dests.includes('0,0,3'), 'cannot slide through own piece');
    assert(dests.includes('3,0,0'), 'can capture the enemy');
    assert(!dests.includes('4,0,0'), 'cannot slide past a capture');
  });

  test('knight from the centre has all 24 leaps and jumps over blockers', () => {
    const st = position(D6, { '2,2,2': 'wn' });
    eq(pseudoMoves(st, at(st, 2, 2, 2)).length, 24);

    // Surround it completely; a leaper must be unaffected.
    const boxed = { '2,2,2': 'wn' };
    for (const [dx, dy, dz] of ALL_DIRS) boxed[`${2 + dx},${2 + dy},${2 + dz}`] = 'wp';
    const st2 = position(D6, boxed);
    eq(pseudoMoves(st2, at(st2, 2, 2, 2)).length, 24, 'knight still has 24 leaps when boxed in');
  });

  test('king in the centre has 26 moves, in a corner has 7', () => {
    const centre = position(D6, { '2,2,2': 'wk' });
    eq(pseudoMoves(centre, at(centre, 2, 2, 2)).length, 26);
    const corner = position(D6, { '0,0,0': 'wk' });
    eq(pseudoMoves(corner, at(corner, 0, 0, 0)).length, 7);
  });

  test('queen equals rook plus bishop', () => {
    const q = position(D6, { '2,2,2': 'wq' });
    const r = position(D6, { '2,2,2': 'wr' });
    const b = position(D6, { '2,2,2': 'wb' });
    const qn = pseudoMoves(q, at(q, 2, 2, 2)).length;
    const rn = pseudoMoves(r, at(r, 2, 2, 2)).length;
    const bn = pseudoMoves(b, at(b, 2, 2, 2)).length;
    eq(qn, rn + bn, 'queen count == rook + bishop');
  });

  test('pieces cannot leave the board', () => {
    const st = position(D6, { '0,0,0': 'wq' });
    for (const m of pseudoMoves(st, at(st, 0, 0, 0))) {
      const { x, y, z } = st.geo.xyz(m.to);
      assert(st.geo.inBounds(x, y, z), 'move stayed in bounds');
    }
  });
});

// ===========================================================================
// Pawns
// ===========================================================================

suite('Pawns', () => {
  test('white advances +z, black advances -z', () => {
    const st = position(D6, { '2,2,2': 'wp' });
    const w = destSet(st, pseudoMoves(st, at(st, 2, 2, 2)));
    deepEq(w, ['2,2,3'], 'white quiet move');

    const st2 = position(D6, { '2,2,2': 'bp' }, 'b');
    const b = destSet(st2, pseudoMoves(st2, at(st2, 2, 2, 2)));
    deepEq(b, ['2,2,1'], 'black quiet move');
  });

  test('double step only from the starting rank, and not through a blocker', () => {
    const st = position(D6, { '2,0,1': 'wp' });
    const d = destSet(st, pseudoMoves(st, at(st, 2, 0, 1)));
    deepEq(d, ['2,0,2', '2,0,3'], 'single and double from rank 1');

    const blocked = position(D6, { '2,0,1': 'wp', '2,0,2': 'bp' });
    eq(pseudoMoves(blocked, at(blocked, 2, 0, 1)).length, 0, 'blocked directly in front');

    const farBlocked = position(D6, { '2,0,1': 'wp', '2,0,3': 'bp' });
    deepEq(destSet(farBlocked, pseudoMoves(farBlocked, at(farBlocked, 2, 0, 1))), ['2,0,2']);
  });

  test('a pawn that has already moved cannot double step', () => {
    const st = position(D6, { '2,0,1': 'wpm' });   // trailing m = moved
    deepEq(destSet(st, pseudoMoves(st, at(st, 2, 0, 1))), ['2,0,2']);
  });

  test('captures on the 4 forward diagonals, including up and down a level', () => {
    const st = position(D6, {
      '2,2,2': 'wp',
      '3,2,3': 'bp',   // sideways in x
      '2,3,3': 'bp',   // one level up
      '1,2,3': 'bp',   // sideways in x, other way
      '2,1,3': 'bp',   // one level down
      '3,3,3': 'bp',   // space diagonal — must NOT be capturable
    });
    const d = destSet(st, pseudoMoves(st, at(st, 2, 2, 2)));
    assert(d.includes('3,2,3') && d.includes('1,2,3'), 'x-diagonal captures');
    assert(d.includes('2,3,3') && d.includes('2,1,3'), 'y-diagonal captures');
    assert(!d.includes('3,3,3'), 'space diagonal is not a pawn capture (placeholder rule)');
    assert(d.includes('2,2,3'), 'quiet advance still available');
  });

  test('a pawn cannot capture straight ahead', () => {
    const st = position(D6, { '2,2,2': 'wp', '2,2,3': 'bp' });
    eq(pseudoMoves(st, at(st, 2, 2, 2)).length, 0);
  });

  test('promotion triggers on the far rank', () => {
    const st = position(D6, { '0,0,4': 'wpm' });
    const moves = pseudoMoves(st, at(st, 0, 0, 4));
    eq(moves.length, 1);
    eq(moves[0].promo, 'q', 'auto-promotes to queen');

    applyMove(st, moves[0]);
    eq(st.board[at(st, 0, 0, 5)].t, 'q', 'piece on the board is now a queen');
  });

  test('en passant captures the pawn that double-stepped past', () => {
    const st = position(D6, { '2,0,1': 'wp', '1,0,3': 'bp', '5,5,5': 'wk', '0,5,5': 'bk' });

    const dbl = pseudoMoves(st, at(st, 2, 0, 1)).find((m) => m.double);
    assert(dbl, 'double step available');
    applyMove(st, dbl);
    assert(st.ep, 'en passant target armed');
    eq(st.ep.target, at(st, 2, 0, 2), 'target is the crossed cell');
    eq(st.ep.victim, at(st, 2, 0, 3), 'victim is the pawn itself');

    const epMove = pseudoMoves(st, at(st, 1, 0, 3)).find((m) => m.flag === 'ep');
    assert(epMove, 'black pawn can take en passant');
    eq(epMove.to, at(st, 2, 0, 2), 'lands on the crossed cell');
    eq(epMove.cap, at(st, 2, 0, 3), 'captures on a different cell than it lands');

    applyMove(st, epMove);
    eq(st.board[at(st, 2, 0, 3)], null, 'the double-stepped pawn is gone');
    eq(st.board[at(st, 2, 0, 2)].t, 'p', 'the capturer landed on the crossed cell');
  });

  test('en passant expires after one move', () => {
    const st = position(D6, { '2,0,1': 'wp', '1,0,3': 'bp', '5,5,5': 'wk', '0,5,0': 'bk' });
    applyMove(st, pseudoMoves(st, at(st, 2, 0, 1)).find((m) => m.double));
    // Black plays something else.
    const kingMove = pseudoMoves(st, at(st, 0, 5, 0))[0];
    applyMove(st, kingMove);
    eq(st.ep, null, 'en passant window closed');
  });
});

// ===========================================================================
// Castling
// ===========================================================================

suite('Castling', () => {
  test('king castles two cells toward an unmoved rook', () => {
    const st = position(D6, { '3,0,0': 'wk', '0,0,0': 'wr', '5,5,5': 'bk' });
    const castle = pseudoMoves(st, at(st, 3, 0, 0)).find((m) => m.flag === 'castle');
    assert(castle, 'castle move generated');
    eq(castle.to, at(st, 1, 0, 0), 'king lands two cells over');
    deepEq(castle.extra, [{ from: at(st, 0, 0, 0), to: at(st, 2, 0, 0) }], 'rook jumps the king');

    applyMove(st, castle);
    eq(st.board[at(st, 1, 0, 0)].t, 'k');
    eq(st.board[at(st, 2, 0, 0)].t, 'r');
    eq(st.board[at(st, 0, 0, 0)], null);
    eq(st.board[at(st, 3, 0, 0)], null);
  });

  test('castling is blocked by a piece in the corridor', () => {
    const st = position(D6, { '3,0,0': 'wk', '0,0,0': 'wr', '2,0,0': 'wn', '5,5,5': 'bk' });
    assert(!pseudoMoves(st, at(st, 3, 0, 0)).some((m) => m.flag === 'castle'));
  });

  test('a moved king or a moved rook cannot castle', () => {
    const movedKing = position(D6, { '3,0,0': 'wkm', '0,0,0': 'wr', '5,5,5': 'bk' });
    assert(!pseudoMoves(movedKing, at(movedKing, 3, 0, 0)).some((m) => m.flag === 'castle'));

    const movedRook = position(D6, { '3,0,0': 'wk', '0,0,0': 'wrm', '5,5,5': 'bk' });
    assert(!pseudoMoves(movedRook, at(movedRook, 3, 0, 0)).some((m) => m.flag === 'castle'));
  });

  test('cannot castle out of, through, or into check', () => {
    // Black rook aims down the z axis at the cell the king must cross.
    const through = position(D6, { '3,0,0': 'wk', '0,0,0': 'wr', '2,0,5': 'br', '5,5,5': 'bk' });
    assert(!pseudoMoves(through, at(through, 3, 0, 0)).some((m) => m.flag === 'castle'),
      'blocked by attack on the crossed cell');

    const into = position(D6, { '3,0,0': 'wk', '0,0,0': 'wr', '1,0,5': 'br', '5,5,5': 'bk' });
    assert(!pseudoMoves(into, at(into, 3, 0, 0)).some((m) => m.flag === 'castle'),
      'blocked by attack on the destination');

    const outOf = position(D6, { '3,0,0': 'wk', '0,0,0': 'wr', '3,0,5': 'br', '5,5,5': 'bk' });
    assert(!pseudoMoves(outOf, at(outOf, 3, 0, 0)).some((m) => m.flag === 'castle'),
      'blocked while in check');
  });
});

// ===========================================================================
// Check, mate, stalemate, pins
// ===========================================================================

suite('Check and legality', () => {
  test('isAttacked sees a rook down an open line and not through a blocker', () => {
    const open = position(D6, { '0,0,5': 'br', '0,0,0': 'wk' });
    assert(isAttacked(open, at(open, 0, 0, 0), 'b'), 'attacked along the open file');

    const blocked = position(D6, { '0,0,5': 'br', '0,0,2': 'wp', '0,0,0': 'wk' });
    assert(!isAttacked(blocked, at(blocked, 0, 0, 0), 'b'), 'blocker stops the attack');
  });

  test('inCheck agrees with isAttacked on the king cell', () => {
    const st = position(D6, { '0,0,5': 'br', '0,0,0': 'wk', '5,5,5': 'bk' }, 'w');
    assert(inCheck(st, 'w'));
    assert(!inCheck(st, 'b'));
  });

  test('a pinned piece may only move along the pin line', () => {
    const st = position(D6, { '0,0,0': 'wk', '0,0,1': 'wr', '0,0,5': 'br', '5,5,5': 'bk' }, 'w');
    const moves = legalMoves(st, at(st, 0, 0, 1));
    assert(moves.length > 0, 'the pinned rook still has moves along the pin');
    for (const m of moves) {
      const { x, y } = st.geo.xyz(m.to);
      assert(x === 0 && y === 0, 'pinned rook stayed on the pin line');
    }
    assert(moves.some((m) => m.to === at(st, 0, 0, 5)), 'it may capture the pinner');
  });

  test('a king may not move into an attacked cell', () => {
    // The rook on (1,0,5) rakes the z axis, covering (1,0,1) and (1,0,0) —
    // two of the corner king's seven escape cells.
    const st = position(D6, { '0,0,0': 'wk', '1,0,5': 'br', '5,5,5': 'bk' }, 'w');
    const dests = destSet(st, legalMoves(st, at(st, 0, 0, 0)));
    assert(!dests.includes('1,0,0'), '(1,0,0) is raked by the rook');
    assert(!dests.includes('1,0,1'), '(1,0,1) is raked by the rook');
    eq(dests.length, 5, 'the other five escape cells remain');
  });

  test('a rook covers a line, not a plane', () => {
    // Worth pinning down explicitly: in 3D the "file" through (1,y,z) is a
    // whole plane, and a single rook does not attack a plane. A rook on
    // (1,5,5) reaches (1,0,0) on no axis at all.
    const st = position(D6, { '1,5,5': 'br' });
    assert(!isAttacked(st, at(st, 1, 0, 0), 'b'), 'needs two axes to change');
    assert(isAttacked(st, at(st, 1, 0, 5), 'b'), 'same x and z, straight down y');
    assert(isAttacked(st, at(st, 1, 5, 0), 'b'), 'same x and y, straight down z');
  });

  test('checkmate is detected', () => {
    // Black king cornered by its own pawns, white rook checks down the z axis
    // and simultaneously covers the one free escape cell.
    const st = position(D6, {
      '0,0,0': 'bk',
      '1,0,0': 'bpm', '0,1,0': 'bpm', '1,1,0': 'bpm',
      '1,0,1': 'bpm', '0,1,1': 'bpm', '1,1,1': 'bpm',
      '0,0,5': 'wr',
      '5,5,5': 'wk',
    }, 'b');

    assert(inCheck(st, 'b'), 'black is in check');
    eq(allLegalMoves(st, 'b').length, 0, 'black has no legal moves');
    const status = gameStatus(st);
    assert(status.over, 'game is over');
    eq(status.reason, 'checkmate');
    eq(status.result, 'w');
  });

  test('stalemate is detected', () => {
    // Same box, but no checking piece: black is not in check and cannot move.
    const st = position(D6, {
      '0,0,0': 'bk',
      '1,0,0': 'bpm', '0,1,0': 'bpm', '1,1,0': 'bpm',
      '0,0,1': 'bpm', '1,0,1': 'bpm', '0,1,1': 'bpm', '1,1,1': 'bpm',
      '5,5,5': 'wk',
    }, 'b');

    assert(!inCheck(st, 'b'), 'black is not in check');
    eq(allLegalMoves(st, 'b').length, 0, 'black has no legal moves');
    const status = gameStatus(st);
    assert(status.over);
    eq(status.reason, 'stalemate');
    eq(status.result, 'draw');
  });

  test('king and king is a draw by insufficient material', () => {
    const st = position(D6, { '0,0,0': 'wk', '5,5,5': 'bk' }, 'w');
    const status = gameStatus(st);
    assert(status.over);
    eq(status.reason, 'insufficient material');
  });
});

// ===========================================================================
// Apply / undo integrity
// ===========================================================================

suite('Apply and undo', () => {
  const snapshot = (st) => JSON.stringify({
    board: st.board, turn: st.turn, ep: st.ep, halfmove: st.halfmove, fullmove: st.fullmove,
  });

  test('undo restores the position exactly, for every legal opening move', () => {
    setBoardSize(6);
    const { board, geo } = startingPosition(D6);
    const st = { geo, board, turn: 'w', ep: null, halfmove: 0, fullmove: 1 };
    const before = snapshot(st);

    let count = 0;
    for (const m of allLegalMoves(st, 'w')) {
      const undo = applyMove(st, m);
      undoMove(st, undo);
      eq(snapshot(st), before, 'position restored after move ' + count);
      count++;
    }
    assert(count > 50, `expected a decent number of opening moves, got ${count}`);
  });

  test('undo restores compound moves (castling and en passant)', () => {
    const castleSt = position(D6, { '3,0,0': 'wk', '0,0,0': 'wr', '5,5,5': 'bk' });
    const beforeCastle = snapshot(castleSt);
    const castle = pseudoMoves(castleSt, at(castleSt, 3, 0, 0)).find((m) => m.flag === 'castle');
    undoMove(castleSt, applyMove(castleSt, castle));
    eq(snapshot(castleSt), beforeCastle, 'castling undone');

    const epSt = position(D6, { '2,0,1': 'wp', '1,0,3': 'bp', '5,5,5': 'wk', '0,5,5': 'bk' });
    applyMove(epSt, pseudoMoves(epSt, at(epSt, 2, 0, 1)).find((m) => m.double));
    const beforeEp = snapshot(epSt);
    const ep = pseudoMoves(epSt, at(epSt, 1, 0, 3)).find((m) => m.flag === 'ep');
    undoMove(epSt, applyMove(epSt, ep));
    eq(snapshot(epSt), beforeEp, 'en passant undone');
  });

  test('the moved flag is set and restored', () => {
    const st = position(D6, { '0,0,0': 'wr', '5,5,5': 'bk', '0,5,0': 'wk' });
    eq(st.board[at(st, 0, 0, 0)].moved, false);
    const m = pseudoMoves(st, at(st, 0, 0, 0))[0];
    const undo = applyMove(st, m);
    eq(st.board[m.to].moved, true, 'moved flag set');
    undoMove(st, undo);
    eq(st.board[at(st, 0, 0, 0)].moved, false, 'moved flag restored');
  });
});

// ===========================================================================
// GameState
// ===========================================================================

suite('GameState', () => {
  test('play rejects an illegal move and accepts a legal one', () => {
    setBoardSize(6);
    const gs = new GameState(D6);
    const from = gs.geo.idx(0, 0, 1);          // a white pawn
    eq(gs.play({ from, to: gs.geo.idx(3, 3, 3) }), null, 'nonsense move rejected');
    eq(gs.turn, 'w', 'turn unchanged after a rejected move');

    const ok = gs.play({ from, to: gs.geo.idx(0, 0, 2) });
    assert(ok, 'legal pawn push accepted');
    eq(gs.turn, 'b', 'turn passed to black');
    eq(gs.log.length, 1, 'move logged');
  });

  test('the side not to move cannot move', () => {
    setBoardSize(6);
    const gs = new GameState(D6);
    const blackPawn = gs.geo.idx(0, 0, 4);
    eq(gs.play({ from: blackPawn, to: gs.geo.idx(0, 0, 3) }), null);
  });

  test('captures land in the right tray and score material', () => {
    setBoardSize(6);
    const gs = new GameState(D6);
    gs.board = gs.board.map(() => null);
    gs.board[gs.geo.idx(0, 0, 0)] = { t: 'k', c: 'w', moved: true };
    gs.board[gs.geo.idx(5, 5, 5)] = { t: 'k', c: 'b', moved: true };
    gs.board[gs.geo.idx(0, 0, 3)] = { t: 'r', c: 'w', moved: true };
    gs.board[gs.geo.idx(0, 0, 4)] = { t: 'q', c: 'b', moved: true };

    const res = gs.play({ from: gs.geo.idx(0, 0, 3), to: gs.geo.idx(0, 0, 4) });
    assert(res, 'capture accepted');
    deepEq(gs.captured.w, ['q'], 'white captured a queen');
    deepEq(gs.captured.b, [], 'black captured nothing');
    eq(gs.materialFor('w'), Config.values.q);
    eq(res.sound, 'capture');
  });

  test('serialize and deserialize round-trip', () => {
    setBoardSize(6);
    const gs = new GameState(D6);
    gs.play({ from: gs.geo.idx(0, 0, 1), to: gs.geo.idx(0, 0, 3) });
    gs.play({ from: gs.geo.idx(5, 0, 4), to: gs.geo.idx(5, 0, 2) });

    const copy = GameState.deserialize(gs.serialize());
    deepEq(copy.board, gs.board, 'boards match');
    eq(copy.turn, gs.turn);
    eq(copy.fullmove, gs.fullmove);
    deepEq(copy.ep, gs.ep, 'en passant state survives');
    eq(copy.log.length, gs.log.length);
  });

  test('notation reads sensibly', () => {
    setBoardSize(6);
    const gs = new GameState(D6);
    const res = gs.play({ from: gs.geo.idx(0, 0, 1), to: gs.geo.idx(0, 0, 3) });
    eq(res.entry.text, 'a2L1-a4L1');
  });

  test('a full random game terminates without throwing', () => {
    setBoardSize(6);
    const gs = new GameState(D6);
    let plies = 0;
    // Deterministic pseudo-random so a failure is reproducible.
    let seed = 12345;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

    while (!gs.outcome && plies < 120) {
      const moves = gs.allMoves();
      if (!moves.length) break;
      const m = moves[Math.floor(rand() * moves.length)];
      const res = gs.play(m);
      assert(res, `move ${plies} was rejected by play()`);
      plies++;
    }
    assert(plies > 0, 'at least one move was made');
    // Every logged move must still be re-derivable from the board history.
    eq(gs.log.length, plies, 'log length matches plies played');
  });
});

// ===========================================================================
// Board size independence
// ===========================================================================

suite('Board size is a variable', () => {
  for (const n of [4, 5, 6, 8]) {
    test(`a game on ${n}x${n}x${n} generates legal moves and plays 6 plies`, () => {
      setBoardSize(n);
      const dims = { x: n, y: n, z: n };
      const gs = new GameState(dims);
      eq(gs.board.length, n * n * n, 'board array sized correctly');
      assert(findKing(gs.board, 'w') >= 0, 'white king present');
      assert(findKing(gs.board, 'b') >= 0, 'black king present');

      for (let i = 0; i < 6 && !gs.outcome; i++) {
        const moves = gs.allMoves();
        assert(moves.length > 0, `side to move has options at ply ${i}`);
        assert(gs.play(moves[0]), `ply ${i} accepted`);
      }
    });
  }

  test('a non-cubic board works end to end', () => {
    const dims = { x: 4, y: 3, z: 6 };
    setBoardSize(dims);
    const gs = new GameState(dims);
    eq(gs.board.length, 72);
    assert(gs.allMoves().length > 0, 'white has moves');
    assert(gs.play(gs.allMoves()[0]), 'a move can be played');
  });
});

// Restore the default so the app is unaffected if both are loaded.
setBoardSize(6);

export { results };
