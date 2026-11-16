// Daily seed: everybody who plays on the same Perth calendar day gets the same world (and sea direction).
export function perthDate(d = new Date()) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
  catch { const p = new Date(d.getTime() + 8 * 3600e3); return p.toISOString().slice(0, 10); }
}
/** FNV-1a hash of the date string -> 32-bit seed */
export function dailySeed(d = new Date()) {
  const s = 'octopus-run:' + perthDate(d);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
