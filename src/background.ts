import { loadApp, saveApp } from './storage.js';
import { reduceApp, resolveSettings, newRun, archiveRun } from './app.js';
import { downloadTo } from './downloads.js';
import { cleanPrompt, jobBaseName, outputPath, outputFileName } from './naming.js';
import type {
  Action,
  AppState,
  InboundMessage,
  OutboundMessage,
  Run,
  Job,
  DownloadRecord,
  RunRequest,
  FlowResult,
} from './types.js';

/**
 * Background service worker — the run engine.
 *
 *   popup(action)  -->  handleAction (reduce app, persist, advance)
 *   engine --"run-job"-->  Flow content script (drives one prompt)
 *   content script --"job-result"-->  engine (download phase, then advance)
 *
 * Jobs progress:
 *   queued -> running (generation) -> downloading -> completed
 *                                              \-> download-failed
 *   queued -> failed (generation/flow error)
 *
 * Reliability (background operation):
 *  - Every mutation is persisted via chrome.storage.local, so the queue keeps
 *    running after the popup closes and survives worker suspension.
 *  - A lightweight chrome.alarms heartbeat re-drives the engine when the
 *    service worker is woken, so the queue continues with no popup open.
 *  - chrome.tabs.onUpdated/onRemoved detect a reloaded/closed Flow tab, safely
 *    un-stick the interrupted job, and resume.
 *  - An optional "Refresh Flow periodically" setting reloads Flow between jobs
 *    without interrupting an in-flight generation, then reconnects and resumes.
 */

const ALARM_NAME = 'flow-tick';
const ALARM_MIN = 0.5; // every 30s
const GEN_TIMEOUT_MS = 8 * 60 * 1000;
const MAX_DOWNLOAD_ATTEMPTS = 3;

let status = 'Idle';
let watchdog: ReturnType<typeof setTimeout> | null = null;
let flowTabId: number | null = null;
let refreshing = false;
let recovered = false;

function isFlowUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === 'labs.google' ||
      host.endsWith('.labs.google') ||
      host === 'labs.google.com' ||
      host.endsWith('.labs.google.com') ||
      host === 'flow.google.com' ||
      host === 'flow.google' ||
      host.endsWith('.google.com') ||
      host.endsWith('.google') ||
      host.endsWith('.withgoogle.com')
    );
  } catch {
    return false;
  }
}

async function findFlowTab(): Promise<number | null> {
  try {
    const active = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active.length > 0 && active[0].id !== undefined && isFlowUrl(active[0].url)) {
      flowTabId = active[0].id;
      return flowTabId;
    }
    const tabs = await chrome.tabs.query({});
    const flow = tabs.find((t) => t.id !== undefined && isFlowUrl(t.url));
    if (flow?.id !== undefined) {
      flowTabId = flow.id;
      return flowTabId;
    }
    const titleMatch = tabs.find((t) => t.id !== undefined && t.title && /flow|google labs/i.test(t.title));
    if (titleMatch?.id !== undefined) {
      flowTabId = titleMatch.id;
      return flowTabId;
    }
    return null;
  } catch {
    return null;
  }
}

async function getOrFindFlowTab(): Promise<number | null> {
  if (flowTabId !== null) {
    try {
      const tab = await chrome.tabs.get(flowTabId);
      if (tab && isFlowUrl(tab.url)) return flowTabId;
    } catch {
      flowTabId = null;
    }
  }
  return findFlowTab();
}

function buildStatus(app: AppState): string {
  const run = app.currentRun;
  const pending = run.jobs.filter((j) => j.state === 'queued').length;
  const downloading = run.jobs.filter((j) => j.state === 'downloading' || j.state === 'download-failed').length;
  if (refreshing) return `Refreshing Flow…`;
  if (app.paused) return `Paused · ${run.dirName} · ${pending} queued`;
  if (app.running) return `Running · ${run.dirName}`;
  if (pending) return `Idle · ${pending} queued`;
  if (downloading) return `Idle · downloads pending (${downloading})`;
  return `Idle · ${run.dirName}`;
}

