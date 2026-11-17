// Audio smoke for the adaptive score: build the graph, then simulate a minute of
// play across biomes, night, a hunt, water and the satchel. Run after `npm run build`.
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const chrome = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
if (!chrome) { console.error('No Chrome found. Set CHROME_PATH.'); process.exit(2); }
const file = resolve('play/index.html');
if (!existsSync(file)) { console.error('play/index.html missing - run `npm run build` first'); process.exit(2); }

let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failed++; };

const browser = await puppeteer.launch({
  executablePath: chrome, headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 560 });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(pathToFileURL(file).href + '?seed=2026', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.frame > 3, { timeout: 240000 });
await page.click('#play');
const E = (f, ...a) => page.evaluate(f, ...a);
await E(() => { const G = window.__game; G.clearPredators(); G.freezeTime(true); G.setTime(0.5); G.setWeather('clear'); });

const boot = await E(async () => {
  const g = window.__game.game, m = g.music, a = g.audio;
  if (a.ctx?.state === 'suspended') await a.ctx.resume();
  if (!m.sum) { m.attach(a); m.start(); }
  const an = a.ctx.createAnalyser();
  an.fftSize = 2048;
  m.out.connect(an);
  m._an = an;
  m._buf = new Float32Array(an.fftSize);
  const nodes = {
    ctx: a.ctx.state,
    master: !!a.master,
    sum: !!m.sum, lp: !!m.lp, out: !!m.out,
    voices: m.voices?.length, plucks: m.plucks?.length,
    tense: !!(m.tenseLo && m.tenseHi),
    externals: [...document.querySelectorAll('audio, video, source')].length,
    enabled: m.enabled, satchel: m.satchel,
  };
  return nodes;
});
ok(boot.ctx === 'running' && boot.master && boot.sum && boot.lp && boot.out, `graph built on a running context (${boot.ctx})`);
ok(boot.voices === 3 && boot.plucks === 4 && boot.tense, `reused voices: ${boot.voices} drones, ${boot.plucks} plucks, tension pair`);
ok(boot.externals === 0, 'no external audio/video elements');
ok(boot.enabled && !boot.satchel, 'score starts enabled and not ducked');

const snap = (label) => E((label) => {
  const G = window.__game, g = G.game, m = g.music, a = g.audio, o = g.octopus;
  const an = m._an, buf = m._buf;
  let peak = 0, sumsq = 0;
  if (an) {
    an.getFloatTimeDomainData(buf);
    for (let i = 0; i < buf.length; i++) { const v = buf[i]; const x = Math.abs(v); if (x > peak) peak = x; sumsq += v * v; }
  }
  const voiceGains = (m.voices || []).flatMap((v) => [v.root.g.gain.value, v.fifth.g.gain.value]);
  const pluckGains = (m.plucks || []).map((v) => v.g.gain.value);
  const tense = [m.tenseLo?.g.gain.value ?? 0, m.tenseHi?.g.gain.value ?? 0];
  const inst = voiceGains.reduce((s, x) => s + Math.max(0, x), 0) + pluckGains.reduce((s, x) => s + Math.max(0, x), 0) + tense.reduce((s, x) => s + Math.max(0, x), 0);
  return {
    label, biome: G.biome, night: g.world.night, water: o.waterKind || '', swim: o.swim || 0,
    hunt: m.hunt, wet: m.wet, cut: m.cut, oct: m.oct, slots: [...m.slot],
    out: m.out?.gain.value ?? null, master: a.master?.gain.value ?? null,
    muted: a.muted, musicOn: m.enabled, satchel: m.satchel, mode: g.soundMode ?? 0,
    ctx: a.ctx.state, peak, rms: Math.sqrt(sumsq / (buf?.length || 1)),
    inst, voiceGains, tense, tenseG0: m.tenseG0, errors: 0,
  };
}, label);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Farm at noon
await E(() => { window.__game.teleportToBiome('farm'); window.__game.advance(8); });
await wait(400);
const farm = await snap('farm-noon');
ok(farm.biome === 'farm' && farm.cut > 3000 && farm.oct > 0.9, `farm noon: biome ${farm.biome}, cut ${farm.cut?.toFixed?.(0)}, oct ${farm.oct?.toFixed?.(2)}`);
ok(farm.inst < 0.25 && farm.peak < 0.6, `farm levels quiet and unclipped (inst ${farm.inst.toFixed(3)}, peak ${farm.peak.toFixed(3)}, rms ${farm.rms.toFixed(4)})`);

// Midnight
await E(() => { const G = window.__game; G.setTime(0); G.advance(8); });
await wait(300);
const night = await snap('farm-night');
ok(night.night > 0.8 && night.cut < 1600 && night.oct < farm.oct, `night closes the lowpass and drops the register (cut ${night.cut?.toFixed?.(0)}, oct ${night.oct?.toFixed?.(2)}, night ${night.night.toFixed(2)})`);

