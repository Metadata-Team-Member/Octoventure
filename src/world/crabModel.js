// Gatherable shore crab (src/assets/models/crab.glb). The browser inlines the file
// via a Vite `?url` import in systems/gather.js (that import must not live here:
// node unit and placement tests load this module, and they do not understand `?url`).
// Node reads the same bytes and awaits one parse before those tests run, so the
// placement audit seats exactly the stand-in the live mesh draws.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bakeToonSkinned } from './toonGlb.js';

// Authored sRGB from tools/blender/crab.py — not the linearised glTF colours.
export const CRAB_TINT = {
  CrabShell: 0xFF5C28, CrabSpeckle: 0xD03818, CrabCream: 0xF8E8CC, CrabCreamTip: 0xF6D7A0,
  CrabLeg: 0xF45828, CrabEye: 0x1A1A1A, CrabHighlight: 0xffffff,
};
// Shell and legs share bone buckets so each leg and claw keeps its own triangles.
// Cream, speckles, eyes, the catchlight and the claw tips are small parts.
export const CRAB_PART = {
  CrabShell: 0, CrabLeg: 0, CrabCream: 1, CrabSpeckle: 2, CrabEye: 3, CrabHighlight: 4, CrabCreamTip: 5,
};
export const CRAB_BUDGET = {
  root: 2, body: 18, eye_L: 3, eye_R: 3,
  claw_L: 6, claw_L_pin: 4, claw_R: 6, claw_R_pin: 4,
  leg_L1: 3, leg_L1_shin: 2, leg_L2: 3, leg_L2_shin: 2, leg_L3: 3, leg_L3_shin: 2, leg_L4: 3, leg_L4_shin: 2,
  leg_R1: 3, leg_R1_shin: 2, leg_R2: 3, leg_R2_shin: 2, leg_R3: 3, leg_R3_shin: 2, leg_R4: 3, leg_R4_shin: 2,
  p1: 8, p2: 6, p3: 8, p4: 3, p5: 6,
};

const SPEC = {
  tint: CRAB_TINT, part: CRAB_PART, budget: CRAB_BUDGET, fallback: 0xFF5C28,
  keepLow: true, keepSpan: true, clipNames: ['walk', 'idle', 'snap'],
};

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
  const buf = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../assets/models/crab.glb'));
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
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, false);
  xhr.overrideMimeType('text/plain; charset=x-user-defined');
  xhr.send(null);
  const text = xhr.responseText;
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 255;
  return out.buffer;
}

export async function installCrabFromUrl(url) {
  if (_tpl) return _tpl;
  _tpl = await parseGlb(bytesFromUrl(url));
  return _tpl;
}

export function crabTemplate() {
  if (!_tpl) throw new Error('crab glb is not ready');
  return _tpl;
}

/** Rest-pose stand-in. A fresh clone so a Gatherer can dispose its copy. */
export function crabStandIn() {
  return crabTemplate().farGeo.clone();
}

if (isNode()) _tpl = await parseGlb(readBytesNode());
