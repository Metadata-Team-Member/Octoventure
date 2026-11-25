// Ladybird gatherable (src/assets/models/beetle.glb). The browser inlines the file
// via a Vite `?url` import in systems/gather.js (that import must not live here:
// node unit and placement tests load this module, and they do not understand `?url`).
// Node reads the same bytes and awaits one parse before those tests run, so the
// placement audit seats exactly the stand-in the instanced mesh draws.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bakeToonSkinned } from './toonGlb.js';

// Authored sRGB from tools/blender/beetle.py — not the linearised glTF colours.
export const BEETLE_TINT = {
  BeetleShell: 0xFF5A2A, BeetleSeam: 0xE83C20, BeetleSpot: 0x2A221C, BeetleCream: 0xF3E6C8,
  BeetleBelly: 0x3D2A24, BeetleEye: 0x1A1A1A, BeetleHighlight: 0xffffff,
};
// Shell and the dark body (head, legs, spots) share bone buckets so each leg keeps
// its own triangles. Seam, cream, belly, eyes and the catchlight are small parts.
export const BEETLE_PART = {
  BeetleShell: 0, BeetleSpot: 0, BeetleSeam: 1, BeetleCream: 2, BeetleBelly: 3, BeetleEye: 4, BeetleHighlight: 5,
};
export const BEETLE_BUDGET = {
  head: 12, thorax: 8, abdomen: 16, root: 2, ant_L: 3, ant_R: 3,
  leg_LF: 4, leg_LM: 4, leg_LH: 4, leg_RF: 4, leg_RM: 4, leg_RH: 4,
  p1: 6, p2: 6, p3: 4, p4: 6, p5: 3,
};

const SPEC = { tint: BEETLE_TINT, part: BEETLE_PART, budget: BEETLE_BUDGET, fallback: 0xFF5A2A, keepLow: true, keepSpan: true };

let _tpl = null;

function isNode() {
  return typeof window === 'undefined' && typeof process !== 'undefined' && !!process.versions?.node && typeof process.getBuiltinModule === 'function';
}

async function parseGlb(buffer) {
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  return bakeToonSkinned(gltf, SPEC);
}

function readBytesNode() {
  const { readFileSync } = process.getBuiltinModule('fs');
  const { dirname, join } = process.getBuiltinModule('path');
  const { fileURLToPath } = process.getBuiltinModule('url');
  const buf = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../assets/models/beetle.glb'));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function bytesFromUrl(url) {
  if (typeof url === 'string' && url.startsWith('data:')) {
    const b64 = url.slice(url.indexOf(',') + 1);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 255;
    return out.buffer;
  }
  // Vite dev serves the glb as a URL; the single-file build inlines a data URL.
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, false);
  xhr.overrideMimeType('text/plain; charset=x-user-defined');
  xhr.send(null);
  const text = xhr.responseText;
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 255;
  return out.buffer;
}

export async function installBeetleFromUrl(url) {
  if (_tpl) return _tpl;
  _tpl = await parseGlb(bytesFromUrl(url));
  return _tpl;
}

export function beetleTemplate() {
  if (!_tpl) throw new Error('beetle glb is not ready');
  return _tpl;
}

/** Rest-pose stand-in. A fresh clone so a Gatherer can dispose its copy. */
export function beetleStandIn() {
  return beetleTemplate().farGeo.clone();
}

if (isNode()) _tpl = await parseGlb(readBytesNode());
