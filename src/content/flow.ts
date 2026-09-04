// Inline types from types.ts — no import so TypeScript does NOT treat this
// file as an ES module and does NOT emit "export {}" at the bottom, which
// would break content-script injection (classic script context).
type GenType = 'image' | 'video';
type VideoMode = 'text-to-video' | 'start-frame' | 'start-end-frame' | 'reference';
type RefRole = 'start' | 'end' | 'reference';
interface FlowResult {
  summary: string;
  count: number;
  previewUrls: string[];
  downloadUrls: string[];
  applied: string[];
  skipped: string[];
}
interface GenSettings {
  genType: GenType;
  model: string;
  aspectRatio: string;
  count: number;
  quality: string;
  videoMode: VideoMode;
  duration: number;
}
interface Reference {
  id: string;
  name: string;
  category: string;
  dataUrl: string;
  createdAt: number;
}
interface TaggedRef {
  role: RefRole;
  ref: Reference;
}
interface RunRequest {
  id: string;
  prompt: string;
  settings: GenSettings;
  refs: TaggedRef[];
}
type OutboundMessage =
  | { kind: 'state'; app: unknown; status: string }
  | { kind: 'run-job'; job: RunRequest }
  | { kind: 'ping' };
type InboundMessage =
  | { kind: 'job-result'; ok: true; id: string; result: FlowResult }
  | { kind: 'job-result'; ok: false; id: string; error: string }
  | { kind: 'job-progress'; id: string; message: string }
  | { kind: 'flow-ready' };

interface SelectorConfig {
  pageMatch: RegExp;
  promptInput: string[];
  generate: string[];
  generating: string[];
  completed: string[];
  failed: string[];
  result: string[];
  downloadButton: string[];
  downloadWithin: string[];
  imageMode: string[];
  videoModeTab: string[];
  videoModeOptions: string[];
  modelPicker: string[];
  aspectRatio: string[];
  count: string[];
  quality: string[];
  duration: string[];
  referenceUpload: string[];
  startFrameUpload: string[];
  endFrameUpload: string[];
}

const selectors: SelectorConfig = {
  pageMatch: /(^|\.)((labs|flow)\.google(\.com)?|aitestkitchen\.withgoogle\.com|google\.com|google)$/i,

  promptInput: [
    // Placeholder-based — most specific to this exact page.
    '[placeholder*="create" i]',
    '[aria-placeholder*="create" i]',
    '[data-placeholder*="create" i]',
    '[placeholder*="prompt" i]',
    '[aria-placeholder*="prompt" i]',
    // Generic role/attribute selectors.
    '[data-testid="prompt-input"]',
    '[data-testid="prompt-box"]',
    '[aria-label*="prompt" i]',
    '[aria-label*="create" i]',
    '[role="textbox"]',
    'textarea',
    'input[type="text"]',
    // Last resort — any contenteditable (may match wrong element).
    '[contenteditable="true"]',
  ],

  // Generate button selectors — attribute-based (fast path).
  // Text-based search ("Generate", "Create", "Run") is handled separately
  // in findGenerateButton() below, since ImageFX uses plain text content
  // with no stable aria-label or data-testid.
  generate: [
    'button[aria-label="Generate"]',
    'button[aria-label*="Generate" i]',
    'button[aria-label*="Create" i]',
    'button[aria-label*="Run" i]',
    'button[data-testid*="generate" i]',
    'button[data-testid*="submit" i]',
    'button[type="submit"]',
    'button[aria-label*="enerate" i]',
    'button[aria-label*="reate" i]',
    'button[aria-label*="Submit" i]',
    // ImageFX floating action button (send arrow)
    'button.generate-button',
    '[class*="generate" i] button',
    '[class*="submit" i] button',
  ],

  // FIX #4: Add Angular Material + common framework loading selectors.
  generating: [
    'mat-spinner',
    'mat-progress-bar',
    'mat-progress-spinner',
    '[role="progressbar"]',
    '[data-testid*="generating" i]',
    '[data-testid*="progress" i]',
    '[data-testid*="loading" i]',
    '.spinner',
    '[class*="spinner" i]',
    '[class*="loading" i]',
    '[class*="progress" i]',
    '[aria-busy="true"]',
    'circle[stroke-dasharray]',        // SVG spinner rings
    '[class*="Generating" i]',
    '[class*="Processing" i]',
    // Extended: cover Flow/ImageFX-specific signals
    '[aria-label*="generating" i]',
    '[aria-label*="loading" i]',
    '[class*="skeleton" i]',
    '[class*="shimmer" i]',
    'button[disabled][aria-label*="generate" i]',
    '[data-testid*="skeleton" i]',
  ],

  completed: [
    '[data-testid*="download" i]',
    'button[aria-label*="ownload" i]',
    'button[aria-label*="Save" i]',
    'button[aria-label*="Export" i]',
  ],

  failed: [
    '[data-testid*="error" i]',
    '[aria-label*="Error" i][role="alert"]',
    '[class*="error-message" i]',
    '[class*="errorMessage" i]',
    '[role="dialog"]',
    'mat-snack-bar-container',
    '[class*="snack" i]',
    '[class*="toast" i]',
    '[class*="alert" i]',
    '[class*="banner" i]',
    // Only match role=alert if it has visible non-empty text (not ambient).
    // Checked separately in detectFailure() below.
  ],

  // FIX #3: Broaden result selectors — Flow serves images from CDN (https://),
  // not blob: or data:. Accept any visible <img> with a non-empty src, plus
  // common class-name patterns Flow uses for output cards.
  result: [
    'video[src]',
    'video source[src]',
    'img[src^="blob:"]',
    'img[src^="data:"]',
    'img[src^="https://"]',
    '[data-testid*="result" i] img',
    '[data-testid*="output" i] img',
    '[data-testid*="generation" i] img',
    '[class*="result" i] img',
    '[class*="output" i] img',
    '[class*="generation" i] img',
    '[class*="image-card" i] img',
    '[class*="imageCard" i] img',
    '[class*="media-card" i] img',
    '[data-testid*="result" i]',
    '[data-testid*="output" i]',
  ],

  downloadButton: [
    '[data-testid*="download" i]',
    'a[download]',
    'a[aria-label*="ownload" i]',
    'button[data-testid*="download" i]',
    'button[aria-label*="ownload" i]',
  ],
  downloadWithin: [
    '[data-testid*="result" i]',
    '[data-testid*="output" i]',
    '[data-testid*="generation" i]',
    '[class*="result" i]',
    '[class*="card" i]',
    '[class*="output" i]',
    '[class*="generation" i]',
  ],

  imageMode: [
    '[data-testid*="image" i][role="tab"]',
    '[role="tab"][aria-label*="mage" i]',
    '[role="button"][aria-label*="mage" i]',
  ],
  videoModeTab: [
    '[data-testid*="video" i][role="tab"]',
    '[role="tab"][aria-label*="ideo" i]',
    '[role="button"][aria-label*="ideo" i]',
  ],

  videoModeOptions: [
    '[role="radiogroup"] [role="radio"]',
    '[data-testid*="video-mode" i] [role="button"]',
    'button[role="radio"]',
    '[role="tab"]',
  ],

  modelPicker: [
    '[aria-label*="odel" i]',
    '[data-testid*="model" i]',
    'select',
  ],
  aspectRatio: [
    '[aria-label*="spect" i]',
    '[data-testid*="aspect" i]',
    '[aria-label*="Ratio" i]',
  ],
  count: [
    '[aria-label*="ount" i]',
    '[data-testid*="count" i]',
    'input[type="number"]',
  ],
  quality: [
    '[aria-label*="uality" i]',
    '[data-testid*="quality" i]',
  ],
  duration: [
    '[aria-label*="uration" i]',
    '[data-testid*="duration" i]',
    'input[type="range"]',
  ],

  referenceUpload: [
    '[data-testid*="reference" i] input[type="file"]',
    '[data-testid*="upload" i] input[type="file"]',
    '[data-testid*="upload" i]',
    'input[type="file"]',
  ],
  startFrameUpload: [
    '[data-testid*="start-frame" i] input[type="file"]',
    '[data-testid*="start" i] input[type="file"]',
  ],
  endFrameUpload: [
    '[data-testid*="end-frame" i] input[type="file"]',
    '[data-testid*="end" i] input[type="file"]',
  ],
};

