/*
 * 3D Chess — App.js
 *
 * Entry point and orchestrator. Owns the four run modes and routes every user
 * action through the one place that is allowed to change the position.
 *
 *   practice   local, plays both sides. No network. Used for development and
 *              for eyeballing movement rules.
 *   host       authoritative. Owns the real GameState, validates the opponent's
 *              moves, broadcasts snapshots.
 *   client     the second player. Previews its own legal moves locally for
 *              responsiveness, but only the host's snapshot is ever believed.
 *   spectator  receives snapshots, may rotate and slice the board, may chat,
 *              may not move.
 *
 * The authority split matters: the host is the single source of truth, so a
 * client that sends a malformed or illegal move simply has it rejected rather
 * than desyncing the two boards.
 */

import { Config, setBoardSize, other } from '../rules/Config.js';
import { GameState } from '../rules/GameState.js';
import { Renderer3D } from '../view/Renderer3D.js';
import { UI } from '../view/UI.js';
import { sounds } from '../view/Sounds.js';
import { hostGame, listGames } from '../net/Lobby.js';
import { NetClient } from '../net/Net.js';

class App {
  constructor() {
    this.ui = new UI();
    this.renderer = null;

    this.mode = null;          // 'practice' | 'host' | 'client' | 'spectator'
    this.state = null;
    this.seat = null;          // 'w' | 'b' | null (spectator)
    this.names = { w: 'White', b: 'Black' };

    this.selected = -1;
    this.moves = new Map();    // destination index -> Move
    this.lastMove = null;

    this.host = null;          // NetHost
    this.client = null;        // NetClient
    this.drawOfferFrom = null;

    this.slice = { axis: '', index: 0 };

    this._bindLobby();
    this._bindGameControls();

    const saved = localStorage.getItem('3dchess.name');
    if (saved) this.ui.playerName = saved;

    this.refreshLobby();
    window.addEventListener('beforeunload', () => this.teardownNet());
  }

  // =========================================================================
  // Lobby
  // =========================================================================

  _bindLobby() {
    this.ui.el.btnHost.addEventListener('click', () => this.startHost());
    this.ui.el.btnPractice.addEventListener('click', () => this.startPractice());
    this.ui.el.btnRefresh.addEventListener('click', () => this.refreshLobby());
    this.ui.el.nameInput.addEventListener('change', () => {
      localStorage.setItem('3dchess.name', this.ui.playerName);
    });
  }

  async refreshLobby() {
    this.ui.setLobbyStatus('Looking for open games…');
    this.ui.renderGames([], () => {});
    const found = [];
    try {
      await listGames((game) => {
        found.push(game);
        this.ui.renderGames(found, (g, role) => this.joinGame(g, role));
      });
      this.ui.setLobbyStatus(
        found.length
          ? `${found.length} game${found.length === 1 ? '' : 's'} found.`
          : 'No games running. Host one, or try practice mode.',
      );
    } catch (err) {
      console.error(err);
      this.ui.setLobbyStatus(`Could not reach the matchmaking broker: ${err.message}`);
    }
  }

  // =========================================================================
  // Starting a game
  // =========================================================================

  _ensureRenderer() {
    if (!this.renderer) {
      this.renderer = new Renderer3D(this.ui.el.viewport);
      this.renderer.onPick = (cell) => this.handlePick(cell);
    }
    return this.renderer;
  }

  _enterGame() {
    this.ui.showScreen('game');
    this._ensureRenderer();
    // The viewport has no size until the screen is visible.
    requestAnimationFrame(() => this.renderer.resize());
    this.renderer.build(this.state.dims);
    this.renderer.viewFrom(this.seat || 'w');
    this._resetSliceControls();
    this.refreshAll();
  }

  startPractice() {
    setBoardSize(this.ui.boardSize);
    this.mode = 'practice';
    this.state = new GameState(Config.dims);
    this.seat = 'w';
    this.names = { w: 'White (you)', b: 'Black (you)' };
    this.ui.clearChat();
    this.ui.addChat({ system: true, text: 'Practice mode — you control both sides. Nothing is sent over the network.' });
    this.ui.el.gameActions.hidden = false;
    this._enterGame();
  }

