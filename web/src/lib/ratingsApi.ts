/**
 * Community averages, read from the server and remembered briefly.
 *
 * Never per-user data and never on the live stream: this is a cached
 * aggregate the server serves to anyone, with the threshold already applied
 * — below five ratings there is a count and nothing else, and no client can
 * show a mean the contract says not to. A person's *own* rating is in their
 * local `ratings` table and never comes from here.
 * docs/spec/ratings-and-modular-sets.md §3.3.
 */

export interface RatingSummary {
  readonly count: number;
  /** Present only from the threshold. */
  readonly mean?: number;
  /** Six bins, index = score. Present only with `mean`. */
  readonly histogram?: readonly number[];
}

const BASE = '/api/v1';
/** Matches the server's Cache-Control; a screen revisited within it costs nothing. */
const TTL_MS = 60_000;
/** The most subjects one request may carry, per the endpoint. */
const PER_REQUEST = 50;

const memo = new Map<string, { summary: RatingSummary; expires: number }>();

/**
 * Summaries for a set of subjects, from memory where fresh, otherwise fetched
 * in one request for the rest.
 *
 * A subject that cannot be fetched — offline, a server hiccup — is simply
 * absent from the result, and every caller treats absent as "nothing to
 * show". Averages are decoration on a decision, never a reason a screen
 * cannot render.
 */
export async function summariesFor(subjects: readonly string[]): Promise<ReadonlyMap<string, RatingSummary>> {
  const now = Date.now();
  const out = new Map<string, RatingSummary>();
  const missing: string[] = [];
  for (const subject of new Set(subjects)) {
    const cached = memo.get(subject);
    if (cached !== undefined && cached.expires > now) {
      out.set(subject, cached.summary);
    } else {
      missing.push(subject);
    }
  }
  for (let i = 0; i < missing.length; i += PER_REQUEST) {
    const chunk = missing.slice(i, i + PER_REQUEST);
    const query = chunk.map((s) => `subject=${encodeURIComponent(s)}`).join('&');
    try {
      const response = await fetch(`${BASE}/ratings/summary?${query}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        continue;
      }
      const body = (await response.json()) as Record<string, RatingSummary>;
      for (const subject of chunk) {
        const summary = body[subject];
        if (summary !== undefined) {
          memo.set(subject, { summary, expires: now + TTL_MS });
          out.set(subject, summary);
        }
      }
    } catch {
      // Offline, or the server is not there: nothing to show, and that is fine.
    }
  }
  return out;
}

/** Forgets what was fetched, so the next read asks again. For after rating. */
export function forgetSummaries(subjects: readonly string[]): void {
  for (const subject of subjects) {
    memo.delete(subject);
  }
}