function push(app: AppState): void {
  void chrome.runtime.sendMessage({ kind: 'state', app, status } satisfies OutboundMessage).catch(noop);
}

function clearWatchdog(): void {
  if (watchdog) {
    clearTimeout(watchdog);
    watchdog = null;
  }
}

/** Pick the next job that needs work: generation first, then downloads. */
function pickNextJob(run: Run): Job | null {
  const gen = run.jobs.find((j) => j.state === 'queued');
  if (gen) return gen;
  const dl = run.jobs.find((j) => j.state === 'downloading' || j.state === 'download-failed');
  return dl ?? null;
}

async function saveAndSync(app: AppState): Promise<void> {
  await saveApp(app);
  setStatus(buildStatus(app));
  push(app);
}

/** Determine whether it is time to refresh Flow per the refresh settings. */
function refreshDue(app: AppState): boolean {
  const r = app.refresh;
  if (!r.enabled) return false;
  if (r.intervalMin > 0) {
    const last = app.lastRefreshAt ?? 0;
    if (last === 0 || Date.now() - last >= r.intervalMin * 60_000) return true;
  }
  if (r.afterJobs > 0 && app.jobsSinceRefresh >= r.afterJobs) return true;
  return false;
}

/** Attempt a single programmatic injection of the content script into tabId. */
async function injectContentScript(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/flow.js'],
    });
    await delay(300);
  } catch {
    /* ignore */
  }
}

/**
 * Flow ignores synthetic DOM input events, leaving its Send button disabled.
 * Chrome's debugger input domain produces the same trusted keyboard/input path
 * as a real user, but is scoped to the already-open Flow tab and detached
 * immediately after the prompt is entered.
 */
async function replacePromptWithNativeInput(tabId: number, text: string, x?: number, y?: number): Promise<void> {
  const target: chrome.debugger.Debuggee = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    // Focus the actual Flow editor with a native click before sending keys.
    if (Number.isFinite(x) && Number.isFinite(y)) {
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mousePressed', x, y, button: 'left', clickCount: 1,
      });
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
      });
    }
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyDown', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2,
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyUp', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2,
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyDown', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8,
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyUp', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8,
    });
    await chrome.debugger.sendCommand(target, 'Input.insertText', { text });
    // Flow's editor enables Send after a real key interaction. Add/remove a
    // space so the final prompt text is unchanged but the full key path runs.
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: ' ', code: 'Space', text: ' ', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32,
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32,
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8,
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8,
    });
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(noop);
  }
}

/** Click the visible Generate control through Chrome's native input pathway. */
async function clickWithNativeInput(tabId: number, x: number, y: number): Promise<void> {
  const target: chrome.debugger.Debuggee = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1,
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
    });
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(noop);
  }
}

/** Wait for the content script in a tab to be reachable (responds to ping). */
async function awaitContentScript(tabId: number): Promise<boolean> {
  for (let i = 0; i < 5; i += 1) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { kind: 'ping' } satisfies OutboundMessage);
      if (res && res.received) return true;
    } catch {
      await injectContentScript(tabId);
      await delay(300);
    }
  }
  return false;
}

/**
 * Refresh the Flow tab: reload it, wait for it to finish loading, then wait for
 * the content script to come back online. Called only between jobs so no
 * active generation is ever interrupted.
 */
async function refreshFlow(app: AppState): Promise<boolean> {
  if (refreshing) return false;
  const tabId = await getOrFindFlowTab();
  if (tabId == null) return false;

  refreshing = true;
  setStatus('Refreshing Flow…');
  push(app);

  try {
    await chrome.tabs.reload(tabId);
    const ok = await waitForTabComplete(tabId);
    if (!ok) return false;
    const connected = await awaitContentScript(tabId);
    if (!connected) return false;

    const fresh = await loadApp();
    fresh.lastRefreshAt = Date.now();
    fresh.jobsSinceRefresh = 0;
    await saveAndSync(fresh);
    return true;
  } catch {
    return false;
  } finally {
    refreshing = false;
    setStatus(buildStatus(await loadApp()));
  }
}