  async startHost() {
    setBoardSize(this.ui.boardSize);
    const colour = this.ui.hostColour;
    const name = this.ui.playerName;

    this.ui.setLobbyStatus('Claiming a game slot…');
    let host;
    try {
      host = await hostGame({
        hostName: name,
        hostColour: colour,
        size: Config.dims.x,
        dims: Config.dims,
      });
    } catch (err) {
      console.error(err);
      this.ui.setLobbyStatus(err.message);
      return;
    }

    this.host = host;
    this.mode = 'host';
    this.seat = colour;
    this.state = new GameState(Config.dims);
    this.names = { w: colour === 'w' ? name : 'Waiting…', b: colour === 'b' ? name : 'Waiting…' };

    this._bindHostEvents();
    this.ui.clearChat();
    this.ui.addChat({ system: true, text: 'Game created. Waiting for an opponent to join from the lobby…' });
    this.ui.el.gameActions.hidden = false;
    this._enterGame();
    this.ui.banner('Waiting for an opponent…');
  }

  async joinGame(game, role) {
    const name = this.ui.playerName;
    this.ui.setLobbyStatus(`Connecting to ${game.meta.hostName || 'host'}…`);

    const client = new NetClient(game.peerId, name, role);
    this._bindClientEvents(client);
    try {
      await client.connect();
    } catch (err) {
      console.error(err);
      this.ui.setLobbyStatus(err.message);
      client.close();
      return;
    }
    this.client = client;
    this.mode = role === 'player' ? 'client' : 'spectator';
    // Seat, board and names all arrive with the host's `welcome` message.
  }

  // =========================================================================
  // Host-side networking
  // =========================================================================

  _bindHostEvents() {
    const h = this.host;

    h.on('join', (conn, info) => {
      if (info.role === 'player') {
        this.names[info.colour] = info.name;
        this.ui.banner('');
      }
      h.send(conn, 'welcome', {
        role: info.role,
        colour: info.colour,
        snapshot: this.state.serialize(),
        names: this.names,
        meta: h.meta,
      });
      h.broadcast('players', { names: this.names });
      const line = info.role === 'player'
        ? `${info.name} joined as ${info.colour === 'w' ? 'White' : 'Black'}.`
        : `${info.name} is watching.`;
      this.ui.addChat({ system: true, text: line });
      h.broadcast('chat', { system: true, text: line });
      this.refreshAll();
    });

    h.on('leave', (conn, info) => {
      const line = `${info.name} left.`;
      this.ui.addChat({ system: true, text: line });
      h.broadcast('chat', { system: true, text: line });
      if (info.role === 'player' && !this.state.outcome) {
        this.names[info.colour] = 'Waiting…';
        h.broadcast('players', { names: this.names });
        this.ui.banner('Opponent disconnected — waiting for a new one…');
      }
      this.refreshAll();
    });

    h.on('move', (msg, conn, info) => {
      // Only the seated opponent may move, and only on their own turn.
      if (info.role !== 'player' || info.colour !== this.state.turn) {
        h.send(conn, 'rejected', { reason: 'Not your turn.' });
        return;
      }
      const result = this.state.play({ from: msg.from, to: msg.to });
      if (!result) {
        h.send(conn, 'rejected', { reason: 'Illegal move.' });
        h.send(conn, 'state', { snapshot: this.state.serialize() });   // resync
        return;
      }
      this.afterMove(result, true);
    });

    h.on('chat', (msg, conn, info) => {
      const payload = { name: info.name, text: String(msg.text || '').slice(0, 240), colour: info.colour };
      if (!payload.text) return;
      this.ui.addChat(payload);
      sounds.play('chat');
      h.broadcast('chat', payload);
    });

    h.on('resign', (msg, conn, info) => {
      if (info.role !== 'player' || this.state.outcome) return;
      this.state.finish(other(info.colour), 'resignation');
      this.announceEnd();
    });

    h.on('draw-offer', (msg, conn, info) => {
      if (info.role !== 'player' || this.state.outcome) return;
      this.receiveDrawOffer(info.name);
    });

    h.on('draw-response', (msg, conn, info) => {
      if (info.role !== 'player') return;
      this.resolveDrawResponse(msg.accept, info.name);
    });

    h.on('error', (err) => {
      console.error('[host]', err);
      this.ui.toast('Network error — see console.');
    });
  }

