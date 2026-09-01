# TryAIToday Automator (Local)

A **local-only** Chrome/Chromium extension that turns pasted/imported prompts
into a queue, drives each one through your **already-open Google Flow**
browser session (generate → detect → download), and organizes the results into
folders with predictable, `#name`-based filenames.

- No authentication, login, signup, accounts, subscriptions, licensing, or API
  keys.
- No backend, no cloud database, no telemetry. Prompts, settings, and
  **reference images stay on your machine**.
- You log into Google Flow **normally** yourself; the extension drives that
  existing session locally via a content script.

---

## 1. Requirements

- **Node.js 18+** (developed/tested on Node 24) with `npm`, used only for the
  build tooling (TypeScript, ESLint). Not needed to *run* the extension.
- A Chromium-family browser that supports **Manifest V3** and the
  **Downloads API** (Chrome, Edge, or Brave).
- A real, logged-in **Google Flow** session (`https://flow.google.com` or
  `https://labs.google/fx/tools/flow`). The extension cannot generate
  anything by itself — it automates the open Flow tab.
- The extension is loaded **unpacked** (Developer mode).

---

## 2. Installation using Load unpacked

1. Clone/open this project and install the dev tooling once:
   ```bash
   npm install
   ```
2. Build the extension:
   ```bash
   npm run build      # compiles TypeScript → dist/ and copies assets
   ```
3. In Chrome, open `chrome://extensions`.
4. Turn on **Developer mode** (top-right toggle).
5. Click **Load unpacked** and select the **`dist`** folder in this project.
6. The **TryAIToday Automator** extension appears (toolbar icon).

> After changing source, rerun `npm run build` and click the **reload ↻**
> button on the extension card in `chrome://extensions` to pick up changes.

---

## 3. How to build

```bash
npm install        # one-time: dev tooling
npm run build      # compile TypeScript → dist/ (also copies manifest/html/css)
npm run typecheck  # TypeScript type checking
npm run lint       # ESLint
npm test           # unit tests (builds first)
```

`npm run build` produces a ready-to-load extension in **`dist/`** — this is the
folder you point "Load unpacked" at.

---

## 4. How to use

1. **Open and log into Flow** in a normal Chrome tab
   (`https://flow.google.com` or `https://labs.google/fx/tools/flow`). **Leave
   the tab open** and pinned if possible.
2. Open the extension popup (toolbar icon).
3. **Settings tab** — choose **Image** or **Video**, set global defaults
   (Model, Aspect ratio, Count, Quality; Video also: Video mode, Duration),
   and click **Save global settings**.
4. **(Optional) Flow refresh** — enable **Refresh Flow periodically** with an
   interval (minutes) and/or "after N jobs" to keep the session healthy. A
   refresh only ever runs **between** jobs (never mid-generation), saves the
   queue first, reloads Flow, waits for it, reconnects, and resumes.
5. **References tab** — upload images, name them (this is their `@name`), and
   categorize as Subject / Scene / Style. Everything stays local.
6. **Queue tab** — paste prompts (one per line) and click **Add to queue**, or
   click **Import .txt**.
7. Use prompt tokens:
   - `#name` → output filename base (e.g. `#robot-scene` → `001-robot-scene.png`).
   - `@name` → attach a local reference (role: reference).
   - `@start:name` / `@end:name` / `@reference:name` → attach with an explicit
     Flow role (start frame, end frame, reference).
8. Per job: **Details** (full info + reference thumbnails + download records),
   **Edit** (change prompt, toggle per-job settings override, attach
   references with roles), **Dup** (duplicate), **↑/↓** (reorder), **Skip**,
   **Del**, **Re-gen** (regenerate as `-v2`, `-v3`, … without overwriting
   previous results), **Retry DL** (re-download failed files).
9. **Search** jobs and **filter by status** using the bar above the queue.
10. Click **Start**. The engine drives the next job through Flow:
    `queued → running (generate) → downloading → completed`, reporting
    failures honestly. Watch live **progress statistics**.
11. Control the run with **Pause / Resume / Stop / Retry failed / Retry
    downloads / New run**.
12. **History tab** — finished runs (latest 10 per type). **Open/Resume**,
    **Run again** (a brand-new run folder, no overwriting), or **Delete**.

**Output locations:** results download into
`Downloads/TryAIToday/Run-YYYY-MM-DD-NNN/` with names like
`001-robot-scene.png` (images) or `002-scene-v2.mp4` (videos). Regenerated
versions append `-v2`, `-v3`, … and never overwrite earlier files. Collisions
are additionally guarded by Chrome's `uniquify` conflict action.

---

## 5. How to keep Flow open

