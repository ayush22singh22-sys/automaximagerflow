import type { Action, AppState, DownloadRecord, GenSettings, Job, Run } from './types.js';
import { defaultSettings, jobId, runId } from './types.js';
import { jobBaseName, outputFileName, parseNameToken, resolvePromptRefs, runDirName, sanitizeFolderName } from './naming.js';

const HISTORY_PER_MODE = 10;

/**
 * Pure app reducer. Mutates a working copy of state in place and returns it.
 * Kept free of Chrome/DOM so it is directly unit-testable.
 *
 * The app is modeled around a "run" (the current buildable/executable batch)
 * plus a history of completed runs (capped per mode). Jobs go through:
 *   queued -> running -> downloading -> completed | failed | download-failed
 */
export function reduceApp(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'add':
      addPrompts(state, action.prompts);
      break;
    case 'delete':
      state.currentRun.jobs = state.currentRun.jobs.filter((j) => j.id !== action.id);
      if (state.activeJobId === action.id) state.activeJobId = null;
      break;
    case 'duplicateJob': {
      const idx = state.currentRun.jobs.findIndex((j) => j.id === action.id);
      if (idx >= 0) {
        const src = state.currentRun.jobs[idx];
        const copy = cloneJobFresh(src);
        copy.prompt = src.prompt;
        copy.settings = src.settings;
        copy.name = src.name;
        state.currentRun.jobs.splice(idx + 1, 0, copy);
      }
      break;
    }
    case 'moveJob': {
      const jobs = state.currentRun.jobs;
      const from = jobs.findIndex((j) => j.id === action.id);
      if (from < 0) break;
      const to = Math.max(0, Math.min(jobs.length - 1, action.toIndex));
      if (from === to) break;
      const [moved] = jobs.splice(from, 1);
      jobs.splice(to, 0, moved);
      break;
    }
    case 'updateJob': {
      const job = find(state.currentRun, action.id);
      if (job && job.state !== 'running' && job.state !== 'downloading') {
        if (action.prompt !== undefined) {
          job.prompt = action.prompt;
          const parsed = resolvePromptRefs(job.prompt, state.references);
          job.refs = parsed.tagged;
          job.name = parseNameToken(job.prompt) ?? undefined;
        }
        if (action.settings !== undefined) job.settings = action.settings;
        if (action.refs !== undefined) job.refs = action.refs;
        if (action.name !== undefined) job.name = action.name;
      }
      break;
    }
    case 'setRunDirName': {
      const sanitized = sanitizeFolderName(action.dirName);
      if (sanitized) {
        state.currentRun.dirName = sanitized;
      }
      break;
    }
    case 'retryFailed':
      for (const job of state.currentRun.jobs) {
        if (job.state === 'failed') requeue(job);
      }
      break;
    case 'retryDownloads':
      for (const job of state.currentRun.jobs) {
        if (job.state === 'download-failed' || job.state === 'failed-paused') {
          job.state = 'downloading';
          for (const d of job.downloads) if (d.state !== 'completed') d.state = 'pending';
          job.error = undefined;
        }
      }
      break;
    case 'retryJob': {
      const job = find(state.currentRun, action.id);
      if (job && (job.state === 'failed' || job.state === 'download-failed' || job.state === 'failed-paused')) {
        if (job.tempResult || (job.downloads && job.downloads.length > 0)) {
          job.state = 'downloading';
          if (job.tempResult && job.downloads.length === 0) {
            // Re-create download records from preserved tempResult
            job.downloads = makeDownloadRecordsForJob(job, state.currentRun);
          } else {
            for (const d of job.downloads) if (d.state !== 'completed') d.state = 'pending';
          }
          job.error = undefined;
        } else {
          requeue(job);
        }
      }
      break;
    }
    case 'regenerate': {
      const job = find(state.currentRun, action.id);
      if (job && (job.state === 'completed' || job.state === 'download-failed' || job.state === 'failed')) {
        // Preserve prior result metadata, start a fresh version.
        job.version += 1;
        job.regenArchive = [...(job.regenArchive ?? []), ...job.downloads];
        job.downloads = [];
        job.genSummary = undefined;
        requeue(job);
      }
      break;
    }
    case 'skip': {
      const job = find(state.currentRun, action.id);
      if (job && (job.state === 'queued' || job.state === 'skipped')) {
        job.state = 'skipped';
        job.finishedAt = Date.now();
      }
      break;
    }
    case 'start':
      state.running = true;
      state.paused = false;
      break;
    case 'pause':
      state.paused = true;
      break;
    case 'resume':
      state.paused = false;
      state.running = true;
      break;
    case 'stop': {
      state.running = false;
      state.paused = false;
      const active = find(state.currentRun, state.activeJobId ?? '');
      if (active && (active.state === 'running' || active.state === 'downloading')) {
        active.state = 'queued';
        active.startedAt = undefined;
      }
      state.activeJobId = null;
      break;
    }
    case 'clearCurrent':
      state.currentRun = newRun(state.nextRunNumber, state.settings);
      state.nextRunNumber += 1;
      state.activeJobId = null;
      break;
    case 'setSettings':
      state.settings = { ...defaultSettings(state.settings.genType), ...action.settings };
      break;
    case 'setRefresh':
      state.refresh = {
        enabled: !!action.refresh.enabled,
        intervalMin: Math.max(0, action.refresh.intervalMin || 0),
        afterJobs: Math.max(0, action.refresh.afterJobs || 0),
      };
      break;
    case 'setAutoRetry':
      state.autoRetry = {
        enabled: !!action.autoRetry.enabled,
        maxRetries: Math.max(1, action.autoRetry.maxRetries || 1),
        cooldownSec: Math.max(5, action.autoRetry.cooldownSec || 5),
        reloadOnUnusualActivity: action.autoRetry.reloadOnUnusualActivity !== undefined ? !!action.autoRetry.reloadOnUnusualActivity : true,
      };
      break;
    case 'setJobDelay':
      state.jobDelaySec = Math.max(0, action.delaySec || 0);
      break;
    case 'addReference':
      if (action.reference?.id && action.reference?.dataUrl) {
        state.references = state.references.filter((r) => r.id !== action.reference.id);
        state.references.push(action.reference);
      }
      break;
    case 'deleteReference': {
      state.references = state.references.filter((r) => r.id !== action.id);
      for (const job of state.currentRun.jobs) {
        job.refs = job.refs.filter((t) => t.ref.id !== action.id);
      }
      for (const run of state.history) {
        for (const job of run.jobs) job.refs = job.refs.filter((t) => t.ref.id !== action.id);
      }
      break;
    }
    case 'openRun': {
      const idx = state.history.findIndex((r) => r.id === action.id);
      if (idx >= 0) {
        state.currentRun = state.history[idx];
        state.history.splice(idx, 1);
        state.activeJobId = null;
      }
      break;
    }
    case 'runAgain': {
      const src = state.history.find((r) => r.id === action.id);
      if (src) {
        const run = newRun(state.nextRunNumber, src.settings);
        run.mode = src.settings.genType;
        state.nextRunNumber += 1;
        run.jobs = src.jobs.map((j) => cloneJobFresh(j));
        state.currentRun = run;
        state.activeJobId = null;
      }
      break;
    }
    case 'deleteRun':
      state.history = state.history.filter((r) => r.id !== action.id);
      break;
    case 'state':
      break;
  }
  return state;
}

