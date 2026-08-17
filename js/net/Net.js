/*
 * 3D Chess — Net.js
 *
 * WebRTC transport over PeerJS. The host's browser is the authority: it owns
 * the real GameState, validates every incoming move against the legal move
 * list, and broadcasts a full snapshot after each accepted move. Clients and
 * spectators only ever render snapshots, so a tampered client cannot desync
 * the game — the worst it can do is send a move the host rejects.
 *
 * Topology is one host, one opposing player, and any number of spectators.
 * The host also answers lobby probes (see Lobby.js) on the same peer.
 *
 * Message types
 *   -> host   hello {name, role}   move {from,to}   chat {text}
 *             resign   draw-offer   draw-response {accept}   lobby-query
 *   -> peers  welcome {role, colour, snapshot, players, chat, meta}
 *             state {snapshot, sound, lastMove}   chat {name, text, colour}
 *             players {...}   ended {result, reason}   lobby-info {meta}
 *             rejected {reason}
 */

const PEER_OPTS = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  },
};

export function peerOptions() { return PEER_OPTS; }

/** Minimal typed event bus. */
class Emitter {
  constructor() { this._h = new Map(); }
  on(type, fn) {
    if (!this._h.has(type)) this._h.set(type, []);
    this._h.get(type).push(fn);
    return this;
  }
  emit(type, ...args) {
    for (const fn of this._h.get(type) || []) {
      try { fn(...args); } catch (e) { console.error(`[net] handler for "${type}" threw`, e); }
    }
    for (const fn of this._h.get('*') || []) {
      try { fn(type, ...args); } catch (e) { console.error(e); }
    }
  }
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

export class NetHost extends Emitter {
  /**
   * @param {string} peerId well-known slot id claimed from the lobby
   * @param {object} meta   game description shown in the lobby listing
   */
  constructor(peerId, meta) {
    super();
    this.peerId = peerId;
    this.meta = meta;
    this.peer = null;
    this.conns = new Map();      // conn -> { name, role, colour }
    this.opponent = null;        // the conn holding the second seat
  }

  start() {
    return new Promise((resolve, reject) => {
      this.peer = new Peer(this.peerId, PEER_OPTS);
      this.peer.on('open', (id) => resolve(id));
      this.peer.on('connection', (conn) => this._attach(conn));
      this.peer.on('error', (err) => {
        // 'unavailable-id' means the slot was taken between probe and claim;
        // Lobby.hostGame handles retrying with the next slot.
        if (err.type === 'unavailable-id') reject(err);
        else this.emit('error', err);
      });
      this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch (e) { /* gone */ } });
    });
  }

  _attach(conn) {
    conn.on('open', () => {
      // `greeted` separates real participants from lobby probes, which connect,
      // ask for the game card, and disconnect without ever saying hello.
      this.conns.set(conn, { name: 'anonymous', role: 'spectator', colour: null, greeted: false });
    });

    conn.on('data', (msg) => {
      if (!msg || !msg.type) return;

      // Lobby probes are not players — answer and let them disconnect.
      if (msg.type === 'lobby-query') {
        conn.send({ type: 'lobby-info', meta: this.describe() });
        return;
      }

      const info = this.conns.get(conn);
      if (!info) return;

      if (msg.type === 'hello') {
        info.greeted = true;
        info.name = String(msg.name || 'anonymous').slice(0, 24);
        const wantsPlay = msg.role === 'player';
        if (wantsPlay && !this.opponent) {
          this.opponent = conn;
          info.role = 'player';
          info.colour = this.meta.hostColour === 'w' ? 'b' : 'w';
        } else {
          info.role = 'spectator';
          info.colour = null;
        }
        this.emit('join', conn, info);
        return;
      }

      this.emit(msg.type, msg, conn, info);
    });

    conn.on('close', () => {
      const info = this.conns.get(conn);
      this.conns.delete(conn);
      if (this.opponent === conn) this.opponent = null;
      // A probe disconnecting is not somebody leaving the game.
      if (info && info.greeted) this.emit('leave', conn, info);
    });

    conn.on('error', (err) => console.warn('[net] conn error', err));
  }

  send(conn, type, payload = {}) {
    if (conn && conn.open) conn.send({ type, ...payload });
  }

  broadcast(type, payload = {}) {
    for (const conn of this.conns.keys()) this.send(conn, type, payload);
  }

  /** Lobby card contents. */
  describe() {
    let spectators = 0;
    let players = 1;
    for (const info of this.conns.values()) {
      if (!info.greeted) continue;              // in-flight lobby probe
      if (info.role === 'player') players++;
      else spectators++;
    }
    return { ...this.meta, players, spectators, open: !this.opponent };
  }

  updateMeta(patch) { Object.assign(this.meta, patch); }

  close() {
    for (const conn of this.conns.keys()) { try { conn.close(); } catch (e) { /* already gone */ } }
    this.conns.clear();
    try { this.peer?.destroy(); } catch (e) { /* already gone */ }
    this.peer = null;
  }
}

// ---------------------------------------------------------------------------
// Client (player 2 or spectator)
// ---------------------------------------------------------------------------

export class NetClient extends Emitter {
  constructor(hostId, name, role) {
    super();
    this.hostId = hostId;
    this.name = name;
    this.role = role;          // 'player' | 'spectator'
    this.peer = null;
    this.conn = null;
  }

  connect(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (e) => { if (!settled) { settled = true; reject(e); } };

      const timer = setTimeout(() => fail(new Error('Timed out connecting to the host.')), timeoutMs);

      this.peer = new Peer(PEER_OPTS);
      this.peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') fail(new Error('That game is no longer available.'));
        else if (!settled) fail(err);
        else this.emit('error', err);
      });

      this.peer.on('open', () => {
        this.conn = this.peer.connect(this.hostId, { reliable: true });

        this.conn.on('open', () => {
          clearTimeout(timer);
          settled = true;
          this.conn.send({ type: 'hello', name: this.name, role: this.role });
          resolve();
        });

        this.conn.on('data', (msg) => {
          if (msg && msg.type) this.emit(msg.type, msg);
        });

        this.conn.on('close', () => this.emit('closed'));
        this.conn.on('error', (err) => this.emit('error', err));
      });
    });
  }

  send(type, payload = {}) {
    if (this.conn && this.conn.open) this.conn.send({ type, ...payload });
  }

  close() {
    try { this.conn?.close(); } catch (e) { /* already gone */ }
    try { this.peer?.destroy(); } catch (e) { /* already gone */ }
    this.conn = null;
    this.peer = null;
  }
}