function waitForTabComplete(tabId: number): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - start > 120_000) {
        clearInterval(timer);
        resolve(false);
        return;
      }
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') {
          clearInterval(timer);
          resolve(true);
          return;
        }
      } catch {
        clearInterval(timer);
        resolve(false);
        return;
      }
    }, 500);
  });
}

async function advance(app: AppState): Promise<void> {
  if (refreshing) return;
  if (!app.running || app.paused) return;
  if (app.activeJobId) return;

  // Opt-in periodic Flow refresh between jobs (never during a generation).
  if (refreshDue(app)) {
    const ok = await refreshFlow(app);
    if (!ok) {
      // Flow unreachable — don't spin; fail the next queued job with a clear error.
      await markFlowUnavailable(app);
      return;
    }
  }

  const run = app.currentRun;
  const next = pickNextJob(run);
  if (!next) {
    await finalizeRun(app);
    return;
  }

  app.activeJobId = next.id;
  await saveApp(app);

  if (next.state === 'queued') {
    await startGeneration(app, next);
  } else {
    app.activeJobId = null;
    await saveApp(app);
    await downloadPhase(app, next);
  }
}

async function markFlowUnavailable(app: AppState): Promise<void> {
  const run = app.currentRun;
  const next = pickNextJob(run);
  if (next && next.state === 'queued') {
    next.state = 'failed';
    next.error = 'Could not connect to Google Flow content script. Open Flow in a tab (and log in), then Start again.';
    next.finishedAt = Date.now();
  }
  app.activeJobId = null;
  await saveAndSync(app);
}

async function startGeneration(app: AppState, job: Job): Promise<void> {
  const run = app.currentRun;
  job.state = 'running';
  job.startedAt = Date.now();
  job.error = undefined;
  job.genSummary = 'Connecting to Google Flow…';
  const tabId = await getOrFindFlowTab();
  if (tabId == null) {
    job.state = 'failed';
    job.error = 'No Google Flow page found open. Open Flow in a tab (and log in), then Start again.';
    job.finishedAt = Date.now();
    app.activeJobId = null;
    await saveAndSync(app);
    await advance(app);
    return;
  }
  flowTabId = tabId;

  // Confirm the content script is reachable before committing the generation.
  if (!(await awaitContentScript(tabId))) {
    job.state = 'failed';
    job.error = 'Could not reach the Flow content script. Reload the Flow tab (Ctrl+Shift+R), then retry.';
    job.finishedAt = Date.now();
    app.activeJobId = null;
    app.running = false;
    await saveAndSync(app);
    return;
  }

  const attrs = resolveSettings(run.settings, job.settings);
  const request: RunRequest = {
    id: job.id,
    prompt: cleanPrompt(job.prompt),
    settings: attrs,
    refs: job.refs,
  };
  const message: OutboundMessage = { kind: 'run-job', job: request };
  setStatus(buildStatus(app));
  push(app);

  try {
    await chrome.tabs.sendMessage(tabId, message);
    clearWatchdog();
    watchdog = setTimeout(() => {
      void (async () => {
        const fresh = await loadApp();
        const j = fresh.currentRun.jobs.find((x) => x.id === job.id);
        if (j && j.state === 'running') {
          j.state = 'failed';
          j.error = 'Timed out waiting for the Flow content script to report the result.';
          j.finishedAt = Date.now();
          fresh.activeJobId = null;
          await saveAndSync(fresh);
          await advance(fresh);
        }
      })();
    }, GEN_TIMEOUT_MS);
  } catch {
    job.state = 'failed';
    job.error = 'Could not reach the Flow content script. Reload the Flow tab (Ctrl+Shift+R), then retry.';
    job.finishedAt = Date.now();
    app.activeJobId = null;
    await saveAndSync(app);
    await advance(app);
  }
}

