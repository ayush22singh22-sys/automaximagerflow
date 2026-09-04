export type GenType = 'image' | 'video';

export type VideoMode = 'text-to-video' | 'start-frame' | 'start-end-frame' | 'reference';

export type RefCategory = 'Subject' | 'Scene' | 'Style';

export type JobState =
  | 'queued'
  | 'running'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'download-failed'
  | 'failed-paused';

export type DownloadState = 'pending' | 'running' | 'completed' | 'failed';

/** How a reference is attached to a Flow generation. */
export type RefRole = 'start' | 'end' | 'reference';

/** What the Flow content script observed on the page after a generation. */
export interface FlowResult {
  summary: string;
  count: number;
  /** Result preview src/href URLs (may include data:/blob:). */
  previewUrls: string[];
  /** Candidate download/save URLs collected from the result area. */
  downloadUrls: string[];
  applied: string[];
  skipped: string[];
}

export interface GenSettings {
  genType: GenType;
  model: string;
  aspectRatio: string;
  count: number;
  quality: string;
  videoMode: VideoMode;
  duration: number;
}

export interface Reference {
  id: string;
  name: string;
  category: RefCategory;
  dataUrl: string;
  createdAt: number;
}

export interface TaggedRef {
  role: RefRole;
  ref: Reference;
}

export interface DownloadRecord {
  url: string;
  /** Final file name including version, e.g. 001-robot-scene-v2.png */
  fileName: string;
  localPath?: string;
  state: DownloadState;
  error?: string;
  attempt: number;
  version: number;
}

export interface Job {
  id: string;
  prompt: string;
  state: JobState;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  /** Per-job override of global generation settings. */
  settings?: Partial<GenSettings>;
  /** Resolved references with their Flow role. */
  refs: TaggedRef[];
  /** Base output name (from #name) if provided. */
  name?: string;
  /** Regeneration version (1 = first). */
  version: number;
  downloads: DownloadRecord[];
  /** Prior versions' download records, preserved during regeneration. */
  regenArchive?: DownloadRecord[];
  /** Human summary of the latest generation result. */
  genSummary?: string;
  /** Preserved result payload for download retries without re-generating. */
  tempResult?: FlowResult;
  /** Automatic retry attempt count for generation failures / unusual activity. */
  retryCount?: number;
}

export interface Run {
  id: string;
  /** Folder name: Run-YYYY-MM-DD-NNN */
  dirName: string;
  runNumber: number;
  mode: GenType;
  /** Global settings snapshot for this run (used to reproduce on "run again"). */
  settings: GenSettings;
  createdAt: number;
  jobs: Job[];
  completedAt?: number;
}

/** Optional periodic Flow refresh, configured with an interval and/or job count. */
export interface FlowRefreshSettings {
  enabled: boolean;
  /** Minutes between refreshes (0 = off). */
  intervalMin: number;
  /** Refresh after this many completed jobs (0 = off). */
  afterJobs: number;
}

/** Automatic retry configuration for transient errors / unusual activity flags. */
export interface AutoRetrySettings {
  enabled: boolean;
  /** Maximum number of auto-retry attempts before marking job failed (default: 3). */
  maxRetries: number;
  /** Seconds to wait before attempting auto-retry (default: 20s). */
  cooldownSec: number;
  /** Whether to reload the Flow tab before retrying after unusual activity (default: true). */
  reloadOnUnusualActivity: boolean;
}

export interface AppState {
  currentRun: Run;
  history: Run[];
  running: boolean;
  paused: boolean;
  activeJobId: string | null;
  nextRunNumber: number;
  settings: GenSettings;
  references: Reference[];
  refresh: FlowRefreshSettings;
  /** How many jobs have completed since the last Flow refresh. */
  jobsSinceRefresh: number;
  lastRefreshAt?: number;
  autoRetry: AutoRetrySettings;
  /** Delay in seconds to wait between completing one job and starting the next (default: 5s). */
  jobDelaySec: number;
}

export type Action =
  | { type: 'state' }
  | { type: 'add'; prompts: string[] }
  | { type: 'delete'; id: string }
  | { type: 'duplicateJob'; id: string }
  | { type: 'moveJob'; id: string; toIndex: number }
  | { type: 'updateJob'; id: string; prompt?: string; settings?: Partial<GenSettings>; refs?: TaggedRef[]; name?: string }
  | { type: 'setRunDirName'; dirName: string }
  | { type: 'retryFailed' }
  | { type: 'retryDownloads' }
  | { type: 'retryJob'; id: string }
  | { type: 'regenerate'; id: string }
  | { type: 'skip'; id: string }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'clearCurrent' }
  | { type: 'setSettings'; settings: GenSettings }
  | { type: 'setRefresh'; refresh: FlowRefreshSettings }
  | { type: 'setAutoRetry'; autoRetry: AutoRetrySettings }
  | { type: 'setJobDelay'; delaySec: number }
  | { type: 'addReference'; reference: Reference }
  | { type: 'deleteReference'; id: string }
  | { type: 'openRun'; id: string }
  | { type: 'runAgain'; id: string }
  | { type: 'deleteRun'; id: string };

export interface RunRequest {
  id: string;
  /** Prompt with #name and @reference tokens stripped. */
  prompt: string;
  settings: GenSettings;
  refs: TaggedRef[];
}

export type OutboundMessage =
  | { kind: 'state'; app: AppState; status: string }
  | { kind: 'run-job'; job: RunRequest }
  | { kind: 'ping' };

export type InboundMessage =
  | { kind: 'job-result'; ok: true; id: string; result: FlowResult }
  | { kind: 'job-result'; ok: false; id: string; error: string }
  | { kind: 'job-progress'; id: string; message: string }
  | { kind: 'flow-ready' };

export function jobId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function runId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function refId(): string {
  return `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultSettings(genType: GenType = 'image'): GenSettings {
  return {
    genType,
    model: genType === 'video' ? 'Veo 3.1' : 'Nano Banana Pro',
    aspectRatio: genType === 'video' ? '16:9' : '1:1',
    count: 1,
    quality: 'High',
    videoMode: 'text-to-video',
    duration: 5,
  };
}
