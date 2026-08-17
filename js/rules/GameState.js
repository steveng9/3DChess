/*
 * 3D Chess — GameState.js
 *
 * Owns a position plus everything derived from it: whose turn, captured
 * material, the move log, repetition history and the terminal status. It is
 * view-free and network-free — App.js drives it, Renderer3D.js reads it, and
 * Net.js ships `serialize()` output over the wire.
 */

import { Config, setBoardSize, other } from './Config.js';
import { makeGeometry, cellName, positionKey, cloneBoard, findKing } from './Board.js';
import { startingPosition } from './Setup.js';
import {
  applyMove, undoMove, legalMoves, allLegalMoves,
  gameStatus, inCheck,
} from './MoveGen.js';
import { PIECE_NAMES } from './Pieces.js';

export class GameState {
  constructor(dims = Config.dims) {
    this.reset(dims);
  }

  reset(dims = Config.dims) {
    const { board, geo } = startingPosition(dims);
    this.geo = geo;
    this.board = board;
    this.turn = 'w';
    this.ep = null;
    this.halfmove = 0;
    this.fullmove = 1;

    /** Pieces each colour has taken from the opponent. */
    this.captured = { w: [], b: [] };
    /** Full move log: { move, text, colour, check, mate }. */
    this.log = [];
    /** positionKey history, for threefold repetition. */
    this.keys = [positionKey(this.board, this.turn, this.ep)];
    /** Set when the game ends: { result, reason }. result = 'w'|'b'|'draw'. */
    this.outcome = null;
    return this;
  }

  // ---- queries ---------------------------------------------------------

  get dims() { return this.geo.dims; }

  pieceAt(i) { return this.board[i]; }

  /** Legal moves from a cell, as a Map keyed by destination index. */
  movesFrom(i) {
    if (this.outcome) return new Map();
    const p = this.board[i];
    if (!p || p.c !== this.turn) return new Map();
    const map = new Map();
    for (const m of legalMoves(this, i)) map.set(m.to, m);
    return map;
  }

  allMoves(colour = this.turn) { return allLegalMoves(this, colour); }

  status() {
    if (this.outcome) return { over: true, ...this.outcome, check: false };
    return gameStatus(this, this.keys);
  }

  inCheck(colour = this.turn) { return inCheck(this, colour); }

  kingIndex(colour) { return findKing(this.board, colour); }

  /** Total value of material captured by `colour`, using Config.values. */
  materialFor(colour) {
    return this.captured[colour].reduce((s, t) => s + (Config.values[t] || 0), 0);
  }

  // ---- mutation --------------------------------------------------------

  /**
   * Play a move. Accepts a Move object, or {from, to} which is resolved against
   * the legal move list. Returns a result descriptor, or null if illegal.
   */
  play(input) {
    if (this.outcome) return null;

    let move = input;
    if (move && move.to !== undefined && move.t === undefined) {
      move = this.movesFrom(move.from).get(move.to) || null;
    }
    if (!move) return null;

    // Re-validate against the legal list so a hostile or stale client cannot
    // inject a fabricated move object.
    const legal = this.movesFrom(move.from).get(move.to);
    if (!legal) return null;
    move = legal;

    const mover = this.board[move.from].c;
    if (move.capT) this.captured[mover].push(move.capT);

    applyMove(this, move);
    this.keys.push(positionKey(this.board, this.turn, this.ep));

    const status = this.status();
    if (status.over) this.outcome = { result: status.result, reason: status.reason };

    const entry = {
      move,
      colour: mover,
      text: this.notate(move, status),
      check: !!status.check,
      mate: status.over && status.reason === 'checkmate',
    };
    this.log.push(entry);

    return {
      move,
      entry,
      status,
      sound: status.over && status.reason === 'checkmate' ? 'end'
        : status.check ? 'check'
          : move.capT ? 'capture'
            : 'move',
    };
  }

  /** End the game outside of normal play (resignation, agreed draw, timeout). */
  finish(result, reason) {
    if (this.outcome) return this.outcome;
    this.outcome = { result, reason };
    return this.outcome;
  }

  // ---- notation --------------------------------------------------------

  /** e.g. "Nc1L1xd3L2+", "e2L1-e4L1", "O-O", "b7L1-b8L1=Q#" */
  notate(move, status) {
    if (move.flag === 'castle') {
      const dir = this.geo.xyz(move.to).x > this.geo.xyz(move.from).x;
      return dir ? 'O-O' : 'O-O-O';
    }
    const letter = move.t === 'p' ? '' : move.t.toUpperCase();
    const sep = move.cap !== null ? 'x' : '-';
    let s = letter + cellName(this.geo, move.from) + sep + cellName(this.geo, move.to);
    if (move.flag === 'ep') s += ' e.p.';
    if (move.promo) s += '=' + move.promo.toUpperCase();
    if (status) {
      if (status.over && status.reason === 'checkmate') s += '#';
      else if (status.check) s += '+';
    }
    return s;
  }

  describeCell(i) {
    const p = this.board[i];
    const name = cellName(this.geo, i);
    if (!p) return name;
    return `${p.c === 'w' ? 'White' : 'Black'} ${PIECE_NAMES[p.t]} on ${name}`;
  }

  // ---- serialisation (host -> client snapshots) ------------------------

  serialize() {
    return {
      dims: this.geo.dims,
      board: this.board.map((p) => (p ? p.c + p.t + (p.moved ? '1' : '0') : '')),
      turn: this.turn,
      ep: this.ep,
      halfmove: this.halfmove,
      fullmove: this.fullmove,
      captured: { w: [...this.captured.w], b: [...this.captured.b] },
      log: this.log.map((e) => ({
        text: e.text, colour: e.colour, check: e.check, mate: e.mate,
        from: e.move.from, to: e.move.to,
      })),
      outcome: this.outcome,
      keys: this.keys,
    };
  }

  static deserialize(snap) {
    setBoardSize(snap.dims);
    const gs = new GameState(snap.dims);
    gs.geo = makeGeometry(snap.dims);
    gs.board = snap.board.map((s) => (s ? { t: s[1], c: s[0], moved: s[2] === '1' } : null));
    gs.turn = snap.turn;
    gs.ep = snap.ep;
    gs.halfmove = snap.halfmove;
    gs.fullmove = snap.fullmove;
    gs.captured = { w: [...snap.captured.w], b: [...snap.captured.b] };
    gs.log = snap.log.map((e) => ({ ...e, move: { from: e.from, to: e.to } }));
    gs.outcome = snap.outcome;
    gs.keys = snap.keys || [];
    return gs;
  }

  clone() {
    const gs = new GameState(this.geo.dims);
    gs.geo = makeGeometry(this.geo.dims);
    gs.board = cloneBoard(this.board);
    gs.turn = this.turn;
    gs.ep = this.ep;
    gs.halfmove = this.halfmove;
    gs.fullmove = this.fullmove;
    gs.captured = { w: [...this.captured.w], b: [...this.captured.b] };
    gs.log = [...this.log];
    gs.keys = [...this.keys];
    gs.outcome = this.outcome;
    return gs;
  }
}

export { applyMove, undoMove, other };
