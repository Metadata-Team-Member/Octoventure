// Dev helper: load the built game, run a snippet of JS in the page, wait, take a screenshot.
//   node scripts/shoot.mjs out.png "G.setTime(0.9); G.advance(2)" [--seed=2026] [--w=1200] [--h=675] [--wait=1500]
// Inside the snippet, `G` is window.__game (debug hooks) and `g` is the Game itself.
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [out, code = ''] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `=${d}`).split('=')[1];
const chrome = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: +opt('w', 1200), height: +opt('h', 675) });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
await page.goto(pathToFileURL(resolve('play/index.html')).href + `?seed=${opt('seed', 2026)}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.frame > 3, { timeout: 240000 }).catch((e) => { console.log('LOAD FAILED', problems.join('\n')); process.exit(1); });
await page.click('#play');
await page.evaluate(`(async () => { const G = window.__game, g = G.game; G.clearPredators(); g.input.keys.clear(); ${code} })()`).then((r) => r !== undefined && console.log('result:', JSON.stringify(r)));
await new Promise((r) => setTimeout(r, +opt('wait', 1500)));
await page.screenshot({ path: out });
console.log('shot ->', out, problems.length ? '\nPROBLEMS:\n' + problems.join('\n') : '(no console problems)');
await browser.close();
