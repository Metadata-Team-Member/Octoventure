// =====================================================================
//  Wet trail: what a damp octopus leaves behind. Not footprints - thin, wavy drag lines from its trailing arms, each with a
//  row of tiny sucker dots. One stamp = the stretch of trail between two points; stamps are instanced and fade out.
//  Unit geometry: lies in the XZ plane, +z is the direction of travel; the stamp covers z in [-1, 0] and is scaled in z to the
//  real segment length. A whole number of wave periods per stamp keeps the lines continuous from one stamp to the next.
// =====================================================================
import * as THREE from 'three';

export const TRAIL = { arms: 5, spread: 0.09, width: 0.012, amp: 0.022, dot: 0.011, dotsPerArm: 7 };

export function trailGeometry() {
  const T = TRAIL, pos = [], idx = [];
  const quad = (a, b, c, d) => { const i = pos.length / 3; pos.push(...a, ...b, ...c, ...d); idx.push(i, i + 2, i + 1, i, i + 3, i + 2); };
  const N = 14;
  for (let k = 0; k < T.arms; k++) {
    const ax = (k - (T.arms - 1) / 2) * T.spread, ph = k * 2.1 + 0.7, A = T.amp * (0.7 + 0.5 * ((k * 37) % 10) / 10);
    const X = (z) => ax + A * Math.sin(2 * Math.PI * z + ph);
    const dX = (z) => A * 2 * Math.PI * Math.cos(2 * Math.PI * z + ph);
    // the drag line: a thin ribbon following the wave
    for (let i = 0; i < N; i++) {
      const z0 = -1 + i / N, z1 = -1 + (i + 1) / N;
      const hw = T.width / 2 * (0.75 + 0.25 * Math.sin(Math.PI * (z0 + 1)));          // swells a little mid-stamp
      quad([X(z0) - hw, 0, z0], [X(z1) - hw, 0, z1], [X(z1) + hw, 0, z1], [X(z0) + hw, 0, z0]);
    }
    // sucker dots: small octagons alternating either side of the line
    for (let j = 0; j < T.dotsPerArm; j++) {
      const z = -1 + (j + 0.5) / T.dotsPerArm, side = j % 2 ? 1 : -1;
      const nx = 1 / Math.hypot(1, dX(z)), cx = X(z) + side * (T.width / 2 + T.dot * 0.9) * nx, cz = z - side * (T.width / 2 + T.dot * 0.9) * dX(z) * nx;
      const c = pos.length / 3; pos.push(cx, 0, cz);
      for (let s = 0; s < 8; s++) { const a = (s / 8) * Math.PI * 2; pos.push(cx + Math.cos(a) * T.dot, 0, cz + Math.sin(a) * T.dot * 0.5); }   // dots are slightly stretched along the line (z scale 0.5 -> ~round after the stamp's z scale)
      for (let s = 0; s < 8; s++) idx.push(c, c + 1 + ((s + 1) % 8), c + 1 + s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

/** material: wet-dark, with a per-instance alpha attribute `aA` so each stamp fades on its own */
export function trailMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: 0x1b2b3a, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aA;\nvarying float vA;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvA = aA;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vA;').replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\ndiffuseColor.a *= vA;');
  };
  m.customProgramCacheKey = () => 'trail1';
  return m;
}
