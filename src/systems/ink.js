// =====================================================================
//  Ink deterrence (t253u). Pure logic, no three.js, so it is unit-testable.
//
//  A squirt of ink (only in water, or from a crafted ink sac) leaves a dark cloud.
//  Predators in or near the cloud lose the octopus and back off for a few seconds.
//  Shore and water hunters feel it a little sooner and stay lost a little longer.
//  Birds overhead lose sight if the octopus itself is under the cloud, even when
//  the bird is high above it. Nothing is shown on screen: they simply turn away.
// =====================================================================

export const INK_NEAR = 1.6;          // extra reach past the visible cloud ("near")
export const INK_AQUA_NEAR = 2.8;     // crabs and gulls feel it sooner
export const INK_BLIND = 3.8;         // seconds a land hunter stays lost
export const INK_AQUA_BLIND = 5.2;    // shore / water hunters stay lost longer
export const INK_BIRD_RANGE = 40;     // how close a bird must be to lose sight of an octopus under ink

/** hunters that live on the shore or in the shallows */
export const AQUA = new Set(['crab', 'gull']);
/** anything that hunts from the air (gulls hop on the sand but still watch from above) */
export const FLYERS = new Set(['eagle', 'gull', 'magpie', 'kookaburra']);

/** true when (x,z) is inside a cloud plus an optional extra radius */
export function cloudCovers(c, x, z, pad = 0) {
  if (!c || !(c.r > 0) || !(c.k > 0)) return false;
  const r = c.r * c.k + pad;
  return (x - c.x) ** 2 + (z - c.z) ** 2 < r * r;
}

/** the first cloud that covers (x,z), or null */
export function inkUnder(clouds, x, z, pad = 0) {
  for (const c of clouds || []) if (cloudCovers(c, x, z, pad)) return c;
  return null;
}

/**
 * Should this predator lose track because of ink?
 * Ground and shore animals must be in or near a cloud.
 * Birds also lose sight if the octopus is under a cloud and the bird is close enough to have been watching.
 * Returns `{ cloud, secs }` or null.
 */
export function inkDeter(kind, predX, predZ, playerX, playerZ, clouds) {
  const list = clouds || [];
  if (!list.length) return null;
  const aqua = AQUA.has(kind);
  const flyer = FLYERS.has(kind);
  const pad = aqua ? INK_AQUA_NEAR : INK_NEAR;
  const secs = aqua ? INK_AQUA_BLIND : INK_BLIND;
  let cloud = inkUnder(list, predX, predZ, pad);
  if (!cloud && flyer) {
    const under = inkUnder(list, playerX, playerZ, 0.8);
    if (under) {
      const dx = predX - playerX, dz = predZ - playerZ;
      if (dx * dx + dz * dz < INK_BIRD_RANGE * INK_BIRD_RANGE) cloud = under;
    }
  }
  return cloud ? { cloud, secs } : null;
}
