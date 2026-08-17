/*
 * 3D Chess — Lobby.js
 *
 * Open-game discovery with no backend, which GitHub Pages requires.
 *
 * The trick: hosts do not get random room codes. Each host claims the lowest
 * free id from a fixed, publicly known list — 3DCHESS-V1-SLOT-0 .. -15. Any
 * browser can therefore enumerate every possible game by probing that list.
 *
 * Probing is cheap because the PeerJS broker answers "no such peer" from its
 * own registry without any ICE negotiation, so dead slots fail in one server
 * round-trip. Only live slots pay for a real WebRTC handshake, and there are
 * usually zero to three of those. Live hosts answer a `lobby-query` with a
 * `lobby-info` card and the probe connection is closed immediately.
 *
 * Trade-off, accepted deliberately: at most `Config.lobbySlots` concurrent
 * games worldwide. Raising the cap is a one-line change; swapping the whole
 * mechanism for a real database means reimplementing only this file, since
 * App.js talks to `listGames` / `hostGame` and nothing else.
 */

import { Config } from '../rules/Config.js';
import { NetHost, peerOptions } from './Net.js';

export const slotId = (n) => `${Config.lobbyPrefix}${n}`;

/** Every slot id, in claim order. */
export function allSlots() {
  return Array.from({ length: Config.lobbySlots }, (_, i) => slotId(i));
}

/**
 * Claim the lowest free slot and start hosting there.
 * @returns {Promise<NetHost>} a started host
 */
export async function hostGame(meta) {
  let lastErr = null;
  for (let n = 0; n < Config.lobbySlots; n++) {
    const host = new NetHost(slotId(n), { ...meta, slot: n });
    try {
      await host.start();
      return host;
    } catch (err) {
      lastErr = err;
      host.close();
      if (err?.type !== 'unavailable-id') throw err;   // a real failure, not a busy slot
    }
  }
  const e = new Error(`All ${Config.lobbySlots} game slots are in use. Try again shortly.`);
  e.cause = lastErr;
  throw e;
}

/**
 * Probe every slot and report the live games.
 *
 * @param {(game:{peerId:string, slot:number, meta:object}) => void} [onFound]
 *        called as each game replies, so the list can populate progressively
 * @returns {Promise<Array>} all games found
 */
export async function listGames(onFound) {
  const peer = new Peer(peerOptions());

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Could not reach the matchmaking broker.')), 12000);
    peer.on('open', () => { clearTimeout(t); resolve(); });
    peer.on('error', (err) => { clearTimeout(t); reject(err); });
  });

  // A dead slot surfaces as a Peer-level 'peer-unavailable' error naming the
  // target id, not as an error on the connection object.
  const pending = new Map();
  peer.on('error', (err) => {
    if (err?.type !== 'peer-unavailable') return;
    const m = /peer\s+(\S+)/i.exec(err.message || '');
    const entry = m && pending.get(m[1]);
    if (entry) entry.finish(null);
  });

  const probe = (id, slot) => new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pending.delete(id);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), Config.probeTimeoutMs);
    pending.set(id, { finish });

    let conn;
    try {
      conn = peer.connect(id, { reliable: true });
    } catch (e) {
      finish(null);
      return;
    }

    conn.on('open', () => conn.send({ type: 'lobby-query' }));
    conn.on('data', (msg) => {
      if (!msg || msg.type !== 'lobby-info') return;
      const game = { peerId: id, slot, meta: msg.meta || {} };
      try { conn.close(); } catch (e) { /* already closing */ }
      if (onFound) onFound(game);
      finish(game);
    });
    conn.on('error', () => finish(null));
    conn.on('close', () => finish(null));
  });

  const found = [];
  const ids = allSlots();
  for (let i = 0; i < ids.length; i += Config.probeBatchSize) {
    const batch = ids.slice(i, i + Config.probeBatchSize);
    const results = await Promise.all(batch.map((id, k) => probe(id, i + k)));
    found.push(...results.filter(Boolean));
  }

  try { peer.destroy(); } catch (e) { /* already gone */ }
  return found;
}