The queue **keeps running even when the popup is closed** — the work is done
by the background service worker, not the popup. Everything important is
persisted to `chrome.storage.local`, and a lightweight `chrome.alarms`
heartbeat keeps the engine moving after service-worker restarts.

- **Leave the Flow tab open** while the queue runs. The engine targets one
  controlled Flow tab; if it can't find one it marks the next job `failed`
  with a clear message rather than guessing.
- If the Flow tab **reloads or closes**, the background detects it via
  `chrome.tabs` events, safely un-sticks the interrupted job (generation →
  `failed`, download → `download-failed`), and resumes the rest of the queue.
- After a reload, the background **reconnects** to the content script (ping)
  automatically and continues.
- Keep using "Refresh Flow periodically" for long queues to avoid stale
  sessions.

---

## 6. Known limitations

- **Flow selectors are best-effort and unverified.** Flow is a private,
  frequently-redesigned Labs app. The selectors in
  `src/content/selectors.ts` are centralised (⭐ single place to update) and
  tried in order, but they can't be verified without a live logged-in session.
- **Blob: URLs can't be downloaded by `chrome.downloads.download`.** If Flow
  only exposes results as page-scoped `blob:` URLs, the job is marked
  `download-failed` honestly (never faked as success) so you can grab it
  manually.
- **Downloading requires `http(s)`/`data:` URLs.** Results must expose a
  real, download-able URL for the automatic organized download to work.
- Settings application is best-effort: whatever couldn't be found on the page
  is reported as **skipped** (visible per job), not silently ignored.
- The engine uses **one controlled Flow tab**. It doesn't parallelise across
  multiple tabs.
- Generation completion is detected by polling the Flow DOM for a result
  element. If Flow's markup changes, detection may fail until selectors are
  updated.
- Reference images are stored as data URLs in local storage; very large
  libraries consume local-storage quota (Chrome's default ~5–10 MB per origin).

---

## 7. Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| "No Google Flow page found open" | Open and log into Flow in a normal tab, then **Start** again. |
| "Could not reach the Flow content script" | Flow tab just reloaded or content script not ready. Reload the Flow tab (Ctrl+Shift+R), then **Start** / **Retry**. |
| Job stuck on `running` after a reload | The tab event handler un-sticks it (marked `failed`). Use **Retry failed**. |
| "Flow reported a generation failure" / job `failed` | Flow itself errored for that prompt; check the Flow page. Use **Retry failed** or edit the prompt. |
| A setting was "skipped" | The setting control wasn't found on the page. Update it manually in Flow or tune the selector (see below). |
| Job `download-failed` | The result URL couldn't be downloaded (common with `blob:` URLs). Download it manually from Flow, or use **Retry DL** for transient failures. |
| Results not detected | Flow changed its DOM. Inspect the page with DevTools and update the selectors, then rebuild and reload. |
| Queue didn't resume after browser restart | It should — state persists and recovers on startup. If not, open the popup and **Start**; completed jobs are never re-run. |
| "Storage error" / odd state | `chrome.storage.local` quota blown (very large reference library). Remove unused references. |

### Tuning the Flow selectors

1. Log into Flow, open DevTools, and find stable hooks (`data-testid`,
   `aria-label`, `role`) for: prompt box, generate action, progress/failure
   indicator, result element, Image/Video tabs, video-mode options, model /
   aspect / count / quality / duration controls, and the reference /
   start-frame / end-frame upload inputs.
2. Add them as the **first** entries in the corresponding arrays in
   `src/content/selectors.ts` (a `downloadButton`/`downloadWithin` set is used
   to collect real result URLs for download).
3. `npm run build` and reload the extension.

---

## Architecture (background operation)

```
popup/              UI: queue (search/filter/stats), settings + Flow refresh,
                    references, history, job editor + details, previews
background.js       Service worker engine: advance jobs, downloads, recovery,
                    alarms heartbeat, tab events, Flow refresh, reconnection
content/flow.js     Flow automation layer (content script); responds to ping
content/selectors.js  ⭐ ALL Flow DOM selectors in one place
downloads.js        chrome.downloads wrapper → TryAIToday/Run-…/ organized files
naming.js           Pure filename + token parsing (#name, @start/@end/@ref)
app.js              Pure reducer (runs, jobs, downloads, history; unit-tested)
storage.js          chrome.storage.local persistence + recovery normalization
types.js            Shared types + messages
```

Messaging:
- background sends `{ kind: 'run-job', job }` to Flow and `{ kind: 'ping' }`
  to test reachability during reconnection.
- content script reports `{ kind: 'job-result', ok, id, result|error }` and
  `{ kind: 'flow-ready' }`.
- every mutation is persisted **before** the next step, so the queue survives
  popup closure, service-worker restarts, and Flow tab reloads without
  duplicating completed generations or downloads.
