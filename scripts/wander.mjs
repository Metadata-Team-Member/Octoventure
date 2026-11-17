// Long-wander probe: walks the octopus ~2.4 km in a wobbly line across chunk / tile boundaries and records per-frame
// update+render time (the streaming hitches), chunks built / freed and JS heap growth. Software renderer: compare runs.
//   npm run build && node scripts/wander.mjs [--mobile]     env PLAY=path/to/index.html  FRAMES=900
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const chrome = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const mobile = process.argv.includes('--mobile');
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'], protocolTimeout: 0 });
const page = await browser.newPage();
if (mobile) await page.emulate({ viewport: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
else await page.setViewport({ width: 1280, height: 720 });
await page.goto(pathToFileURL(resolve(process.env.PLAY || 'play/index.html')).href + '?seed=2026&nosave' + (mobile ? '&mobile=1' : ''), { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.frame > 3, { timeout: 240000 });
await page.click('#play');
const r = await page.evaluate(async (N) => {
  const G = window.__game, g = G.game, o = g.octopus;
  G.clearPredators(); G.freezeTime(true); G.setTime(0.45); G.setWeather('clear');
  const gc = () => { if (window.gc) window.gc(); };
  const gl = g.renderer.getContext(), px = new Uint8Array(4);
  for (let i = 0; i < 30; i++) { g.update(1 / 30); g.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }   // sync each warm-up frame, or frame 0 pays for all of them
  gc(); await new Promise((r) => setTimeout(r, 200));
  const heap0 = performance.memory?.usedJSHeapSize || 0;
  const ms = []; const b0 = g.view.stats.chunksBuilt;
  let a = 0.7;                                   // fixed heading: before/after runs walk the same line
  for (let i = 0; i < N; i++) {
    a += Math.sin(i * 0.01) * 0.01;
    o.x += Math.cos(a) * 1.5; o.z += Math.sin(a) * 1.5; o.y = g.world.heightAt(o.x, o.z); o.health = 100;   // ~45 m/s: a long trip in a few hundred frames
    const t0 = performance.now(); g.update(1 / 30); g.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ms.push(performance.now() - t0);
  }
  gc(); await new Promise((r) => setTimeout(r, 300)); gc();
  const heap1 = performance.memory?.usedJSHeapSize || 0;
  const worst = ms.map((v, i) => [i, +v.toFixed(0)]).sort((x, y) => y[1] - x[1]).slice(0, 5);   // where the hitches happen
  ms.sort((x, y) => x - y);
  const q = (p) => +ms[Math.min(ms.length - 1, Math.floor(ms.length * p))].toFixed(1);
  return { frames: N, meanMs: +(ms.reduce((s, x) => s + x, 0) / N).toFixed(1), p50: q(0.5), p95: q(0.95), p99: q(0.99), maxMs: q(1), chunksBuilt: g.view.stats.chunksBuilt - b0, chunksLive: g.view.chunks.size, heapMB0: +(heap0 / 1048576).toFixed(1), heapMB1: +(heap1 / 1048576).toFixed(1), geos: g.renderer.info.memory.geometries, programs: g.renderer.info.programs?.length, worst };
}, Number(process.env.FRAMES || 900));
console.log(JSON.stringify(r));
await browser.close();
