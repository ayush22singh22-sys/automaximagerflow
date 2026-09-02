import type {
  Action,
  AppState,
  GenSettings,
  Job,
  OutboundMessage,
  Reference,
  RefCategory,
  RefRole,
  Run,
  TaggedRef,
  VideoMode,
} from '../types.js';
import { refId } from '../types.js';

type Ui = { app: AppState; status: string };

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const els = {
  status: $('status'),
  runLabel: $('run-label'),
  promptInput: $<HTMLTextAreaElement>('prompt-input'),
  addBtn: $<HTMLButtonElement>('add-btn'),
  importFile: $<HTMLInputElement>('import-file'),
  startBtn: $<HTMLButtonElement>('start-btn'),
  pauseBtn: $<HTMLButtonElement>('pause-btn'),
  resumeBtn: $<HTMLButtonElement>('resume-btn'),
  stopBtn: $<HTMLButtonElement>('stop-btn'),
  retryBtn: $<HTMLButtonElement>('retry-btn'),
  redlBtn: $<HTMLButtonElement>('redl-btn'),
  clearBtn: $<HTMLButtonElement>('clear-btn'),
  stats: $('stats'),
  search: $<HTMLInputElement>('search'),
  filterStatus: $<HTMLSelectElement>('filter-status'),
  queue: $('queue'),
  empty: $('empty'),
  filterEmpty: $('filter-empty'),
  queueCount: $('queue-count'),
  genImage: $<HTMLButtonElement>('gen-image'),
  genVideo: $<HTMLButtonElement>('gen-video'),
  setModel: $<HTMLInputElement>('set-model'),
  setAspect: $<HTMLInputElement>('set-aspect'),
  setQuality: $<HTMLInputElement>('set-quality'),
  setCount: $<HTMLInputElement>('set-count'),
  setVideoMode: $<HTMLSelectElement>('set-videomode'),
  setDuration: $<HTMLInputElement>('set-duration'),
  videoSettings: $('video-settings'),
  saveSettings: $<HTMLButtonElement>('save-settings'),
  refreshEnabled: $<HTMLInputElement>('refresh-enabled'),
  refreshInterval: $<HTMLInputElement>('refresh-interval'),
  refreshJobs: $<HTMLInputElement>('refresh-jobs'),
  saveRefresh: $<HTMLButtonElement>('save-refresh'),
  refFile: $<HTMLInputElement>('ref-file'),
  refName: $<HTMLInputElement>('ref-name'),
  refCategory: $<HTMLSelectElement>('ref-category'),
  refList: $('ref-list'),
  refEmpty: $('ref-empty'),
  refCount: $('ref-count'),
  historyList: $('history-list'),
  historyEmpty: $('history-empty'),
  historyCount: $('history-count'),
  modal: $('modal'),
  modalBody: $('modal-body'),
  modalBackdrop: $('modal-backdrop'),
  tabs: Array.from(document.querySelectorAll<HTMLButtonElement>('.tab')),
  panels: {
    queue: $('tab-queue'),
    settings: $('tab-settings'),
    refs: $('tab-refs'),
    history: $('tab-history'),
  },
};

let ui: Ui = { app: emptyUiApp(), status: 'Idle' };
let editingId: string | null = null;
let search = '';
let filterStatus = 'all';
const expanded = new Set<string>();
let lastDirtyKey = '';

function emptyUiApp(): AppState {
  return {
    currentRun: { id: '', dirName: 'Run-…', runNumber: 1, mode: 'image', settings: emptySettings(), createdAt: Date.now(), jobs: [] },
    history: [],
    running: false,
    paused: false,
    activeJobId: null,
    nextRunNumber: 1,
    settings: emptySettings(),
    references: [],
    refresh: { enabled: false, intervalMin: 15, afterJobs: 0 },
    jobsSinceRefresh: 0,
  };
}

function emptySettings(): GenSettings {
  return { genType: 'image', model: '', aspectRatio: '', count: 1, quality: '', videoMode: 'text-to-video', duration: 5 };
}

