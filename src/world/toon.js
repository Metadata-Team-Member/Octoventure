// =====================================================================
//  Soft toon look (t248u): Animal Crossing / Fortnite style, not hard Borderlands cel shading.
//   - toonMat(): MeshToonMaterial with a soft 3-band gradient (linear filtering blurs the band edges), a gentle rim light and a
//     small saturation lift, replacing the physically based MeshStandardMaterial everywhere (no roughness / metalness / PBR
//     specular maths per pixel).
//   - outlineMat(): a cheap inverted-hull outline (back faces pushed out a fixed number of PIXELS in clip space, so lines stay
//     thin at any distance). Used only on the octopus, the babies and the creatures.
//  One shared uniform set (TOON) so the day/night cycle can tune the rim and saturation for everything at once.
// =====================================================================
import * as THREE from 'three';

export const TOON = {
  uRim: { value: 0.28 },                       // rim light strength
  uRimColor: { value: new THREE.Color(0xfff2dc) },
  uSat: { value: 1.05 },                       // saturation lift after lighting (curated, slightly candy colours)
  uOutlinePx: { value: 1.6 },                  // outline width in device pixels
  uRes: { value: new THREE.Vector2(1280, 720) },
};

let _grad = null;
/** three soft bands: shade (0.5) / mid (0.78) / lit (1.0), with short linear ramps between them */
export function toonGradient() {
  if (_grad) return _grad;
  const v = [0.50, 0.52, 0.78, 0.80, 1.0, 1.0];
  const data = new Uint8Array(v.map((x) => Math.round(x * 255)));
  _grad = new THREE.DataTexture(data, v.length, 1, THREE.RedFormat);
  _grad.minFilter = THREE.LinearFilter; _grad.magFilter = THREE.LinearFilter; _grad.generateMipmaps = false;
  _grad.needsUpdate = true;
  return _grad;
}

const PBR_ONLY = ['roughness', 'metalness', 'roughnessMap', 'metalnessMap', 'envMap', 'envMapIntensity', 'clearcoat', 'sheen', 'ior', 'reflectivity'];

/** chain a shader patch onto a material without losing earlier ones; `key` keeps program caching correct */
export function addPatch(mat, key, patch) {
  const prev = mat._patches || [];
  mat._patches = [...prev, { key, patch }];
  mat.onBeforeCompile = (sh, r) => { for (const p of mat._patches) p.patch(sh, r); };
  mat.customProgramCacheKey = () => mat._patches.map((p) => p.key).join('|');
  return mat;
}

function rimPatch(sh) {
  Object.assign(sh.uniforms, { uRim: TOON.uRim, uRimColor: TOON.uRimColor, uSat: TOON.uSat });
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uRim; uniform vec3 uRimColor; uniform float uSat;')
    .replace('#include <opaque_fragment>', `{
      float rf = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
      outgoingLight += uRimColor * (smoothstep(0.55, 0.95, rf) * uRim) * (0.35 + 0.65 * diffuseColor.rgb);
      float lum = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
      outgoingLight = max(mix(vec3(lum), outgoingLight, uSat), 0.0);
    }
    #include <opaque_fragment>`);
}

/** drop-in replacement for the old physically based standard material (same params; PBR-only keys are ignored) */
export function toonMat(params = {}) {
  const q = { ...params };
  for (const k of PBR_ONLY) delete q[k];
  const m = new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...q });
  return addPatch(m, 'toon1', rimPatch);
}

/** inverted-hull outline material (set `instanced` for InstancedMesh hulls) */
export function outlineMat(color = 0x1d1420, opacity = 1) {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
  return addPatch(m, 'outline1', (sh) => {
    Object.assign(sh.uniforms, { uOutlinePx: TOON.uOutlinePx, uRes: TOON.uRes });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutlinePx; uniform vec2 uRes;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec3 on = normal;
          #ifdef USE_INSTANCING
            on = mat3(instanceMatrix) * on;
          #endif
          vec3 vn = normalize(mat3(modelViewMatrix) * on);
          vec2 cn = (projectionMatrix * vec4(vn, 0.0)).xy;
          float ln = length(cn);
          if (ln > 1e-5) gl_Position.xy += (cn / ln) * (uOutlinePx * 2.0 / uRes) * gl_Position.w;
        }`);
  });
}

/** give a mesh (or every mesh under an object) an outline child that shares its geometry */
export function outline(obj, mat) {
  const list = [];
  obj.traverse((o) => { if (o.isMesh && !o.userData.isOutline && !o.userData.noOutline) list.push(o); });
  const hulls = [];
  for (const o of list) {
    let h;
    if (o.isInstancedMesh) { h = new THREE.InstancedMesh(o.geometry, mat, o.instanceMatrix.count); h.instanceMatrix = o.instanceMatrix; h.count = o.count; h.frustumCulled = o.frustumCulled; }
    else h = new THREE.Mesh(o.geometry, mat);
    h.userData.isOutline = true; h.castShadow = false; h.receiveShadow = false; h.renderOrder = o.renderOrder;
    o.add(h); hulls.push(h);
  }
  return hulls;
}
