// =====================================================================
//  Cars - a hazard on the streets of the suburbs and town.
//  They drive the road grid and turn at intersections. Unlike every predator
//  they do NOT care that the octopus is camouflaged (a car can't be fooled:
//  it simply isn't looking), so there's an audio warning instead: engine
//  noise that swells as one approaches, and a horn if it is bearing down on you.
// =====================================================================
import * as THREE from 'three';
import { toonMat } from '../world/toon.js';
import { CONFIG } from '../config.js';
import { clamp } from '../util/rng.js';
import { PROP_GEO, CAR_SCALE } from '../world/props.js';

export class CarManager {
  constructor(world, scene) {
    this.world = world; this.scene = scene; this.cars = [];
    this.geo = PROP_GEO.parkedcar();
    const want = Math.round((CONFIG.predators.cars ?? 0) * world.areaScale);
    const rnd = world.rnd;
    for (let i = 0, made = 0; i < want * 60 && made < want; i++) {
      const s = world._spotB(['suburb', 'town'], { tries: 20, minW: 0.5, notRoad: false, maxSlope: 0.5 });
      if (!s || Math.hypot(s.x - world.start.x, s.z - world.start.z) < 70) continue;
      const c = this.snapToRoad(s.x, s.z, rnd() < 0.5);
      if (!c || !world.isRoad(c.x, c.z)) continue;
      this.cars.push(this.make(c, rnd));
      made++;
    }
  }
  lineP(x, z) { const w = this.world.biomeWeights(x, z); return w[1] > 0.4 ? 64 : 92; }    // town / suburb grid spacing
  snapToRoad(x, z, alongX) {
    const w = this.world, P = this.lineP(x, z);
    if (alongX) { const k = Math.round((z - w.roadOff.z) / P); return { x, z: w.roadOff.z + k * P, alongX: true }; }
    const k = Math.round((x - w.roadOff.x) / P); return { x: w.roadOff.x + k * P, z, alongX: false };
  }
  make(c, rnd) {
    const mat = toonMat({ vertexColors: true, roughness: 0.55, metalness: 0.2 });
    const hue = rnd();
    const grey = (hue * 7) % 1 < 0.3;
    mat.color.setHSL(hue, grey ? 0.05 : 0.62, grey ? 0.62 : 0.5);
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.castShadow = CONFIG.graphics.shadows;
    this.scene.add(mesh);
    const dir = rnd() < 0.5 ? 1 : -1;
    const car = { mesh, x: c.x, z: c.z, alongX: c.alongX, dir, speed: 7 + rnd() * 4, hornT: 0, hitCool: 0, heading: 0, lane: 1.9 };
    this.place(car);
    return car;
  }
  place(car) {
    const w = this.world;
    // drive on the left (Australia): lane offset is to the left of the direction of travel
    const side = car.dir * car.lane;
    car.px = car.alongX ? car.x : car.x + side; car.pz = car.alongX ? car.z - side : car.z;
    car.heading = car.alongX ? (car.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (car.dir > 0 ? 0 : Math.PI);
    car.mesh.position.set(car.px, w.heightAt(car.px, car.pz), car.pz);
    car.mesh.rotation.y = car.heading;
  }
  update(dt, player) {
    const w = this.world;
    let nearest = null, nd = 1e9, warn = false;
    for (const c of this.cars) {
      const d = Math.hypot(c.px - player.x, c.pz - player.z);
      c.mesh.visible = d < CONFIG.graphics.fogFar + 40;
      if (d > 230) continue;
      c.hitCool = Math.max(0, c.hitCool - dt);
      // drive: look ahead, turn at intersections, u-turn when the road ends
      const step = c.speed * dt * c.dir;
      const nx = c.alongX ? c.x + step : c.x, nz = c.alongX ? c.z : c.z + step;
      const ax = c.alongX ? c.x + c.dir * 9 : c.x, az = c.alongX ? c.z : c.z + c.dir * 9;
      if (!w.isRoad(ax, az)) { c.dir = -c.dir; c.speed = 7 + w.rnd() * 4; }
      else {
        const P = this.lineP(c.x, c.z);
        // crossing the centre line of the perpendicular street: maybe turn
        const prev = c.alongX ? c.x : c.z, nxt = c.alongX ? nx : nz;
        const off = c.alongX ? w.roadOff.x : w.roadOff.z;
        const kPrev = Math.floor((prev - off) / P), kNext = Math.floor((nxt - off) / P);
        if (kPrev !== kNext && w.rnd() < 0.4) {
          const kc = Math.max(kPrev, kNext);
          const lineAt = off + kc * P;
          if (c.alongX) { c.x = lineAt; c.alongX = false; } else { c.z = lineAt; c.alongX = true; }
          c.dir = w.rnd() < 0.5 ? 1 : -1;
        } else { c.x = nx; c.z = nz; }
      }
      this.place(c);
      // collision / warning
      if (d < nd) { nd = d; nearest = c; }
      if (player.alive && !player.tunnel) {
        const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
        const rx = player.x - c.px, rz = player.z - c.pz;
        const along = rx * fx + rz * fz, lat = rx * fz - rz * fx;
        if (Math.abs(along) < 2.5 * CAR_SCALE && Math.abs(lat) < 1.0 * CAR_SCALE + 0.3 && c.hitCool <= 0) {
          c.hitCool = 1.6;
          player.damage(CONFIG.abilities.carDamage, 'car', { ignoreCamo: true });
          // knocked clear of the road
          const sgn = lat >= 0 ? 1 : -1;
          const kx = fz * sgn, kz = -fx * sgn;
          const r = w.resolve(player.x + kx * 3.6, player.z + kz * 3.6, 0.7 * (player.sz ?? 1));
          player.x = r.x; player.z = r.z; player.shake = 1; player.hitByCar = true;
        }
        if (along > 0 && along < 34 && Math.abs(lat) < 3.6 && d < 40) { warn = true; if (c.hornT <= 0) c.hornT = 1.8; }
      }
      c.hornT = Math.max(0, c.hornT - dt);
    }
    return nearest && nd < 90 ? { dist: nd, x: nearest.px, z: nearest.pz, horn: warn && nearest.hornT > 1.6, speed: nearest.speed } : null;
  }
  dispose() { for (const c of this.cars) { this.scene.remove(c.mesh); c.mesh.material.dispose(); } this.geo.dispose(); this.cars = []; }
}
