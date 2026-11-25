// Player octopus (src/assets/models/octopus.glb). The browser inlines the file via a
// Vite `?url` import in entities/octopus.js (that import must not live here: a
// static `?url` in a module node tests load breaks those tests). Node reads the
// same bytes. Materials stay separate toonMats — baking them into one mesh would
// make camouflage and the ring flash impossible.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assignToonMaterials } from './toonGlb.js';

// Authored sRGB from tools/blender/octopus.py — not the linearised glTF colours.
export const OCTO_HEX = {
  body: 0xDC9C14, belly: 0xF6E4B8, rings: 0x1E6BFF, ringEdge: 0x0A1C66, ringCore: 0x4A3C18,
  eye: 0x1A1A1A, highlight: 0xFFFFFF, beak: 0x3A2C22, sucker: 0xF3D9A8,
};

let _tpl = null;

function isNode() {
  return typeof window === 'undefined' && typeof process !== 'undefined' && !!process.versions?.node && typeof process.getBuiltinModule === 'function';
}

async function parseGlb(buffer) {
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  return assignToonMaterials(gltf, OCTO_HEX, 0xDC9C14);
}

function readBytesNode() {
  const { readFileSync } = process.getBuiltinModule('fs');
  const { dirname, join } = process.getBuiltinModule('path');
  const { fileURLToPath } = process.getBuiltinModule('url');
  const buf = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../assets/models/octopus.glb'));
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

export async function installOctopusFromUrl(url) {
  if (_tpl) return _tpl;
  _tpl = await parseGlb(bytesFromUrl(url));
  return _tpl;
}

export function octopusTemplate() {
  if (!_tpl) throw new Error('octopus glb is not ready');
  return _tpl;
}

if (isNode()) _tpl = await parseGlb(readBytesNode());
