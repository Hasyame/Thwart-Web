import { db } from './db';
import type { DeckFolder } from './records';

/**
 * Folders on the shelf of decks.
 *
 * The folder holds the list of decks, not the deck its folder (see the
 * record's own note), so every change here is one folder written whole with
 * a fresh `updatedAt` -- which is what the merge compares and what a Dexie
 * hook turns into a sync.
 */

/** The folder a deck is in, or null. A deck is in at most one; the first wins if data disagrees. */
export function folderOf(folders: readonly DeckFolder[], deckId: string): DeckFolder | null {
  return folders.find((folder) => folder.deckIds.includes(deckId)) ?? null;
}

/** Folders in shelf order: by name, the way a person looks for one. */
export function inShelfOrder(folders: readonly DeckFolder[]): DeckFolder[] {
  return [...folders].sort((a, b) => a.name.localeCompare(b.name));
}

export async function createFolder(name: string): Promise<string> {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new Error('empty folder name');
  }
  const now = Date.now();
  const id = `folder-${crypto.randomUUID()}`;
  await db.deckFolders.put({ id, name: trimmed, deckIds: [], createdAt: now, updatedAt: now });
  return id;
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  const folder = await db.deckFolders.get(id);
  if (folder === undefined || trimmed === '' || trimmed === folder.name) {
    return;
  }
  await db.deckFolders.put({ ...folder, name: trimmed, updatedAt: Date.now() });
}

/** Removes the folder. Its decks stay on the shelf, in no folder. */
export async function deleteFolder(id: string): Promise<void> {
  await db.deckFolders.delete(id);
}

/**
 * Puts a deck in a folder, or in none, taking it out of any other first.
 * One transaction, so a sync between the two writes cannot show the deck
 * in two folders or in neither.
 */
export async function moveDeck(deckId: string, folderId: string | null): Promise<void> {
  await db.transaction('rw', db.deckFolders, async () => {
    const now = Date.now();
    const folders = await db.deckFolders.toArray();
    for (const folder of folders) {
      const inIt = folder.deckIds.includes(deckId);
      if (folder.id === folderId && !inIt) {
        await db.deckFolders.put({ ...folder, deckIds: [...folder.deckIds, deckId], updatedAt: now });
      } else if (folder.id !== folderId && inIt) {
        await db.deckFolders.put({ ...folder, deckIds: folder.deckIds.filter((d) => d !== deckId), updatedAt: now });
      }
    }
  });
}