async function downloadUrlWithRetry(run: Run, job: Job, record: DownloadRecord): Promise<void> {
  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
    record.state = 'running';
    record.attempt = attempt;
    record.error = undefined;
    await saveJob(run, job).catch(noop);
    const path = outputPath(run.dirName, record.fileName);
    const outcome = await downloadTo(path, record.url);
    if (outcome.ok) {
      record.state = 'completed';
      record.localPath = outcome.localPath;
      record.error = undefined;
      // Clear data: URL after download — it can be several MB and would
      // exhaust chrome.storage.local quota across many jobs.
      if (record.url.startsWith('data:')) record.url = '';
      await saveJob(run, job).catch(noop);
      return;
    }
    record.error = outcome.error;
    record.state = 'failed';
    await saveJob(run, job).catch(noop);
    if (attempt < MAX_DOWNLOAD_ATTEMPTS) await delay(800 * attempt);
  }
}

/** Persist the given (in-memory, possibly detached) job into the stored graph. */
async function saveJob(run: Run, job: Job): Promise<void> {
  const app = await loadApp();
  const target = app.currentRun.id === run.id ? app.currentRun : app.history.find((r) => r.id === run.id);
  if (!target) return;
  const idx = target.jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) target.jobs[idx] = job;
  await saveAndSync(app);
}

async function downloadPhase(app: AppState, job: Job): Promise<void> {
  const run = app.currentRun;
  job.state = 'downloading';
  job.startedAt = job.startedAt ?? Date.now();
  job.error = undefined;
  await saveAndSync(app);

  for (const record of job.downloads) {
    if (record.state === 'completed') continue;
    await downloadUrlWithRetry(run, job, record);
  }

  const allOk = job.downloads.length > 0 && job.downloads.every((d) => d.state === 'completed');
  job.state = allOk ? 'completed' : 'download-failed';
  if (allOk) {
    job.finishedAt = Date.now();
    job.error = undefined;
  }
  await saveAndSync(app);
  await advance(app);
}

async function finalizeRun(app: AppState): Promise<void> {
  const run = app.currentRun;
  archiveRun(app, run);
  app.currentRun = newRun(app.nextRunNumber, app.settings);
  app.nextRunNumber += 1;
  app.activeJobId = null;
  app.running = false;
  setStatus('Run complete');
  await saveAndSync(app);
}

function makeDownloadRecords(result: FlowResult, job: Job, run: Run): DownloadRecord[] {
  const attrs = resolveSettings(run.settings, job.settings);
  const genType = attrs.genType;
  const base = jobBaseName(job.name, job.prompt);
  const urls = dedupe([
    ...result.downloadUrls,
    ...result.previewUrls.filter((u) => u.startsWith('data:') || u.startsWith('https://')),
  ].filter(Boolean));
  const jobIdx = run.jobs.findIndex((j) => j.id === job.id);
  const safeIndex = jobIdx >= 0 ? jobIdx + 1 : 1;

  return urls.map((url, i) => ({
    url,
    fileName: outputFileName(
      genType,
      base,
      safeIndex,
      job.version,
      urls.length > 1 ? i + 1 : undefined,
    ),
    state: 'pending' as const,
    attempt: 0,
    version: job.version,
  }));
}

function dedupe(list: string[]): string[] {
  return Array.from(new Set(list));
}

/**
 * Deep-clone app state replacing any data: URLs in download records with ''.
 * Used before persisting to chrome.storage.local to avoid exhausting the
 * default 10 MB quota with large base64 image payloads.
 */
function stripDataUrls(app: AppState): AppState {
  return {
    ...app,
    currentRun: {
      ...app.currentRun,
      jobs: app.currentRun.jobs.map((job) => ({
        ...job,
        downloads: job.downloads.map((d) => ({
          ...d,
          url: d.url.startsWith('data:') ? '' : d.url,
        })),
      })),
    },
    history: app.history.map((run) => ({
      ...run,
      jobs: run.jobs.map((job) => ({
        ...job,
        downloads: job.downloads.map((d) => ({
          ...d,
          url: d.url.startsWith('data:') ? '' : d.url,
        })),
      })),
    })),
  };
}

