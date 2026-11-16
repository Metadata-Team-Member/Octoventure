// Visits every biome (teleport hook), checks it looks/behaves like itself, takes one screenshot each.
//   node scripts/biomes.mjs [--seed=N (debug world; default: the one world)] [--out=.]
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `=${d}`).split('=')[1];
const chrome = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 620 });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
await page.goto(pathToFileURL(resolve('play/index.html')).href + (process.argv.some((a) => a.startsWith('--seed=')) ? `?seed=${opt('seed', 45)}` : '?nosave'), { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.frame > 3, { timeout: 240000 });
await page.click('#play');
let fails = 0;
const check = (c, m) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m); if (!c) fails++; };
const names = ['suburb', 'town', 'farm', 'bush', 'riverbank', 'wetland', 'dunes', 'beach', 'headland', 'estuary', 'sea'];
for (const name of names) {
  const r = await page.evaluate(async (name) => {
    const G = window.__game, g = G.game;
    G.clearPredators(); G.freezeTime(true); G.setTime(0.42); G.setWeather('clear');
    const okTp = G.teleportToBiome(name);
    if (name === 'sea') { G.teleportToOcean(14); }
    g.octopus.health = 100;
    g.input.yaw = 0.8; g.input.pitch = 0.45;
    G.advance(1.2);
    await new Promise((r) => setTimeout(r, 900));
    const w = g.world, o = G.pos;
    const near = (kinds, R) => w.props.filter((p) => kinds.includes(p.kind) && Math.hypot(p.x - o.x, p.z - o.z) < R).length;
    return { okTp, biome: G.biome, terrain: G.terrain, perf: G.perf, amb: g.atmo.ambient, tint: g.atmo.bTint.getHexString(), fog: g.atmo.bFog, trees: w.decor.trees.filter((t) => Math.hypot(t.x - o.x, t.z - o.z) < 150).reduce((a, t) => (a[t.kind] = (a[t.kind] || 0) + 1, a), {}), pos: o };
  }, name);
  check(r.okTp && (r.biome === name || name === 'sea' && r.biome === 'sea'), `${name}: teleported into the biome (now in ${r.biome}, ground ${r.terrain})`);
  console.log(`      draw calls ${r.perf.calls}, tris ${(r.perf.triangles / 1000).toFixed(0)}k, chunks ${r.perf.chunks}/${r.perf.chunksVisible}, tint #${r.tint}, fog x${r.fog.toFixed(2)}, trees ${JSON.stringify(r.trees)}`);
  check(r.perf.calls < 900, `${name}: draw calls under budget (${r.perf.calls})`);
  await page.screenshot({ path: `${opt('out', '.')}/octo-v2-biome-${name}.png` });
}

// ---- the blends between neighbouring biomes: one ends, the next starts (and both are really there)
const pairs = [['suburb', 'farm'], ['farm', 'bush'], ['bush', 'wetland'], ['bush', 'dunes'], ['dunes', 'beach'], ['beach', 'sea'], ['headland', 'beach'], ['estuary', 'wetland'], ['bush', 'headland'], ['wetland', 'sea']];
for (const [a, b] of pairs) {
  const r = await page.evaluate(async (a, b) => {
    const G = window.__game, g = G.game;
    G.clearPredators(); G.freezeTime(true); G.setTime(0.42); G.setWeather('clear'); g.octopus.health = 100;
    const e = G.teleportToEcotone(a, b, 24, 0);
    if (!e) return null;
    g.input.pitch = 0.42; g.input.zoom = 0.5;
    G.advance(1.2);
    await new Promise((r) => setTimeout(r, 900));
    const w = g.world, o = G.pos, ww = Array.from(w.biomes.weights(e.x, e.z)), q0 = Array.from(w.biomes.weights(o.x, o.z)), ia = ['suburb', 'town', 'farm', 'bush', 'riverbank', 'wetland', 'dunes', 'beach', 'headland', 'estuary', 'sea'];
    const near = (nm) => { const i = ia.indexOf(nm); return { mid: ww[i], here: q0[i] }; };
    // the ground types on both sides of the line, in a 120 m strip across the blend: both biomes' ground must show up, intermixed
    const types = {}; for (let d = -45; d <= 45; d += 3) { const t = w.typeAt(e.x + e.dx * d, e.z + e.dz * d); types[t] = (types[t] || 0) + 1; }
    return { e, a: near(a), b: near(b), types, calls: G.perf.calls };
  }, a, b);
  check(r && r.a.mid > 0.3 && r.b.mid > 0.3, `${a} -> ${b}: a blend exists (weights ${r ? r.a.mid.toFixed(2) + ' / ' + r.b.mid.toFixed(2) : 'none'}), ground ${r ? JSON.stringify(r.types) : ''}`);
  check(r && r.a.here > r.b.here && r.calls < 900, `${a} -> ${b}: the camera starts on the ${a} side (${r ? r.a.here.toFixed(2) + ' vs ' + r.b.here.toFixed(2) : ''}), draw calls ${r ? r.calls : ''}`);
  await page.screenshot({ path: `${opt('out', '.')}/octo-v5-transition-${a}-${b}.png` });
}
check(problems.length === 0, 'no console errors or warnings' + (problems.length ? '\n' + problems.join('\n') : ''));
console.log(fails ? `${fails} check(s) FAILED` : 'all biome checks passed');
await browser.close();
process.exit(fails ? 1 : 0);
