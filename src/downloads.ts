/**
 * Downloads service (background only).
 *
 * Wraps chrome.downloads to download a generated result URL into the
 * Downloads folder with a specific filename. Filename is enforced via
 * onDeterminingFilename which is registered once at module load.
 */

export interface DownloadOutcome {
  ok: boolean;
  localPath?: string;
  error?: string;
}

// Pre-registered filename — set BEFORE calling chrome.downloads.download()
// so onDeterminingFilename can pick it up synchronously without any race condition.
let pendingFilename: string | null = null;

// Register the listener ONCE at module load time.
if (typeof chrome !== 'undefined' && chrome.downloads?.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    if (pendingFilename) {
      const name = pendingFilename;
      pendingFilename = null;
      console.log(`[downloads] onDeterminingFilename → forcing filename: "${name}"`);
      suggest({ filename: name, conflictAction: 'uniquify' });
      // NOTE: Do NOT return true here — returning true causes Chrome to freeze
      // waiting for a subsequent async suggest() that never comes.
    }
  });
}

function downloadAttempt(filename: string, url: string, timeoutMs: number): Promise<DownloadOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let downloadId = -1;

    const finish = (outcome: DownloadOutcome): void => {
      if (settled) return;
      settled = true;
      pendingFilename = null;
      chrome.downloads.onChanged.removeListener(onChanged);
      clearInterval(interval);
      clearTimeout(timer);
      resolve(outcome);
    };

    function onChanged(delta: chrome.downloads.DownloadDelta): void {
      if (downloadId < 0 || delta.id !== downloadId) return;
      const st = delta.state;
      if (!st || typeof st.current !== 'string') return;
      if (st.current === 'complete') {
        finish({ ok: true, localPath: delta.filename?.current ?? undefined });
      } else if (st.current === 'interrupted') {
        finish({ ok: false, error: `Download interrupted${delta.error?.current ? ` (${delta.error.current})` : ''}` });
      }
    }

    const timer = setTimeout(() => finish({ ok: false, error: 'Download timed out' }), timeoutMs);

    const interval = setInterval(() => {
      if (downloadId < 0) return;
      chrome.downloads.search({ id: downloadId }, (items) => {
        const item = items?.[0];
        if (!item) return;
        if (item.state === 'complete') finish({ ok: true, localPath: item.filename });
        else if (item.state === 'interrupted') finish({ ok: false, error: `Download interrupted (${item.error ?? ''})` });
      });
    }, 1000);

    chrome.downloads.onChanged.addListener(onChanged);

    // Set pendingFilename BEFORE calling chrome.downloads.download()
    // Chrome requires forward slashes for relative subdirectory paths.
    const normalized = filename.replace(/\\/g, '/');
    pendingFilename = normalized;
    console.log(`[downloads] Starting download → filename: "${normalized}"`);

    chrome.downloads.download(
      { url, filename: normalized, conflictAction: 'uniquify', saveAs: false },
      (id?: number) => {
        if (chrome.runtime.lastError || id === undefined) {
          pendingFilename = null;
          finish({ ok: false, error: String(chrome.runtime.lastError?.message ?? 'Download not started') });
          return;
        }
        downloadId = id;
        console.log(`[downloads] Download started with id=${id}`);
      },
    );
  });
}

/**
 * Download `url` saving it as `filename` in the Downloads folder.
 * Method 1: Direct chrome.downloads (works for https:// and data: URLs).
 * Method 2: Blob ObjectURL fallback (for data: URLs when Method 1 fails).
 */
export async function downloadTo(filename: string, url: string, timeoutMs = 120000): Promise<DownloadOutcome> {
  // Method 1: Direct download
  const outcome = await downloadAttempt(filename, url, timeoutMs);
  if (outcome.ok) return outcome;

  // Method 2: Blob ObjectURL fallback for data: URLs
  if (url.startsWith('data:')) {
    let blobUrl: string | null = null;
    try {
      console.log('[downloads] Method 1 failed → trying Blob ObjectURL fallback...');
      const res = await fetch(url);
      const blob = await res.blob();
      blobUrl = URL.createObjectURL(blob);
      const altOutcome = await downloadAttempt(filename, blobUrl, timeoutMs);
      if (altOutcome.ok) console.log('[downloads] Blob ObjectURL fallback succeeded ✅');
      return altOutcome;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    }
  }

  return outcome;
}