async function handleInbound(msg: InboundMessage): Promise<void> {
  console.log('[handleInbound] received message:', msg.kind, 'id' in msg ? msg.id : '');
  if (msg.kind === 'flow-ready') {
    await findFlowTab();
    // Content script just loaded — resume the queue if it was waiting.
    const app = await loadApp();
    if (app.running && !app.paused) await advance(app);
    return;
  }
  if (msg.kind === 'job-progress') {
    const app = await loadApp();
    const job = app.currentRun.jobs.find((j) => j.id === msg.id);
    if (job && job.state === 'running') {
      job.genSummary = msg.message;
      await saveAndSync(app);
    }
    return;
  }
  if (msg.kind !== 'job-result') return;
  const app = await loadApp();
  const run = app.currentRun;
  if (app.activeJobId !== null && app.activeJobId !== msg.id) return;
  clearWatchdog();
  const job = run.jobs.find((j) => j.id === msg.id);
  if (!job) return;
  app.activeJobId = null;

  if (msg.ok) {
    job.genSummary = msg.result.summary;
    job.downloads = makeDownloadRecords(msg.result, job, run);
    console.log('[handleInbound] created download records:', job.downloads);
    job.state = 'downloading';
    app.jobsSinceRefresh += 1;
    // Save app state WITHOUT data: URLs (they can be MBs each and blow the
    // 10 MB chrome.storage.local quota). We download first, then persist the
    // resulting local path which is tiny.
    const appToSave = stripDataUrls(app);
    await saveApp(appToSave).catch(noop);
    setStatus(buildStatus(app));
    push(app);
    await downloadPhase(app, job);
    return;
  }

  job.state = 'failed';
  job.error = msg.error;
  job.finishedAt = Date.now();
  app.jobsSinceRefresh += 1;
  await saveApp(app);
  setStatus(buildStatus(app));
  push(app);
  await advance(app);
}

async function handleAction(action: Action): Promise<AppState> {
  const app = reduceApp(await loadApp(), action);
  await saveApp(app);
  setStatus(buildStatus(app));
  await advance(app);
  return app;
}

/**
 * Restore the persisted queue when Chrome wakes this MV3 service worker.
 * A worker wake is normal during a long Flow generation, so do not reset the
 * active job here — the content script is still running in the Flow tab.
 */
async function recoverOnce(): Promise<void> {
  if (recovered) return;
  recovered = true;
  const app = await loadApp();
  const active = app.currentRun.jobs.find((job) => job.id === app.activeJobId);
  if (!active && app.activeJobId !== null) {
    app.activeJobId = null;
  }
  await saveAndSync(app);
}

/** Fail only a genuinely stale job; do not confuse normal worker suspension with failure. */
async function expireStaleActiveJob(app: AppState): Promise<boolean> {
  const active = app.currentRun.jobs.find((job) => job.id === app.activeJobId);
  if (!active) return false;
  if (active.state !== 'running') return false;
  const startedAt = active.startedAt ?? Date.now();
  if (Date.now() - startedAt < GEN_TIMEOUT_MS) return false;

  active.state = 'failed';
  active.error = 'Timed out waiting for Google Flow to finish this generation.';
  active.finishedAt = Date.now();
  app.activeJobId = null;
  await saveAndSync(app);
  await advance(app);
  return true;
}

/** Called by the heartbeat alarm: keep the queue moving with popup closed. */
async function tick(): Promise<void> {
  const app = await loadApp();
  if (app.running && !app.paused) {
    if (await expireStaleActiveJob(app)) return;
    await advance(app);
  }
}

