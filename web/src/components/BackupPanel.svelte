<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { Backup } from '../lib/records';
  import {
    BackupError,
    downloadBackup,
    importBackup,
    parseBackup,
    summarise,
    type ImportSummary,
  } from '../lib/backup';
  import { ArchiveError, readBackupArchive, type BackupPhoto } from '../lib/backupArchive';

  interface Props {
    t: Strings;
  }

  const { t }: Props = $props();

  /**
   * `$state.raw`, not `$state`, and this matters.
   *
   * Svelte 5 deep-proxies plain objects put into `$state`. IndexedDB stores
   * values with the structured clone algorithm, which cannot clone a Proxy — so
   * a parsed backup held in ordinary `$state` fails on write with
   * `DataCloneError` and the whole import rolls back. Raw state is also the
   * honest description: a parsed file is immutable here, replaced wholesale or
   * not at all, and nothing ever reaches into it to change a field.
   */
  let pending = $state.raw<{ backup: Backup; summary: ImportSummary; photos: readonly BackupPhoto[] } | null>(null);
  let done = $state<ImportSummary | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let fileInput: HTMLInputElement | null = $state(null);

  async function onFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Reset immediately so choosing the same file twice fires a change event.
    input.value = '';
    if (file === undefined) {
      return;
    }

    error = null;
    done = null;
    try {
      // Sniffed, not taken from the name: the app writes a file named .zip
      // containing plain JSON whenever photos were asked for and none existed.
      const archive = await readBackupArchive(file);
      const backup = parseBackup(archive.document);
      pending = { backup, summary: summarise(backup), photos: archive.photos.filter(photo => backup.photos.includes(photo.name)) };
    } catch (caught) {
      pending = null;
      error =
        caught instanceof ArchiveError ||
        (caught instanceof BackupError && caught.message === 'not-json')
          ? t.backupNotJson
          : t.backupUnreadable;
    }
  }

  /**
   * Nothing is written until this runs.
   *
   * The counts go up before anything is touched, deliberately. This is somebody
   * else's play history arriving from their phone, and doc 02 §6 is emphatic
   * about the equivalent moment in sync: never silently overwrite, always show
   * what is about to happen. The same argument applies to a file import, so the
   * same rule does.
   */
  async function confirm(mode: 'merge' | 'replace'): Promise<void> {
    if (pending === null) {
      return;
    }
    busy = true;
    error = null;
    try {
      done = await importBackup(pending.backup, mode, pending.photos);
      pending = null;
    } catch {
      error = t.backupImportFailed;
    } finally {
      busy = false;
    }
  }

  async function download(): Promise<void> {
    busy = true;
    try {
      error = null;
      await downloadBackup();
    } catch {
      error = t.backupExportFailed;
    } finally {
      busy = false;
    }
  }
</script>

<div class="panel">
  <h2>{t.backupTitle}</h2>
  <p class="muted">{t.backupIntro}</p>

  <div class="actions">
    <button class="btn" type="button" onclick={() => fileInput?.click()} disabled={busy}>
      {t.backupImport}
    </button>
    <button class="btn" type="button" onclick={download} disabled={busy}>
      {t.backupExport}
    </button>
    <input
      bind:this={fileInput}
      type="file"
      accept=".json,.zip,application/json,application/zip"
      class="visually-hidden"
      onchange={onFile}
    />
  </div>

  {#if error !== null}
    <p class="error">{error}</p>
  {/if}

  {#if pending !== null}
    <div class="confirm">
      <p><strong>{t.backupAboutToImport}</strong></p>
      <ul class="counts">
        <li>{t.countPacks(pending.summary.ownedPacks)}</li>
        <li>{t.countFavourites(pending.summary.favouriteCards)}</li>
        <li>{t.countDecks(pending.summary.decks)}</li>
        <li>{t.countPlays(pending.summary.plays)}</li>
        <li>{t.countCampaigns(pending.summary.campaignRuns)}</li>
      </ul>

      {#if pending.summary.decks > 0 || pending.summary.plays > 0 || pending.summary.campaignRuns > 0}
        <!-- Said plainly, because the alternative is somebody importing a
             backup, seeing no decks, and concluding the import ate them. -->
        <p class="muted note">{t.backupCarriedNote}</p>
      {/if}

      {#if pending.summary.photos > 0}
        <p class="muted note">{t.backupPhotosNote(pending.summary.photos, pending.photos.length)}</p>
      {/if}

      <div class="actions">
        <button type="button" class="btn btn--primary" onclick={() => confirm('merge')} disabled={busy}>
          {t.backupMerge}
        </button>
        <button class="btn" type="button" onclick={() => confirm('replace')} disabled={busy}>
          {t.backupReplace}
        </button>
        <button class="btn" type="button" onclick={() => (pending = null)} disabled={busy}>
          {t.cancel}
        </button>
      </div>
      <p class="muted note">{t.backupMergeHint}</p>
    </div>
  {/if}

  {#if done !== null}
    <p class="done">
      {t.backupImported(done.ownedPacks, done.favouriteCards)}
    </p>
  {/if}
</div>

<style>
  .panel {
    margin: var(--space-4) 0;
  }

  h2 {
    font-size: var(--text-lg);
    margin-bottom: var(--space-1);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .confirm {
    margin-top: var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--hairline);
  }

  .counts {
    margin: var(--space-2) 0;
    padding-inline-start: var(--space-5);
  }

  .note {
    font-size: var(--text-sm);
    max-width: var(--prose-max);
  }

  .error {
    color: var(--danger);
    font-weight: 600;
  }

  .done {
    margin-top: var(--space-3);
    color: var(--accent);
    font-weight: 600;
  }
</style>
