/**
 * Downloads service (background only).
 *
 * Wraps chrome.downloads to download a generated result URL into the
 * organized TryAIToday/Run-…/ folder and resolve to the final local path when
 * the download completes. Filename collisions are prevented by Chrome's
 * "uniquify" conflict action.
 */

export interface DownloadOutcome {
  ok: boolean;
  localPath?: string;
  error?: string;
}

/**
 * Download `url` to `filename` (relative path under the Downloads dir).
 * Resolves when the download reaches a terminal state.
 */
function downloadAttempt(filename: string, url: string, timeoutMs: number): Promise<DownloadOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let downloadId = -1;

    const finish = (outcome: DownloadOutcome): void => {
      if (settled) return;
      settled = true;
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
        finish({ ok: true, localPath: delta.filename && typeof delta.filename.current === 'string' ? delta.filename.current : undefined });
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

    chrome.downloads.download(
      { url, filename, conflictAction: 'uniquify', saveAs: false },
      (id?: number) => {
        if (chrome.runtime.lastError || id === undefined) {
          finish({ ok: false, error: String(chrome.runtime.lastError?.message ?? 'Download not started') });
          return;
        }
        downloadId = id;
      },
    );
  });
}

/**
 * Download `url` to `filename` (relative path under the Downloads dir).
 * Supports automatic Blob ObjectURL fallback for data: URLs if direct download fails.
 */
export async function downloadTo(filename: string, url: string, timeoutMs = 120000): Promise<DownloadOutcome> {
  // Option 1: Direct download
  const outcome = await downloadAttempt(filename, url, timeoutMs);
  if (outcome.ok) return outcome;

  // Option 2: Alternative Blob ObjectURL method fallback for data: URLs
  if (url.startsWith('data:')) {
    let blobUrl: string | null = null;
    try {
      console.log('🔄 Option 1 failed, trying Blob ObjectURL alternative download...');
      const res = await fetch(url);
      const blob = await res.blob();
      blobUrl = URL.createObjectURL(blob);
      const altOutcome = await downloadAttempt(filename, blobUrl, timeoutMs);
      if (altOutcome.ok) console.log('✅ Blob ObjectURL alternative download succeeded');
      return altOutcome;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    }
  }

  return outcome;
}
