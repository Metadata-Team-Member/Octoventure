import { SPECIES } from './entities/predators.js';
import { dailySeed } from './util/daily.js';
import { BIOMES } from './world/biomes.js';
// window.__game: handy hooks for tests and for tinkering from the browser console.
import { TERRAIN, CONFIG } from './config.js';

export function installDebugHooks(game) {
  window.__game = {
    get frame() { return game.frame; },
    get state() { return game.state; },
    get seed() { return game.world.seed; },
    get health() { return game.octopus.health; },
    get energy() { return game.octopus.energy; },
    get camoActive() { return game.octopus.camoActive; },
    get terrain() { return game.octopus.terrain; },
    get waterKind() { return game.octopus.waterKind; },
    get pos() { const o = game.octopus; return { x: o.x, y: o.y, z: o.z }; },
    get seaAngle() { return game.world.angle; },
    get distanceToSea() { return -game.world.distToSea(game.octopus.x, game.octopus.z); },
    get predators() { return game.predators.list.map((p) => ({ kind: p.kind, state: p.state, x: p.x, z: p.z })); },
    get greyness() { const o = game.octopus; return { r: o.mat.color.r, g: o.mat.color.g, b: o.mat.color.b }; },
    get ringColor() { const c = game.octopus.ringBlue.color; return { r: c.r, g: c.g, b: c.b, glow: game.octopus.ringBlue.emissiveIntensity }; },
    get camoProtected() { return game.octopus.camoProtected; },
    get restartVisible() { return !document.getElementById('end').hidden; },
    get endTitle() { return document.getElementById('end-title').textContent; },
    get lastDamage() { return game.octopus.lastDamage; },
    get yaw() { return game.input.yaw; },
    get pitch() { return game.input.pitch; },
    get paused() { return game.paused; },
    get difficultyName() { return CONFIG.difficulty; },
    get dailySeed() { return dailySeed(); },
    get pauseVisible() { return !document.getElementById('pause').hidden; },
    get lockSupported() { return game.input.lockSupported; },
    get lockFailed() { return game.input.lockFailed; },
    get realLock() { return document.pointerLockElement === game.canvas; },
    /** pretend the browser granted (true) / dropped (false) the pointer lock; null = back to the real state */
    mockLock(v) {
      const i = game.input;
      if (i._saveEver === undefined) i._saveEver = i.everLocked;
      i._mock = v;
      if (v === null) { i.everLocked = i._saveEver; i._saveEver = undefined; return; }
      if (v === true) i.everLocked = true;
      game.onLockChange(v);
    },
    /** force "not locked" without firing the pause logic (to test the click-and-drag fallback) */
    mockUnlockedSilently(v) { game.input._mock = v ? false : null; },
    /** simulate a browser without pointer lock: click-and-drag fallback, never pauses */
    forceFallback(on) {
      const i = game.input;
      if (on) { i.lockSupported = false; i.everLocked = false; i.lockFailed = true; i.releaseLock(); }
      else { i.lockSupported = true; i.lockFailed = false; }
    },
    get lockRequests() { return game.input.lockRequests; },
    get runTime() { return game.runTime; },
    get zoom() { return game.input.zoom; },
    mouseMove(dx, dy) { window.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: dy })); },
    get speed() { return game.octopus.speed; },
        get webgl() { return !!game.renderer.getContext(); },
    get alarm() { return game.octopus.alarm; },
    get ringGlow() { return game.octopus.ringBlue.emissiveIntensity; },
    setAlarm(v) { game.forceAlarm = v !== null; if (v !== null) game.octopus.alarm = v; },
    setHealth(v) { game.octopus.health = v; },
    setMoisture(v) { game.octopus.health = v; },
    begin() { game.begin(); },
    restart() { game.restart(); },
    teleport(x, z) { const o = game.octopus; o.x = x; o.z = z; o.y = game.world.heightAt(x, z); game.camInit = false; game.view.flushAround(x, z, 170); },
    /** a spot inside the blend between two biomes (both weights near 0.5). Returns {x, z, dx, dz} (dx,dz: unit vector pointing from a-land to b-land) or null. */
    findEcotone(a, b, nth = 0) {
      const w = game.world, ia = BIOMES.indexOf(a), ib = BIOMES.indexOf(b), hits = [];
      for (let x = -760; x <= 760; x += 12) for (let z = -760; z <= 760; z += 12) {
        const q = w.biomes.weights(x, z);
        if (q[ia] < 0.33 || q[ib] < 0.33 || Math.abs(q[ia] - q[ib]) > 0.12) continue;
        if (b !== 'sea' && a !== 'sea' && (w.heightAt(x, z) < 0.3 || w._blocked(x, z, 2.5) || w.waterAt(x, z))) continue;
        hits.push([x, z]);
      }
      if (!hits.length) return null;
      const [x, z] = hits[Math.min(hits.length - 1, Math.floor(hits.length * (0.25 + 0.5 * ((nth * 0.37) % 1))))];
      const f = (X, Z) => { const q = w.biomes.weights(X, Z); return q[ib] - q[ia]; };
      let dx = f(x + 15, z) - f(x - 15, z), dz = f(x, z + 15) - f(x, z - 15); const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
      return { x, z, dx, dz, count: hits.length };
    },
    /** stand on the a-side of a blend, looking across it towards the b-side (screenshots of one biome ending and the next starting) */
    teleportToEcotone(a, b, back = 22, nth = 0) {
      const e = this.findEcotone(a, b, nth); if (!e) return null;
      this.teleport(e.x - e.dx * back, e.z - e.dz * back);
      game.input.yaw = Math.atan2(-e.dx, -e.dz); game.octopus.heading = game.input.yaw + Math.PI; game.camInit = false;
      return e;
    },
    setDebugCam(x, y, z, lx, ly, lz) { game.debugCam = { x, y, z, lx, ly, lz }; },
    clearDebugCam() { game.debugCam = null; },
    /** an elevated look across the blend between biome a and b (for screenshots): the octopus waits at the middle of it */
    overviewEcotone(a, b, h = 38, back = 70, nth = 0) {
      const e = this.findEcotone(a, b, nth); if (!e) return null;
      this.teleport(e.x, e.z);
      const w = game.world, gy = (x, z) => w.heightAt(x, z);
      const cx = e.x - e.dx * back, cz = e.z - e.dz * back, ground = Math.max(gy(cx, cz), gy(e.x, e.z), 0.5);
      game.camera.far = 900; game.camera.updateProjectionMatrix();
      this.setDebugCam(cx, ground + h, cz, e.x + e.dx * 55, ground - 1, e.z + e.dz * 55);
      return e;
    },
    teleportToBiome(name) { const s = game.world.findBiomeSpot(name); if (!s) return false; this.teleport(s.x, s.z); return true; },
    get biome() { const o = game.octopus; return game.world.biomeAt(o.x, o.z); },
    biomeAt(x, z) { return game.world.biomeAt(x, z); },
    get perf() { const i = game.renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, chunks: game.view.stats.chunksBuilt, chunksVisible: game.view.stats.chunksVisible, buildMs: game.view.stats.buildMs, genMs: game.genMs }; },
    teleportToOcean(depth = 8) {
      const w = game.world, o = game.octopus;
      // walk forward along the sea direction until we are in the water
      for (let d = 0; d < 6000; d += d < 1200 ? 1 : 4) {          // random starts can be far inland: look a long way
        const x = o.x + w.dir.x * d, z = o.z + w.dir.z * d;
        if (w.isSea(x, z)) { this.teleport(x + w.dir.x * depth, z + w.dir.z * depth); return true; }
      }
      return false;
    },
    teleportNearOcean(dist = 40) {      // land just before the shore
      const w = game.world;
      const c = w.cCoast - dist;
      this.teleport(w.dir.x * c, w.dir.z * c);
    },
    get speciesList() { return Object.keys(SPECIES); },
    spawnPredator(kind, dx = 8, dz = 0) { const o = game.octopus; return game.predators.spawn(kind, o.x + dx, o.z + dz); },
    clearPredators() { game.predators.dispose(); },
    advance(sec) { game.advance(sec); },
    get env() { return game.env; },
    setTime(t) { game.env.t = t; game.env.apply(); },
    freezeTime(on = true) { game.env.frozen = on; },
    setWeather(kind) { game.env.target = kind; game.env.timer = 1e9; },
    setTide(v) { game.env.tideOverride = v; game.env.apply(); },
    // ---- hidden mechanics (for tests): never reachable from the UI
    get armor() { return game.octopus.armor; },
    get shellsCollected() { return game.progress.shells; },
    get babiesFound() { return game.progress.babies; },
    get shellTotal() { return game.world.shells.length; },
    get babyTotal() { return game.world.babies.length; },
    get dom() { return document.body.innerText.trim(); },
    inkNow() { return game.tryInk(); },
    biteNow() { return game.tryBite(); },
    nipNow() { return game.tryNip(); },
    setLevel(L) { const lv = game.levels; lv.xp = 15 * (L - 1) * (L + 2); lv.level = L; lv.events.length = 0; },
    get inkClouds() { return game.world.ink.length; },
    get journal() { return game.journal; },
    get tab() { return game.satchel.tab; },
    setTab(id) { game.satchel.setTab(id); return game.satchel.tab; },
    discover(id) { return game.journal.see(id); },
    get clockHidden() { return game.clockHidden(); },
    get plankton() { return game.plankton; },

    get inkCool() { return game.octopus.inkCool; },
    get biteCool() { return game.octopus.biteCool; },
    get hiddenIn() { return game.octopus.hiddenIn?.kind ?? null; },
    get inTunnel() { return !!game.octopus.tunnel; },
    get climbing() { return !!game.octopus.climb; },
    get carried() { return !!game.octopus.carried; },
    get night() { return game.world.night; },
    get gamepad() { return game.input.pad; },
    pressKey(code, ms = 0) { game.input.keys.add(code); game.input.pressed.add(code); if (ms) setTimeout(() => game.input.keys.delete(code), ms); },
    releaseKey(code) { game.input.keys.delete(code); },
    mockPad(p) { game.input.pad.mock = p; },
    teleportToShell(i = 0) { const s = game.world.shells.filter((q) => !q.got && q.kind !== 'sea')[i]; if (!s) return null; this.teleport(s.x - 3, s.z); return s; },
    teleportToBaby(i = 0) { const b = game.world.babies[i]; if (!b) return null; this.teleport(b.x - 4, b.z); return b; },
    teleportToTunnel(kind) { const t = game.world.tunnels.find((q) => !kind || q.kind === kind); if (!t) return null; const dx = t.b.x - t.a.x, dz = t.b.z - t.a.z, l = Math.hypot(dx, dz) || 1; this.teleport(t.a.x - dx / l * 2.5, t.a.z - dz / l * 2.5); game.octopus.heading = Math.atan2(dx, dz); return t; },
    teleportToHide(kind) { const h = game.world.hides.find((q) => !kind || q.kind === kind); if (!h) return null; this.teleport(h.x - 2.5, h.z); return h; },
    /** stand 2.5 m in front of a climbable collider that has free ground on the far side, facing it; returns {c, dx, dz} */
    teleportToClimbable(kind) {
      const w = game.world;
      for (const c of w.colliders) {
        if (!c.climb || (kind && c.kind !== kind)) continue;
        let dx = 0, dz = 1, depth;
        if (c.r !== undefined) { dx = 1; dz = 0; depth = c.r; } else if (c.hw >= c.hd) { depth = c.hd; } else { dx = 1; dz = 0; depth = c.hw; }
        const sx = c.x - dx * (depth + 2.5), sz = c.z - dz * (depth + 2.5), ex = c.x + dx * (depth + 2.5), ez = c.z + dz * (depth + 2.5);
        if (w.resolve(sx, sz, 0.8).hit || w.resolve(ex, ez, 0.8).hit || w.heightAt(sx, sz) < 0.5 || w.heightAt(ex, ez) < 0.5) continue;
        this.teleport(sx, sz); game.octopus.heading = Math.atan2(dx, dz); game.input.yaw = Math.atan2(-dx, -dz);
        return { c, dx, dz, depth, kind: c.kind };
      }
      return null;
    },
    teleportToRoad() { const w = game.world; for (let i = 0; i < 4000; i++) { const s = w.findBiomeSpot('town', 60, 1); if (s && w.isRoad(s.x, s.z)) { this.teleport(s.x, s.z); return s; } } return null; },
    // ---- satchel / gathering (tests)
    get inv() { return game.inv; },
    get satchelOpen() { return game.satchelOpen; },
    get gatherItems() { return game.gather.items(); },
    give(id, n = 1) { game.inv.add(id, n); },
    craft(id) { const ok = game.inv.craft(id); if (game.satchelOpen) game.satchel.render(); return ok; },
    use(id) { return game.abilities.use(id); },
    get buff() { return { ...game.octopus.buff }; },
    get abilities() { return game.abilities; },
    get gather() { return game.gather; },
    toggleSatchel() { return game.toggleSatchel(); },
    teleportToGather(kind, i = 0) { const l = game.gather.items().filter((q) => q.kind === kind && !q.got); const g = l[i]; if (!g) return null; this.teleport(g.x - 2.5, g.z); return g; },
    get cars() { return game.cars.cars; },
    get scent() { return game.world.scent.length; },
    // ---- levels & badges (tests)
    get levels() { return game.levels; },
    giveXP(n) { game.levels.add(n); },
    did(kind, arg) { game.levels.did(kind, arg); },
    get shimmerActive() { return game.shimmer.active > 0; },
    get seaBeatActive() { return game.seaBeat.active; },
    get critters() { return game.critters.counts(); },
    rareSpots(id) { return (game.rares?.spotsOf(id) || []).map((s) => ({ id: s.id, x: +s.x.toFixed(1), z: +s.z.toFixed(1) })); },
    teleportToRare(id) {
      const list = game.rares?.spotsOf(id) || [];
      const s = list[0];
      if (!s) return null;
      this.teleport(s.x, s.z);
      return s;
    },
    soakRare() { if (game.rares) game.rares.wet = 1; return game.rares?.wet || 0; },
    get raresFound() { return [...(game.levels?.st.rare || [])]; },
    terrainTypes: Object.keys(TERRAIN),
    game,
  };
}
