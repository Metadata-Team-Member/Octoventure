// =====================================================================
//  The satchel (Tab): a paused tide-pool nook. Pages (shell tabs): bag (gather + craft),
//  field journal, explored map, collection. A small octopus portrait shows worn things
//  and the current level (the only place a level number appears). Short tooltips name
//  unlocked badges, ingredients and crafted things (locked badges stay silent).
//  Mouse, keyboard (arrows / WASD, Q/E or 1-4 for pages, Enter / Space to use) and
//  gamepad (d-pad / stick, LB / RB pages, A uses, B closes).
// =====================================================================
import { icon } from './icons.js';
import { RECIPES, USABLE, FX, loreOf } from '../systems/items.js';
import { BADGES } from '../systems/levels.js';
import { ENTRIES, RARE, TABS } from '../systems/journal.js';
import { unpackCell, exploreCell } from '../systems/save.js';
import { drawMap } from './map.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp01 = (v) => Math.max(0, Math.min(1, v));

const OCTO_SVG = `<svg class="por-svg" viewBox="0 0 64 64" aria-hidden="true">
  <ellipse class="por-body" cx="32" cy="28" rx="16" ry="14"/>
  <g class="por-arms">${[0,1,2,3,4,5].map((i) => { const a = (-40 + i * 16) * Math.PI / 180, x = 32 + Math.sin(a) * 14, y = 36 + Math.cos(a) * 16; return `<path d="M32 34 Q${(32+x)/2} ${34+(y-34)*0.3} ${x} ${y}" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>`; }).join('')}</g>
  <g class="por-rings">${[[26,24],[38,24],[32,20],[28,30],[36,30]].map(([x,y]) => `<circle cx="${x}" cy="${y}" r="2.1"/>`).join('')}</g>
  <g class="por-eyes"><circle class="por-eye" cx="26.5" cy="25" r="2.3"/><circle class="por-eye" cx="37.5" cy="25" r="2.3"/><rect class="por-lid" x="23.5" y="22.4" width="6" height="5.2" rx="1"/><rect class="por-lid" x="34.5" y="22.4" width="6" height="5.2" rx="1"/></g>
  <g class="wear wear-kelp" hidden>${[[22,18],[42,18],[32,14]].map(([x,y],i) => `<path d="M${x} ${y} C${x-4} ${y+10} ${x+4} ${y+16} ${x} ${y+22}" fill="none" stroke="#6a7a2a" stroke-width="2" stroke-linecap="round"/>`).join('')}</g>
  <g class="wear wear-mimic" hidden><circle cx="24" cy="20" r="2.2" fill="#e4b842"/><circle cx="40" cy="22" r="1.8" fill="#ef6a78"/><circle cx="33" cy="16" r="1.6" fill="#e4b842"/></g>
  <g class="wear wear-shield" hidden><path d="M16 26 Q20 18 28 22 L26 34 Q20 36 16 30z" fill="#f3dcc9" stroke="#d9b49a"/><path d="M48 26 Q44 18 36 22 L38 34 Q44 36 48 30z" fill="#f3dcc9" stroke="#d9b49a"/></g>
  <g class="wear wear-jar" hidden><rect x="20" y="12" width="24" height="28" rx="4" fill="rgba(180,220,230,0.35)" stroke="rgba(220,245,255,0.7)" stroke-width="1.4"/><rect x="26" y="9" width="12" height="5" rx="1" fill="rgba(200,230,235,0.5)" stroke="rgba(220,245,255,0.7)"/></g>
</svg>`;