const ROLE_LABEL: Record<RefRole, string> = { start: 'Start', end: 'End', reference: 'Ref' };
const STATE_LABEL: Record<string, string> = {
  queued: 'Queued', running: 'Running', downloading: 'Downloading',
  completed: 'Completed', failed: 'Failed', 'download-failed': 'DL failed', skipped: 'Skipped',
  'failed-paused': 'DL paused',
};

function send(action: Action): Promise<Ui> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(action, (reply: OutboundMessage | undefined) => {
        if (reply?.kind === 'state') resolve({ app: reply.app, status: reply.status });
        else resolve(ui);
      });
    } catch {
      resolve(ui);
    }
  });
}

/* ------------------------------- metrics ------------------------------- */
function stats(run: Run): Record<string, number> {
  const m: Record<string, number> = {
    total: run.jobs.length,
    queued: 0, running: 0, downloading: 0, completed: 0, failed: 0, 'download-failed': 0, skipped: 0,
  };
  for (const j of run.jobs) m[j.state] = (m[j.state] ?? 0) + 1;
  return m;
}

function renderStats(run: Run): void {
  const m = stats(run);
  const done = m.completed;
  const prog = m.total ? Math.round((done / m.total) * 100) : 0;
  els.stats.textContent = '';
  const mk = (label: string, value: number, cls: string): void => {
    const s = document.createElement('span');
    s.className = 'stat';
    const b = document.createElement('b');
    b.className = cls;
    b.textContent = String(value);
    s.appendChild(b);
    s.appendChild(document.createTextNode(label));
    els.stats.appendChild(s);
  };
  mk('total', m.total, '');
  mk('done', done, 's-completed');
  mk('failed', m.failed + m['download-failed'], 's-failed');
  mk('queued', m.queued, 's-queued');
  els.stats.appendChild(progressBar(prog));
}

function progressBar(pct: number): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'progress-bar';
  const fill = document.createElement('div');
  fill.className = 'progress-fill';
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);
  return bar;
}

/* --------------------------------- render ------------------------------- */
/** Key that changes only when the visible bits of the queue actually change. */
function dirtyKey(app: AppState): string {
  const run = app.currentRun;
  const jk = run.jobs.map((j) => `${j.state}:${j.version}`).join(',');
  return `${run.jobs.length}|${jk}|${app.activeJobId}|${app.running}|${app.paused}|${search}|${filterStatus}|${Array.from(expanded).sort().join(',')}|${editingId}`;
}

function render(): void {
  try {
    const { app, status } = ui;
    const run = app?.currentRun ?? emptyUiApp().currentRun;

    els.status.textContent = status || 'Idle';
    els.status.className = 'status' + (app?.paused ? ' paused' : app?.running ? ' running' : '');

    els.runLabel.textContent = (run.jobs?.length ?? 0) ? `Run ${run.dirName} · #${run.runNumber}` : `Run ${run.dirName || 'Run-…'}`;

    const completed = (run.jobs ?? []).filter((j) => j.state === 'completed').length;
    els.queueCount.textContent = `${run.jobs?.length ?? 0} jobs · ${completed} done`;

    els.pauseBtn.disabled = !app?.running || Boolean(app?.paused);
    els.resumeBtn.disabled = !app?.paused;
    els.stopBtn.disabled = !app?.running && !app?.paused;
    els.addBtn.disabled = Boolean(app?.running && !app?.paused);

    renderStats(run);

    const key = dirtyKey(app);
    if (key !== lastDirtyKey) {
      lastDirtyKey = key;
      renderQueue(run, app?.references ?? []);
    }

    if (app?.settings) renderSettings(app.settings);
    if (app?.refresh) renderRefresh(app.refresh);
    renderRefs(app?.references ?? []);
    renderHistory(app?.history ?? []);

    els.refCount.textContent = String(app?.references?.length ?? 0);
    els.historyCount.textContent = String(app?.history?.length ?? 0);
  } catch (err) {
    console.error('Error rendering popup:', err);
  }
}

