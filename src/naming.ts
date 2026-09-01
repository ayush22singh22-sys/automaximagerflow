import type { GenType, Reference, TaggedRef } from './types.js';

/** Replace illegal/unsafe filename characters and collapse space. */
export function sanitizeFileName(value: string): string {
  // Remove control characters first (kept out of the literal regex for lint).
  let s = Array.from(value)
    .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f)
    .join('');
  s = s
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  // Strip trailing dots/spaces which are illegal on Windows.
  s = s.replace(/[. ]+$/g, '');
  if (s === '' || s === '.' || s === '..') return 'result';
  if (s.length > 80) s = s.slice(0, 80);
  return s;
}

/** Extract the #name directive from a prompt, if present. */
export function parseNameToken(prompt: string): string | null {
  const m = /#([A-Za-z0-9_-]+)/.exec(prompt);
  return m ? sanitizeFileName(m[1]) : null;
}

/** Strip #name and @reference/@start/@end tokens from the text typed into Flow. */
export function cleanPrompt(prompt: string): string {
  return prompt
    .replace(/#[A-Za-z0-9_-]+/g, '')
    .replace(/@(start|end|reference):[A-Za-z0-9_.-]+/g, '')
    .replace(/@[A-Za-z0-9_.-]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export interface ParsedRefs {
  tagged: TaggedRef[];
  /** Names that appear in the prompt but have no matching reference. */
  unresolved: string[];
}

/**
 * Resolve both plain @name and role-tagged @start:name / @end:name /
 * @reference:name tokens in a prompt against the local reference library.
 */
export function resolvePromptRefs(prompt: string, references: Reference[]): ParsedRefs {
  const tagged: TaggedRef[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();

  const add = (role: TaggedRef['role'], name: string): void => {
    const ref = references.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (ref && !seen.has(ref.id)) {
      seen.add(ref.id);
      tagged.push({ role, ref });
    } else if (!ref && !unresolved.includes(name)) {
      unresolved.push(name);
    }
  };

  // Role-tagged first: @start:x @end:x @reference:x
  const roleRe = /@(start|end|reference):([A-Za-z0-9_.-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = roleRe.exec(prompt)) !== null) {
    add(m[1] as TaggedRef['role'], m[2]);
  }

  // Plain @name (not already consumed by role tags).
  const plainRe = /(^|\s)@([A-Za-z0-9_.-]+)(?=\s|$)/g;
  const plainWorld = new Set(prompt.match(/@start:|@end:|@reference:/g) ?? []);
  void plainWorld;
  while ((m = plainRe.exec(prompt)) !== null) {
    add('reference', m[2]);
  }

  return { tagged, unresolved };
}

/**
 * Build the output file base name for a job: #name if present, else 'result'.
 */
export function jobBaseName(name: string | undefined): string {
  return name ? sanitizeFileName(name) : 'result';
}

/** Extension for the output: images .png, videos .mp4. */
export function extFor(genType: GenType): string {
  return genType === 'video' ? '.mp4' : '.png';
}

/** Zero-padded 3-digit index: 1 -> "001". */
export function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

/** Full file name for download index i (1-based) within a job / run. */
export function outputFileName(
  genType: GenType,
  base: string,
  index: number,
  version: number,
  subIndex?: number,
): string {
  const v = version > 1 ? `-v${version}` : '';
  const sub = subIndex !== undefined && subIndex > 0 ? `-${subIndex}` : '';
  return `${pad3(index)}-${base}${sub}${v}${extFor(genType)}`;
}

/** Full relative path under the user's Downloads folder. */
export function outputPath(dirName: string, fileName: string): string {
  return `TryAIToday/${dirName}/${fileName}`;
}

/** Run-YYYY-MM-DD-NNN */
export function runDirName(runNumber: number, date = new Date(), pad = 3): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `Run-${y}-${mo}-${d}-${String(runNumber).padStart(pad, '0')}`;
}
