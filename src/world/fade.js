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
};

/** update from the game once per frame (world units) */
export function setFade(cam, tgt, k = 1) {
  FADE.uCam.value.copy(cam); FADE.uTgt.value.copy(tgt);
  FADE.uTube.value = 1.15 * Math.max(0.5, k * 1.6);
  FADE.uNear.value = 3.2 * k;
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
