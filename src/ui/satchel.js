// =====================================================================
//  The satchel (Tab): left, the things you have gathered (picture + a small count); right, what you can make (picture recipes only:
//  ingredients -> arrow -> result). The game is fully paused while it is open.
//  The current level is shown as a number inside a blue-ring motif (the only place a level number appears). Short tooltips name
//  unlocked badges, ingredients and crafted things (locked badges stay silent silhouettes). Works with mouse, keyboard
//  (arrows / WASD to move, Enter / Space to use) and a gamepad (d-pad / stick + A, B closes).
// =====================================================================
import { icon } from './icons.js';
import { RECIPES, USABLE, FX, loreOf } from '../systems/items.js';
import { BADGES } from '../systems/levels.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Satchel {
  /** @param game  Game (inv, abilities, audio)  */
  constructor(root, game) {
    this.root = root; this.game = game; this.isOpen = false; this.lastFocus = null; this._tipId = null;
    root.innerHTML = '';
    this.panel = el('div', 'sat-panel');
    this.head = el('div', 'sat-head');
    this.levelEl = el('div', 'sat-level', `<i>${icon('rings')}</i><b>1</b>`);
    this.head.append(this.levelEl);
    this.bag = el('div', 'sat-bag'); this.recs = el('div', 'sat-recipes'); this.fxrow = el('div', 'sat-fx'); this.badgeRow = el('div', 'sat-badges');
    const left = el('div', 'sat-left'); left.append(this.head, this.bag, this.fxrow, this.badgeRow);
    this.panel.append(left, this.recs); root.append(this.panel);
    this.tip = el('div', 'sat-tip'); this.tip.hidden = true; this.tip.setAttribute('role', 'tooltip'); root.append(this.tip);
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) { return; }
      this.act(b);
    });
    root.addEventListener('keyup', (e) => { if (e.code === 'Space' || e.code === 'Enter') e.preventDefault(); });   // (the game handles those keys itself: no second, native click)
    root.addEventListener('mousedown', (e) => e.stopPropagation());
    root.addEventListener('pointerdown', (e) => e.stopPropagation());
    root.addEventListener('pointerover', (e) => this.tipFor(e.target));
    root.addEventListener('pointerout', (e) => { if (!e.relatedTarget || !root.contains(e.relatedTarget)) this.hideTip(); });
    root.addEventListener('focusin', (e) => this.tipFor(e.target));
    root.addEventListener('focusout', (e) => { if (!e.relatedTarget || !root.contains(e.relatedTarget)) this.hideTip(); });
  }
  open() { this.isOpen = true; this.root.hidden = false; this.render(); this.focusFirst(); }
  close() { this.hideTip(); this.isOpen = false; this.root.hidden = true; }

  render() {
    const g = this.game, inv = g.inv, o = g.octopus;
    const keep = this.root.querySelector(':focus')?.dataset;
    this.levelEl.querySelector('b').textContent = String(g.levels?.level || 1);
    // ---- left: what you hold (only things ever found)
    this.bag.innerHTML = '';
    const slots = inv.slots();
    for (const s of slots) {
      const b = el('button', 'slot' + (s.n > 0 ? '' : ' none') + (USABLE.has(s.id) && s.n > 0 ? ' usable' : ''), `<i>${icon(s.id)}</i>` + (s.n > 0 ? `<b>${s.n}</b>` : ''));
      b.dataset.act = 'use'; b.dataset.id = s.id; b.dataset.tip = 'item:' + s.id; this.bag.append(b);
    }
    for (let i = slots.length; i < 25; i++) this.bag.append(el('div', 'slot empty'));
    // ---- right: what could be made (a recipe shows up once one of its ingredients has been found)
    this.recs.innerHTML = '';
    const vis = inv.visibleRecipes();
    for (const r of vis) {
      const can = inv.canCraft(r);
      const row = el('button', 'rec' + (can ? '' : ' no'));
      row.dataset.act = 'craft'; row.dataset.id = r.id; row.dataset.tip = 'item:' + r.out;
      let h = '';
      Object.entries(r.in).forEach(([k, n], i) => {
        const have = inv.count(k);
        h += (i ? `<u>${icon('plus')}</u>` : '') + `<span class="ing${have >= n ? '' : ' lack'}" data-tip="item:${k}"><i>${icon(k)}</i>${n > 1 ? `<b>${n}</b>` : ''}</span>`;
      });
      h += `<u class="arr">${icon('arrow')}</u><span class="res" data-tip="item:${r.out}"><i>${icon(r.out)}</i></span>`;
      row.innerHTML = h; this.recs.append(row);
    }
    if (!vis.length) this.recs.append(el('div', 'rec ghost'), el('div', 'rec ghost'));
    // ---- active effects: tiny pictures with a thin bar for what is left
    this.fxrow.innerHTML = '';
    const B = o.buff, add = (id, frac, n) => { const e = el('div', 'fxi', `<i>${icon(id)}</i>` + (n ? `<b>${n}</b>` : '') + (frac != null ? `<s style="width:${Math.round(clamp01(frac) * 100)}%"></s>` : '')); e.dataset.tip = 'item:' + id; this.fxrow.append(e); };
    if (B.shield > 0) add('shield', B.shield / FX.shield);
    if (B.jar > 0) add('hideaway', B.jar / FX.jar);
    if (B.kelp > 0) add('wrap', B.kelp / FX.kelp);
    if (B.mimic > 0) add('mimic', B.mimic / FX.mimic);
    if (B.feast > 0) add('feast', B.feast / FX.feast);
    if (B.tonic > 0) add('tonic', B.tonic / FX.tonic);
    if (o.venomReady) add('gland', 1);
    if (o.lethalDose) add('dose', 1);
    if (o.inkCharges > 0) add('inksac', null, o.inkCharges);
    if (g.abilities?.dens.length) add('den', null, g.abilities.dens.length);
    this.fxrow.hidden = !this.fxrow.children.length;
    // ---- badges (t241u): earned ones as bright tokens, the rest as faint silhouettes to discover; newly earned ones shine once
    this.badgeRow.innerHTML = '';
    const lv = g.levels, fresh = g.freshBadges;
    if (lv) for (const b of BADGES) {
      const got = lv.badges.has(b.id);
      const t = el(got ? 'button' : 'span', 'badge' + (got ? ' got' : '') + (got && fresh?.has(b.id) ? ' new' : ''), `<i>${icon(b.glyph)}</i>`);
      t.dataset.badge = b.id;
      if (got) { t.dataset.tip = 'badge:' + b.id; t.type = 'button'; }
      this.badgeRow.append(t);
    }
    if (fresh) fresh.clear();
    // restore the focus where it was
    if (keep && keep.id) { const n = this.root.querySelector(`button[data-act="${keep.act}"][data-id="${keep.id}"]`); if (n) n.focus({ preventScroll: true }); }
    else if (this._tipId) this.tipFor(this.root.querySelector(`[data-tip="${this._tipId}"]`));
  }
  /** look up and show a tooltip for an element (or hide if it has none / is a locked badge) */
  tipFor(node) {
    if (!node || !this.root.contains(node)) { this.hideTip(); return; }
    const t = node.closest('[data-tip]');
    if (!t || !this.root.contains(t)) { this.hideTip(); return; }
    const key = t.dataset.tip, [kind, id] = key.split(':');
    let title = '', note = '';
    if (kind === 'item') { const L = loreOf(id); if (!L) { this.hideTip(); return; } title = L.name; note = L.note; }
    else if (kind === 'badge') {
      const b = BADGES.find((q) => q.id === id);
      if (!b || !this.game.levels?.badges.has(id)) { this.hideTip(); return; }
      title = b.title; note = b.note;
    } else { this.hideTip(); return; }
    this._tipId = key;
    this.tip.innerHTML = `<strong>${esc(title)}</strong>` + (note ? `<small>${esc(note)}</small>` : '');
    this.tip.hidden = false;
    this.placeTip(t);
  }
  placeTip(anchor) {
    const r = anchor.getBoundingClientRect(), tip = this.tip, pad = 10;
    // measure after unhiding; keep it on screen and preferably above the anchor
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 8;
    if (y < pad) y = r.bottom + 8;
    x = Math.max(pad, Math.min(x, innerWidth - tw - pad));
    y = Math.max(pad, Math.min(y, innerHeight - th - pad));
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  hideTip() { if (this.tip.hidden) return; this.tip.hidden = true; this.tip.innerHTML = ''; this._tipId = null; }
  buttons() { return [...this.root.querySelectorAll('button[data-act], button.badge.got')]; }
  focusFirst() { const b = this.buttons()[0]; if (b) b.focus({ preventScroll: true }); }
  /** move the focus to the nearest button in a direction (dx / dy in -1 / 0 / 1) */
  nav(dx, dy) {
    const all = this.buttons(); if (!all.length) return;
    const cur = this.root.querySelector(':focus');
    if (!cur || !all.includes(cur)) { all[0].focus(); this.tipFor(all[0]); return; }
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
    if (best) { best.focus({ preventScroll: true }); this.tipFor(best); }
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
