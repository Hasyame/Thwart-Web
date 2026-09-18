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
  if (row === undefined) {
    return null;
  }
  // A draft written down before the packs existed has none; its next open
  // builds them from the shelf as it stands, and it carries on.
  const state = row.state as Partial<DraftState> & DraftState;
  return { ...state, packs: state.packs ?? state.players.map(() => []), builds: state.builds ?? 0 };
}

export async function saveDraft(state: DraftState): Promise<void> {
  await db.drafts.put({ id: ROW_ID, state, updatedAt: Date.now() });
}

export async function clearDraft(): Promise<void> {
  await db.drafts.delete(ROW_ID);
}