export class Satchel {
  /** @param game  Game (inv, abilities, audio, journal)  */
  constructor(root, game) {
    this.root = root; this.game = game; this.isOpen = false; this.lastFocus = null; this._tipId = null;
    this.tab = 'bag'; this._parallax = { x: 0, y: 0 }; this._t = 0;
    root.innerHTML = '';
    this.panel = el('div', 'sat-panel');
    this.den = el('div', 'sat-den', `<div class="sat-caustic"></div><div class="sat-weed"></div><div class="sat-bubbles"><i></i><i></i><i></i><i></i><i></i></div>`);
    this.den.setAttribute('aria-hidden', 'true');
    this.head = el('div', 'sat-head');
    this.portrait = el('div', 'sat-portrait', OCTO_SVG + `<b class="sat-level">1</b>`);
    this.tabsEl = el('div', 'sat-tabs');
    for (const id of TABS) {
      const b = el('button', 'sat-tab', `<i>${icon('tab_' + (id === 'collection' ? 'collect' : id === 'journal' ? 'journal' : id === 'map' ? 'map' : 'bag'))}</i>`);
      b.type = 'button'; b.dataset.tab = id; b.dataset.act = 'tab'; b.dataset.id = id;
      this.tabsEl.append(b);
    }
    this.head.append(this.portrait, this.tabsEl);
    this.bag = el('div', 'sat-bag'); this.recs = el('div', 'sat-recipes'); this.fxrow = el('div', 'sat-fx'); this.badgeRow = el('div', 'sat-badges');
    const left = el('div', 'sat-left'); left.append(this.bag, this.fxrow, this.badgeRow);
    this.bagPage = el('div', 'sat-page sat-page-bag'); this.bagPage.append(left, this.recs);
    this.journalPage = el('div', 'sat-page sat-page-journal');
    this.mapPage = el('div', 'sat-page sat-page-map');
    this.mapCanvas = document.createElement('canvas'); this.mapCanvas.className = 'sat-map'; this.mapCanvas.width = 640; this.mapCanvas.height = 480;
    this.mapPage.append(this.mapCanvas);
    this.colPage = el('div', 'sat-page sat-page-col');
    this.pages = { bag: this.bagPage, journal: this.journalPage, map: this.mapPage, collection: this.colPage };
    this.body = el('div', 'sat-body');
    this.body.append(this.bagPage, this.journalPage, this.mapPage, this.colPage);
    this.panel.append(this.den, this.head, this.body);
    this.tip = el('div', 'sat-tip'); this.tip.hidden = true; this.tip.setAttribute('role', 'tooltip');
    this.ghost = el('div', 'sat-ghost'); this.ghost.hidden = true;
    root.append(this.panel, this.tip, this.ghost);
    root.addEventListener('click', (e) => {
      const tab = e.target.closest('button[data-act="tab"]'); if (tab) { this.setTab(tab.dataset.id); return; }
      const ent = e.target.closest('[data-ent]'); if (ent) { this.openEntry(ent.dataset.ent); return; }
      const b = e.target.closest('button[data-act]'); if (!b) return;
      this.act(b);
    });
    root.addEventListener('keyup', (e) => { if (e.code === 'Space' || e.code === 'Enter') e.preventDefault(); });
    root.addEventListener('mousedown', (e) => e.stopPropagation());
    root.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.dragStart(e); });
    root.addEventListener('pointermove', (e) => this.dragMove(e));
    root.addEventListener('pointerup', (e) => this.dragEnd(e));
    root.addEventListener('pointercancel', () => this.dragCancel());
    root.addEventListener('pointerover', (e) => this.tipFor(e.target));
    root.addEventListener('pointerout', (e) => { if (!e.relatedTarget || !root.contains(e.relatedTarget)) this.hideTip(); });
    root.addEventListener('focusin', (e) => this.tipFor(e.target));
    root.addEventListener('focusout', (e) => { if (!e.relatedTarget || !root.contains(e.relatedTarget)) this.hideTip(); });
    root.addEventListener('pointermove', (e) => {
      if (this._drag) return;
      const r = this.panel.getBoundingClientRect();
      this._parallax.x = ((e.clientX - r.left) / r.width - 0.5) * 8;
      this._parallax.y = ((e.clientY - r.top) / r.height - 0.5) * 6;
    });
  }
  open() {
    this.isOpen = true; this.root.hidden = false;
    this.tab = this.game.journal?.tab || 'bag';
    this.render(); this.focusFirst();
    this.game.audio?.menuOpen?.();
  }
  close() {
    this.hideTip(); this.dragCancel(); this.isOpen = false; this.root.hidden = true;
    if (this.game.journal) this.game.journal.tab = this.tab;
    this.game.audio?.menuClose?.();
  }

  setTab(id) {
    if (!this.pages[id] || this.tab === id) { this.tab = id; this.syncTab(); return; }
    this.tab = id;
    if (this.game.journal) this.game.journal.tab = id;
    this.game.audio?.pageFlip?.();
    this.render();
    this.focusFirst();
  }
  nextTab() { const i = TABS.indexOf(this.tab); this.setTab(TABS[(i + 1) % TABS.length]); }
  prevTab() { const i = TABS.indexOf(this.tab); this.setTab(TABS[(i + TABS.length - 1) % TABS.length]); }

  syncTab() {
    for (const id of TABS) {
      this.pages[id].hidden = id !== this.tab;
      const b = this.tabsEl.querySelector(`[data-id="${id}"]`);
      if (b) b.classList.toggle('on', id === this.tab);
    }
  }

  render() {
    const g = this.game, keep = this.root.querySelector(':focus')?.dataset;
    this.renderPortrait();
    this.syncTab();
    this.renderBag();
    if (this.tab === 'journal') this.renderJournal();
    else if (this.tab === 'map') this.renderMap();
    else if (this.tab === 'collection') this.renderCollection();
    if (keep && keep.id) {
      const n = this.root.querySelector(`button[data-act="${keep.act}"][data-id="${keep.id}"]`);
      if (n) n.focus({ preventScroll: true });
    } else if (this._tipId) this.tipFor(this.root.querySelector(`[data-tip="${this._tipId}"]`));
  }

  renderPortrait() {
    const g = this.game, o = g.octopus, lv = g.levels?.level || 1;
    this.portrait.querySelector('.sat-level').textContent = String(lv);
    const show = (cls, on) => { const n = this.portrait.querySelector(cls); if (n) n.hidden = !on; };
    show('.wear-kelp', o.buff?.kelp > 0);
    show('.wear-jar', o.buff?.jar > 0);
    show('.wear-shield', o.buff?.shield > 0);
    show('.wear-mimic', o.buff?.mimic > 0);
    const body = this.portrait.querySelector('.por-body');
    if (body) {
      const grey = 1 - Math.max(0, Math.min(1, (o.health ?? 100) / 100));
      body.style.fill = `rgb(${Math.round(196 - grey * 80)},${Math.round(140 - grey * 40)},${Math.round(46 + grey * 40)})`;
    }
    this.portrait.classList.toggle('feast', (o.buff?.feast || 0) > 0 || (o.buff?.tonic || 0) > 0);
    this.portrait.classList.toggle('inked', (o.inkCharges || 0) > 0);
  }

  renderBag() {
    const g = this.game, inv = g.inv, o = g.octopus;
    this.bag.innerHTML = '';
    const slots = inv.slots();
    for (const s of slots) {
      const b = el('button', 'slot' + (s.n > 0 ? '' : ' none') + (USABLE.has(s.id) && s.n > 0 ? ' usable' : ''), `<i>${icon(s.id)}</i>` + (s.n > 0 ? `<b>${s.n}</b>` : ''));
      b.dataset.act = 'use'; b.dataset.id = s.id; b.dataset.tip = 'item:' + s.id; this.bag.append(b);
    }
    for (let i = slots.length; i < 25; i++) this.bag.append(el('div', 'slot empty'));
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
  }

  renderJournal() {
    const J = this.game.journal, page = this.journalPage;
    page.innerHTML = '';
    const list = el('div', 'sat-jlist');
    let last = '';
    for (const e of ENTRIES) {
      if (e.group !== last) { last = e.group; list.append(el('div', 'sat-jrule')); }
      const got = J?.has(e.id);
      const b = el(got ? 'button' : 'span', 'j-ent' + (got ? ' got' : ''), `<i>${icon(e.glyph)}</i>`);
      b.dataset.ent = e.id;
      if (got) { b.type = 'button'; b.dataset.tip = 'entry:' + e.id; b.dataset.act = 'entry'; b.dataset.id = e.id; }
      list.append(b);
    }
    this.jpage = el('div', 'sat-jpage');
    this.jpage.hidden = true;
    page.append(list, this.jpage);
  }
  openEntry(id) {
    const e = ENTRIES.find((q) => q.id === id);
    if (!e || !this.game.journal?.has(id)) return;
    this.jpage.hidden = false;
    this.jpage.classList.remove('flip'); void this.jpage.offsetWidth; this.jpage.classList.add('flip');
    this.jpage.innerHTML = `<strong>${esc(e.title)}</strong><small>${esc(e.note)}</small>`;
    this.game.audio?.pageFlip?.();
  }

  renderMap() {
    const g = this.game, c = this.mapCanvas, ctx = c.getContext('2d'), world = g.world;
    if (!world) return;
    const seaOk = !!g.progress?.seaReached;
    const cells = [...(g.explored || [])].map((n) => { const { ix, iz } = unpackCell(n); return { x: ix * 100 + 50, z: iz * 100 + 50 }; });
    const ex = g.explored || new Set();
    const seen = (x, z) => ex.has(exploreCell(x, z));
    const babies = [];
    for (const b of world.babies || []) if (b.found) babies.push(b);
    for (const r of world.regions?.list || []) for (const b of r.babies || []) if (b.found) babies.push(b);
    const puddles = [];
    for (const q of world.waters || []) if ((q.kind === 'puddle' || q.kind === 'pond' || q.kind === 'tidepool') && seen(q.x, q.z)) { puddles.push(q); if (puddles.length >= 40) break; }
    const o = g.octopus;
    this.mapInfo = drawMap(ctx, c.width, c.height, {
      cells, seaOk, biomeAt: (x, z) => world.biomeAt(x, z), trail: g.trail || [],
      dens: g.abilities?.denList?.() || [], babies: babies.filter((b) => seen(b.x, b.z)), puddles,
      me: o ? { x: o.x, z: o.z } : null,
    });
  }

  renderCollection() {
    const g = this.game, page = this.colPage;
    page.innerHTML = '';
    const wall = el('div', 'sat-col');
    const babies = g.world?.babies || [];
    const got = g.progress?.rescued || new Set();
    for (const b of babies) {
      const id = String(b.id ?? b);
      const found = got.has(id) || got.has(b.id);
      const p = el(found ? 'button' : 'span', 'col-port' + (found ? ' got' : ''), found ? this.babyPortrait(id) : `<i>${icon('b_baby')}</i>`);
      if (found) { p.type = 'button'; p.dataset.tip = 'entry:octo-baby'; }
      wall.append(p);
    }
    const rares = el('div', 'sat-rares');
    for (const id of RARE) {
      const found = !!(g.inv?.seen?.has(id) || g.inv?.count(id) > 0 || g.inv?.made?.has(id));
      const L = loreOf(id);
      const p = el(found ? 'button' : 'span', 'col-rare' + (found ? ' got' : ''), `<i>${icon(id)}</i>`);
      if (found) { p.type = 'button'; p.dataset.tip = 'item:' + id; p.dataset.act = 'look'; p.dataset.id = id; }
      rares.append(p);
      void L;
    }
    page.append(wall, rares);
  }
  babyPortrait(id) {
    let h = 0; for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0;
    const hue = h % 40, a = 24 + (h % 8);
    return `<svg viewBox="0 0 32 32" aria-hidden="true"><ellipse cx="16" cy="14" rx="8" ry="7" fill="hsl(32,${a}%,${48 + (h % 10)}%)"/><circle cx="13" cy="13" r="1.1" fill="#1a1a1a"/><circle cx="19" cy="13" r="1.1" fill="#1a1a1a"/><g fill="none" stroke="hsl(205,80%,60%)" stroke-width="1.1">${[[12,12],[20,12],[16,10],[14,16],[18,16]].map(([x,y]) => `<circle cx="${x}" cy="${y}" r="1.4"/>`).join('')}</g></svg>`;
  }

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
    } else if (kind === 'entry') {
      const e = ENTRIES.find((q) => q.id === id);
      if (!e || !this.game.journal?.has(id)) { this.hideTip(); return; }
      title = e.title; note = e.note;
    } else { this.hideTip(); return; }
    this._tipId = key;
    this.tip.innerHTML = `<strong>${esc(title)}</strong>` + (note ? `<small>${esc(note)}</small>` : '');
    this.tip.hidden = false;
    this.placeTip(t);
  }
  placeTip(anchor) {
    const r = anchor.getBoundingClientRect(), tip = this.tip, pad = 10;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 8;
    if (y < pad) y = r.bottom + 8;
    x = Math.max(pad, Math.min(x, innerWidth - tw - pad));
    y = Math.max(pad, Math.min(y, innerHeight - th - pad));
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  hideTip() { if (this.tip.hidden) return; this.tip.hidden = true; this.tip.innerHTML = ''; this._tipId = null; }

  buttons() { return [...this.root.querySelectorAll('button[data-act], button.badge.got, button.j-ent.got, button.sat-tab')]; }
  focusFirst() {
    const prefer = this.tab === 'bag' ? this.bagPage.querySelector('button[data-act]') : this.root.querySelector('.sat-page:not([hidden]) button, .sat-tab.on');
    const b = prefer || this.buttons()[0];
    if (b) b.focus({ preventScroll: true });
  }
  nav(dx, dy) {
    const all = this.buttons().filter((b) => !b.hidden && b.offsetParent);
    if (!all.length) return;
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
  activate() {
    const b = this.root.querySelector(':focus');
    if (!b) return;
    if (b.dataset.act === 'tab') this.setTab(b.dataset.id);
    else if (b.dataset.ent) this.openEntry(b.dataset.ent);
    else if (b.dataset.act) this.act(b);
  }
  act(b) {
    const g = this.game;
    if (b.dataset.act === 'tab') { this.setTab(b.dataset.id); return; }
    if (b.dataset.act === 'craft') {
      if (g.inv.craft(b.dataset.id)) { g.audio.craft?.(); g.audio.plop?.(); g.afterCraft?.(RECIPES.find((r) => r.id === b.dataset.id)); this.render(); this.pop(b.dataset.id); }
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

  // ---- drag an ingredient onto a recipe (mouse); click-to-craft still works
  dragStart(e) {
    if (this.tab !== 'bag' || e.button) return;
    const slot = e.target.closest('button.slot[data-id]');
    if (!slot || slot.classList.contains('none') || this.game.inv.count(slot.dataset.id) < 1) return;
    this._drag = { id: slot.dataset.id, x: e.clientX, y: e.clientY, from: slot, ready: false };
  }
  dragMove(e) {
    if (!this._drag) return;
    const d = this._drag;
    if (!d.ready && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    if (!d.ready) {
      d.ready = true;
      this.ghost.hidden = false; this.ghost.innerHTML = `<i>${icon(d.id)}</i>`;
      this.root.setPointerCapture?.(e.pointerId);
    }
    this.ghost.style.left = e.clientX + 'px'; this.ghost.style.top = e.clientY + 'px';
    const rec = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('button.rec');
    for (const r of this.recs.querySelectorAll('.rec')) r.classList.toggle('drop', r === rec && !!RECIPES.find((q) => q.id === r.dataset.id && q.in[d.id]));
  }
  dragEnd(e) {
    if (!this._drag) return;
    const d = this._drag;
    const rec = d.ready && document.elementFromPoint(e.clientX, e.clientY)?.closest?.('button.rec');
    this.dragCancel();
    if (rec && RECIPES.find((q) => q.id === rec.dataset.id && q.in[d.id]) && this.game.inv.craft(rec.dataset.id)) {
      this.game.audio.craft?.(); this.game.audio.plop?.();
      this.game.afterCraft?.(RECIPES.find((r) => r.id === rec.dataset.id));
      this.render(); this.pop(rec.dataset.id);
    }
  }
  dragCancel() {
    if (!this._drag) return;
    this._drag = null; this.ghost.hidden = true; this.ghost.innerHTML = '';
    for (const r of this.recs.querySelectorAll('.rec.drop')) r.classList.remove('drop');
  }

  /** lightweight menu motion while the game is paused */
  tick(dt) {
    if (!this.isOpen) return;
    this._t += dt;
    const px = this._parallax.x + Math.sin(this._t * 0.25) * 2;
    const py = this._parallax.y + Math.cos(this._t * 0.2) * 1.5;
    this.den.style.transform = `translate(${px}px, ${py}px)`;
  }
}
