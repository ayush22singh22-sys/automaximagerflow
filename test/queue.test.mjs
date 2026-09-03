import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduceApp, resolveSettings, archiveRun, newRun } from '../dist/app.js';
import { normalizeApp } from '../dist/storage.js';
import {
  sanitizeFileName,
  parseNameToken,
  cleanPrompt,
  resolvePromptRefs,
  jobBaseName,
  outputFileName,
  outputPath,
  runDirName,
  pad3,
  extFor,
} from '../dist/naming.js';
import { defaultSettings, refId } from '../dist/types.js';

function freshApp() {
  return normalizeApp(undefined);
}

const REF = () => ({
  id: refId(),
  name: 'john',
  category: 'Subject',
  dataUrl: 'data:image/png;base64,AAAA',
  createdAt: 1,
});

test('add splits multi-line text into queued jobs with resolved tagged refs', () => {
  const app = freshApp();
  const ref = REF();
  app.references = [ref];
  reduceApp(app, { type: 'add', prompts: ['@john walking\n  through  \n\ncity'] });

  const run = app.currentRun;
  assert.equal(run.jobs.length, 3);
  assert.deepEqual(run.jobs.map((j) => j.prompt), ['@john walking', 'through', 'city']);
  assert.equal(run.jobs[0].refs.length, 1);
  assert.equal(run.jobs[0].refs[0].ref.id, ref.id);
  assert.equal(run.jobs[0].refs[0].role, 'reference');
  assert.equal(run.jobs[1].refs.length, 0);
});

test('add parses #name and role-tagged references', () => {
  const app = freshApp();
  const start = REF();
  const end = REF();
  end.id = 'e1';
  end.name = 'red';
  app.references = [start, end];
  reduceApp(app, { type: 'add', prompts: ['#robot @start:john @end:red make it fly'] });
  const job = app.currentRun.jobs[0];
  assert.equal(job.name, 'robot');
  assert.equal(job.refs.length, 2);
  const byRole = Object.fromEntries(job.refs.map((t) => [t.role, t.ref.name]));
  assert.equal(byRole['start'], 'john');
  assert.equal(byRole['end'], 'red');
});

test('add merges standalone #name on its own line with prompt text into single job block', () => {
  const app = freshApp();
  reduceApp(app, {
    type: 'add',
    prompts: ['#3-00\nmedium-wide shot, prehistoric human sleeping deeply\n\n#3-01\nanother prompt here'],
  });
  assert.equal(app.currentRun.jobs.length, 2);
  assert.equal(app.currentRun.jobs[0].name, '3-00');
  assert.equal(app.currentRun.jobs[0].prompt, '#3-00 medium-wide shot, prehistoric human sleeping deeply');
  assert.equal(app.currentRun.jobs[1].name, '3-01');
  assert.equal(app.currentRun.jobs[1].prompt, '#3-01 another prompt here');
});

test('cleanPrompt strips # and @ tokens normalized to spaces', () => {
  assert.equal(cleanPrompt('@start:john @end:red #robot make it fly'), 'make it fly');
  assert.equal(cleanPrompt('@a  @b  hello'), 'hello');
  assert.equal(cleanPrompt('plain'), 'plain');
});

test('resolvePromptRefs maps roles and flags unresolved names', () => {
  const refs = [REF()];
  const { tagged, unresolved } = resolvePromptRefs('@start:john @end:nope walk', refs);
  assert.equal(tagged.length, 1);
  assert.equal(tagged[0].role, 'start');
  assert.deepEqual(unresolved, ['nope']);
});

test('start/pause/resume lifecycle', () => {
  const app = freshApp();
  reduceApp(app, { type: 'add', prompts: ['x'] });
  reduceApp(app, { type: 'start' });
  assert.equal(app.running, true);
  reduceApp(app, { type: 'pause' });
  assert.equal(app.paused, true);
  reduceApp(app, { type: 'resume' });
  assert.equal(app.paused, false);
  assert.equal(app.running, true);
});

test('stop returns a running job to queued and clears active', () => {
  const app = freshApp();
  const date = app.currentRun;
  date.jobs = [{ id: 'a', prompt: 'p', state: 'running', createdAt: 1, refs: [], version: 1, downloads: [], startedAt: 9 }];
  app.running = true;
  app.activeJobId = 'a';
  reduceApp(app, { type: 'stop' });
  assert.equal(app.running, false);
  assert.equal(app.activeJobId, null);
  assert.equal(app.currentRun.jobs[0].state, 'queued');
  assert.equal(app.currentRun.jobs[0].startedAt, undefined);
});

