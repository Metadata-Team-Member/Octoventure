// =====================================================================
//  The satchel (Tab): left, the things you have gathered (picture + a small count); right, what you can make (picture recipes only:
//  ingredients -> arrow -> result). No words, no tooltips. The game is fully paused while it is open.
//  Works with mouse, keyboard (arrows / WASD to move, Enter / Space to use) and a gamepad (d-pad / stick + A, B closes).
// =====================================================================
import { icon } from './icons.js';
import { RECIPES, USABLE, FX } from '../systems/items.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

export class Satchel {
  /** @param game  Game (inv, abilities, audio)  */
  constructor(root, game) {
    this.root = root; this.game = game; this.isOpen = false; this.lastFocus = null;
    root.innerHTML = '';
    this.panel = el('div', 'sat-panel');
    this.bag = el('div', 'sat-bag'); this.recs = el('div', 'sat-recipes'); this.fxrow = el('div', 'sat-fx');
    const left = el('div', 'sat-left'); left.append(this.bag, this.fxrow);
    this.panel.append(left, this.recs); root.append(this.panel);
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) { return; }
      this.act(b);
    });
    root.addEventListener('keyup', (e) => { if (e.code === 'Space' || e.code === 'Enter') e.preventDefault(); });   // (the game handles those keys itself: no second, native click)
    root.addEventListener('mousedown', (e) => e.stopPropagation());
    root.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
  open() { this.isOpen = true; this.root.hidden = false; this.render(); this.focusFirst(); }
  close() { this.isOpen = false; this.root.hidden = true; }

  render() {
    const g = this.game, inv = g.inv, o = g.octopus;
    const keep = this.root.querySelector(':focus')?.dataset;
    // ---- left: what you hold (only things ever found)
    this.bag.innerHTML = '';
    const slots = inv.slots();
    for (const s of slots) {
      const b = el('button', 'slot' + (s.n > 0 ? '' : ' none') + (USABLE.has(s.id) && s.n > 0 ? ' usable' : ''), `<i>${icon(s.id)}</i>` + (s.n > 0 ? `<b>${s.n}</b>` : ''));
      b.dataset.act = 'use'; b.dataset.id = s.id; this.bag.append(b);
    }
    for (let i = slots.length; i < 25; i++) this.bag.append(el('div', 'slot empty'));
    // ---- right: what could be made (a recipe shows up once one of its ingredients has been found)
    this.recs.innerHTML = '';
    const vis = inv.visibleRecipes();
    for (const r of vis) {
      const can = inv.canCraft(r);
      const row = el('button', 'rec' + (can ? '' : ' no'));
      row.dataset.act = 'craft'; row.dataset.id = r.id;
      let h = '';
      Object.entries(r.in).forEach(([k, n], i) => {
        const have = inv.count(k);
        h += (i ? `<u>${icon('plus')}</u>` : '') + `<span class="ing${have >= n ? '' : ' lack'}"><i>${icon(k)}</i>${n > 1 ? `<b>${n}</b>` : ''}</span>`;
      });
      h += `<u class="arr">${icon('arrow')}</u><span class="res"><i>${icon(r.out)}</i></span>`;
      row.innerHTML = h; this.recs.append(row);
    }
    if (!vis.length) this.recs.append(el('div', 'rec ghost'), el('div', 'rec ghost'));
    // ---- active effects: tiny pictures with a thin bar for what is left
    this.fxrow.innerHTML = '';
    const B = o.buff, add = (id, frac, n) => { const e = el('div', 'fxi', `<i>${icon(id)}</i>` + (n ? `<b>${n}</b>` : '') + (frac != null ? `<s style="width:${Math.round(clamp01(frac) * 100)}%"></s>` : '')); this.fxrow.append(e); };
    if (B.shield > 0) add('shield', B.shield / FX.shield);
    if (B.jar > 0) add('hideaway', B.jar / FX.jar);
    if (B.kelp > 0) add('wrap', B.kelp / FX.kelp);
    if (B.mimic > 0) add('mimic', B.mimic / FX.mimic);
    if (B.feast > 0) add('feast', B.feast / FX.feast);
    if (o.venomReady) add('gland', 1);
    if (o.inkCharges > 0) add('inksac', null, o.inkCharges);
    if (g.abilities?.dens.length) add('den', null, g.abilities.dens.length);
    this.fxrow.hidden = !this.fxrow.children.length;
    // restore the focus where it was
    if (keep && keep.id) { const n = this.root.querySelector(`button[data-act="${keep.act}"][data-id="${keep.id}"]`); if (n) n.focus({ preventScroll: true }); }
  }
  buttons() { return [...this.root.querySelectorAll('button[data-act]')]; }
  focusFirst() { const b = this.buttons()[0]; if (b) b.focus({ preventScroll: true }); }
  /** move the focus to the nearest button in a direction (dx / dy in -1 / 0 / 1) */
  nav(dx, dy) {
    const all = this.buttons(); if (!all.length) return;
    const cur = this.root.querySelector(':focus');
    if (!cur || !all.includes(cur)) { all[0].focus(); return; }
    const c = cur.getBoundingClientRect(), cx = c.left + c.width / 2, cy = c.top + c.height / 2;
    let best = null, bs = 1e9;
    for (const b of all) {
      if (b === cur) continue;
      const r = b.getBoundingClientRect(), x = r.left + r.width / 2 - cx, y = r.top + r.height / 2 - cy;
      const along = x * dx + y * dy, across = Math.abs(dx ? y : x);
      if (along < 6) continue;
      const s = along + across * 2.2;
      if (s < bs) { bs = s; best = b; }
    }
    if (best) best.focus({ preventScroll: true });
  }
  activate() { const b = this.root.querySelector(':focus'); if (b && b.dataset.act) this.act(b); }
  act(b) {
    const g = this.game;
    if (b.dataset.act === 'craft') {
      if (g.inv.craft(b.dataset.id)) { g.audio.craft?.(); g.afterCraft?.(RECIPES.find((r) => r.id === b.dataset.id)); this.render(); this.pop(b.dataset.id); }
      else this.shake(b);
    } else if (b.dataset.act === 'use') {
      const id = b.dataset.id;
      if (!USABLE.has(id) || g.inv.count(id) < 1) { this.shake(b); return; }
      const closes = id === 'den';
      if (g.abilities.use(id)) { if (closes) g.closeSatchel(); else this.render(); }
      else this.shake(b);
    }
  }
  pop(id) { const b = this.root.querySelector(`button[data-act="craft"][data-id="${id}"] .res`); if (b) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); } }
  shake(b) { b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); }
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
