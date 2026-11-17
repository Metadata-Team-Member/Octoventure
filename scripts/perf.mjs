// Rough software-render perf probe: draw calls, triangles and mean frame time over a short walk. Run after `npm run build`.
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const chrome = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(pathToFileURL(resolve('play/index.html')).href + '?seed=2026&nosave', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.frame > 3, { timeout: 240000 });
await page.click('#play');
const out = {};
for (const b of (process.env.BIOMES || 'bush,farm,beach,desert,rainforest').split(',')) {
  const r = await page.evaluate(async (b) => {
    const G = window.__game, g = G.game;
    if (!G.teleportToBiome(b)) return null;
    G.freezeTime(true); G.setTime(0.45);
    await new Promise((r) => setTimeout(r, 800));
    const info = g.renderer.info; let calls = 0, tris = 0, ms = 0; const N = 20;
    for (let i = 0; i < N; i++) { const t0 = performance.now(); g.update(1 / 30); g.render(); ms += performance.now() - t0; calls += info.render.calls; tris += info.render.triangles; }
    return { calls: Math.round(calls / N), tris: Math.round(tris / N), ms: +(ms / N).toFixed(1) };
  }, b);
  out[b] = r;
}
console.log(JSON.stringify(out));
await browser.close();