/**
 * Flow automation layer (content script).
 *
 * Drives one prompt through Google Flow in the page, applying generation
 * settings and uploading local references. It reports success or an explicit,
 * descriptive failure. It never fabricates a successful generation.
 *
 * Communication contract (see types.ts):
 *   inbound "run-job" (RunRequest) -> executes one prompt
 *   outbound "job-result" -> sends the outcome back to the background worker
 */

function $(sel: string): HTMLElement | null {
  return document.querySelector(sel);
}

function all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(sel));
}

function first(selectorsList: string[]): HTMLElement | null {
  for (const s of selectorsList) {
    const el = $(s);
    if (el) return el;
  }
  return null;
}

/**
 * Pick the best visible prompt input on the page.
 * Prefers elements that:
 *  1. Match a specific placeholder selector (most precise).
 *  2. Are visible and editable.
 *  3. Are in the lower half of the viewport (where ImageFX prompt box lives).
 *  4. Smallest offsetTop (i.e., still in view but at the bottom).
 *
 * This prevents accidentally typing into hidden or auxiliary contenteditable
 * elements that Angular uses internally (e.g., rich-text editors, menus).
 */
function bestPromptInput(): HTMLElement | null {
  const vh = window.innerHeight;

  // Try each selector in priority order; pick first visible one.
  for (const sel of selectors.promptInput) {
    const candidates = all(sel).filter((el) => {
      if (!visible(el)) return false;
      // Must be editable (contenteditable, or native form element).
      if (!(el.isContentEditable || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
      return true;
    });
    if (candidates.length === 0) continue;

    // Among candidates from this selector, prefer the one closest to the
    // bottom of the viewport (like ImageFX's prompt bar at the bottom).
    const scored = candidates.map((el) => {
      const rect = el.getBoundingClientRect();
      // Score: how close the element's vertical center is to the bottom third of the viewport.
      const center = rect.top + rect.height / 2;
      const score = Math.abs(center - vh * 0.8); // prefer elements near 80% down the page
      return { el, score };
    });
    scored.sort((a, b) => a.score - b.score);
    return scored[0].el;
  }
  return null;
}

function findGenerateButton(): HTMLElement | null {
  // Strategy 1: A button that is now ENABLED (aria-disabled is false/absent)
  // and is near the prompt input — this is the ImageFX pattern.
  const input = first(selectors.promptInput);
  if (input) {
    let container: HTMLElement | null = input.parentElement;
    for (let i = 0; i < 8 && container; i++) {
      const btns = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .filter((b) => visible(b));
      // Prefer buttons where aria-disabled is explicitly "false" (just enabled).
      const enabled = btns.filter((b) => b.getAttribute('aria-disabled') === 'false');
      if (enabled.length > 0) return enabled[enabled.length - 1];
      // Fall back to any non-natively-disabled button in the container.
      const notDisabled = btns.filter((b) => !b.disabled && b.getAttribute('aria-disabled') !== 'true');
      if (notDisabled.length > 0) return notDisabled[notDisabled.length - 1];
      container = container.parentElement;
    }
  }

  // Strategy 2: Attribute-based selectors (aria-label, data-testid, type).
  const byAttr = first(selectors.generate);
  if (byAttr && visible(byAttr)) return byAttr;

  // Strategy 3: Text-content scan.
  const TEXT_RE = /^(generate|create|run|go|submit|make|create image|generate image)$/i;
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
  for (const btn of buttons) {
    if (!visible(btn)) continue;
    const txt = (btn.textContent ?? '').trim();
    if (TEXT_RE.test(txt)) return btn;
    const lbl = btn.getAttribute('aria-label') ?? '';
    if (TEXT_RE.test(lbl)) return btn;
    // mat-icon send/arrow_forward inside button.
    const icon = btn.querySelector('mat-icon, [class*="send" i], [class*="arrow" i]');
    if (icon) {
      const iconTxt = (icon.textContent ?? '').trim().toLowerCase();
      if (iconTxt === 'send' || iconTxt === 'arrow_forward' || iconTxt === 'arrow_right') return btn;
    }
  }

  return null;
}

/** True when the generate button exists AND is no longer aria-disabled. */
function generateButtonReady(): boolean {
  const btn = findGenerateButton();
  if (!btn) return false;
  // Button must not be natively disabled or aria-disabled="true".
  if ((btn as HTMLButtonElement).disabled) return false;
  if (btn.getAttribute('aria-disabled') === 'true') return false;
  return true;
}

/** Collect all elements matching any candidate selector in the list. */
function allOf(selectorsList: string[]): HTMLElement[] {
  return selectorsList.flatMap((s) => all(s));
}

function visible(el: HTMLElement | null): boolean {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function isFlowPage(): boolean {
  return selectors.pageMatch.test(window.location.hostname);
}

function waitFor(cond: () => boolean, timeoutMs: number, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (cond()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error(`Timed out waiting for: ${label}`));
      setTimeout(tick, 200);
    };
    tick();
  });
}

