import { db } from '../db';
import type { DraftState } from './types';

/**
 * The draft in progress, on this device.
 *
 * One row, rewritten on every change, so a page closed mid-pick reopens on
 * the same offer. Local only: a draft is one device's table session, and the
 * decks it makes travel through the ordinary shelf once saved.
 */
const ROW_ID = 'current';

export async function loadDraft(): Promise<DraftState | null> {
  const row = await db.drafts.get(ROW_ID);
  return row?.state ?? null;
}

export async function saveDraft(state: DraftState): Promise<void> {
  await db.drafts.put({ id: ROW_ID, state, updatedAt: Date.now() });
}

export async function clearDraft(): Promise<void> {
  await db.drafts.delete(ROW_ID);
}