test('retryFailed requeues only failed jobs', () => {
  const app = freshApp();
  app.currentRun.jobs = [
    { id: 'a', prompt: 'p', state: 'failed', error: 'e', createdAt: 1, refs: [], version: 1, downloads: [] },
    { id: 'b', prompt: 'p', state: 'completed', createdAt: 1, refs: [], version: 1, downloads: [] },
    { id: 'c', prompt: 'p', state: 'failed', createdAt: 1, refs: [], version: 1, downloads: [] },
  ];
  reduceApp(app, { type: 'retryFailed' });
  const byId = Object.fromEntries(app.currentRun.jobs.map((j) => [j.id, j.state]));
  assert.equal(byId['a'], 'queued');
  assert.equal(byId['c'], 'queued');
  assert.equal(byId['b'], 'completed');
  assert.equal(app.currentRun.jobs[0].error, undefined);
});

test('retryDownloads re-queues download-failed jobs', () => {
  const app = freshApp();
  app.currentRun.jobs = [
    {
      id: 'a',
      prompt: 'p',
      state: 'download-failed',
      createdAt: 1,
      refs: [],
      version: 1,
      downloads: [{ url: 'http://x/1.png', fileName: '001-result.png', state: 'failed', attempt: 1, version: 1 }],
    },
  ];
  reduceApp(app, { type: 'retryDownloads' });
  const job = app.currentRun.jobs[0];
  assert.equal(job.state, 'downloading');
  assert.equal(job.downloads[0].state, 'pending');
});

test('regenerate preserves prior metadata and bumps version', () => {
  const app = freshApp();
  app.currentRun.jobs = [
    {
      id: 'a',
      prompt: 'p',
      state: 'completed',
      createdAt: 1,
      refs: [],
      version: 1,
      downloads: [{ url: 'http://x/1.png', fileName: '001-result.png', state: 'completed', attempt: 1, version: 1, localPath: '/d/1.png' }],
    },
  ];
  reduceApp(app, { type: 'regenerate', id: 'a' });
  const job = app.currentRun.jobs[0];
  assert.equal(job.state, 'queued');
  assert.equal(job.version, 2);
  assert.equal(job.downloads.length, 0);
  assert.equal(job.regenArchive.length, 1);
  assert.equal(job.regenArchive[0].fileName, '001-result.png');
});

test('skip only marks queued jobs as skipped', () => {
  const app = freshApp();
  reduceApp(app, { type: 'add', prompts: ['x'] });
  reduceApp(app, { type: 'skip', id: app.currentRun.jobs[0].id });
  assert.equal(app.currentRun.jobs[0].state, 'skipped');
});

test('delete removes job and clears active reference', () => {
  const app = freshApp();
  app.currentRun.jobs = [
    { id: 'a', prompt: 'p', state: 'queued', createdAt: 1, refs: [], version: 1, downloads: [] },
    { id: 'b', prompt: 'p', state: 'queued', createdAt: 1, refs: [], version: 1, downloads: [] },
  ];
  app.activeJobId = 'a';
  reduceApp(app, { type: 'delete', id: 'a' });
  assert.equal(app.currentRun.jobs.length, 1);
  assert.equal(app.activeJobId, null);
});

test('updateJob edits prompt, settings, and refs on a non-running job', () => {
  const app = freshApp();
  const ref = REF();
  app.currentRun.jobs = [{ id: 'a', prompt: 'p', state: 'queued', createdAt: 1, refs: [], version: 1, downloads: [] }];
  reduceApp(app, { type: 'updateJob', id: 'a', prompt: 'new prompt', settings: { count: 4 }, refs: [{ role: 'reference', ref }] });
  assert.equal(app.currentRun.jobs[0].prompt, 'new prompt');
  assert.equal(app.currentRun.jobs[0].settings.count, 4);
  assert.equal(app.currentRun.jobs[0].refs.length, 1);
});

test('updateJob does not touch a running job', () => {
  const app = freshApp();
  app.currentRun.jobs = [{ id: 'a', prompt: 'p', state: 'running', createdAt: 1, refs: [], version: 1, downloads: [] }];
  reduceApp(app, { type: 'updateJob', id: 'a', prompt: 'ignored', settings: { count: 99 } });
  assert.equal(app.currentRun.jobs[0].prompt, 'p');
  assert.equal(app.currentRun.jobs[0].settings, undefined);
});

