/*
 * 3D Chess — Sounds.js
 *
 * Four cues, synthesised with the Web Audio API rather than shipped as files:
 * no binary assets in the repo, nothing extra for GitHub Pages to serve, and
 * no load-order race before the first move.
 *
 *   move      soft wooden knock
 *   capture   lower, harder knock with a noise transient
 *   check     two-tone rising alert
 *   end       descending minor arpeggio (checkmate, resignation, draw)
 */

import { Config } from '../rules/Config.js';

export class Sounds {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  /**
   * Browsers refuse to start an AudioContext before a user gesture, so it is
   * created lazily on the first sound and resumed if suspended.
   */
  _ensure() {
    if (this.muted || !Config.sounds) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setMuted(m) { this.muted = m; }

  play(name) {
    const ctx = this._ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    switch (name) {
      case 'move': this._knock(t, 320, 0.085, 0.35); break;
      case 'capture': this._capture(t); break;
      case 'check': this._check(t); break;
      case 'end': this._end(t); break;
      case 'chat': this._blip(t); break;
      default: break;
    }
  }

  // ---- primitives ------------------------------------------------------

  _env(t, attack, decay, peak) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  /** Short pitched thud: a sine dropping fast in frequency reads as a knock. */
  _knock(t, freq, dur, peak) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.45, t + dur);
    const g = this._env(t, 0.004, dur, peak);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Filtered white-noise burst — the "click" layer on top of a knock. */
  _noise(t, dur, peak, cutoff) {
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = cutoff;
    const g = this._env(t, 0.002, dur, peak);
    src.connect(filt).connect(g).connect(this.ctx.destination);
    src.start(t);
  }

  _tone(t, freq, dur, peak, type = 'triangle') {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    const g = this._env(t, 0.01, dur, peak);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // ---- cues ------------------------------------------------------------

  _capture(t) {
    this._knock(t, 190, 0.14, 0.42);
    this._noise(t, 0.09, 0.3, 2600);
  }

  _check(t) {
    this._tone(t, 660, 0.12, 0.22, 'triangle');
    this._tone(t + 0.11, 990, 0.20, 0.22, 'triangle');
  }

  _end(t) {
    const notes = [784, 659, 523, 392];   // G5 E5 C5 G4
    notes.forEach((f, i) => this._tone(t + i * 0.14, f, 0.32, 0.2, 'sine'));
  }

  _blip(t) {
    this._tone(t, 880, 0.06, 0.12, 'sine');
  }
}

export const sounds = new Sounds();
