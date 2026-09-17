/**
 * A seeded generator, so a draft written down and reopened offers the same
 * cards, and a test gets the same draft twice.
 *
 * mulberry32: thirty-two bits of state, good enough spread for shuffling a
 * few hundred cards, and small enough to read. Not the phone's generator —
 * two clients never share one draft, so they need not agree on a draw, only
 * each with itself.
 */
export type Random = () => number;

export function seeded(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates, on a copy. */
export function shuffled<T>(items: readonly T[], random: Random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

/** A seed nobody chose, for a new draft. */
export const freshSeed = (): number => Math.floor(Math.random() * 0xffffffff);