function click(el: HTMLElement | null): boolean {
  if (!el) return false;
  el.focus();
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
}

/** Click an option widget whose visible text matches (case-insensitive). */
function clickByText(options: HTMLElement[], text: string): boolean {
  const t = text.trim().toLowerCase();
  for (const el of options) {
    if (el.textContent && el.textContent.trim().toLowerCase() === t) {
      click(el);
      return true;
    }
    const label = el.getAttribute('aria-label');
    if (label && label.trim().toLowerCase() === t) {
      click(el);
      return true;
    }
  }
  return false;
}

function setNumber(sels: string[], value: number): boolean {
  const el = first(sels);
  if (!(el instanceof HTMLInputElement)) return false;
  el.value = String(value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function dataUrlToFile(dataUrl: string): File | null {
  try {
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    if (!m) return null;
    const bytes = atob(m[2]);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new File([arr], `ref-${Date.now()}.png`, { type: m[1] });
  } catch {
    return null;
  }
}

// Global set of all image URLs seen or downloaded in this tab session across jobs.
// This prevents older generation images from ever being re-downloaded into later jobs.
const sessionSeenUrls = new Set<string>();

class FlowDriver {
  private readonly job: RunRequest;
  // Snapshot immediately before clicking Generate. Keeping this on the driver
  // avoids missing a fast result that appears while submitPrompt() is waiting
  // for Flow's progress indicator.
  private baselineResultCount = 0;
  private baselineUrls: Set<string> = new Set();
  private resultCount = 0;
  private previewUrls: string[] = [];
  private downloadUrls: string[] = [];
  private applied: string[] = [];
  private skipped: string[] = [];

  constructor(job: RunRequest) {
    this.job = job;
  }

  private report(payload: { ok: true; result: FlowResult } | { ok: false; error: string }): void {
    const message: InboundMessage =
      payload.ok
        ? { kind: 'job-result', ok: true, id: this.job.id, result: payload.result }
        : { kind: 'job-result', ok: false, id: this.job.id, error: payload.error };
    void safeSendMessage(message);
  }

  private progress(message: string): void {
    const update: InboundMessage = { kind: 'job-progress', id: this.job.id, message };
    void safeSendMessage(update);
  }

  async run(): Promise<void> {
    try {
      this.progress('Finding the Flow prompt box…');
      await this.detectPage();
      const input = await this.findPromptInput();
      this.progress('Applying generation settings…');
      await this.applySettings();
      await this.uploadReferences();
      this.progress('Typing the prompt into Flow…');
      await this.enterPrompt(input);
      this.progress('Waiting for Flow to enable Generate…');
      const beforeResults = this.resultElements();
      this.baselineResultCount = beforeResults.length;
      this.baselineUrls = new Set(
        beforeResults.map((el) => {
          const img = el instanceof HTMLImageElement ? el : el.querySelector<HTMLImageElement>('img');
          return img ? (img.currentSrc || img.src || '') : '';
        }).filter(Boolean)
      );
      for (const u of this.baselineUrls) sessionSeenUrls.add(u);
      await this.submitPrompt();
      this.progress('Generation submitted — waiting for the result…');
      await this.waitForResult();
      this.progress('Result found — preparing clean download…');
      this.report({ ok: true, result: this.resultPayload() });
    } catch (err) {
      this.report({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private resultPayload(): FlowResult {
    const skippedNote = this.skipped.length ? ` · skipped ${this.skipped.length} setting(s)` : '';
    return {
      summary: `${this.resultCount} result(s) detected${skippedNote}`,
      count: this.resultCount,
      previewUrls: this.previewUrls,
      downloadUrls: this.downloadUrls,
      applied: this.applied,
      skipped: this.skipped,
    };
  }

  private async detectPage(): Promise<void> {
    await waitFor(() => !!document.body, 5000, 'page body');
    if (!isFlowPage()) {
      throw new Error(`Not a supported Flow page (host: ${window.location.hostname})`);
    }
  }

  private async findPromptInput(): Promise<HTMLElement> {
    await waitFor(() => !!bestPromptInput(), 15000, 'prompt input');
    const el = bestPromptInput();
    if (!el) throw new Error('No prompt input found on the Flow page');
    return el;
  }

  /** Apply generation settings best-effort, recording what was or wasn't found. */
  private async applySettings(): Promise<void> {
    const s = this.job.settings;

    // Switch medium (image vs video).
    const wantsVideo = s.genType === 'video';
    const mediumTab = wantsVideo ? first(selectors.videoModeTab) : first(selectors.imageMode);
    if (mediumTab) {
      click(mediumTab);
      this.applied.push(`medium:${s.genType}`);
      await new Promise((r) => setTimeout(r, 400));
    } else {
      this.skipped.push('medium');
    }

    // Video-mode sub option.
    if (s.genType === 'video') {
      const modeLabel = videoModeLabels[s.videoMode];
      const ok = clickByText(allOf(selectors.videoModeOptions), modeLabel);
      this.record(ok, `videoMode:${s.videoMode}`);
    }

    // Model.
    this.record(clickByText(allOf(selectors.modelPicker), s.model), `model:${s.model}`);
    // Aspect ratio.
    this.record(clickByText(allOf(selectors.aspectRatio), s.aspectRatio), `aspect:${s.aspectRatio}`);
    // Quality.
    this.record(clickByText(allOf(selectors.quality), s.quality), `quality:${s.quality}`);
    // Count.
    if (s.count > 1) {
      this.record(setNumber(selectors.count, s.count), `count:${s.count}`);
    }
    // Duration (video).
    if (s.genType === 'video' && s.duration > 0) {
      this.record(setNumber(selectors.duration, s.duration), `duration:${s.duration}`);
    }
  }

  private record(ok: boolean, label: string): void {
    (ok ? this.applied : this.skipped).push(label);
  }

  /** Upload local references according to their tagged Flow role. */
  private async uploadReferences(): Promise<void> {
    const refs = this.job.refs ?? [];
    if (refs.length === 0) return;

    const targetFor = (role: TaggedRef['role']): HTMLInputElement | null => {
      if (role === 'start') return this.fileInput(selectors.startFrameUpload);
      if (role === 'end') return this.fileInput(selectors.endFrameUpload);
      return this.fileInput(selectors.referenceUpload);
    };

    for (const tagged of refs) {
      const target = targetFor(tagged.role);
      if (!target) {
        this.skipped.push(`ref:${tagged.ref.name} (no ${tagged.role} upload control)`);
        continue;
      }
      if (this.fillTarget(target, tagged.ref)) this.applied.push(`ref:${tagged.role}:${tagged.ref.name}`);
      else this.skipped.push(`ref:${tagged.ref.name} (upload failed)`);
    }

    const anyTarget = [selectors.referenceUpload, selectors.startFrameUpload, selectors.endFrameUpload]
      .some((sels) => this.fileInput(sels));
    if (!anyTarget) {
      throw new Error('No reference upload control found on the Flow page — cannot attach local references.');
    }
  }

  private fileInput(sels: string[]): HTMLInputElement | null {
    const el = first(sels);
    return el instanceof HTMLInputElement ? el : null;
  }

  private fillTarget(input: HTMLInputElement, ref: Reference): boolean {
    const file = dataUrlToFile(ref.dataUrl);
    if (!file) return false;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  private async enterPrompt(input: HTMLElement): Promise<void> {
    input.focus();
    // Clear any existing text first.
    setValue(input, '');
    const rect = input.getBoundingClientRect();
    const response = (await safeSendMessage({
      kind: 'native-replace-text',
      text: this.job.prompt,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    })) as {
      ok?: boolean;
      error?: string;
    } | undefined;
    if (!response?.ok) {
      // Fall back directly to DOM setValue if native debugger input was unavailable in background
      setValue(input, this.job.prompt);
    }

    // Wait longer — Angular needs time to re-evaluate the model and enable the button.
    await new Promise((r) => setTimeout(r, 800));
  }

  private async submitPrompt(): Promise<void> {
    // Phase 1 — wait for the button to EXIST (may be disabled while input is empty).
    await waitFor(() => !!findGenerateButton(), 12000, 'generate button');

    // Phase 2 — wait for it to become ENABLED.
    // ImageFX sets aria-disabled="true" until the user types text; after
    // setValue() the framework needs a tick to re-evaluate and enable it.
    await waitFor(generateButtonReady, 10000, 'generate button to become enabled');

    const gen = findGenerateButton();
    if (!gen) throw new Error('No generate button found on the Flow page.');

    // Phase 3 — click it via native input and DOM click
    const rect = gen.getBoundingClientRect();
    const response = (await safeSendMessage({
      kind: 'native-click',
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    })) as { ok?: boolean; error?: string } | undefined;

    // Also trigger DOM click to ensure background / occluded tabs process the click
    click(gen);

    if (!response?.ok && !this.generatingActive()) {
      throw new Error(`Flow did not accept the Generate click: ${response?.error ?? 'no response from extension'}`);
    }

    // For plain textarea / input also fire Enter as secondary signal.
    const input = first(selectors.promptInput);
    if (
      input &&
      (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement)
    ) {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }),
      );
      input.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }),
      );
    }

    // Phase 4 — wait up to 30s for any spinner/progress indicator.
    // We do NOT check failureSurface here — ambient alert elements on the page
    // cause false positives. Real generation errors are caught in waitForResult().
    const waitMs = 30_000;
    const start = Date.now();
    while (Date.now() - start < waitMs) {
      if (this.generatingActive()) return;
      await new Promise((r) => setTimeout(r, 400));
    }
    // No spinner detected — proceed to waitForResult regardless.
  }

  private generatingActive(): boolean {
    return selectors.generating.some((s) => visible($(s)));
  }

  private detectFailure(): { hasError: boolean; message: string; isUnusual: boolean } {
    const UNUSUAL_TEXT_RE = /(unusual activity|unusual traffic|suspicious activity|rate limit|too many requests|slow down|quota exceeded|we noticed some unusual)/i;
    const GENERAL_ERROR_RE = /(unusual activity|unusual traffic|suspicious activity|rate limit|too many requests|slow down|quota exceeded|we noticed some unusual|error|failed|unable|violation|policy|something went wrong|try again)/i;

    const candidateSelectors = [
      ...selectors.failed,
      '[role="alert"]',
      '[role="dialog"]',
      'mat-snack-bar-container',
      '[class*="snack" i]',
      '[class*="toast" i]',
      '[class*="alert" i]',
      '[class*="banner" i]',
    ];

    for (const sel of candidateSelectors) {
      const elements = all(sel).filter((el) => visible(el));
      for (const el of elements) {
        const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
        if (!text) continue;
        if (GENERAL_ERROR_RE.test(text)) {
          const isUnusual = UNUSUAL_TEXT_RE.test(text);
          this.dismissErrorModal(el);
          return {
            hasError: true,
            message: text.slice(0, 300),
            isUnusual,
          };
        }
      }
    }

    return { hasError: false, message: '', isUnusual: false };
  }

  private dismissErrorModal(container: HTMLElement): void {
    try {
      const buttons = Array.from(container.querySelectorAll<HTMLElement>('button, [role="button"], a'));
      for (const btn of buttons) {
        const txt = (btn.textContent ?? '').trim();
        if (/(dismiss|ok|close|got it|understand|cancel)/i.test(txt)) {
          click(btn);
          break;
        }
      }
    } catch {
      /* ignore */
    }
  }

  private failureSurface(): boolean {
    return this.detectFailure().hasError;
  }

  // Filters out Google avatars, nav icons, and tiny placeholder images.
  // Only real AI-generated output images (>120px) pass through.
  private resultElements(): HTMLElement[] {
    const raw = selectors.result.map((s) => all(s)).flat().filter((e) => visible(e));
    const seenEl = new Set<HTMLElement>();
    const seenSrc = new Set<string>();
    const unique: HTMLElement[] = [];

    const process = (el: HTMLElement) => {
      if (seenEl.has(el)) return;
      seenEl.add(el);

      const img = el instanceof HTMLImageElement ? el : el.querySelector<HTMLImageElement>('img');
      const vid = el instanceof HTMLVideoElement ? el : el.querySelector<HTMLVideoElement>('video');
      const media = img || vid;
      if (!media || !visible(media)) return;

      if (media instanceof HTMLImageElement) {
        const src = media.currentSrc || media.src || '';
        if (!src) return;
        // Skip Google profile avatar
        if (src.includes('googleusercontent.com/a/')) return;
        // Skip tiny placeholder data URIs
        if (src.startsWith('data:') && src.length < 100) return;
        // Skip tiny icons / thumbnails (< 150px)
        const w = media.naturalWidth || media.width || 0;
        const h = media.naturalHeight || media.height || 0;
        if (w > 0 && w < 150) return;
        if (h > 0 && h < 150) return;

        // Skip duplicates by src
        if (seenSrc.has(src)) return;
        seenSrc.add(src);
      }

      if (media.closest('header, nav, footer, [role="banner"], [role="navigation"], [aria-label*="Account" i], .gb_d')) return;

      unique.push(media);
    };

    for (const el of raw) process(el);

    // FALLBACK: if CSS selectors found nothing, scan ALL visible images on the page.
    if (unique.length === 0) {
      const allImgs = Array.from(document.querySelectorAll<HTMLImageElement>('img'));
      for (const img of allImgs) process(img);
    }

    return unique;
  }

  /** Collect candidate result download/save URLs (anchors + media src). */
  private collectDownloadUrls(): string[] {
    const urls: string[] = [];
    const push = (u: string | null | undefined): void => {
      if (u && u.startsWith('https://') && urls.indexOf(u) < 0) urls.push(u);
    };
    for (const sel of selectors.downloadButton) {
      for (const el of all(sel)) {
        if (!visible(el)) continue;
        push(el.getAttribute('href'));
        push(el.getAttribute('data-url'));
        push(el.getAttribute('data-download-url'));
      }
    }
    // Collect from result containers.
    for (const el of this.resultElements()) {
      const near = selectors.downloadWithin;
      const parent = el.closest<HTMLElement>(near.join(','));
      const container = parent ?? el;
      for (const a of Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href]'))) push(a.href);
      for (const img of Array.from(container.querySelectorAll<HTMLImageElement>('img[src]'))) {
        push(img.currentSrc || img.src);
      }
      for (const vid of Array.from(container.querySelectorAll<HTMLVideoElement>('video[src]'))) {
        push(vid.currentSrc || vid.src);
      }
      const src = (el as HTMLImageElement | HTMLVideoElement).src;
      if (src && src.startsWith('https://')) push(src);
    }
    return urls;
  }

  /**
   * Collect result URLs to hand off to the background downloader.
   *
   * Strategy priority:
   *   1. https:// CDN URLs — pushed directly. chrome.downloads.download() in the
   *      background service worker has no CORS restriction, so this is the
   *      most reliable path for Google Flow CDN images (lh3.googleusercontent.com, etc.).
   *      Attempting canvas.drawImage() on these images throws SecurityError (tainted
   *      canvas) and fetch() from a content script is CORS-blocked, so we skip both.
   *   2. blob: URLs — same-origin, safe to draw onto canvas and export as data:.
   *   3. data: URLs — already in data: form, push directly.
   */
  private async collectDataUrls(elements?: HTMLElement[]): Promise<string[]> {
    const targetElements = elements && elements.length > 0 ? elements : this.resultElements();
    const dataUrls: string[] = [];

    const blobToDataUrl = (blob: Blob): Promise<string> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });

    for (const el of targetElements) {
      const imgEl = el instanceof HTMLImageElement ? el : el.querySelector<HTMLImageElement>('img');
      const vidEl = el instanceof HTMLVideoElement ? el : el.querySelector<HTMLVideoElement>('video');

      if (imgEl) {
        const src = imgEl.currentSrc || imgEl.src || '';
        if (!src) continue;

        // Strategy 1: https:// CDN URLs — push directly, let chrome.downloads handle them.
        // canvas.toDataURL() throws SecurityError for cross-origin images, and
        // content-script fetch() is blocked by CORS on Google's CDN.
        if (src.startsWith('https://')) {
          dataUrls.push(src);
          continue;
        }

        // Strategy 2: data: URLs — already usable, push directly.
        if (src.startsWith('data:')) {
          dataUrls.push(src);
          continue;
        }

        // Strategy 3: blob: URLs — same-origin, safe to canvas-draw or fetch.
        if (src.startsWith('blob:')) {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = imgEl.naturalWidth || imgEl.width || 512;
            canvas.height = imgEl.naturalHeight || imgEl.height || 512;
            const ctx = canvas.getContext('2d');
            if (ctx && canvas.width > 0 && canvas.height > 0) {
              ctx.drawImage(imgEl, 0, 0);
              const dataUrl = canvas.toDataURL('image/png', 1.0);
              if (dataUrl && dataUrl.length > 100 && !dataUrl.startsWith('data:,')) {
                dataUrls.push(dataUrl);
                continue;
              }
            }
          } catch { /* canvas failed — try fetch */ }

          try {
            const res = await fetch(src);
            if (res.ok) {
              const blob = await res.blob();
              const dataUrl = await blobToDataUrl(blob);
              if (dataUrl && dataUrl.length > 50) {
                dataUrls.push(dataUrl);
                continue;
              }
            }
          } catch { /* fetch also failed */ }

          // Last resort: push the blob URL itself.
          dataUrls.push(src);
          continue;
        }

        // Unknown scheme — push as-is and let the downloader try.
        dataUrls.push(src);

      } else if (vidEl) {
        const src = vidEl.currentSrc || vidEl.src;
        if (src) dataUrls.push(src);
      }
    }
    return Array.from(new Set(dataUrls));
  }

  // Detects new result via image URL change, count increase, or spinner completion lifecycle
  private async waitForResult(): Promise<void> {
    const start = Date.now();
    const timeoutMs = 5 * 60 * 1000;
    const graceMs = 3000;              // Grace period: skip failure check during initial 3s
    let consecutiveFailureTicks = 0;   // Debounce counter for failure signals
    const requiredFailureTicks = 3;    // Require 3 consecutive failure ticks before throwing
    let hasStartedGenerating = false;

    let debugTick = 0;
    while (Date.now() - start < timeoutMs) {
      debugTick++;
      const wasGenerating = this.generatingActive();
      if (wasGenerating) {
        hasStartedGenerating = true;
      }

      const currentResults = this.resultElements();

      // Strategy A: Count increase
      const newByCount = Math.max(0, currentResults.length - this.baselineResultCount);

      // Strategy B: Image URL changed from baseline snapshot AND never seen before in this tab session
      const newByUrl = currentResults.filter((el) => {
        const img = el instanceof HTMLImageElement ? el : el.querySelector<HTMLImageElement>('img');
        const src = img ? (img.currentSrc || img.src || '') : '';
        return src && !this.baselineUrls.has(src) && !sessionSeenUrls.has(src);
      });

      // Strategy C: Generation spinner ran and has now finished with rendered output
      const spinnerFinished = hasStartedGenerating && !this.generatingActive() && currentResults.length > 0;

      const newResults = Math.max(newByCount, newByUrl.length, spinnerFinished ? 1 : 0);

      // Debug log every 5 ticks (~4s) so we can trace what's happening
      if (debugTick % 5 === 1) {
        const urls = currentResults.map((el) => {
          const img = el instanceof HTMLImageElement ? el : el.querySelector<HTMLImageElement>('img');
          return img ? (img.currentSrc || img.src || '(no src)').slice(0, 80) : '(no img)';
        });
        console.log(
          `[flow:waitForResult] tick=${debugTick} baseline=${this.baselineResultCount}` +
          ` current=${currentResults.length} newByCount=${newByCount}` +
          ` newByUrl=${newByUrl.length} spinner=${wasGenerating}` +
          ` hasStarted=${hasStartedGenerating} spinnerDone=${spinnerFinished}`,
          urls,
        );
      }

      if (newResults > 0) {
        this.resultCount = newResults;

        // Give Flow 1500ms to lazy-load src attributes and fully paint the image.
        // CDN images (https://) often have their src set asynchronously after the
        // <img> element appears in the DOM, so we need to wait before reading src.
        await new Promise((r) => setTimeout(r, 1500));

        // Re-read fresh results after the settle delay
        const settledResults = this.resultElements();
        const settledNewByUrl = settledResults.filter((el) => {
          const img = el instanceof HTMLImageElement ? el : el.querySelector<HTMLImageElement>('img');
          const src = img ? (img.currentSrc || img.src || '') : '';
          return src && !this.baselineUrls.has(src) && !sessionSeenUrls.has(src);
        });

        // Maximum images per prompt is 4 in ImageFX / Google Flow
        const maxImages = Math.min(4, Math.max(1, this.job.settings.count || 4));

        let candidateElements: HTMLElement[];
        if (settledNewByUrl.length > 0) {
          // Take only the newest items, capped at maxImages
          candidateElements = settledNewByUrl.slice(-maxImages);
        } else if (settledResults.length > this.baselineResultCount) {
          // Take the newest appended items, capped at maxImages
          const addedCount = Math.min(maxImages, settledResults.length - this.baselineResultCount);
          candidateElements = settledResults.slice(-addedCount);
        } else {
          // Fallback: take at most maxImages from the latest results
          candidateElements = settledResults.slice(-maxImages);
        }

        // Register candidate URLs in sessionSeenUrls so they are NEVER re-downloaded in subsequent jobs
        for (const el of candidateElements) {
          const img = el instanceof HTMLImageElement ? el : el.querySelector<HTMLImageElement>('img');
          const src = img ? (img.currentSrc || img.src || '') : '';
          if (src) {
            sessionSeenUrls.add(src);
            this.baselineUrls.add(src);
          }
        }

        this.previewUrls = candidateElements.map((e) => {
          const img = e instanceof HTMLImageElement ? e : e.querySelector<HTMLImageElement>('img');
          const url = img ? (img.currentSrc || img.src || '') : (e as HTMLImageElement).src ?? '';
          return url || (e.getAttribute('src') ?? '');
        }).filter(Boolean).slice(0, maxImages);

        // Always extract real canvas data: URLs from the generated images
        try {
          const dataUrls = await this.collectDataUrls(candidateElements);
          if (dataUrls.length > 0) {
            this.downloadUrls = Array.from(new Set(dataUrls)).slice(0, maxImages);
          } else {
            this.downloadUrls = this.collectDownloadUrls().slice(0, maxImages);
          }
        } catch {
          this.downloadUrls = this.collectDownloadUrls().slice(0, maxImages);
        }

        console.log(`[flow] Found ${this.downloadUrls.length} image result(s) (capped at ${maxImages})`);
        return;
      }

      // Check for failure surface only after grace period, with debounce
      const failure = this.detectFailure();
      const pastGracePeriod = Date.now() - start > graceMs;
      if ((pastGracePeriod || failure.isUnusual) && failure.hasError && !this.generatingActive()) {
        consecutiveFailureTicks++;
        console.log(`[flow] failure signal tick ${consecutiveFailureTicks}/${requiredFailureTicks}: ${failure.message}`);
        // For unusual activity or explicit modal error, fail immediately (2 ticks) so background can handle retry/cooldown
        const ticksNeeded = failure.isUnusual ? 2 : requiredFailureTicks;
        if (consecutiveFailureTicks >= ticksNeeded) {
          if (failure.isUnusual) {
            throw new Error(`Flow reported unusual activity: "${failure.message}"`);
          }
          throw new Error(`Flow reported a generation failure: "${failure.message || 'Unknown error'}"`);
        }
      } else {
        consecutiveFailureTicks = 0;
      }

      await new Promise((r) => setTimeout(r, 800));
    }
    throw new Error('Timed out waiting for a generated result');
  }
}

