// window.__game: handy hooks for tests and for tinkering from the browser console.
import { TERRAIN } from './config.js';

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
    teleport(x, z) { const o = game.octopus; o.x = x; o.z = z; o.y = game.world.heightAt(x, z); game.camInit = false; },
    teleportToOcean(depth = 8) {
      const w = game.world, o = game.octopus;
      // walk forward along the sea direction until we are in the water
      for (let d = 0; d < 1200; d += 1) {
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
    spawnPredator(kind, dx = 8, dz = 0) { const o = game.octopus; return game.predators.spawn(kind, o.x + dx, o.z + dz); },
    clearPredators() { game.predators.dispose(); },
    advance(sec) { game.advance(sec); },
    get env() { return game.env; },
    setTime(t) { game.env.t = t; game.env.apply(); },
    freezeTime(on = true) { game.env.frozen = on; },
    setWeather(kind) { game.env.target = kind; game.env.timer = 1e9; },
    setTide(v) { game.env.tideOverride = v; game.env.apply(); },
    terrainTypes: Object.keys(TERRAIN),
    game,
  };
}