function visibleJobs(run: Run): Job[] {
  const q = search.trim().toLowerCase();
  return run.jobs.filter((j) => {
    if (filterStatus !== 'all' && j.state !== filterStatus) return false;
    if (q && !j.prompt.toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderQueue(run: Run, refs: Reference[]): void {
  const shown = visibleJobs(run);
  els.empty.style.display = run.jobs.length ? 'none' : 'block';
  els.filterEmpty.style.display = run.jobs.length && !shown.length ? 'block' : 'none';
  els.queue.textContent = '';
  for (const job of shown) els.queue.appendChild(jobRow(job, refs, run.jobs.length));
}

function renderSettings(s: GenSettings): void {
  els.setModel.value = s.model || '';
  els.setAspect.value = s.aspectRatio || '';
  els.setQuality.value = s.quality || '';
  els.setCount.value = String(s.count || 1);
  els.setVideoMode.value = s.videoMode;
  els.setDuration.value = String(s.duration || 5);
  setGenType(s.genType);
}

function renderRefresh(r: AppState['refresh']): void {
  els.refreshEnabled.checked = r.enabled;
  els.refreshInterval.value = String(r.intervalMin || 0);
  els.refreshJobs.value = String(r.afterJobs || 0);
}

function setGenType(genType: GenSettings['genType']): void {
  els.genImage.classList.toggle('active', genType === 'image');
  els.genVideo.classList.toggle('active', genType === 'video');
  els.videoSettings.classList.toggle('hidden', genType !== 'video');
}

function renderRefs(refs: Reference[]): void {
  els.refEmpty.style.display = refs.length ? 'none' : 'block';
  els.refList.textContent = '';
  for (const ref of refs) els.refList.appendChild(refCard(ref));
}

function renderHistory(runs: Run[]): void {
  els.historyEmpty.style.display = runs.length ? 'none' : 'block';
  els.historyList.textContent = '';
  if (!runs.length) return;
  const sorted = [...runs].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  for (const run of sorted) els.historyList.appendChild(runCard(run));
}

/* -------------------------------- cards -------------------------------- */
function runCard(run: Run): HTMLElement {
  const card = document.createElement('div');
  card.className = 'history-card';
  const head = document.createElement('div');
  head.className = 'history-head';
  const title = document.createElement('div');
  title.className = 'history-title';
  title.textContent = `${run.dirName} · ${run.mode}`;
  const meta = document.createElement('span');
  meta.className = 'muted';
  meta.textContent = `${run.jobs.length} job(s) · ${run.jobs.filter((j) => j.state === 'completed').length} done`;
  head.appendChild(title);
  head.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'job-actions';
  actions.appendChild(actionBtn('Open/Resume', () => void runAction({ type: 'openRun', id: run.id })));
  actions.appendChild(actionBtn('Run again', () => void runAction({ type: 'runAgain', id: run.id })));
  const del = actionBtn('Delete', () => void runAction({ type: 'deleteRun', id: run.id }));
  del.classList.add('danger');
  actions.appendChild(del);

  card.appendChild(head);
  card.appendChild(actions);
  return card;
}

function refCard(ref: Reference): HTMLElement {
  const card = document.createElement('div');
  card.className = 'ref-card';
  const preview = document.createElement('img');
  preview.className = 'ref-preview';
  preview.src = ref.dataUrl;
  preview.alt = ref.name;
  preview.title = 'Click to preview';
  preview.onclick = () => openMedia(ref.dataUrl, `@${ref.name} (${ref.category})`, 'image');
  preview.style.cursor = 'zoom-in';

  const body = document.createElement('div');
  body.className = 'ref-body';
  const name = document.createElement('div');
  name.className = 'ref-name';
  name.textContent = `@${ref.name}`;
  const cat = document.createElement('span');
  cat.className = `category cat-${ref.category.toLowerCase()}`;
  cat.textContent = ref.category;
  const del = document.createElement('button');
  del.className = 'btn small danger';
  del.textContent = 'Delete';
  del.onclick = () => void onDeleteRef(ref.id);
  body.appendChild(name);
  body.appendChild(cat);
  body.appendChild(del);

  card.appendChild(preview);
  card.appendChild(body);
  return card;
}

function jobRow(job: Job, refs: Reference[], total: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'job' + (expanded.has(job.id) ? ' expanded' : '');
  if (editingId === job.id) row.classList.add('editing');

  const prompt = document.createElement('div');
  prompt.className = 'prompt';
  if (job.name) {
    const tag = document.createElement('span');
    tag.className = 'name-tag';
    tag.textContent = `#${job.name}`;
    prompt.appendChild(tag);
    const cleanText = job.prompt
      .replace(new RegExp(`^#${job.name}\\s*`), '')
      // Strip leading timecodes (:00  :30  01:30) from shot-list formatted prompts.
      .replace(/^\s*\d{0,2}:\d{2}(:\d{2})?\s*/, '')
      .trim();
    if (cleanText.length > 0) {
      prompt.appendChild(document.createTextNode(cleanText));
    }
  } else {
    prompt.textContent = job.prompt;
  }
  if (job.refs.length) {
    const refChips = document.createElement('div');
    refChips.className = 'ref-chips';
    for (const t of job.refs) {
      const chip = document.createElement('span');
      chip.className = 'chip pointer';
      chip.textContent = `${ROLE_LABEL[t.role]}:@${t.ref.name}`;
      chip.title = 'Click to preview reference';
      chip.onclick = () => openMedia(t.ref.dataUrl, `@${t.ref.name}`, 'image');
      refChips.appendChild(chip);
    }
    prompt.appendChild(refChips);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  const badge = document.createElement('span');
  badge.className = `badge ${job.state}`;
  badge.textContent = job.version > 1 ? `${STATE_LABEL[job.state] ?? job.state} v${job.version}` : (STATE_LABEL[job.state] ?? job.state);

  const actions = document.createElement('div');
  actions.className = 'job-actions';
  const blockOrder = job.state === 'running' || job.state === 'downloading';

  if (!blockOrder) {
    const idx = allJobIndex(job, total);
    if (idx > 0) {
      const up = actionBtn('↑', () => void runAction({ type: 'moveJob', id: job.id, toIndex: findIndex(job) - 1 }));
      up.className = 'btn small reorder-btn';
      actions.appendChild(up);
    }
    if (idx >= 0 && idx < total - 1) {
      const down = actionBtn('↓', () => void runAction({ type: 'moveJob', id: job.id, toIndex: findIndex(job) + 1 }));
      down.className = 'btn small reorder-btn';
      actions.appendChild(down);
    }
    actions.appendChild(actionBtn('Dup', () => void onDuplicate(job.id)));
  }
  actions.appendChild(actionBtn(expanded.has(job.id) ? 'Hide' : 'Details', () => {
    if (expanded.has(job.id)) expanded.delete(job.id);
    else expanded.add(job.id);
    render();
  }));
  if (job.state !== 'running' && job.state !== 'downloading') {
    actions.appendChild(actionBtn(editingId === job.id ? 'Cancel' : 'Edit', () => {
      editingId = editingId === job.id ? null : job.id;
      render();
    }));
    actions.appendChild(actionBtn('Del', () => void onDelete(job.id)));
  }
  if (job.state === 'queued' || job.state === 'skipped') {
    actions.appendChild(actionBtn('Skip', () => void onSkip(job.id)));
  }
  if (job.state === 'completed' || job.state === 'download-failed' || job.state === 'failed' || job.state === 'failed-paused') {
    actions.appendChild(actionBtn('Re-gen', () => void onRegenerate(job.id)));
  }
  if (job.state === 'failed-paused' || job.state === 'download-failed' || (job.downloads && job.downloads.some((d) => d.state === 'failed'))) {
    actions.appendChild(actionBtn('Retry DL', () => void runAction({ type: 'retryJob', id: job.id })));
  }

  meta.appendChild(badge);
  if (actions.childElementCount) meta.appendChild(actions);
  row.appendChild(prompt);
  row.appendChild(meta);

  if (job.error) {
    const err = document.createElement('div');
    err.className = 'error';
    err.textContent = job.error;
    row.appendChild(err);
  }

  if (job.genSummary) {
    const gen = document.createElement('div');
    gen.className = 'gen-summary';
    gen.textContent = job.genSummary;
    row.appendChild(gen);
  }

  if (expanded.has(job.id)) row.appendChild(jobDetails(job));

  if (editingId === job.id) row.appendChild(jobEditor(job, refs));

  return row;
}

/** Index of the job in the full (unfiltered) run list. */
function findIndex(job: Job): number {
  return ui.app.currentRun.jobs.findIndex((j) => j.id === job.id);
}
function allJobIndex(job: Job, total: number): number {
  return Math.min(findIndex(job), total - 1);
}

function jobDetails(job: Job): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'detail-grid';

  detail(wrap, 'Created', new Date(job.createdAt).toLocaleString());
  if (job.startedAt) detail(wrap, 'Started', new Date(job.startedAt).toLocaleString());
  if (job.finishedAt) detail(wrap, 'Finished', new Date(job.finishedAt).toLocaleString());
  detail(wrap, 'Output name', job.name ?? 'result');
  if (job.settings) {
    const s = job.settings;
    detail(wrap, 'Override', s.genType ? `Output: ${s.genType}` : 'yes');
    if (s.count) detail(wrap, 'Count', String(s.count));
    if (s.model) detail(wrap, 'Model', s.model);
  }

  const thumbs = document.createElement('div');
  thumbs.className = 'preview-thumbs';
  const refs = job.refs.filter((t) => t.ref.dataUrl);
  for (const t of refs) {
    const img = document.createElement('img');
    img.className = 'thumb';
    img.src = t.ref.dataUrl;
    img.alt = t.ref.name;
    img.title = `${ROLE_LABEL[t.role]}: @${t.ref.name} — click to preview`;
    img.onclick = () => openMedia(t.ref.dataUrl, `${ROLE_LABEL[t.role]}: @${t.ref.name}`, 'image');
    const cell = document.createElement('div');
    cell.style.display = 'flex';
    cell.style.flexDirection = 'column';
    cell.appendChild(img);
    const tag = document.createElement('span');
    tag.className = 'thumb-tag';
    tag.textContent = `${ROLE_LABEL[t.role]}:${t.ref.name}`;
    cell.appendChild(tag);
    thumbs.appendChild(cell);
  }

  if (job.downloads.length) {
    detail(wrap, 'Downloads', `${job.downloads.filter((d) => d.state === 'completed').length}/${job.downloads.length}`);
    const dlList = document.createElement('div');
    dlList.className = 'dl-list';
    dlList.style.gridColumn = '1 / -1';
    for (const d of job.downloads) {
      const line = document.createElement('div');
      line.className = `dl-item ${d.state}`;
      const fname = document.createElement('span');
      fname.className = 'dl-name';
      fname.textContent = `v${d.version} ${d.fileName}`;
      const st = document.createElement('span');
      st.className = 'dl-state';
      st.textContent = d.state === 'completed' ? 'downloaded' : d.state + (d.error ? ` — ${d.error}` : '');
      if (d.localPath) st.textContent += ` → ${d.localPath}`;
      line.appendChild(fname);
      line.appendChild(st);
      dlList.appendChild(line);
    }
    wrap.appendChild(dlList);
  }

  if (thumbs.childElementCount) wrap.appendChild(thumbs);
  return wrap;
}

function detail(parent: HTMLElement, k: string, v: string): void {
  const item = document.createElement('div');
  item.className = 'detail-item';
  const key = document.createElement('div');
  key.className = 'k';
  key.textContent = k;
  const val = document.createElement('div');
  val.textContent = v;
  item.appendChild(key);
  item.appendChild(val);
  parent.appendChild(item);
}

function actionBtn(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.className = 'btn small';
  b.onclick = () => onClick();
  return b;
}

/* ----------------------------- job editor ------------------------------ */
function jobEditor(job: Job, refs: Reference[]): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'job-editor';

  const overrideBox = document.createElement('input');
  overrideBox.type = 'checkbox';
  const overrideLabel = document.createElement('label');
  overrideLabel.className = 'field-label row-inline';
  overrideLabel.appendChild(overrideBox);
  overrideLabel.appendChild(document.createTextNode('Override generation settings'));

  const promptLabel = document.createElement('label');
  promptLabel.className = 'field-label';
  promptLabel.textContent = 'Prompt';
  const promptArea = document.createElement('textarea');
  promptArea.value = job.prompt;

  const ovr = { ...emptySettings(), ...(job.settings ?? {}) };
  const modeSel = buildSelect('Output', { image: 'Image', video: 'Video' }, ovr.genType);
  const model = buildText('Model', ovr.model);
  const aspect = buildText('Aspect ratio', ovr.aspectRatio);
  const count = buildNum('Count', ovr.count);
  const quality = buildText('Quality', ovr.quality);
  const vmode = buildSelect('Video mode', { 'text-to-video': 'Text to video', 'start-frame': 'Start frame', 'start-end-frame': 'Start + End', reference: 'Reference' }, ovr.videoMode);
  const duration = buildNum('Duration (s)', ovr.duration);

  const videoWrap = document.createElement('div');
  videoWrap.className = 'video-settings';
  videoWrap.appendChild(vmode.wrap);
  videoWrap.appendChild(duration.wrap);

  const refsWrap = document.createElement('div');
  refsWrap.className = 'ref-picker';
  const refsLabel = document.createElement('div');
  refsLabel.className = 'field-label';
  refsLabel.textContent = 'References (checked + role)';
  refsWrap.appendChild(refsLabel);
  if (refs.length === 0) {
    const none = document.createElement('span');
    none.className = 'muted';
    none.textContent = 'No references yet. Add them in the References tab.';
    refsWrap.appendChild(none);
  } else {
    for (const ref of refs) {
      const existing = job.refs.find((t) => t.ref.id === ref.id);
      const line = document.createElement('div');
      line.className = 'ref-picker-line';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = ref.id;
      box.checked = !!existing;
      const roleSel = document.createElement('select');
      (['reference', 'start', 'end'] as RefRole[]).forEach((role) => {
        const o = document.createElement('option');
        o.value = role;
        o.textContent = ROLE_LABEL[role];
        roleSel.appendChild(o);
      });
      roleSel.value = existing?.role ?? 'reference';
      roleSel.disabled = !existing;
      box.onchange = () => { roleSel.disabled = !box.checked; };
      line.appendChild(box);
      line.appendChild(roleSel);
      line.appendChild(document.createTextNode(`@${ref.name} (${ref.category})`));
      refsWrap.appendChild(line);
    }
  }

  const buttons = document.createElement('div');
  buttons.className = 'row';
  const save = document.createElement('button');
  save.className = 'btn primary';
  save.textContent = 'Save';
  save.onclick = () => {
    const settings = overrideBox.checked
      ? {
          genType: modeSel.control.value as GenSettings['genType'],
          model: model.control.value,
          aspectRatio: aspect.control.value,
          count: Number(count.control.value) || 1,
          quality: quality.control.value,
          videoMode: vmode.control.value as VideoMode,
          duration: Number(duration.control.value) || 5,
        }
      : undefined;
    const chosen: TaggedRef[] = Array.from(refsWrap.querySelectorAll<HTMLDivElement>('.ref-picker-line'))
      .filter((line) => line.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked)
      .map((line) => {
        const box = line.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
        const role = line.querySelector<HTMLSelectElement>('select')!.value as RefRole;
        const ref = refs.find((r) => r.id === box.value)!;
        return { role, ref };
      });
    void (async () => {
      await send({ type: 'updateJob', id: job.id, prompt: promptArea.value, settings, refs: chosen });
      editingId = null;
      await pullState();
    })();
  };
  const cancel = document.createElement('button');
  cancel.className = 'btn';
  cancel.textContent = 'Cancel';
  cancel.onclick = () => { editingId = null; render(); };
  buttons.appendChild(save);
  buttons.appendChild(cancel);

  panel.appendChild(overrideLabel);
  panel.appendChild(promptLabel);
  panel.appendChild(promptArea);
  panel.appendChild(modeSel.wrap);
  panel.appendChild(model.wrap);
  panel.appendChild(aspect.wrap);
  panel.appendChild(count.wrap);
  panel.appendChild(quality.wrap);
  panel.appendChild(videoWrap);
  panel.appendChild(refsWrap);
  panel.appendChild(buttons);
  return panel;
}

function buildField(labelText: string): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const label = document.createElement('span');
  label.className = 'field-label';
  label.textContent = labelText;
  wrap.appendChild(label);
  return wrap;
}
function buildText(labelText: string, value: string): { control: HTMLInputElement; wrap: HTMLElement } {
  const wrap = buildField(labelText);
  const control = document.createElement('input');
  control.type = 'text';
  control.value = value;
  wrap.appendChild(control);
  return { control, wrap };
}
function buildNum(labelText: string, value: number): { control: HTMLInputElement; wrap: HTMLElement } {
  const wrap = buildField(labelText);
  const control = document.createElement('input');
  control.type = 'number';
  control.min = '1';
  control.value = String(value);
  wrap.appendChild(control);
  return { control, wrap };
}
function buildSelect(labelText: string, options: Record<string, string>, value: string): { control: HTMLSelectElement; wrap: HTMLElement } {
  const wrap = buildField(labelText);
  const control = document.createElement('select');
  for (const [k, v] of Object.entries(options)) {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = v;
    control.appendChild(o);
  }
  control.value = value;
  wrap.appendChild(control);
  return { control, wrap };
}

/* ----------------------------- preview modal --------------------------- */
function openMedia(src: string, caption: string, kind: 'image' | 'video'): void {
  els.modalBody.textContent = '';
  const media = document.createElement(kind === 'image' ? 'img' : 'video');
  if (kind === 'video') {
    (media as HTMLVideoElement).controls = true;
    (media as HTMLVideoElement).src = src;
  } else {
    (media as HTMLImageElement).src = src;
    (media as HTMLImageElement).alt = caption;
  }
  const cap = document.createElement('div');
  cap.className = 'modal-caption';
  cap.textContent = caption;
  const close = document.createElement('button');
  close.className = 'btn modal-close';
  close.textContent = '✕';
  close.onclick = closeModal;
  els.modalBody.appendChild(close);
  els.modalBody.appendChild(media);
  els.modalBody.appendChild(cap);
  els.modal.classList.remove('hidden');
}
function closeModal(): void {
  els.modalBody.textContent = '';
  els.modal.classList.add('hidden');
}

/* ------------------------------ handlers ------------------------------- */
async function onDelete(id: string): Promise<void> { await send({ type: 'delete', id }); await pullState(); }
async function onSkip(id: string): Promise<void> { await send({ type: 'skip', id }); await pullState(); }
async function onDuplicate(id: string): Promise<void> { await send({ type: 'duplicateJob', id }); await pullState(); }
async function onRegenerate(id: string): Promise<void> { await send({ type: 'regenerate', id }); await pullState(); }
async function onRetryDownloads(): Promise<void> { await send({ type: 'retryDownloads' }); await pullState(); }
async function onDeleteRef(id: string): Promise<void> { await send({ type: 'deleteReference', id }); await pullState(); }

async function pullState(): Promise<void> {
  ui = await send({ type: 'state' });
  render();
}

function wireControls(): void {
  els.tabs.forEach((tab) => {
    tab.onclick = () => switchTab(tab.dataset.tab ?? 'queue');
  });
  els.addBtn.onclick = () => void addPrompts();
  els.startBtn.onclick = () => void runAction({ type: 'start' });
  els.pauseBtn.onclick = () => void runAction({ type: 'pause' });
  els.resumeBtn.onclick = () => void runAction({ type: 'resume' });
  els.stopBtn.onclick = () => void runAction({ type: 'stop' });
  els.clearBtn.onclick = () => void runAction({ type: 'clearCurrent' });
  els.retryBtn.onclick = () => void (async () => {
    await send({ type: 'retryFailed' });
    await send({ type: 'start' });
    await pullState();
  })();
  els.redlBtn.onclick = () => void (async () => {
    await send({ type: 'retryDownloads' });
    await send({ type: 'start' });
    await pullState();
  })();

  els.search.oninput = () => { search = els.search.value; render(); };
  els.filterStatus.onchange = () => { filterStatus = els.filterStatus.value; render(); };

  els.importFile.onchange = () => void onImport();
  els.refFile.onchange = () => void onRefUpload();
  els.genImage.onclick = () => setGenType('image');
  els.genVideo.onclick = () => setGenType('video');
  els.saveSettings.onclick = () => void saveSettings();
  els.saveRefresh.onclick = () => void saveRefresh();
  els.modalBackdrop.onclick = closeModal;
}

function switchTab(name: string): void {
  els.tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  (Object.keys(els.panels) as (keyof typeof els.panels)[]).forEach((key) => {
    els.panels[key].classList.toggle('active', key === name);
  });
}

async function runAction(action: Action): Promise<void> { await send(action); await pullState(); }

async function addPrompts(): Promise<void> {
  const text = els.promptInput.value;
  if (!text.trim()) return;
  await send({ type: 'add', prompts: [text] });
  els.promptInput.value = '';
  await pullState();
}

async function onImport(): Promise<void> {
  const file = els.importFile.files?.[0];
  if (!file) return;
  const text = await file.text();
  await send({ type: 'add', prompts: [text] });
  els.importFile.value = '';
  await pullState();
}

async function onRefUpload(): Promise<void> {
  const file = els.refFile.files?.[0];
  if (!file) return;
  const name = (els.refName.value || file.name.replace(/\.[^.]+$/, '')).trim();
  const category = els.refCategory.value as RefCategory;
  const dataUrl = await readFileAsDataUrl(file);
  const reference: Reference = { id: refId(), name, category, dataUrl, createdAt: Date.now() };
  await send({ type: 'addReference', reference });
  els.refFile.value = '';
  els.refName.value = '';
  await pullState();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function saveSettings(): Promise<void> {
  const settings: GenSettings = {
    genType: els.genImage.classList.contains('active') ? 'image' : 'video',
    model: els.setModel.value.trim(),
    aspectRatio: els.setAspect.value.trim(),
    count: Number(els.setCount.value) || 1,
    quality: els.setQuality.value.trim(),
    videoMode: els.setVideoMode.value as VideoMode,
    duration: Number(els.setDuration.value) || 5,
  };
  await send({ type: 'setSettings', settings });
  await pullState();
}

async function saveRefresh(): Promise<void> {
  await send({
    type: 'setRefresh',
    refresh: {
      enabled: els.refreshEnabled.checked,
      intervalMin: Number(els.refreshInterval.value) || 0,
      afterJobs: Number(els.refreshJobs.value) || 0,
    },
  });
  await pullState();
}

chrome.runtime.onMessage.addListener((msg: OutboundMessage) => {
  if (msg?.kind === 'state') {
    ui = { app: msg.app, status: msg.status };
    render();
  }
});

wireControls();
void pullState();
