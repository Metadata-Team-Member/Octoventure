// Every shared piece of geometry in one place, so the renderer (worldView / collect) and the placement audit use
// exactly the same meshes.
import * as THREE from 'three';
import { tint, merge, at, rockGeometry, treeGeometries, grassGeometry, reedGeometry, seagrassGeometry, coralGeometry } from './models.js';
import { PROP_GEO } from './props.js';
import { scallop, turban, cowrie } from './shells.js';
import { buildGatherGeos } from './gatherModels.js';

/** a daisy built from separate pieces so the interactive version can curl its petals: a stem, a small centre and six petals
 *  that each hinge at the head centre (the base of the stem is the origin). The instanced flower is these pieces with the
 *  petals open, merged into one geometry; the live (touched) flower in systems/flowers.js animates the same pieces. */
export const FLOWER = { headY: 0.4, petals: 6, petalLen: 0.15, centre: 0.045 };
export function flowerPieces() {
  const stem = at(tint(new THREE.CylinderGeometry(0.018, 0.026, 0.36, 4), 0x4f8a3a), 0, 0.18, 0);
  const centre = at(tint(new THREE.IcosahedronGeometry(FLOWER.centre, 0), 0xfff0b0), 0, FLOWER.headY + 0.005, 0, 0, 0, 0, 1, 0.8, 1);
  const petal = at(tint(new THREE.IcosahedronGeometry(1, 0), 0xffffff), FLOWER.petalLen / 2 + 0.01, 0, 0, 0, 0, 0, FLOWER.petalLen / 2, 0.016, 0.045);   // pivot at the head centre
  return { stem, centre, petal };
}
export function flowerGeometry() {
  const { stem, centre, petal } = flowerPieces();
  const parts = [stem, centre];
  for (let i = 0; i < FLOWER.petals; i++) {
    const g = petal.clone(); g.rotateY((i / FLOWER.petals) * Math.PI * 2); g.translate(0, FLOWER.headY, 0); parts.push(g);
  }
  return merge(parts);
}

/** the three collectible-shell models by kind (c scallop, t turban, k cowrie) */
export const buildShellGeos = () => ({ c: scallop(0), t: turban(), k: cowrie() });

export function buildGeoLib() {
  const propCache = {};
  return {
    tree: treeGeometries(),
    rock: rockGeometry(0), grass: grassGeometry(), reed: reedGeometry(),
    flower: flowerGeometry(),
    shell: at(scallop(1), 0, 0, 0, 0, 0, 0, 0.55), weed: new THREE.IcosahedronGeometry(0.3, 0), wood: new THREE.BoxGeometry(1.6, 0.18, 0.2),
    seagrass: seagrassGeometry(), coral: coralGeometry(),
    shellc: scallop(0), shellt: turban(), shellk: cowrie(),
    gather: buildGatherGeos(),
    propGeo(kind) { return (propCache[kind] ??= PROP_GEO[kind]()); },
    propCache,
  };
}
