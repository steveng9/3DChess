/*
 * 3D Chess — UI.js
 *
 * All DOM reading and writing lives here. App.js holds the game logic and calls
 * into this; nothing in this file knows the rules.
 */

import { PIECE_GLYPHS, PIECE_NAMES } from '../rules/Pieces.js';
import { Config } from '../rules/Config.js';

const EMOJI = [
  '😀', '😄', '😅', '😂', '🙂', '😉', '😊', '😍', '🤔', '🤨', '😐', '😑',
  '😴', '😎', '🥳', '😬', '😳', '🥺', '😢', '😭', '😤', '😡', '🤯', '😱',
  '👍', '👎', '👏', '🙌', '🤝', '💪', '🫡', '🤞', '✌️', '👋', '🙏', '🧠',
  '♟️', '♞', '♜', '♝', '♛', '♚', '🏆', '🔥', '💀', '⚡', '🎯', '🎲',
  '❤️', '💔', '✨', '⭐', '🎉', '👀', '😈', '🤖', '🐐', '🍀', '⏳', '🤷',
];

export class UI {
  constructor() {
    this.el = new Proxy({}, {
      get: (cache, id) => {
        if (!(id in cache)) cache[id] = document.getElementById(id);
        return cache[id];
      },
    });
    this._buildEmojiPicker();
  }

  // ---- screens ---------------------------------------------------------

  showScreen(which) {
    this.el['screen-lobby'].hidden = which !== 'lobby';
    this.el['screen-game'].hidden = which !== 'game';
  }

  // ---- lobby -----------------------------------------------------------

  get playerName() {
    return (this.el.nameInput.value || '').trim().slice(0, 24) || 'anonymous';
  }

  set playerName(v) { this.el.nameInput.value = v; }

  get boardSize() { return parseInt(this.el.sizeSelect.value, 10); }
  get hostColour() { return this.el.colourSelect.value; }

  setLobbyStatus(text) { this.el.lobbyStatus.textContent = text || ''; }

