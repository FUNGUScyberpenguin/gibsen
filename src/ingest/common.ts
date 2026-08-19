/**
 * Shared ingest helpers: refanging, IOC extraction, timestamp parsing and the
 * keyword heuristics that turn prose into categories, relations and tactics.
 */

import type { CategoryId, RelationId, Tactic } from '../model/types';
import { parseTimestamp } from '../model/time';

/**
 * Undo the usual defanging conventions so a report pasted out of a PDF still
 * yields matchable indicators. Deliberately conservative — it only rewrites
 * bracket/paren forms that are unambiguous.
 */
export function refang(text: string): string {
  return text
    .replace(/h(?:xx|XX|tt)p(s?):\/\//gi, (_m, s: string) => `http${s}://`)
    .replace(/\[\s*\.\s*\]|\(\s*\.\s*\)|\{\s*\.\s*\}/g, '.')
    .replace(/\[\s*:\s*\]/g, ':')
    .replace(/\[\s*(?:@|at)\s*\]|\(\s*(?:@|at)\s*\)/gi, '@')
    .replace(/\[\s*(?:dot)\s*\]|\(\s*dot\s*\)/gi, '.')
    .replace(/\[\s*\/\s*\]/g, '/');
}

export type IocType =
  | 'url'
  | 'email'
  | 'ipv4'
  | 'domain'
  | 'sha256'
  | 'sha1'
  | 'md5'
  | 'cve'
  | 'technique'
  | 'registry'
  | 'winpath'
  | 'filename';

export interface IocMatch {
  type: IocType;
  value: string;
  start: number;
  end: number;
}

/**
 * Ordered highest-priority first. Earlier patterns claim their character range,
 * so the domain inside a URL is not also emitted as a bare domain.
 */
const IOC_PATTERNS: { type: IocType; re: RegExp }[] = [
  { type: 'url', re: /\bhttps?:\/\/[^\s<>"'()\][]+/gi },
  { type: 'email', re: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi },
  { type: 'registry', re: /\bHK(?:LM|CU|CR|U|CC)(?:\\[^\s"'<>|]+)+/gi },
  { type: 'winpath', re: /\b[A-Za-z]:\\(?:[^\s"'<>|\\]+\\)*[^\s"'<>|\\]+/g },
  { type: 'sha256', re: /\b[a-f0-9]{64}\b/gi },
  { type: 'sha1', re: /\b[a-f0-9]{40}\b/gi },
  { type: 'md5', re: /\b[a-f0-9]{32}\b/gi },
  { type: 'cve', re: /\bCVE-\d{4}-\d{4,7}\b/gi },
  { type: 'technique', re: /\bT\d{4}(?:\.\d{3})?\b/g },
  { type: 'ipv4', re: /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g },
  {
    type: 'domain',
    re: /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|ru|cn|co|uk|de|fr|nl|top|xyz|info|biz|online|site|shop|club|live|cloud|dev|app|gov|mil|edu|local|int|eu|us|ca|au|jp|br|in|it|es|pl|se|no|fi|dk|ch|at|be|cz|kr|tw|hk|sg|za|mx|ar|tr|ua|ir|il|vn|th|id|my|ph|nz|pt|gr|ro|hu|bg|sk|lt|lv|ee|is|ie|lu|hr|si|rs|by|kz|ge|az|am|md|onion)\b/gi,
  },
  { type: 'filename', re: /\b[\w.@-]+\.(?:exe|dll|sys|ps1|psm1|bat|cmd|vbs|js|jse|hta|scr|lnk|iso|img|zip|rar|7z|tar|gz|doc|docx|xls|xlsx|xlsm|ppt|pptx|pdf|rtf|jar|py|sh|elf|bin|msi|cab|chm|aspx|jsp|php|war)\b/gi },
];

/**
 * Extract indicators from already-refanged text. Overlapping matches are
 * resolved by pattern priority, so each character belongs to at most one IOC.
 */
export function extractIocs(text: string): IocMatch[] {
  const claimed: { start: number; end: number }[] = [];
  const out: IocMatch[] = [];

  const overlaps = (start: number, end: number) =>
    claimed.some((c) => start < c.end && end > c.start);

  for (const { type, re } of IOC_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // Trim trailing sentence punctuation that regexes happily swallow.
      let value = m[0].replace(/[.,;:)\]}'"]+$/, '');
      if (!value) continue;
      const start = m.index;
      const end = start + value.length;
      if (overlaps(start, end)) continue;
      claimed.push({ start, end });
      if (type === 'url' || type === 'email' || type === 'domain') value = value.toLowerCase();
      out.push({ type, value, start, end });
    }
  }

  return out.sort((a, b) => a.start - b.start);
}

/** Map an IOC type onto its GIBSEN category. */
export const IOC_CATEGORY: Record<IocType, CategoryId> = {
  url: 'url',
  email: 'email',
  ipv4: 'ip-address',
  domain: 'domain',
  sha256: 'file',
  sha1: 'file',
  md5: 'file',
  cve: 'vulnerability',
  technique: 'unknown', // handled separately — techniques annotate, not stand alone
  registry: 'registry-key',
  winpath: 'file',
  filename: 'file',
};

/** File extensions that say more about a file than "it is a file". */
const EXTENSION_CATEGORY: { ext: RegExp; category: CategoryId }[] = [
  { ext: /\.(?:ps1|psm1|vbs|js|jse|bat|cmd|sh|py|hta)$/i, category: 'script' },
  { ext: /\.(?:exe|msi|scr|elf|bin|jar)$/i, category: 'executable' },
  { ext: /\.sys$/i, category: 'driver' },
  { ext: /\.dll$/i, category: 'executable' },
  { ext: /\.(?:zip|rar|7z|tar|gz|cab|iso|img)$/i, category: 'archive' },
  { ext: /\.(?:aspx|jsp|php|war)$/i, category: 'webshell' },
];

/** Refine a file-ish artifact into script/executable/archive where the name says so. */
export function refineFileCategory(value: string): CategoryId {
  for (const { ext, category } of EXTENSION_CATEGORY) {
    if (ext.test(value)) return category;
  }
  return 'file';
}

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

const TIME_PATTERNS: RegExp[] = [
  // 2024-03-14T08:12:03Z / 2024-03-14 08:12:03 / with offset
  /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
  // 14 Mar 2024 08:12 / 14 March 2024
  /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?\b/gi,
  // Mar 14, 2024 08:12
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?\b/gi,
  // Bare date
  /\b\d{4}-\d{2}-\d{2}\b/g,
];

export { parseTimestamp };

/**
 * A clock reading with no date attached. Reports are written this way — the
 * date is established once and every later beat is "at 09:14" — and without
 * this the whole intrusion collapses into a single midnight column, which
 * throws away the one axis the diagram is built on.
 *
 * The lookarounds keep it off anything that merely contains a colon between
 * digits: an address, a version, a port, a ratio.
 */
const CLOCK_RE = /(?<![\d:])(?<!\d\.)(?<!\d[/\-])([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(?![\d:])(?!\.\d)(?![/\-]\d)/g;

/**
 * A bare clock is only read as a time when the prose says it is one. Reports
 * write "at 09:14" or "09:14 UTC"; a number that just happens to look like a
 * clock does not get a cue, and stays a number.
 */
const CLOCK_CUE = /(?:^|[\s(,;–—-])(?:at|around|about|by|from|until|till|through|between|and|since|approximately|approx\.?|circa|beginning|starting|ending)\s+$/i;
const CLOCK_SUFFIX = /^\s*(?:UTC|GMT|Z|hrs?|hours|local(?:\s+time)?|[ap]\.?m\.?)\b/i;

export interface FoundTime {
  iso: string;
  start: number;
  end: number;
  /** Whether the source text actually named a time of day, or only a date. */
  hasClock: boolean;
}

/**
 * Find every timestamp in a block of text, in order of appearance.
 *
 * `contextDate` is the `YYYY-MM-DD` the narrative has most recently
 * established. Bare clock readings are resolved against the nearest date to
 * their left — in this text if there is one, otherwise the one carried in —
 * and are dropped entirely when no date is in scope, because a time with no
 * day is not a position on any timeline.
 */
export function findTimestamps(text: string, contextDate?: string | null): FoundTime[] {
  const found: FoundTime[] = [];
  const claimed: { start: number; end: number }[] = [];

  for (const re of TIME_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (claimed.some((c) => start < c.end && end > c.start)) continue;
      const iso = parseTimestamp(m[0]);
      if (!iso) continue;
      claimed.push({ start, end });
      found.push({ iso, start, end, hasClock: /\d{1,2}:\d{2}/.test(m[0]) });
    }
  }

  // Dates already in this text, so a clock can be resolved against the one
  // that precedes it rather than against whatever the document said last.
  const dated = [...found].sort((a, b) => a.start - b.start);
  const dateAt = (position: number): string | null => {
    let best: string | null = dated.length ? dated[0].iso.slice(0, 10) : (contextDate ?? null);
    for (const stamp of dated) {
      if (stamp.start > position) break;
      best = stamp.iso.slice(0, 10);
    }
    return best;
  };

  CLOCK_RE.lastIndex = 0;
  let clock: RegExpExecArray | null;
  while ((clock = CLOCK_RE.exec(text)) !== null) {
    const start = clock.index;
    const end = start + clock[0].length;
    if (claimed.some((c) => start < c.end && end > c.start)) continue;

    const before = text.slice(Math.max(0, start - 24), start);
    const after = text.slice(end, end + 14);
    const meridiem = after.match(CLOCK_SUFFIX)?.[0].trim().toLowerCase() ?? '';
    if (!CLOCK_CUE.test(before) && !CLOCK_SUFFIX.test(after)) continue;

    const date = dateAt(start);
    if (!date) continue;

    let hour = Number(clock[1]);
    if (/^p/.test(meridiem) && hour < 12) hour += 12;
    if (/^a/.test(meridiem) && hour === 12) hour = 0;

    const iso = parseTimestamp(`${date}T${String(hour).padStart(2, '0')}:${clock[2]}:${clock[3] ?? '00'}`);
    if (!iso) continue;
    claimed.push({ start, end });
    found.push({ iso, start, end, hasClock: true });
  }

  return found.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// Keyword heuristics
// ---------------------------------------------------------------------------

/** Verb cues, longest/most specific first. */
const RELATION_CUES: { re: RegExp; relation: RelationId }[] = [
  // Malware internals first: these are specific enough that a looser cue
  // further down would otherwise claim the sentence.
  { re: /\binject(?:ed|s|ing)?\b|\bprocess hollow|\bhollow(?:ed|ing)/i, relation: 'injects-into' },
  { re: /\bdecrypt|\bdeobfuscat|\bunpack(?:ed|s|ing)?\b|\bdecod(?:ed|es|ing) (?:the )?payload/i, relation: 'decrypts' },
  { re: /\bspawn(?:ed|s|ing)? (?:a |an )?(?:worker |encryption |network )?thread|\bmulti-?threaded/i, relation: 'spawns-thread' },
  { re: /\bshadow (?:cop|volume)|\bvssadmin|\bdelete shadows|\bdisabl(?:ed|es|ing) recovery|\bdestroy(?:ed|s|ing)? backups/i, relation: 'inhibits-recovery' },
  { re: /\bcreat(?:ed|es|ing) (?:a |the )?mutex|\bmutant\b/i, relation: 'creates' },
  // Narrow on purpose: a bare "contains" is far too common in prose to be a
  // reliable signal, and this list is consulted first.
  { re: /\bpacked (?:in|inside)\b|\b(?:in|inside|within) the (?:archive|zip|rar|7z)\b|\b(?:archive|zip|rar|7z) contain/i, relation: 'contains' },
  { re: /\bexfiltrat|\bstaged? for exfil|\bsiphon/i, relation: 'exfiltrates-to' },
  { re: /\bbeacon|\bcheck(?:ed|s|ing)? in\b|\bcallback/i, relation: 'beacons-to' },
  { re: /\bmoved? lateral|\blateral movement|\bpivot(?:ed|s|ing)? (?:to|into)/i, relation: 'moves-laterally-to' },
  { re: /\bescalat/i, relation: 'escalates-to' },
  { re: /\bauthenticat|\blogg?(?:ed|ing) in|\bsign(?:-| )?in|\blogon/i, relation: 'authenticates-to' },
  { re: /\bexploit/i, relation: 'exploits' },
  { re: /\bpersist|\bestablish(?:ed|es)? persistence/i, relation: 'persists-via' },
  { re: /\bencrypt|\bransom/i, relation: 'encrypts' },
  { re: /\bdownload|\bretriev|\bfetch|\bpull(?:ed|s)? down/i, relation: 'downloads-from' },
  { re: /\bupload/i, relation: 'uploads-to' },
  { re: /\bdeliver|\bphish|\bsent\b|\bemail(?:ed)?\b|\battach/i, relation: 'delivers' },
  { re: /\bspawn|\bchild process/i, relation: 'spawns' },
  { re: /\bexecut|\bran\b|\blaunch|\binvok/i, relation: 'executes' },
  { re: /\bdropp?ed|\bwr(?:ote|ites|iting)|\bcreat(?:ed|es) (?:the )?file/i, relation: 'writes' },
  { re: /\bresolv/i, relation: 'resolves-to' },
  { re: /\bhost(?:ed|s|ing)\b|\bserv(?:ed|es|ing)\b/i, relation: 'hosts' },
  { re: /\benumerat|\bdiscover|\bscann?(?:ed|ing)/i, relation: 'discovers' },
  { re: /\bcollect|\bharvest|\bdump(?:ed|s|ing)?\b/i, relation: 'collects-from' },
  { re: /\bconnect|\breach(?:ed|es)? out|\bcommunicat/i, relation: 'connects-to' },
];

/** Guess the behaviour joining artifacts mentioned in the same sentence. */
export function guessRelation(text: string): RelationId {
  for (const { re, relation } of RELATION_CUES) {
    if (re.test(text)) return relation;
  }
  return 'related-to';
}

const TACTIC_CUES: { re: RegExp; tactic: Tactic }[] = [
  { re: /\brecon|\bscann?(?:ed|ing)|\bopen(?:-| )source research/i, tactic: 'reconnaissance' },
  { re: /\bregister(?:ed)? (?:a )?domain|\binfrastructure (?:was )?(?:set up|staged)/i, tactic: 'resource-development' },
  { re: /\bphish|\binitial access|\bfirst (?:foothold|access)|\bfoothold|\bexploit(?:ed)? (?:the )?(?:public|internet)/i, tactic: 'initial-access' },
  { re: /\bexecut|\bran\b|\blaunch|\bmacro|\bpowershell/i, tactic: 'execution' },
  { re: /\bpersist|\brun key|\bscheduled task|\bservice (?:was )?creat/i, tactic: 'persistence' },
  { re: /\bescalat|\bSYSTEM privileges|\badmin(?:istrator)? rights/i, tactic: 'privilege-escalation' },
  { re: /\bevad|\bdisabl(?:ed|ing) (?:av|edr|defender)|\bobfuscat|\bclear(?:ed)? logs/i, tactic: 'defense-evasion' },
  { re: /\bcredential|\bmimikatz|\blsass|\bhash(?:es)? (?:were )?dump|\bkerberoast/i, tactic: 'credential-access' },
  { re: /\benumerat|\bdiscover|\bnet view|\bad (?:recon|enumeration)/i, tactic: 'discovery' },
  { re: /\blateral|\bpsexec|\bwmi(?:c)?\b|\brdp\b|\bsmb (?:share|session)/i, tactic: 'lateral-movement' },
  { re: /\bcollect|\bstag(?:ed|ing)|\barchiv(?:ed|e)|\bcompress/i, tactic: 'collection' },
  { re: /\bbeacon|\bc2\b|\bcommand[- ]and[- ]control|\bcallback/i, tactic: 'command-and-control' },
  { re: /\bexfiltrat|\bdata (?:was )?(?:stolen|taken)/i, tactic: 'exfiltration' },
  { re: /\bencrypt|\bransom|\bwip(?:ed|er)|\bdestruct|\boutage|\bshut ?down/i, tactic: 'impact' },
];

/** Guess the ATT&CK tactic a sentence is describing. */
export function guessTactic(text: string): Tactic | null {
  for (const { re, tactic } of TACTIC_CUES) {
    if (re.test(text)) return tactic;
  }
  return null;
}

/** Words that mark an artifact as attacker-controlled rather than victim-owned. */
const MALICIOUS_CUES =
  /\bmalicious|\battacker[- ]controlled|\badversary[- ]controlled|\bc2\b|\bcommand[- ]and[- ]control|\bcompromis|\bmalware|\bbackdoor|\bimplant|\bpayload|\brogue|\bspoofed|\bfraudulent|\bthreat actor'?s?\b/i;

export function looksMalicious(text: string): boolean {
  return MALICIOUS_CUES.test(text);
}

/**
 * Split prose into paragraphs, rejoining hard-wrapped lines.
 *
 * Reports pasted out of a PDF or written in a fixed-width editor break
 * sentences mid-clause. Treating each physical line as a unit would scatter
 * "the domain controller CORP-DC-01" across two segments and lose both the
 * timestamp at the top of the paragraph and the noun that identifies the host.
 * Headings and list items still start a block of their own, since those really
 * are separate thoughts.
 */
export function paragraphs(text: string): string[] {
  const out: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const joined = current.join(' ').replace(/\s+/g, ' ').trim();
    if (joined) out.push(joined);
    current = [];
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (/^(?:#{1,6}\s|[-*•]\s|\d+[.)]\s|\|)/.test(line)) flush();
    current.push(line);
  }
  flush();

  return out;
}

/**
 * Break a paragraph at sentence boundaries. The paragraph supplies the clock;
 * its sentences supply the verbs, so each behaviour is read from the clause
 * that actually describes it.
 */
export function sentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Shorten a value for use as a node label without losing its identity.
 *
 * The cap is generous because the diagram would rather be wide than lie: a
 * registry path or a full hash is the artifact's identity, and an ellipsis in
 * the middle of one costs the reader more than the width does.
 */
export function truncateLabel(value: string, max = 90): string {
  if (value.length <= max) return value;
  // Keep the tail of paths and URLs — the distinguishing part is usually last.
  if (/[/\\]/.test(value)) {
    const tail = value.slice(-(max - 1));
    return `…${tail}`;
  }
  return `${value.slice(0, max - 1)}…`;
}
