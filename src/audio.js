// Tiny procedural WebAudio sound-scape (no audio files). Starts on first user input.
import { CONFIG } from './config.js';
import { clamp } from './util/rng.js';

export class GameAudio {
  constructor() { this.ctx = null; this.muted = false; this.nextGull = 3; this.t = 0; }

  start() {
    if (this.ctx || !CONFIG.audio.enabled) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain(); this.master.gain.value = CONFIG.audio.volume; this.master.connect(c.destination);
      // noise buffer
      const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; d[i] = last * 6; }
      this.noiseBuf = buf;
      const mk = (freq, q, type) => {
        const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
        const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
        const g = c.createGain(); g.gain.value = 0;
        src.connect(f); f.connect(g); g.connect(this.master); src.start();
        return { src, f, g };
      };
      this.wind = mk(420, 0.7, 'lowpass');
      this.surf = mk(700, 0.4, 'lowpass');
    } catch (e) { this.ctx = null; }
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  toggleMute() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : CONFIG.audio.volume; return this.muted; }

  /** coast: 0 (far inland) .. 1 (at the shore) */
  update(dt, coast, sprint) {
    if (!this.ctx) return;
    this.t += dt;
    const c = this.ctx, now = c.currentTime;
    const gate = CONFIG.hints.gullSounds ? 1 : 0;
    this.wind.g.gain.setTargetAtTime(0.05 + 0.05 * Math.sin(this.t * 0.3) ** 2, now, 0.3);
    this.surf.g.gain.setTargetAtTime(gate * (0.02 + 0.22 * coast * coast * (0.7 + 0.3 * Math.sin(this.t * 0.7))), now, 0.4);
    this.nextGull -= dt;
    if (this.nextGull <= 0) {
      const near = clamp(coast, 0, 1);
      this.nextGull = (3 + Math.random() * 9) * (1.8 - near * 1.3);
      if (gate && Math.random() < 0.25 + near * 0.75) this.gull(0.04 + 0.2 * near * near + 0.02);
    }
  }

  tone(freq, dur, type = 'sine', vol = 0.2, slide = 0, delay = 0) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t0 = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  noise(dur, freq, vol = 0.2) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t0 = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t0, Math.random()); s.stop(t0 + dur);
  }
  gull(v = 0.1) { for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) this.tone(1500 + Math.random() * 300, 0.32, 'sawtooth', v, -700, i * 0.34); }
  splash() { this.noise(0.35, 1400, 0.25); }
  alert() { this.tone(520, 0.12, 'square', 0.08); this.tone(780, 0.16, 'square', 0.08, 0, 0.1); }
  camo(on) { this.tone(on ? 260 : 420, 0.3, 'sine', 0.1, on ? 220 : -200); }
  hurt() { this.noise(0.18, 300, 0.3); this.tone(160, 0.25, 'sawtooth', 0.15, -80); }
  die() { this.tone(300, 0.9, 'triangle', 0.2, -230); }
  /** first time in the sea: a soft swell of surf and a gentle two-note sigh */
  seaArrival() { this.noise(3.2, 600, 0.18); this.tone(392, 2.2, 'sine', 0.07, 0, 0.1); this.tone(587, 2.6, 'sine', 0.06, 0, 0.9); }
  win() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.18, 0, i * 0.16)); }
}
