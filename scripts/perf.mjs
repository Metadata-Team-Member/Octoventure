// Perf probe (software renderer, so compare runs against each other rather than reading absolute ms as real-GPU numbers).
// For each biome: teleport, let the streaming settle, then average N frames of update + render: draw calls, triangles (both
// including the shadow pass), shader programs, and mean CPU+raster frame time. Also reports the octopus's own draw calls.
//   usage: npm run build && node scripts/perf.mjs [--shadows=0] [--mobile]      env BIOMES=bush,farm,... N=30
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const chrome = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const extra = process.argv.includes('--shadows=0') ? '&shadows=0' : '';
const mobile = process.argv.includes('--mobile');
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
if (mobile) await page.emulate({ viewport: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
else await page.setViewport({ width: 1280, height: 720 });
await page.goto(pathToFileURL(resolve('play/index.html')).href + '?seed=2026&nosave' + extra, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.frame > 3, { timeout: 240000 });
await page.evaluate(() => document.getElementById('play').click());
const N = Number(process.env.N || 30);
const out = {};
for (const b of (process.env.BIOMES || 'suburb,bush,farm,beach,desert,rainforest').split(',')) {
  out[b] = await page.evaluate(async (b, N) => {
    const G = window.__game, g = G.game;
    if (!G.teleportToBiome(b)) return null;
    G.clearPredators(); G.freezeTime(true); G.setTime(0.45); G.setWeather('clear');
    for (let i = 0; i < 40; i++) { g.update(1 / 30); g.render(); }            // let chunks stream in and shaders compile
    await new Promise((r) => setTimeout(r, 300));
    const info = g.renderer.info; let calls = 0, tris = 0, ms = 0;
    const gl = g.renderer.getContext(), px = new Uint8Array(4);       // a 1-pixel read-back waits for the GPU, so ms includes the raster work
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); sync();
    for (let i = 0; i < N; i++) { const t0 = performance.now(); g.update(1 / 30); g.render(); sync(); ms += performance.now() - t0; calls += info.render.calls; tris += info.render.triangles; }
    // the octopus alone: render only its group once
    const vis = []; g.scene.children.forEach((c) => { vis.push(c.visible); c.visible = c === g.octopus.group; });
    const sm = g.renderer.shadowMap.enabled; g.renderer.shadowMap.enabled = false; g.renderer.render(g.scene, g.camera); const octo = info.render.calls; g.renderer.shadowMap.enabled = sm;
    g.scene.children.forEach((c, i) => { c.visible = vis[i]; });
    return { calls: Math.round(calls / N), tris: Math.round(tris / N), ms: +(ms / N).toFixed(1), programs: info.programs.length, octoCalls: octo };
  }, b, N);
}
console.log(JSON.stringify(out));
await browser.close();