/**
 * Direct DOM Anchor Download helper (triggers a programmatic click on an <a download> element).
 */
async function downloadDirectlyInDom(dataUrl: string, filename: string): Promise<boolean> {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    console.log(`⬇️ Direct DOM anchor download triggered: ${filename}`);
    link.click();
    setTimeout(() => {
      if (document.body.contains(link)) document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 2000);
    return true;
  } catch (err) {
    console.error('Direct DOM download failed:', err);
    return false;
  }
}

/**
 * Removes the Gemini / Google ImageFX watermark from an image canvas.
 * The watermark in Google Imagen / Flow is located in the bottom-right corner.
 */
function removeGeminiWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const boxW = Math.max(48, Math.min(Math.round(width * 0.08), 92));
  const boxH = Math.max(48, Math.min(Math.round(height * 0.08), 92));
  const marginX = Math.max(8, Math.round(width * 0.015));
  const marginY = Math.max(8, Math.round(height * 0.015));

  const startX = Math.max(0, width - boxW - marginX);
  const startY = Math.max(0, height - boxH - marginY);
  const w = Math.min(boxW + marginX, width - startX);
  const h = Math.min(boxH + marginY, height - startY);

  if (w <= 0 || h <= 0 || startX <= 0 || startY <= 0) return;

  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  const sampleAbove = startY >= h;
  const sampleOffsetY = sampleAbove ? -h : 0;
  const sampleOffsetX = !sampleAbove && startX >= w ? -w : 0;

  for (let dy = 0; dy < h; dy++) {
    const y = startY + dy;
    const srcY = Math.max(0, Math.min(height - 1, y + sampleOffsetY));
    const featherY = Math.min(dy / 6, (h - 1 - dy) / 6, 1);

    for (let dx = 0; dx < w; dx++) {
      const x = startX + dx;
      const srcX = Math.max(0, Math.min(width - 1, x + sampleOffsetX));
      const featherX = Math.min(dx / 6, (w - 1 - dx) / 6, 1);
      const alpha = Math.min(featherX, featherY);

      const targetIdx = (y * width + x) * 4;
      const srcIdx = (srcY * width + srcX) * 4;

      const topBorderIdx = (Math.max(0, startY - 1) * width + x) * 4;
      const leftBorderIdx = (y * width + Math.max(0, startX - 1)) * 4;

      const weightTop = (h - dy) / h;
      const weightLeft = (w - dx) / w;
      const norm = weightTop + weightLeft || 1;

      const bgR = (data[topBorderIdx] * weightTop + data[leftBorderIdx] * weightLeft) / norm;
      const bgG = (data[topBorderIdx + 1] * weightTop + data[leftBorderIdx + 1] * weightLeft) / norm;
      const bgB = (data[topBorderIdx + 2] * weightTop + data[leftBorderIdx + 2] * weightLeft) / norm;

      const texR = data[srcIdx];
      const texG = data[srcIdx + 1];
      const texB = data[srcIdx + 2];

      const blendedR = Math.round(texR * 0.4 + bgR * 0.6);
      const blendedG = Math.round(texG * 0.4 + bgG * 0.6);
      const blendedB = Math.round(texB * 0.4 + bgB * 0.6);

      data[targetIdx] = Math.round(data[targetIdx] * (1 - alpha) + blendedR * alpha);
      data[targetIdx + 1] = Math.round(data[targetIdx + 1] * (1 - alpha) + blendedG * alpha);
      data[targetIdx + 2] = Math.round(data[targetIdx + 2] * (1 - alpha) + blendedB * alpha);
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

async function urlToImageBitmap(src: string): Promise<HTMLImageElement | ImageBitmap> {
  try {
    const res = await fetch(src);
    if (res.ok) {
      const blob = await res.blob();
      if (typeof createImageBitmap === 'function') {
        return await createImageBitmap(blob);
      }
      const blobUrl = URL.createObjectURL(blob);
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = blobUrl;
      });
    }
  } catch {
    /* fallback to Image element */
  }

  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

async function processImageWatermark(src: string): Promise<string> {
  if (!src || src.startsWith('data:video') || src.includes('.mp4')) return src;
  try {
    const source = await urlToImageBitmap(src);
    const width = 'naturalWidth' in source ? (source.naturalWidth || source.width) : source.width;
    const height = 'naturalHeight' in source ? (source.naturalHeight || source.height) : source.height;

    if (!width || !height) return src;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return src;

    ctx.drawImage(source as CanvasImageSource, 0, 0);
    removeGeminiWatermark(ctx, width, height);
    return canvas.toDataURL('image/png', 1.0);
  } catch (err) {
    return src;
  }
}

const videoModeLabels: Record<GenSettings['videoMode'], string> = {
  'text-to-video': 'Text to video',
  'start-frame': 'Start frame',
  'start-end-frame': 'Start + End frame',
  reference: 'Reference',
};

/**
 * Set text in any input type.
 *
 * Angular (labs.google/fx) only recognizes text if it arrives through the
 * browser's native event path. The most reliable approach is:
 *  1. Focus the element.
 *  2. Select-all + delete existing text.
 *  3. Use execCommand('insertText') which goes through the browser's native
 *     text-insertion path (Zone.js patches this and Angular picks it up).
 *  4. If execCommand fails, simulate a paste event with DataTransfer.
 *  5. Last resort: set textContent + fire an input event.
 */
function setValue(input: HTMLElement, value: string): void {
  if (input instanceof HTMLTextAreaElement) {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  if (input instanceof HTMLInputElement) {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  if (!input.isContentEditable) {
    throw new Error(`Prompt input not a supported type (${input.tagName})`);
  }

  input.focus();

  // Step 1: Select all + delete to clear.
  document.execCommand('selectAll', false);
  document.execCommand('delete', false);

  // Step 2: execCommand('insertText') — goes through Zone.js and triggers
  // Angular's internal change detection (most reliable on Angular apps).
  const inserted = document.execCommand('insertText', false, value);
  if (inserted && (input.textContent ?? '').trim().length > 0) return;

  // Step 3: Paste event simulation with DataTransfer.
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', value);
    dt.setData('text/html', value);
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    if ((input.textContent ?? '').trim().length > 0) return;
  } catch { /* fall through */ }

  // Step 4: Direct DOM + comprehensive events (last resort).
  input.textContent = value;
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  // Move cursor to end.
  const range = document.createRange();
  range.selectNodeContents(input);
  range.collapse(false);
  const sel = window.getSelection();
  if (sel) { sel.removeAllRanges(); sel.addRange(range); }
}

chrome.runtime.onMessage.addListener((msg: OutboundMessage, _sender, sendResponse: (r: { received: boolean }) => void) => {
  if (msg && msg.kind === 'ping') {
    sendResponse({ received: true });
    return;
  }
  if (msg && msg.kind === 'run-job') {
    const job = msg.job;
    const normalized: RunRequest = {
      id: job.id,
      prompt: job.prompt,
      settings: job.settings ?? ({ genType: 'image', model: '', aspectRatio: '', count: 1, quality: '', videoMode: 'text-to-video', duration: 0 } as GenSettings),
      refs: job.refs ?? [],
    };
    new FlowDriver(normalized).run();
    sendResponse({ received: true });
  }
});

function safeSendMessage<T = unknown>(message: unknown): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
        return resolve(undefined);
      }
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          // Silence unhandled lastError warning when SW is sleeping or context invalidated
          return resolve(undefined);
        }
        resolve(response as T);
      });
    } catch {
      // Synchronous context invalidation error
      resolve(undefined);
    }
  });
}

