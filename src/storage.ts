import type { AppState, DownloadRecord, Job, Run, TaggedRef } from './types.js';
import { defaultSettings } from './types.js';
import { newRun } from './app.js';

const KEY = 'app-v2';

/** Normalize a parsed legacy/stale value to a coherent in-memory state. */
export function normalizeApp(raw: Partial<AppState> | undefined): AppState {
  const settings = {
    ...defaultSettings(raw?.settings?.genType),
    ...(raw?.settings ?? {}),
  };

  const references = Array.isArray(raw?.references) ? raw.references : [];

  // Ensure a viable current run with coherent jobs.
  let currentRun: Run;
  if (raw?.currentRun && Array.isArray(raw.currentRun.jobs)) {
    currentRun = {
      ...raw.currentRun,
      mode: raw.currentRun.mode || settings.genType,
      settings: { ...settings, ...(raw.currentRun.settings ?? {}) },
      jobs: raw.currentRun.jobs.map(normalizeJob),
      createdAt: raw.currentRun.createdAt || Date.now(),
    };
  } else {
    currentRun = newRun(raw?.nextRunNumber ?? 1, settings);
  }

  const history = Array.isArray(raw?.history)
    ? raw.history.map((r) => ({
        ...r,
        mode: r.mode || r.settings?.genType || 'image',
        settings: { ...settings, ...(r.settings ?? {}) },
        jobs: Array.isArray(r.jobs) ? r.jobs.map(normalizeJob) : [],
      }))
    : [];

  // Collision-free run numbers: the next run must exceed every allocated number
  // including the current run's, which already owns its runNumber.
  const used = new Set([
    ...history.map((r) => r.runNumber),
    ...(currentRun.jobs.length ? [currentRun.runNumber] : []),
  ]);
  const nextRunNumber = Math.max(
    raw?.nextRunNumber ?? 1,
    currentRun.runNumber + 1,
    ...Array.from(used).map((n) => n + 1),
  );

  return {
    currentRun,
    history,
    running: !!raw?.running,
    paused: !!raw?.paused,
    activeJobId: raw?.activeJobId ?? null,
    nextRunNumber,
    settings,
    references: references.map((r) => ({ ...r })),
    refresh: {
      enabled: !!raw?.refresh?.enabled,
      intervalMin: Math.max(0, raw?.refresh?.intervalMin || 0),
      afterJobs: Math.max(0, raw?.refresh?.afterJobs || 0),
    },
    jobsSinceRefresh: Math.max(0, raw?.jobsSinceRefresh || 0),
    lastRefreshAt: raw?.lastRefreshAt,
    autoRetry: {
      enabled: raw?.autoRetry?.enabled !== undefined ? !!raw.autoRetry.enabled : true,
      maxRetries: Math.max(1, raw?.autoRetry?.maxRetries ?? 3),
      cooldownSec: Math.max(5, raw?.autoRetry?.cooldownSec ?? 20),
      reloadOnUnusualActivity: raw?.autoRetry?.reloadOnUnusualActivity !== undefined ? !!raw.autoRetry.reloadOnUnusualActivity : true,
    },
    jobDelaySec: Math.max(0, raw?.jobDelaySec !== undefined ? raw.jobDelaySec : 5),
  };
}

function normalizeJob(job: Job | undefined): Job {
  const j: Job = {
    id: job?.id ?? `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    prompt: job?.prompt ?? '',
    state: job?.state ?? 'queued',
    createdAt: job?.createdAt ?? Date.now(),
    refs: Array.isArray(job?.refs) ? job.refs.map(normalizeTagged) : [],
    version: job?.version ?? 1,
    downloads: Array.isArray(job?.downloads) ? job.downloads.map(normalizeDownload) : [],
    retryCount: Math.max(0, job?.retryCount ?? 0),
  };
  if (job?.settings) j.settings = job.settings;
  if (job?.name) j.name = job.name;
  if (job?.startedAt) j.startedAt = job.startedAt;
  if (job?.finishedAt) j.finishedAt = job.finishedAt;
  if (job?.error) j.error = job.error;
  if (job?.genSummary) j.genSummary = job.genSummary;
  if (Array.isArray(job?.regenArchive)) j.regenArchive = job.regenArchive.map(normalizeDownload);
  return j;
}

function normalizeTagged(t: TaggedRef | undefined): TaggedRef {
  return {
    role: t?.role ?? 'reference',
    ref: t?.ref ?? ({ id: '', name: '?', dataUrl: '' } as TaggedRef['ref']),
  };
}

function normalizeDownload(d: DownloadRecord | undefined): DownloadRecord {
  return {
    url: d?.url ?? '',
    fileName: d?.fileName ?? '',
    state: d?.state ?? 'pending',
    attempt: d?.attempt ?? 0,
    version: d?.version ?? 1,
    localPath: d?.localPath,
    error: d?.error,
  };
}

export async function loadApp(): Promise<AppState> {
  const stored = await chrome.storage.local.get(KEY);
  return normalizeApp(stored[KEY] as Partial<AppState> | undefined);
}

export async function saveApp(app: AppState): Promise<void> {
  await chrome.storage.local.set({ [KEY]: app });
}

export function emptyApp(): AppState {
  return normalizeApp(undefined);
}
