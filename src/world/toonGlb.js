// Shared soft-toon glTF helpers (ants, beetles). One parse bakes every primitive into
// vertex colours on a single skinned mesh, and a decimated bind-pose stand-in for
// whatever is too far away to spend an AnimationMixer on. Materials stay toonMat
// at the call site — the glb's PBR is thrown away (GLTFLoader also linearises the
// authored sRGB, so callers pass the hex from the Blender script, not material.color).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Largest triangles per bone / material part. Load time only. `keepLow` retains each bone's lowest triangle (feet). `keepSpan` keeps the extremes so the silhouette stays the real length. */
export function decimateSkinned(geo, bones, budget, { keepLow = false, keepSpan = false } = {}) {
  const pos = geo.attributes.position, col = geo.attributes.color, nrm = geo.attributes.normal;
  const idx = geo.index, skin = geo.attributes.skinIndex, wt = geo.attributes.skinWeight, part = geo.attributes.part;
  const triN = idx.count / 3;
  const groups = new Map();
  const area = (a, b, c) => {
    const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
    const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
    const cx = pos.getX(c), cy = pos.getY(c), cz = pos.getZ(c);
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) * 0.5;
  };
  const boneOf = (v) => {
    let bi = 0, bw = -1;
    for (let k = 0; k < 4; k++) { const w = wt.getComponent(v, k); if (w > bw) { bw = w; bi = skin.getComponent(v, k); } }
    return bones[bi] || 'root';
  };
  for (let t = 0; t < triN; t++) {
    const a = idx.getX(t * 3), b = idx.getX(t * 3 + 1), c = idx.getX(t * 3 + 2);
    const p = part.getX(a);
    const key = p >= 0.5 ? 'p' + Math.round(p) : boneOf(a);
    let g = groups.get(key); if (!g) groups.set(key, g = []);
    g.push({ t, a: area(a, b, c) });
  }
  const keep = [];
  for (const [key, list] of groups) {
    const bgt = budget[key] ?? 4;
    list.sort((u, v) => v.a - u.a);
    const n = Math.min(bgt, list.length);
    for (let i = 0; i < n; i++) if (list[i].a > 0) keep.push(list[i].t);
  }
  if (keepLow || keepSpan) {
    const score = (t, mode) => {
      const o = t * 3, ia = idx.getX(o), ib = idx.getX(o + 1), ic = idx.getX(o + 2);
      if (mode === 'y') return Math.min(pos.getY(ia), pos.getY(ib), pos.getY(ic));
      if (mode === 'z0') return Math.min(pos.getZ(ia), pos.getZ(ib), pos.getZ(ic));
      if (mode === 'z1') return -Math.max(pos.getZ(ia), pos.getZ(ib), pos.getZ(ic));
      if (mode === 'x0') return Math.min(pos.getX(ia), pos.getX(ib), pos.getX(ic));
      return -Math.max(pos.getX(ia), pos.getX(ib), pos.getX(ic));
    };
    const modes = [];
    if (keepLow) modes.push('y');
    if (keepSpan) modes.push('z0', 'z1', 'x0', 'x1');
    for (const [key, list] of groups) {
      if (key[0] === 'p') continue;
      for (const mode of modes) {
        let pick = -1, best = Infinity;
        for (const item of list) {
          const s = score(item.t, mode);
          if (s < best) { best = s; pick = item.t; }
        }
        if (pick >= 0 && !keep.includes(pick)) keep.push(pick);
      }
    }
  }
  const outP = new Float32Array(keep.length * 9), outN = new Float32Array(keep.length * 9), outC = new Float32Array(keep.length * 9);
  let w = 0;
  const put = (v) => {
    outP[w] = pos.getX(v); outP[w + 1] = pos.getY(v); outP[w + 2] = pos.getZ(v);
    outN[w] = nrm.getX(v); outN[w + 1] = nrm.getY(v); outN[w + 2] = nrm.getZ(v);
    outC[w] = col.getX(v); outC[w + 1] = col.getY(v); outC[w + 2] = col.getZ(v);
    w += 3;
  };
  for (const t of keep) { const o = t * 3; put(idx.getX(o)); put(idx.getX(o + 1)); put(idx.getX(o + 2)); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(outP, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(outN, 3));
  g.setAttribute('color', new THREE.BufferAttribute(outC, 3));
  g.computeBoundingSphere();
  return g;
}

/**
 * Merge every skinned primitive into one mesh with vertex colours, parented where the
 * glTF meshes were so SkeletonUtils.clone still finds the skeleton. `farGeo` is the
 * static stand-in (no skin attributes).
 */
export function bakeToonSkinned(gltf, { tint, part, budget, fallback = 0xffffff, keepLow = false, keepSpan = false, clipNames = ['walk', 'idle'] } = {}) {
  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
  const geos = meshes.map((m) => {
    const g = m.geometry.clone();
    const hex = tint[m.material?.name] ?? fallback;
    const c = new THREE.Color(hex), n = g.attributes.position.count, p = part[m.material?.name] ?? 0;
    const col = new Float32Array(n * 3), pa = new Float32Array(n);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; pa[i] = p; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('part', new THREE.BufferAttribute(pa, 1));
    g.deleteAttribute('uv');
    return g;
  });
  const geo = mergeGeometries(geos, false);
  const bones = meshes[0].skeleton.bones.map((b) => b.name);
  const farGeo = decimateSkinned(geo, bones, budget, { keepLow, keepSpan });
  geo.deleteAttribute('part');
  const skinned = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  skinned.bind(meshes[0].skeleton, meshes[0].bindMatrix);
  const parent = meshes[0].parent;
  for (const m of meshes) { parent.remove(m); m.geometry.dispose(); m.material.dispose?.(); }
  parent.add(skinned);
  const clips = gltf.animations.filter((a) => clipNames.includes(a.name));
  return { scene: gltf.scene, geo, farGeo, clips };
}

/** Walk while `moving`, idle otherwise. First claim plays outright; later changes cross-fade. */
export function crossFadeGait(slot, moving, fade = 0.15) {
  if (slot.moving === moving) return;
  const next = moving ? slot.walk : slot.idle, prev = moving ? slot.idle : slot.walk;
  if (slot.moving == null) {
    prev.stop();
    next.reset().setEffectiveWeight(1).play();
    next.time = moving ? slot.phase : (slot.phase * 4) % 2;
  } else {
    next.reset().play();
    next.time = moving ? slot.phase : (slot.phase * 4) % 2;
    prev.crossFadeTo(next, fade, false);
  }
  slot.moving = moving;
}
