// =====================================================================
//  Progress - quiet, internal bookkeeping for the hidden mechanics.
//  Nothing in here is ever shown on screen. It exists so an end-goal can be
//  added later (see DESIGN.md): reaching the sea, shells found, babies rescued.
// =====================================================================
import { CONFIG } from '../config.js';

export class Progress {
  constructor() { this.reset(); }
  reset() {
    this.seaReached = false;      // the octopus has been in the open sea at least once
    this.seaReachedAt = null;     // run time (s) of the first arrival
    this.shells = 0;              // shells collected this run (each secretly toughens the skin)
    this.rescued = new Set();     // ids of baby octopuses found this run
    this.log = [];                // [{t, type, ...}] tiny event log, handy for a future end-game
  }
  get babies() { return this.rescued.size; }
  /** fraction of predator damage that is absorbed (hidden mechanic: -6% per shell, capped) */
  get armor() { const A = CONFIG.shells; return Math.min(A.maxArmor, this.shells * A.armorPerShell); }
  note(t, type, extra = {}) { this.log.push({ t, type, ...extra }); if (this.log.length > 200) this.log.shift(); }
  addShell(t) { this.shells++; this.note(t, 'shell'); }
  addBaby(id, t) { if (this.rescued.has(id)) return false; this.rescued.add(id); this.note(t, 'baby', { id }); return true; }
  markSea(t) { if (this.seaReached) return false; this.seaReached = true; this.seaReachedAt = t; this.note(t, 'sea'); return true; }
}
