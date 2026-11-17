// Dev helper: batch asset screenshots in one browser session (before/after comparisons).
//   npm run build && node scripts/shots.mjs <prefix> [names,comma,separated]
// Each shot frames the nearest instance of a world asset (or a spawned predator) with the debug camera.
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [prefix = '/workspace/octo-v9-shot', only = ''] = process.argv.slice(2);
const chrome = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 675 });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
await page.goto(pathToFileURL(resolve('play/index.html')).href + '?seed=2026&nosave', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.frame > 3, { timeout: 240000 });
await page.click('#play');
await page.evaluate(() => {
  const G = window.__game, g = G.game;
  G.freezeTime(true); G.setTime(0.42); G.setWeather('clear');
  // nearest bucketed instance of cat/kind to (x,z) among built chunks, searching the whole world's buckets
  window.__frame = (cat, kinds, dist, hgt, biome) => {
    if (biome) G.teleportToBiome(biome);
    const o = g.octopus; let best = null, bd = 1e9;
    for (const b of g.view.buckets.values()) {
      const c = b[cat]; if (!c) continue;
      for (const k of kinds) for (const it of c[k] || []) { const d = Math.hypot(it.x - o.x, it.z - o.z); if (d < bd) { bd = d; best = it; } }
    }
    if (!best) return null;
    const a = 0.7, cx = best.x + Math.cos(a) * dist, cz = best.z + Math.sin(a) * dist;
    G.teleport(best.x + Math.cos(a) * dist * 0.5, best.z + Math.sin(a) * dist * 0.5);
    G.clearPredators();
    const gy = g.world.heightAt(best.x, best.z);
    G.setDebugCam(cx, g.world.heightAt(cx, cz) + hgt, cz, best.x, gy + hgt * 0.45, best.z);
    for (let i = 0; i < 20; i++) { g.update(1 / 30); }
    return { x: best.x, z: best.z };
  };
});
const shots = {
  trees: `__frame('tree', ['oak','gum','paperbark'], 16, 4, 'bush')`,
  pine: `__frame('tree', ['pine','willow','palm','mangrove'], 16, 4, 'suburb')`,
  grass: `__frame('grass', ['g'], 3.2, 0.8, 'farm')`,
  rocks: `__frame('rock', ['r'], 5, 1.4, 'headland')`,
  cars: `__frame('prop', ['parkedcar'], 9, 2.5, 'suburb')`,
  houses: `__frame('prop', ['house0','house1','house2'], 26, 6, 'suburb')`,
  props: `__frame('prop', ['fence','bin','shed','log','hollowlog','haybale'], 9, 2.5, 'farm')`,
  predators: `(() => { const G = window.__game, g = G.game; G.teleportToBiome('farm'); G.clearPredators(); const o = g.octopus;
    const ks = ['cat','dog','fox','magpie']; ks.forEach((k, i) => { const p = G.spawnPredator(k, 3 + i * 2.2, -3 + i * 2); p.state = 'wander'; });
    for (let i = 0; i < 10; i++) g.update(1/30);
    G.setDebugCam(o.x + 5, o.y + 2.2, o.z - 6, o.x + 6, o.y + 0.5, o.z + 1); for (let i = 0; i < 5; i++) g.update(1/30); return 1; })()`,
  gull: `(() => { const G = window.__game, g = G.game; G.teleportToBiome('beach'); G.clearPredators(); const o = g.octopus;
    ['gull','crab','human'].forEach((k, i) => { const p = G.spawnPredator(k, 4 + i * 3, i * 2); p.state = 'wander'; });
    for (let i = 0; i < 10; i++) g.update(1/30);
    G.setDebugCam(o.x + 4, o.y + 2.5, o.z - 8, o.x + 7, o.y + 1, o.z + 2); for (let i = 0; i < 5; i++) g.update(1/30); return 1; })()`,
  map: `(() => { const G = window.__game, g = G.game; G.clearDebugCam(); for (let i = 0; i < 300; i++) { g.octopus.x += 1.2; g.octopus.z += Math.sin(i / 20) * 1.5; g.update(1/30); } G.toggleSatchel(); G.setTab('map'); return 1; })()`,
};
for (const [name, code] of Object.entries(shots)) {
  if (only && !only.split(',').includes(name)) continue;
  const r = await page.evaluate(code).catch((e) => 'ERR ' + e.message);
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${prefix}-${name}.png` });
  console.log(name, JSON.stringify(r));
  if (name === 'map') await page.evaluate(() => { const G = window.__game; if (G.game.satchelOpen) G.toggleSatchel(); });
}
console.log(problems.length ? 'PROBLEMS:\n' + [...new Set(problems)].join('\n') : '(no console problems)');
await browser.close();
