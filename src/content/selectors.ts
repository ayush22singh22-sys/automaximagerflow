/**
 * Centralized Google Flow DOM selectors.
 *
 * All Flow-specific selectors live ONLY in this file so they are trivial to
 * update when Google changes the DOM. The content script (flow.ts) reads from
 * here and never hard-codes element locators.
 *
 * Google Flow is a fast-moving Labs app. Its DOM is not guaranteed and cannot
 * be verified without a real logged-in session. Each target below supports a
 * list of candidate selectors tried in order; the first that matches wins.
 * When a required control is missing, the content script reports a clear error
 * naming the step instead of pretending it worked.
 */

export interface SelectorConfig {
  pageMatch: RegExp;
  promptInput: string[];
  generate: string[];
  generating: string[];
  completed: string[];
  failed: string[];
  result: string[];

  // Download / save affordances used to collect real result URLs.
  downloadButton: string[];
  downloadWithin: string[];

  // Medium / generation-type tabs (image vs video).
  imageMode: string[];
  videoModeTab: string[];

  // Video mode selector (text-to-video / start frame / start+end / reference).
  videoModeOptions: string[];

  // Settings controls.
  modelPicker: string[];
  aspectRatio: string[];
  count: string[];
  quality: string[];
  duration: string[];

  // Reference / start-frame / end-frame upload inputs in Flow's prompt bar.
  referenceUpload: string[];
  startFrameUpload: string[];
  endFrameUpload: string[];
}

export const selectors: SelectorConfig = {
  pageMatch: /(^|\.)(labs\.google|flow\.google|labs\.google\.com|flow\.google\.com|withgoogle\.com|google\.com|google)$/i,

  promptInput: [
    '[contenteditable="true"]',
    'textarea',
    'input[type="text"]',
    '[role="textbox"]',
    '[data-testid="prompt-input"]',
    '[data-testid="prompt-box"]',
  ],

  generate: [
    '[aria-label*="enerate" i]',
    '[data-testid*="generate" i]',
    'button[type="submit"]',
    'button[aria-label*="reate" i]',
    'button[aria-label*="Submit" i]',
  ],

  generating: [
    '[role="progressbar"]',
    '[data-testid*="generating" i]',
    '[data-testid*="progress" i]',
    '.spinner',
    '[class*="spinner" i]',
    '[aria-busy="true"]',
  ],

  completed: [
    '[data-testid*="download" i]',
    'button[aria-label*="ownload" i]',
    'button[aria-label*="Save" i]',
    'button[aria-label*="Export" i]',
  ],

  failed: [
    '[data-testid*="error" i]',
    '[role="alert"]',
    '[role="dialog"]',
    'mat-snack-bar-container',
    '[class*="snack" i]',
    '[class*="toast" i]',
    '[class*="error" i]',
    '[aria-label*="Error" i]',
  ],

  result: [
    'video',
    'img[src^="blob:"]',
    'img[src^="data:"]',
    '[data-testid*="result" i]',
    '[data-testid*="output" i]',
  ],

  // Download / save buttons whose hrefs encode the real result URL.
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
    '[class*="result" i]',
    '[class*="card" i]',
  ],

  // Image vs video generation tabs.
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

  // Video-mode sub-options (text-to-video, start frame, start+end, reference).
  videoModeOptions: [
    '[role="radiogroup"] [role="radio"]',
    '[data-testid*="video-mode" i] [role="button"]',
    'button[role="radio"]',
    '[role="tab"]',
  ],

  // Settings controls (model / aspect / count / quality / duration).
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

  // Reference / start-frame / end-frame upload controls in the prompt bar.
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
