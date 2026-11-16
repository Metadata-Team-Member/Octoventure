// Every shared piece of geometry in one place, so the renderer (worldView / collect) and the placement audit use
// exactly the same meshes.
import * as THREE from 'three';
import { tint, merge, at, rockGeometry, treeGeometries, grassGeometry, reedGeometry, seagrassGeometry, coralGeometry } from './models.js';
import { PROP_GEO } from './props.js';

/** a little scallop: fan of ribs on a flat dome (the hidden collectible shells) */
export function shellGeometry() {
  const parts = [at(tint(new THREE.SphereGeometry(0.2, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0xffffff), 0, 0, 0, 0, 0, 0, 1.2, 0.55, 1)];
  for (let i = -2; i <= 2; i++) parts.push(at(tint(new THREE.BoxGeometry(0.035, 0.1, 0.4), 0xdcdcdc), i * 0.09, 0.06 - Math.abs(i) * 0.012, 0.0, 0, 0, i * -0.2));
  parts.push(at(tint(new THREE.CylinderGeometry(0.06, 0.08, 0.05, 5), 0xf6e9dd), 0, 0.02, -0.2));
  return merge(parts);
}
/** a daisy: thin stem with a flower head on top (base of the stem is the origin) */
export function flowerGeometry() {
  return merge([
    at(tint(new THREE.CylinderGeometry(0.018, 0.026, 0.36, 4), 0x4f8a3a), 0, 0.18, 0),
    at(tint(new THREE.IcosahedronGeometry(0.13, 0), 0xffffff), 0, 0.4, 0, 0, 0, 0, 1, 0.55, 1),
  ]);
}

export function buildGeoLib() {
  const propCache = {};
  return {
    tree: treeGeometries(),
    rock: rockGeometry(0), grass: grassGeometry(), reed: reedGeometry(),
    flower: flowerGeometry(),
    shell: new THREE.ConeGeometry(0.16, 0.14, 6), weed: new THREE.IcosahedronGeometry(0.3, 0), wood: new THREE.BoxGeometry(1.6, 0.18, 0.2),
    seagrass: seagrassGeometry(), coral: coralGeometry(),
    shellc: shellGeometry(),
    propGeo(kind) { return (propCache[kind] ??= PROP_GEO[kind]()); },
    propCache,
  };
}