function noop(): void { /* ignore */ }

/**
 * Ensures Google Flow and this automation continue running smoothly when
 * the browser is minimized, occluded, or moved to another virtual desktop.
 */
let audioCtx: AudioContext | null = null;
function startSilentAudioKeepAlive(): void {
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      audioCtx = new AudioContextClass();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      gain.gain.value = 0.00001; // inaudible
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
    }
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }
  } catch {
    /* ignore */
  }
}

function enableBackgroundExecution(): void {
  try {
    // 1. Spoof visibility properties so Flow's Angular engine does not pause or throttle
    Object.defineProperty(document, 'visibilityState', {
      get: () => 'visible',
      configurable: true,
    });
    Object.defineProperty(document, 'hidden', {
      get: () => false,
      configurable: true,
    });
    document.hasFocus = () => true;

    // 2. Stop visibilitychange events from signaling tab hidden to page listeners
    window.addEventListener(
      'visibilitychange',
      (e) => {
        e.stopImmediatePropagation();
      },
      true,
    );

    // 3. Start silent audio keepalive so Chromium treats this as a media tab
    // (disables timer throttling, occlusion freezing, and memory discard)
    startSilentAudioKeepAlive();
  } catch {
    /* ignore */
  }
}

let keepAlivePort: chrome.runtime.Port | null = null;
function sendKeepAlivePing(): void {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return;
    if (!keepAlivePort) {
      keepAlivePort = chrome.runtime.connect({ name: 'flow-keepalive' });
      keepAlivePort.onDisconnect.addListener(() => {
        keepAlivePort = null;
      });
    }
    keepAlivePort.postMessage({ type: 'ping' });
  } catch {
    keepAlivePort = null;
  }
}

enableBackgroundExecution();
setInterval(sendKeepAlivePing, 15000);

// Announce availability so the background can reconnect cheaply after reload.
const ready: InboundMessage = { kind: 'flow-ready' };
void safeSendMessage(ready);