test('setSettings replaces global settings while keeping defaults', () => {
  const app = freshApp();
  reduceApp(app, { type: 'setSettings', settings: { genType: 'video', model: 'Veo', videoMode: 'start-frame', duration: 8, aspectRatio: '9:16', count: 2, quality: 'Ultra' } });
  assert.equal(app.settings.genType, 'video');
  assert.equal(app.settings.model, 'Veo');
  assert.equal(app.settings.videoMode, 'start-frame');
  assert.equal(app.settings.duration, 8);
});

test('resolveSettings merges a partial override onto globals', () => {
  const g = defaultSettings();
  const merged = resolveSettings(g, { count: 3, model: 'Custom' });
  assert.equal(merged.count, 3);
  assert.equal(merged.model, 'Custom');
  assert.equal(merged.genType, 'image');
});

test('addReference de-dupes by id; deleteReference removes from refs and jobs', () => {
  const app = freshApp();
  const ref = REF();
  reduceApp(app, { type: 'addReference', reference: ref });
  assert.equal(app.references.length, 1);
  reduceApp(app, { type: 'addReference', reference: { ...ref, name: 'sky2' } });
  assert.equal(app.references.length, 1);

  app.currentRun.jobs = [{ id: 'a', prompt: 'p', state: 'queued', createdAt: 1, refs: [{ role: 'reference', ref }], version: 1, downloads: [] }];
  reduceApp(app, { type: 'deleteReference', id: ref.id });
  assert.equal(app.references.length, 0);
  assert.equal(app.currentRun.jobs[0].refs.length, 0);
});