  // =========================================================================
  // Client-side networking
  // =========================================================================

  _bindClientEvents(client) {
    client.on('welcome', (msg) => {
      this.seat = msg.colour;
      this.names = msg.names;
      this.state = GameState.deserialize(msg.snapshot);
      this.mode = msg.role === 'player' ? 'client' : 'spectator';
      this.ui.clearChat();
      this.ui.addChat({
        system: true,
        text: this.mode === 'spectator'
          ? 'You are watching. Drag to rotate the board.'
          : `You are playing ${this.seat === 'w' ? 'White' : 'Black'}.`,
      });
      this.ui.el.gameActions.hidden = this.mode === 'spectator';
      this._enterGame();
    });

    client.on('state', (msg) => {
      this.state = GameState.deserialize(msg.snapshot);
      this.lastMove = msg.lastMove || null;
      this.clearSelection();
      if (msg.sound) sounds.play(msg.sound);
      this.refreshAll();
      if (this.state.outcome) this.announceEnd(false);
    });

    client.on('players', (msg) => {
      this.names = msg.names;
      this.ui.setPlayers(this.names, this.seat);
      this.ui.banner(Object.values(this.names).includes('Waiting…') ? 'Waiting for an opponent…' : '');
    });

    client.on('chat', (msg) => {
      this.ui.addChat(msg);
      if (!msg.system) sounds.play('chat');
    });

    client.on('rejected', (msg) => {
      this.ui.toast(msg.reason || 'Move rejected.');
      this.clearSelection();
      this.refreshAll();
    });

    client.on('draw-offer', () => this.receiveDrawOffer(this.names[other(this.seat)] || 'Your opponent'));
    client.on('draw-declined', () => this.ui.toast('Draw offer declined.'));

    client.on('closed', () => {
      this.ui.banner('Disconnected from the host.');
      this.ui.toast('The host closed the game.');
    });

    client.on('error', (err) => console.error('[client]', err));
  }

  // =========================================================================
  // Board interaction
  // =========================================================================

  /** The colour this browser is allowed to move right now, or null. */
  get movingSeat() {
    if (this.mode === 'practice') return this.state.turn;
    if (this.mode === 'host' || this.mode === 'client') return this.seat;
    return null;
  }

  get canMoveNow() {
    if (!this.state || this.state.outcome) return false;
    // A host sitting alone in a room should not be able to start playing
    // against nobody — the seat has to be filled first.
    if (this.mode === 'host' && !this.host?.opponent) return false;
    return this.movingSeat === this.state.turn;
  }

  handlePick(cell) {
    if (!this.state) return;

    if (cell < 0) { this.clearSelection(); this.refreshAll(); return; }

    // Clicking a highlighted destination commits the move.
    if (this.moves.has(cell)) {
      this.submitMove(this.moves.get(cell));
      return;
    }

    const piece = this.state.pieceAt(cell);
    if (piece && this.canMoveNow && piece.c === this.state.turn) {
      this.selected = cell;
      this.moves = this.state.movesFrom(cell);
      if (this.moves.size === 0) this.ui.toast(`${this.state.describeCell(cell)} has no legal moves.`);
    } else {
      this.clearSelection();
    }
    this.refreshAll();
  }

  clearSelection() {
    this.selected = -1;
    this.moves = new Map();
  }

  submitMove(move) {
    if (this.mode === 'client') {
      this.client.send('move', { from: move.from, to: move.to });
      this.clearSelection();
      this.refreshAll();
      return;
    }
    const result = this.state.play(move);
    this.clearSelection();
    if (!result) { this.ui.toast('Illegal move.'); this.refreshAll(); return; }
    this.afterMove(result, this.mode === 'host');
  }