  /**
   * @param {Array} games
   * @param {(game, role:'player'|'spectator') => void} onJoin
   */
  renderGames(games, onJoin) {
    const list = this.el.gameList;
    list.innerHTML = '';

    for (const g of games) {
      const m = g.meta || {};
      const open = !!m.open;

      const li = document.createElement('li');
      li.className = 'game-row';
      li.tabIndex = 0;

      const who = document.createElement('div');
      who.className = 'who';
      const host = document.createElement('strong');
      host.textContent = m.hostName || 'anonymous';
      const sub = document.createElement('small');
      const size = m.size ? `${m.size}×${m.size}×${m.size}` : 'unknown size';
      const watchers = m.spectators ? ` · ${m.spectators} watching` : '';
      sub.textContent = `${size} · host plays ${m.hostColour === 'b' ? 'Black' : 'White'}${watchers}`;
      who.append(host, sub);

      const badge = document.createElement('span');
      badge.className = 'badge ' + (open ? 'open' : 'live');
      badge.textContent = open ? 'Open seat' : 'In progress';

      const watch = document.createElement('button');
      watch.className = 'ghost small';
      watch.textContent = 'Watch';
      watch.addEventListener('click', (e) => { e.stopPropagation(); onJoin(g, 'spectator'); });

      li.append(who, badge, watch);
      li.addEventListener('click', () => onJoin(g, open ? 'player' : 'spectator'));
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') onJoin(g, open ? 'player' : 'spectator');
      });
      list.appendChild(li);
    }
  }

  // ---- game header -----------------------------------------------------

  /** names: { w: string, b: string } */
  setPlayers(names, seat) {
    const top = this.el.playerTop.querySelector('.pname');
    const bottom = this.el.playerBottom.querySelector('.pname');
    top.textContent = names.b + (seat === 'b' ? ' (you)' : '');
    bottom.textContent = names.w + (seat === 'w' ? ' (you)' : '');
  }

  setTurn(state, seat) {
    const bar = this.el.turnBar;
    bar.classList.remove('check', 'over');

    const status = state.outcome
      ? { over: true, ...state.outcome }
      : { over: false, check: state.inCheck() };

    if (status.over) {
      bar.classList.add('over');
      const who = status.result === 'draw'
        ? 'Draw'
        : `${status.result === 'w' ? 'White' : 'Black'} wins`;
      bar.textContent = `${who} — ${status.reason}`;
    } else {
      const mover = state.turn === 'w' ? 'White' : 'Black';
      const yours = state.turn === seat;
      bar.textContent = status.check
        ? `${mover} is in check`
        : `${mover} to move${yours ? ' — your turn' : ''}`;
      if (status.check) bar.classList.add('check');
    }

    this.el.playerTop.classList.toggle('active', !status.over && state.turn === 'b');
    this.el.playerBottom.classList.toggle('active', !status.over && state.turn === 'w');
  }

  renderCaptured(state) {
    const draw = (host, list, takenColour) => {
      host.innerHTML = '';
      const sorted = [...list].sort(
        (a, b) => (Config.values[b] || 0) - (Config.values[a] || 0),
      );
      for (const t of sorted) {
        const s = document.createElement('span');
        s.className = 'cap ' + takenColour;
        s.textContent = PIECE_GLYPHS[t];
        s.title = PIECE_NAMES[t];
        host.appendChild(s);
      }
    };
    // White's tray holds the black pieces White has taken, and vice versa.
    draw(this.el.capturedByW, state.captured.w, 'b');
    draw(this.el.capturedByB, state.captured.b, 'w');

    const wm = state.materialFor('w');
    const bm = state.materialFor('b');
    this.el.matW.textContent = wm > bm ? `+${wm - bm}` : '';
    this.el.matB.textContent = bm > wm ? `+${bm - wm}` : '';
  }

  renderLog(state) {
    const log = this.el.moveLog;
    log.innerHTML = '';
    state.log.forEach((entry, i) => {
      const li = document.createElement('li');
      if (i === state.log.length - 1) li.className = 'last';
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = entry.colour === 'w' ? `${Math.floor(i / 2) + 1}.` : '';
      const t = document.createElement('span');
      t.textContent = entry.text;
      li.append(n, t);
      log.appendChild(li);
    });
    log.scrollTop = log.scrollHeight;
  }

  // ---- chat ------------------------------------------------------------

  addChat({ name, text, colour, system }) {
    const div = document.createElement('div');
    div.className = 'chat-msg' + (system ? ' system' : '');
    if (system) {
      div.textContent = text;
    } else {
      const from = document.createElement('span');
      from.className = 'from ' + (colour || '');
      from.textContent = name + ':';
      const body = document.createElement('span');
      body.textContent = ' ' + text;
      div.append(from, body);
    }
    this.el.chatLog.appendChild(div);
    this.el.chatLog.scrollTop = this.el.chatLog.scrollHeight;
  }

  clearChat() { this.el.chatLog.innerHTML = ''; }

  _buildEmojiPicker() {
    const picker = document.getElementById('emojiPicker');
    if (!picker) return;
    for (const e of EMOJI) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = e;
      b.addEventListener('click', () => {
        const input = document.getElementById('chatInput');
        input.value += e;
        input.focus();
      });
      picker.appendChild(b);
    }
  }

  toggleEmoji() {
    this.el.emojiPicker.hidden = !this.el.emojiPicker.hidden;
  }

  // ---- feedback --------------------------------------------------------

  banner(text) {
    const b = this.el.banner;
    if (!text) { b.hidden = true; return; }
    b.textContent = text;
    b.hidden = false;
  }

  toast(text, ms = 2600) {
    const t = this.el.toast;
    t.textContent = text;
    t.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  /**
   * @param {Array<{label:string, value:any, kind?:'primary'|'danger'}>} buttons
   * @returns {Promise<any>} the chosen button's value
   */
  modal(title, body, buttons) {
    return new Promise((resolve) => {
      this.el.modalTitle.textContent = title;
      this.el.modalBody.textContent = body;
      const host = this.el.modalButtons;
      host.innerHTML = '';

      for (const b of buttons) {
        const btn = document.createElement('button');
        btn.textContent = b.label;
        if (b.kind === 'primary') btn.className = 'primary';
        if (b.kind === 'danger') btn.className = 'danger';
        btn.addEventListener('click', () => {
          this.el.modalRoot.hidden = true;
          resolve(b.value);
        });
        host.appendChild(btn);
      }
      this.el.modalRoot.hidden = false;
    });
  }

  closeModal() { this.el.modalRoot.hidden = true; }
}
