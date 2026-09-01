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
export function downloadTo(filename: string, url: string, timeoutMs = 120000): Promise<DownloadOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let downloadId = -1;

    const finish = (outcome: DownloadOutcome): void => {
      if (settled) return;
      settled = true;
      clearInterval(interval);
      clearTimeout(timer);
      resolve(outcome);
    };

    const onChanged = (delta: chrome.downloads.DownloadDelta): void => {
      if (delta.id !== downloadId) return;
      const st = delta.state;
      if (!st || typeof st.current !== 'string') return;
      if (st.current === 'complete') {
        chrome.downloads.onChanged.removeListener(onChanged);
        finish({ ok: true, localPath: delta.filename && typeof delta.filename.current === 'string' ? delta.filename.current : undefined });
      } else if (st.current === 'interrupted') {
        chrome.downloads.onChanged.removeListener(onChanged);
        finish({ ok: false, error: `Download interrupted${delta.error?.current ? ` (${delta.error.current})` : ''}` });
      }
    };

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

    chrome.downloads.download(
      { url, filename, conflictAction: 'uniquify', saveAs: false },
      (id?: number) => {
        if (chrome.runtime.lastError || id === undefined) {
          finish({ ok: false, error: String(chrome.runtime.lastError?.message ?? 'Download not started') });
          return;
        }
        downloadId = id;
        chrome.downloads.onChanged.addListener(onChanged);
      },
    );
  });
}