  /** Applied after a move lands locally (practice) or on the host. */
  afterMove(result, broadcast) {
    this.lastMove = { from: result.move.from, to: result.move.to };
    this.drawOfferFrom = null;
    sounds.play(result.sound);
    this.clearSelection();
    this.refreshAll();

    if (broadcast && this.host) {
      this.host.broadcast('state', {
        snapshot: this.state.serialize(),
        sound: result.sound,
        lastMove: this.lastMove,
      });
    }
    if (this.state.outcome) this.announceEnd();
  }

  // =========================================================================
  // Rendering
  // =========================================================================

  refreshAll() {
    if (!this.state || !this.renderer) return;

    this.renderer.setPieces(this.state.board);
    this.renderer.setPickable(this.buildPickable());
    this.renderer.setHighlights(this.buildHighlights());

    this.ui.setPlayers(this.names, this.seat);
    this.ui.setTurn(this.state, this.movingSeat);
    this.ui.renderCaptured(this.state);
    this.ui.renderLog(this.state);

    const locked = !!this.state.outcome || this.mode === 'spectator';
    this.ui.el.btnResign.disabled = locked;
    this.ui.el.btnDraw.disabled = locked;
  }

  buildHighlights() {
    const map = new Map();

    if (this.lastMove) {
      map.set(this.lastMove.from, 'lastMove');
      map.set(this.lastMove.to, 'lastMove');
    }

    if (!this.state.outcome && this.state.inCheck(this.state.turn)) {
      const k = this.state.kingIndex(this.state.turn);
      if (k >= 0) map.set(k, 'check');
    }

    for (const [to, mv] of this.moves) {
      map.set(to, mv.cap !== null ? 'capture' : 'quiet');
    }
    if (this.selected >= 0) map.set(this.selected, 'selected');

    return map;
  }

  /**
   * Restricting what can be clicked is what makes a 216-cell volume usable:
   * with a piece selected only its legal destinations (and your other pieces)
   * respond, so a click near a glowing cell cannot land on the wrong one.
   */
  buildPickable() {
    const set = new Set();
    if (!this.state) return set;

    for (const to of this.moves.keys()) set.add(to);

    if (this.canMoveNow) {
      for (let i = 0; i < this.state.board.length; i++) {
        const p = this.state.board[i];
        if (p && p.c === this.state.turn) set.add(i);
      }
    }
    return set;
  }

  // =========================================================================
  // Game controls
  // =========================================================================