/** Push a finished run into history (capped per mode) and return success. */
export function archiveRun(state: AppState, run: Run): void {
  run.completedAt = Date.now();
  run.mode = run.settings.genType;
  const list = state.history.filter((r) => r.mode === run.mode);
  if (list.length >= HISTORY_PER_MODE) {
    // Remove the oldest of this mode.
    const oldest = list.sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0))[0];
    state.history = state.history.filter((r) => r.id !== oldest.id);
  }
  state.history.push(run);
}

function find(run: Run, id: string): Job | undefined {
  return run.jobs.find((j) => j.id === id);
}

function requeue(job: Job): void {
  job.state = 'queued';
  job.error = undefined;
  job.startedAt = undefined;
  job.finishedAt = undefined;
  job.retryCount = 0;
}

/** Clone a job as a fresh queued job (for "run again") with version reset. */
function cloneJobFresh(job: Job): Job {
  return {
    ...job,
    id: jobId(),
    state: 'queued',
    createdAt: Date.now(),
    startedAt: undefined,
    finishedAt: undefined,
    error: undefined,
    version: 1,
    downloads: [],
    regenArchive: undefined,
    genSummary: undefined,
    refs: job.refs.map((t) => ({ ...t })),
    retryCount: 0,
  };
}

function addPrompts(state: AppState, promptChunks: string[]): void {
  const parsedPrompts: string[] = [];

  /** True when a line is a standalone #name token (no other content). */
  const isNameLine = (line: string): boolean =>
    // Allow letters, digits, underscores, dots, hyphens AND colons (timecodes like #0:00).
    /^#[A-Za-z0-9_.:-]+$/.test(line);

  for (const chunk of promptChunks) {
    const lines = chunk
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (isNameLine(line)) {
        // Collect ALL following non-name lines as the body of this prompt.
        // This handles multi-line prompts like:
        //   #0:00
        //   Wide shot of...
        //   STYLE: extremely simple...
        const promptLines: string[] = [];
        while (i + 1 < lines.length && !isNameLine(lines[i + 1])) {
          promptLines.push(lines[i + 1]);
          i++;
        }
        if (promptLines.length > 0) {
          parsedPrompts.push(`${line} ${promptLines.join(' ')}`);
        } else {
          parsedPrompts.push(line);
        }
      } else {
        parsedPrompts.push(line);
      }
    }
  }

  for (const prompt of parsedPrompts) {
    const parsed = resolvePromptRefs(prompt, state.references);
    state.currentRun.jobs.push({
      id: jobId(),
      prompt,
      state: 'queued',
      createdAt: Date.now(),
      refs: parsed.tagged,
      name: parseNameToken(prompt) ?? undefined,
      version: 1,
      downloads: [],
      retryCount: 0,
    });
  }
}