test('archiveRun caps history at 10 per mode', () => {
  const app = freshApp();
  app.settings = defaultSettings('image');
  for (let n = 1; n <= 12; n += 1) {
    const run = newRun(n, defaultSettings('image'));
    run.createdAt = n;
    run.jobs = [{ id: `j${n}`, prompt: 'p', state: 'completed', createdAt: n, refs: [], version: 1, downloads: [] }];
    archiveRun(app, run);
  }
  assert.equal(app.history.length, 10);
  const remaining = app.history.map((r) => r.runNumber).sort((a, b) => a - b);
  assert.deepEqual(remaining, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test('runAgain clones jobs as fresh queued into a new run', () => {
  const app = freshApp();
  const done = newRun(1, defaultSettings('image'));
  done.jobs = [{ id: 'j1', prompt: 'p', state: 'completed', createdAt: 2, refs: [], version: 2, downloads: [], name: 'robot' }];
  archiveRun(app, done);

  reduceApp(app, { type: 'runAgain', id: done.id });
  const fresh = app.currentRun;
  assert.notEqual(fresh.id, done.id);
  assert.equal(fresh.runNumber, 2);
  assert.equal(fresh.jobs.length, 1);
  assert.equal(fresh.jobs[0].state, 'queued');
  assert.equal(fresh.jobs[0].version, 1);
  assert.equal(fresh.jobs[0].downloads.length, 0);
  // Original stays in history.
  assert.equal(app.history.length, 1);
});

test('openRun moves a history run into current without duplicating', () => {
  const app = freshApp();
  const done = newRun(1, defaultSettings('image'));
  done.jobs = [{ id: 'j1', prompt: 'p', state: 'completed', createdAt: 2, refs: [], version: 1, downloads: [] }];
  archiveRun(app, done);

  reduceApp(app, { type: 'openRun', id: done.id });
  assert.equal(app.currentRun.id, done.id);
  assert.equal(app.currentRun.jobs[0].state, 'completed');
  assert.equal(app.history.length, 0);
});

test('deleteRun removes from history', () => {
  const app = freshApp();
  const done = newRun(1, defaultSettings('image'));
  archiveRun(app, done);
  reduceApp(app, { type: 'deleteRun', id: done.id });
  assert.equal(app.history.length, 0);
});

test('normalizeApp ensures a coherent run and collision-free numbering', () => {
  const app = normalizeApp({
    nextRunNumber: 5,
    currentRun: { ...newRun(2, defaultSettings()), jobs: [] },
    history: [newRun(3, defaultSettings('image')), newRun(4, defaultSettings('image'))],
    settings: defaultSettings(),
    references: [],
  });
  // 2,3,4 used -> next available is 5.
  assert.equal(app.currentRun.runNumber, 2);
  assert.ok(app.nextRunNumber >= 5);
});

test('naming: filenames and paths', () => {
  assert.equal(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
  assert.equal(sanitizeFileName('..'), 'result');
  assert.equal(sanitizeFileName('  '), 'result');
  assert.equal(parseNameToken('hello #robot world'), 'robot');
  assert.equal(parseNameToken('no token'), null);
  assert.equal(jobBaseName(undefined), 'result');
  assert.equal(jobBaseName('robot'), 'robot');
  assert.equal(outputFileName('image', 'robot', 1, 1), '001-robot.png');
  assert.equal(outputFileName('image', 'robot', 1, 1, 2), '001-robot-2.png');
  assert.equal(outputFileName('video', 'robot', 2, 2), '002-robot-v2.mp4');
  assert.equal(outputFileName('image', 'scene', 3, 1), '003-scene.png');
  assert.equal(pad3(7), '007');
  assert.equal(extFor('video'), '.mp4');
  const dir = runDirName(42);
  assert.match(dir, /^Run-\d{4}-\d{2}-\d{2}-042$/);
  assert.equal(outputPath(dir, '001-robot.png'), `TryAIToday/${dir}/001-robot.png`);
});

test('duplicateJob inserts a fresh queued copy after the source', () => {
  const app = freshApp();
  app.currentRun.jobs = [
    { id: 'a', prompt: 'p1', state: 'queued', createdAt: 1, refs: [], version: 1, downloads: [] },
    { id: 'b', prompt: 'p2', state: 'queued', createdAt: 1, refs: [], version: 1, downloads: [] },
  ];
  reduceApp(app, { type: 'duplicateJob', id: 'a' });
  assert.equal(app.currentRun.jobs.length, 3);
  assert.equal(app.currentRun.jobs[1].id !== 'a', true);
  assert.equal(app.currentRun.jobs[1].prompt, 'p1');
  assert.equal(app.currentRun.jobs[1].state, 'queued');
});

test('moveJob reorders jobs within the run', () => {
  const app = freshApp();
  app.currentRun.jobs = [
    { id: 'a', prompt: 'p1', state: 'queued', createdAt: 1, refs: [], version: 1, downloads: [] },
    { id: 'b', prompt: 'p2', state: 'queued', createdAt: 1, refs: [], version: 1, downloads: [] },
    { id: 'c', prompt: 'p3', state: 'queued', createdAt: 1, refs: [], version: 1, downloads: [] },
  ];
  reduceApp(app, { type: 'moveJob', id: 'c', toIndex: 0 });
  assert.deepEqual(app.currentRun.jobs.map((j) => j.id), ['c', 'a', 'b']);
  // Out-of-range is clamped.
  reduceApp(app, { type: 'moveJob', id: 'a', toIndex: 99 });
  assert.deepEqual(app.currentRun.jobs.map((j) => j.id), ['c', 'b', 'a']);
});

test('setRefresh stores refresh settings and refresh normalization adds defaults', () => {
  const app = freshApp();
  assert.equal(app.refresh.enabled, false);
  reduceApp(app, { type: 'setRefresh', refresh: { enabled: true, intervalMin: 30, afterJobs: 5 } });
  assert.equal(app.refresh.enabled, true);
  assert.equal(app.refresh.intervalMin, 30);
  assert.equal(app.refresh.afterJobs, 5);
  // Negative/NaN coerced to 0.
  reduceApp(app, { type: 'setRefresh', refresh: { enabled: true, intervalMin: -5, afterJobs: NaN } });
  assert.equal(app.refresh.intervalMin, 0);
  assert.equal(app.refresh.afterJobs, 0);
});

test('setRunDirName updates project folder name with sanitization', () => {
  const app = freshApp();
  assert.match(app.currentRun.dirName, /^Run-\d{4}-\d{2}-\d{2}-001$/);
  reduceApp(app, { type: 'setRunDirName', dirName: 'My Awesome Project: 2026' });
  assert.equal(app.currentRun.dirName, 'My Awesome Project_ 2026');
  assert.equal(outputPath(app.currentRun.dirName, '001-result.png'), 'TryAIToday/My Awesome Project_ 2026/001-result.png');
});