  _bindGameControls() {
    const el = this.ui.el;

    el.sliceAxis.addEventListener('change', () => {
      this.slice.axis = el.sliceAxis.value;
      this.slice.index = 0;
      this._applySlice();
    });
    el.sliceUp.addEventListener('click', () => this._nudgeSlice(1));
    el.sliceDown.addEventListener('click', () => this._nudgeSlice(-1));

    el.btnFlip.addEventListener('click', () => {
      if (!this.renderer) return;
      this._flipped = !this._flipped;
      this.renderer.viewFrom(this._flipped ? other(this.seat || 'w') : (this.seat || 'w'));
    });

    el.btnSpin.addEventListener('click', () => {
      if (!this.renderer) return;
      this._spin = !this._spin;
      this.renderer.setAutoRotate(this._spin);
      el.btnSpin.textContent = this._spin ? 'Stop rotating' : 'Auto-rotate';
    });

    el.btnSound.addEventListener('click', () => {
      const muted = !sounds.muted;
      sounds.setMuted(muted);
      el.btnSound.textContent = `Sound: ${muted ? 'off' : 'on'}`;
    });

    el.btnResign.addEventListener('click', () => this.doResign());
    el.btnDraw.addEventListener('click', () => this.doOfferDraw());
    el.btnLeave.addEventListener('click', () => this.leaveGame());

    el.btnSend.addEventListener('click', () => this.sendChat());
    el.chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.sendChat(); });
    el.btnEmoji.addEventListener('click', () => this.ui.toggleEmoji());

    // Escape clears a selection — handy when a piece is buried in the volume.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.selected >= 0) { this.clearSelection(); this.refreshAll(); }
    });
  }

  _resetSliceControls() {
    this.slice = { axis: '', index: 0 };
    this.ui.el.sliceAxis.value = '';
    this._applySlice();
  }

  _applySlice() {
    const axis = this.slice.axis;
    this.ui.el.sliceRow.hidden = !axis;
    if (axis) {
      const max = this.state.dims[axis];
      this.slice.index = Math.max(0, Math.min(max - 1, this.slice.index));
      const label = axis === 'y' ? `L${this.slice.index + 1}`
        : axis === 'x' ? String.fromCharCode(97 + this.slice.index)
          : String(this.slice.index + 1);
      this.ui.el.sliceLabel.textContent = label;
    }
    this.renderer.setSlice(axis || null, this.slice.index);
  }

  _nudgeSlice(d) {
    if (!this.slice.axis) return;
    const max = this.state.dims[this.slice.axis];
    this.slice.index = (this.slice.index + d + max) % max;
    this._applySlice();
  }

  // ---- chat ----

  sendChat() {
    const input = this.ui.el.chatInput;
    const text = input.value.trim().slice(0, 240);
    if (!text) return;
    input.value = '';
    this.ui.el.emojiPicker.hidden = true;

    const name = this.ui.playerName;
    if (this.mode === 'host') {
      const payload = { name, text, colour: this.seat };
      this.ui.addChat(payload);
      this.host.broadcast('chat', payload);
    } else if (this.client) {
      this.client.send('chat', { text });
    } else {
      this.ui.addChat({ name, text, colour: this.seat });
    }
  }

  // ---- resign / draw ----

  async doResign() {
    const ok = await this.ui.modal(
      'Resign?',
      'This ends the game immediately and awards the win to your opponent.',
      [{ label: 'Cancel', value: false }, { label: 'Resign', value: true, kind: 'danger' }],
    );
    if (!ok) return;

    if (this.mode === 'client') { this.client.send('resign'); return; }
    const loser = this.mode === 'practice' ? this.state.turn : this.seat;
    this.state.finish(other(loser), 'resignation');
    this.announceEnd();
  }

  doOfferDraw() {
    if (this.mode === 'practice') {
      this.state.finish('draw', 'agreement');
      this.announceEnd();
      return;
    }
    if (this.mode === 'client') {
      this.client.send('draw-offer');
    } else if (this.mode === 'host') {
      this.host.broadcast('draw-offer', { from: this.ui.playerName });
    }
    this.ui.toast('Draw offered.');
  }

  async receiveDrawOffer(fromName) {
    const accept = await this.ui.modal(
      'Draw offer',
      `${fromName} offers a draw.`,
      [{ label: 'Decline', value: false }, { label: 'Accept', value: true, kind: 'primary' }],
    );
    if (this.mode === 'client') {
      this.client.send('draw-response', { accept });
    } else {
      this.resolveDrawResponse(accept, this.ui.playerName);
    }
  }

  resolveDrawResponse(accept, fromName) {
    if (!accept) {
      this.ui.toast(`${fromName} declined the draw.`);
      if (this.host) this.host.broadcast('draw-declined', {});
      return;
    }
    this.state.finish('draw', 'agreement');
    this.announceEnd();
  }

  announceEnd(broadcast = true) {
    const o = this.state.outcome;
    if (!o) return;
    sounds.play('end');
    const who = o.result === 'draw' ? 'Draw' : `${o.result === 'w' ? 'White' : 'Black'} wins`;
    this.ui.banner(`${who} — ${o.reason}`);
    this.ui.addChat({ system: true, text: `Game over: ${who} (${o.reason}).` });
    this.refreshAll();

    if (broadcast && this.host) {
      this.host.broadcast('state', {
        snapshot: this.state.serialize(),
        sound: 'end',
        lastMove: this.lastMove,
      });
    }
  }

  // ---- teardown ----

  teardownNet() {
    if (this.host) { this.host.close(); this.host = null; }
    if (this.client) { this.client.close(); this.client = null; }
  }

  leaveGame() {
    this.teardownNet();
    this.mode = null;
    this.state = null;
    this.seat = null;
    this.clearSelection();
    this.lastMove = null;
    this.ui.banner('');
    this.ui.showScreen('lobby');
    this.refreshLobby();
  }
}

// Surfaced so the position can be inspected from the browser console.
window.app = new App();
export { App };