export function newRun(runNumber: number, settings: GenSettings): Run {
  return {
    id: runId(),
    dirName: runDirName(runNumber),
    runNumber,
    mode: settings.genType,
    settings: { ...settings },
    createdAt: Date.now(),
    jobs: [],
  };
}

export function makeDownloadRecordsForJob(job: Job, run: Run): DownloadRecord[] {
  if (!job.tempResult) return job.downloads;
  const attrs = resolveSettings(run.settings, job.settings);
  const genType = attrs.genType;
  const base = jobBaseName(job.name, job.prompt);
  const result = job.tempResult;
  const rawUrls = result.downloadUrls.length > 0 ? result.downloadUrls : result.previewUrls;
  const urls = Array.from(new Set(rawUrls.filter((u) => u.startsWith('data:') || u.startsWith('https:') || u.startsWith('blob:'))));
  const maxAllowed = Math.min(4, Math.max(1, attrs.count || 4));
  const cappedUrls = urls.slice(0, maxAllowed);
  const jobIdx = run.jobs.findIndex((j) => j.id === job.id);
  const safeIndex = jobIdx >= 0 ? jobIdx + 1 : 1;

  return cappedUrls.map((url, i) => ({
    url,
    fileName: outputFileName(
      genType,
      base,
      safeIndex,
      job.version,
      cappedUrls.length > 1 ? i + 1 : undefined,
    ),
    state: 'pending' as const,
    attempt: 0,
    version: job.version,
  }));
}

/** Merge per-job override onto global settings. */
export function resolveSettings(global: GenSettings, override?: Partial<GenSettings>): GenSettings {
  return { ...global, ...(override ?? {}) };
}
