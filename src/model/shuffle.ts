/** Small string hash (FNV-1a), for stable pseudo-random ordering. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Orders items pseudo-randomly but the same way every time for a given seed,
 * so the best wording or the needed bank claim isn't always first, and the
 * order doesn't jump around between renders.
 */
export function stableShuffle<T>(items: T[], keyOf: (item: T) => string, seed: string): T[] {
  return [...items].sort((a, b) => hash(seed + keyOf(a)) - hash(seed + keyOf(b)));
}