/** Flow tab reloaded or content script became reachable again — reconnect. */
async function onFlowTabUpdated(): Promise<void> {
  clearWatchdog();
  const app = await loadApp();
  // If a generation was interrupted by the reload, un-stick it explicitly.
  const active = app.currentRun.jobs.find((j) => j.id === app.activeJobId);
  if (active) {
    if (active.state === 'running') {
      active.state = 'failed';
      active.error = 'Generation was interrupted because the Flow tab reloaded.';
      active.finishedAt = Date.now();
    } else if (active.state === 'downloading') {
      active.state = 'download-failed';
    }
    app.activeJobId = null;
    await saveAndSync(app);
  }
  if (app.running && !app.paused) await advance(app);
}

async function onFlowTabClosed(): Promise<void> {
  flowTabId = null;
  await onFlowTabUpdated();
}

function setupTabListeners(): void {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (flowTabId === null && isFlowUrl(tab.url)) flowTabId = tabId;
    if (tabId === flowTabId && changeInfo.status === 'complete') void onFlowTabUpdated();
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === flowTabId) void onFlowTabClosed();
  });
}

const ACTIONS: Action['type'][] = [
  'state', 'add', 'delete', 'duplicateJob', 'moveJob', 'updateJob',
  'retryFailed', 'retryDownloads', 'regenerate', 'skip',
  'start', 'pause', 'resume', 'stop', 'clearCurrent',
  'setSettings', 'setRefresh', 'addReference', 'deleteReference',
  'openRun', 'runAgain', 'deleteRun',
];

function setStatus(value: string): void {
  status = value;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function setupAlarm(): void {
  try {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_MIN });
  } catch {
    /* ignore */
  }
}

setupTabListeners();
chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await recoverOnce().catch(noop);
    await findFlowTab().catch(noop);
    setupAlarm();
  })();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void tick().catch(noop);
});
setupAlarm();

void (async () => {
  await recoverOnce().catch(noop);
  await findFlowTab().catch(noop);
  const app = await loadApp().catch(() => null);
  if (app?.running) void tick().catch(noop);
})();

function noop(): void { /* ignore */ }

let processingChain: Promise<void> = Promise.resolve();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const action = msg as Action;
  if (action && typeof action.type === 'string' && ACTIONS.includes(action.type as Action['type'])) {
    void handleAction(action)
      .then((app) => sendResponse({ kind: 'state', app, status } satisfies OutboundMessage))
      .catch(() => void (async () => {
        // Storage failure: still surface the persisted state if possible.
        try {
          const app = await loadApp();
          sendResponse({ kind: 'state', app, status: 'Storage error' } satisfies OutboundMessage);
        } catch {
          sendResponse(undefined);
        }
      })());
    return true;
  }

  const inbound = msg as InboundMessage;
  if (inbound && (inbound as { kind?: string }).kind === 'native-replace-text') {
    const tabId = sender.tab?.id;
    if (tabId === undefined) {
      sendResponse({ ok: false, error: 'No Flow tab was available for native input.' });
      return;
    }
    const nativeText = inbound as { text?: string; x?: number; y?: number };
    void replacePromptWithNativeInput(tabId, nativeText.text ?? '', nativeText.x, nativeText.y)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  }
  if (inbound && (inbound as { kind?: string }).kind === 'native-click') {
    const tabId = sender.tab?.id;
    const nativeClick = inbound as { x?: number; y?: number };
    if (tabId === undefined || !Number.isFinite(nativeClick.x) || !Number.isFinite(nativeClick.y)) {
      sendResponse({ ok: false, error: 'Generate button location was unavailable.' });
      return;
    }
    void clickWithNativeInput(tabId, nativeClick.x as number, nativeClick.y as number)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  }
  if (inbound && (inbound.kind === 'job-result' || inbound.kind === 'job-progress' || inbound.kind === 'flow-ready')) {
    processingChain = processingChain
      .then(() => handleInbound(inbound))
      .catch((err) => console.error('[handleInbound] failed:', err));
  }
});
