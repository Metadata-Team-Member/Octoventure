// =====================================================================
//  Biting (t250u / t251u). Pure numbers + rules (no three.js) so they are unit-testable.
//
//  A blue-ringed octopus bites with its beak; its venom (tetrodotoxin) is made by bacteria living in its salivary glands and goes
//  in with the bite. So there are two bites, both felt through animation and sound only (no HUD):
//    - the beak bite (left click / X / gamepad X): a quick nip. Small things back off for a moment; enough nips on something small
//      enough for the octopus's level finishes it.
//    - the venomous bite (right click / B / gamepad RT): at low levels only a deterrent (the predator bolts); as the octopus levels up
//      it becomes lethal to bigger and bigger predators. A crafted lethal dose makes the NEXT venomous bite lethal to any predator.
//  People are never killed (they only ever back off).
// =====================================================================

/** how big / tough each predator is (1 small .. 4 big); people are out of reach */
export const TIER = { crab: 1, gull: 1, magpie: 2, kookaburra: 2, heron: 2, snake: 2, cat: 3, fox: 3, goanna: 3, eagle: 4, dog: 4, human: 9 };
export const PEOPLE = 9;
/** the biggest tier the venomous bite kills at level L (0 = deterrent only) */
export const killTier = (L) => (L >= 12 ? 4 : L >= 8 ? 3 : L >= 5 ? 2 : L >= 3 ? 1 : 0);
/** beak nips needed to finish a predator of tier t (only possible when t <= killTier) */
export const nipsFor = (t) => (t >= PEOPLE ? 1e9 : 2 + t * 2);
/** experience for a kill: bigger is worth more, a venom kill a little more again */
export const killXP = (t, venom) => 15 * Math.min(4, t) + (venom ? 10 : 0);
/** would this bite kill? (lethal dose: any predator, never people) */
export function lethal(kind, level, dose = false) {
  const t = TIER[kind] ?? 2;
  if (t >= PEOPLE) return false;
  return dose || t <= killTier(level);
}
export const BITE = {
  nipCooldown: 0.55, nipRange: 2.4,      // beak bite: quick, short reach (world units; the octopus is 0.42 u)
  nipScare: 1.6,                         // seconds a nipped small animal backs off
  venomCooldown: 14,                     // venomous bite (was 28 s as a last-resort scare)
};
