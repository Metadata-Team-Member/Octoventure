// =====================================================================
//  Occluder fade: with the camera down at octopus height the grass, props and trees are far taller than the view, so
//  anything standing between the camera and the octopus (or right in the lens) is dithered away instead of blocking it.
//  Patched into the instanced world materials with onBeforeCompile; one shared uniform set, updated each frame.
//  Dither (screen-door) instead of alpha blending: no sorting, no transparency cost, shadows are unaffected.
// =====================================================================
import * as THREE from 'three';
import { addPatch } from './toon.js';

export const FADE = {
  uCam: { value: new THREE.Vector3(0, 100, 0) },
  uTgt: { value: new THREE.Vector3(0, 0, 0) },
  uTube: { value: 0.8 },      // radius of the see-through tube around the camera -> octopus line
  uNear: { value: 1.2 },      // fragments closer than this to the lens fade out
  uOn: { value: 1 },
  uTime: { value: 0 },
};

/** update from the game once per frame (world units) */
export function setFade(cam, tgt, k = 1) {
  FADE.uCam.value.copy(cam); FADE.uTgt.value.copy(tgt);
  FADE.uTube.value = 1.15 * Math.max(0.5, k * 1.6);
  FADE.uNear.value = 3.2 * k;
  FADE.uTime.value = (performance.now() / 1000) % 3600;
}

export function applyFade(mat) {
  return addPatch(mat, 'fade1', (sh) => {
    Object.assign(sh.uniforms, FADE);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFadeWP;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 fw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            fw = instanceMatrix * fw;
          #endif
          vFadeWP = (modelMatrix * fw).xyz; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFadeWP;
        uniform vec3 uCam; uniform vec3 uTgt; uniform float uTube; uniform float uNear; uniform float uOn;`)
      .replace('void main() {', `void main() {
        if (uOn > 0.5) {
          vec3 fab = uTgt - uCam; float fL = max(length(fab), 0.001); vec3 fdir = fab / fL;
          vec3 frel = vFadeWP - uCam;
          float ft = dot(frel, fdir);
          float fa = 0.0;
          float dcam = length(frel);
          fa = max(fa, 1.0 - smoothstep(uNear * 0.45, uNear, dcam));                      // in the lens
          if (ft > 0.0 && ft < fL - 0.25) {
            float dl = length(frel - fdir * ft);
            float r = uTube * (0.45 + 0.55 * smoothstep(0.0, fL, ft));                     // a cone: narrow near the camera, wide near the octopus
            fa = max(fa, (1.0 - smoothstep(r * 0.5, r, dl)) * smoothstep(0.0, uNear * 0.6, ft));
          }
          if (fa > 0.0) {
            float fn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            if (fn < fa * 0.96) discard;
          }
        }`);
  });
}

/**
 * t256u grass: a vertex patch for the instanced grass / reed tufts. Blades sway in a soft travelling breeze (bouncy secondary
 * motion) and lean away from the camera -> octopus line and out of the lens, so the near grass parts like real grass instead of
 * showing up as a dithered stipple (the dither in applyFade stays as the safety net for anything the bend can't clear).
 * The blade's local height (0 at the base) weights everything, so the roots stay planted.
 */
export function applyBend(mat) {
  return addPatch(mat, 'bend1', (sh) => {
    Object.assign(sh.uniforms, FADE);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uCam; uniform vec3 uTgt; uniform float uTube; uniform float uNear; uniform float uTime;')
      .replace('#include <project_vertex>', `
        vec4 bw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          bw = instanceMatrix * bw;
        #endif
        bw = modelMatrix * bw;
        {
          float hn = clamp(transformed.y, 0.0, 1.6);            // normalised blade height (roots stay planted)
          vec3 base = bw.xyz;
          #ifdef USE_INSTANCING
            base = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #endif
          float h = max(bw.y - base.y, 0.0);                    // world height of this vertex above the root
          float sway = sin(uTime * 1.7 + base.x * 0.35 + base.z * 0.21) + 0.5 * sin(uTime * 2.9 + base.z * 0.6);
          bw.x += sway * 0.06 * h * hn; bw.z += sway * 0.035 * h * hn;
          // part around the view line (xz only) and out of the lens
          vec2 ab = uTgt.xz - uCam.xz; float L = max(length(ab), 0.001); vec2 dir = ab / L;
          vec2 rel = base.xz - uCam.xz; float ta = dot(rel, dir); float t = clamp(ta, 0.0, L);
          vec2 off = rel - dir * t; float dl = length(off);
          float r = uTube * 1.25 + 0.15;
          float k = (1.0 - smoothstep(r * 0.4, r, dl)) * step(0.0, ta) * step(ta, L + 0.3);
          float kc = 1.0 - smoothstep(uNear * 0.8, uNear * 1.8, length(base - uCam));
          k = max(k, kc);
          vec2 side = dl > 1e-3 ? off / dl : vec2(-dir.y, dir.x);
          bw.xz += side * (k * h * 0.75 * hn);
          bw.y -= k * h * 0.8 * hn;
        }
        vec4 mvPosition = viewMatrix * bw;
        gl_Position = projectionMatrix * mvPosition;`);
  });
}