// Bush / farm edge + back to day
await E(() => { const G = window.__game; G.setTime(0.5); G.teleportToEcotone('bush', 'farm', 4); G.advance(6); });
await wait(250);
const edge = await snap('bush-farm');
const live = edge.slots.filter((s) => s >= 0).length;
ok(live >= 2, `biome edge keeps more than one drone live (${live} slots, slots=${edge.slots})`);

// Under the sea
await E(() => { const G = window.__game; G.teleportToOcean(10); G.advance(8); });
await wait(300);
const sea = await snap('sea');
ok(sea.water && sea.wet > 0.5 && sea.cut < farm.cut, `in water the lowpass closes further (water ${sea.water}, wet ${sea.wet.toFixed(2)}, cut ${sea.cut?.toFixed?.(0)})`);

const underInfo = await E(() => {
  const G = window.__game, w = G.game.world, dir = w.dir, coast = w.cCoast ?? 0;
  let found = false, depth = 0;
  for (let d = 20; d < 900; d += 5) {
    const x = dir.x * (coast + d), z = dir.z * (coast + d);
    const dep = w.seaLevel - w.heightAt(x, z);
    if (w.isSea(x, z) && dep > 1.2) { G.teleport(x, z); found = true; depth = dep; break; }
  }
  G.advance(8);
  return { found, depth, swim: G.game.octopus.swim, sea: w.isSea(G.pos.x, G.pos.z) };
});
await wait(250);
const under = await snap('under');
ok(underInfo.found && underInfo.swim > 0.5 && under.wet > 0.9 && under.cut < 900,
  `fully under closes the lowpass further (found ${underInfo.found}, depth ${underInfo.depth.toFixed(2)}, swim ${underInfo.swim.toFixed(2)}, wet ${under.wet.toFixed(2)}, cut ${under.cut?.toFixed?.(0)})`);

// A close hunt, then the predator is gone
await E(() => {
  const G = window.__game, g = G.game;
  G.teleportToBiome('farm'); G.setTime(0.5); G.clearPredators(); G.advance(0.3);
  const p = G.spawnPredator('dog', 4, 0);
  p.state = 'chase'; p.x = g.octopus.x + 5; p.z = g.octopus.z;
  G.advance(4);
});
await wait(250);
const hunt = await snap('hunt');
ok(hunt.hunt > 0.5 && hunt.tense.some((v) => v > 0.001), `hunt raises the tension layer (hunt ${hunt.hunt.toFixed(2)}, tense ${hunt.tense.map((v) => v.toFixed(4))})`);

await E(() => { const G = window.__game; G.clearPredators(); G.advance(6); });
await wait(200);
const afterHunt = await snap('after-hunt');
ok(afterHunt.hunt < 0.05 && afterHunt.tenseG0 < 0.0005 && afterHunt.tense.every((v) => v < 0.0005),
  `tension falls and is zeroed once the hunt is over (hunt ${afterHunt.hunt.toFixed(3)}, tenseG0 ${afterHunt.tenseG0})`);

// Satchel ducks the score but keeps the context running
await E(() => { const G = window.__game; if (G.paused) G.game.setPaused(false); G.game.openSatchel(); });
await wait(400);
const bag = await snap('satchel');
ok(bag.satchel && bag.ctx === 'running' && bag.out < 0.15, `satchel ducks the score and keeps the context running (out ${bag.out?.toFixed?.(3)}, ctx ${bag.ctx})`);
await E(() => { const G = window.__game; G.game.closeSatchel(); G.game.setPaused(false); });
await wait(500);
const unbag = await snap('unsatchel');
ok(!unbag.satchel && unbag.out > 0.5, `closing the satchel restores the score (out ${unbag.out?.toFixed?.(3)})`);

// M cycles all → effects only → muted → all
const cycle = await E(() => {
  const g = window.__game.game;
  const step = () => ({ mode: g.cycleSound(), musicOn: g.music.enabled, muted: g.audio.muted, master: g.audio.master.gain.value, out: g.music.out.gain.value });
  return { a: step(), b: step(), c: step() };
});
const vol = 0.6;
ok(cycle.a.mode === 1 && cycle.a.musicOn === false && cycle.a.muted === false, `first M is effects only (${JSON.stringify(cycle.a)})`);
ok(cycle.b.mode === 2 && cycle.b.muted === true && cycle.b.master === 0, `second M mutes everything (master ${cycle.b.master})`);
ok(cycle.c.mode === 0 && cycle.c.musicOn === true && cycle.c.muted === false && Math.abs(cycle.c.master - vol) < 1e-6, `third M restores all sound (master ${cycle.c.master})`);

// Pressing M on the menu must not be the only path; already in game. Also confirm no page errors so far.
ok(problems.length === 0, problems.length ? `console stayed clean:\n  ${problems.join('\n  ')}` : 'no console errors or warnings');

await browser.close();
if (failed) { console.error(`\n${failed} music smoke check(s) failed`); process.exit(1); }
console.log('music smoke passed');
