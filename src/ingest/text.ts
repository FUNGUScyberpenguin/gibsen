/**
 * Free-text CTI report parser.
 *
 * This is the parser that does the most interpretive work, and it is the one
 * an analyst is most likely to be correcting afterwards. It walks the report a
 * segment at a time, carries the most recent timestamp forward, and hangs the
 * sentence that mentioned each artifact onto that artifact as commentary — so
 * the diagram arrives already annotated with the narrative it came from.
 *
 * Everything it infers is marked as inferred. Nothing here is presented as
 * observed unless the report literally said so in the same sentence.
 */

import type { CategoryId, GibsenEdge, GibsenNode, IngestResult, Tactic } from '../model/types';
import { makeEdge, makeNode, nextId } from '../model/incident';
import { defaultPlaneFor } from '../model/taxonomy';
import {
  IOC_CATEGORY,
  extractIocs,
  findTimestamps,
  guessRelation,
  guessTactic,
  looksMalicious,
  paragraphs,
  refang,
  refineFileCategory,
  sentences,
  truncateLabel,
} from './common';

/** Explicitly labelled fields are far more reliable than bare-token guessing. */
const LABELLED_FIELDS: { re: RegExp; category: CategoryId }[] = [
  { re: /\b(?:user(?:name)?|account|upn|principal)\s*[:=]\s*"?([A-Za-z0-9._@\\-]{2,64})"?/gi, category: 'user-account' },
  { re: /\b(?:hostname|host|workstation|endpoint|machine|device)\s*[:=]\s*"?([A-Za-z0-9._-]{2,64})"?/gi, category: 'workstation' },
  { re: /\b(?:server|dc|domain controller)\s*[:=]\s*"?([A-Za-z0-9._-]{2,64})"?/gi, category: 'server' },
  { re: /\b(?:process|image|proc)\s*[:=]\s*"?([A-Za-z0-9._\\/-]{2,120})"?/gi, category: 'process' },
  { re: /\b(?:service)\s*[:=]\s*"?([A-Za-z0-9._-]{2,64})"?/gi, category: 'service' },
  { re: /\b(?:scheduled ?task|task ?name)\s*[:=]\s*"?([A-Za-z0-9._\\/ -]{2,64})"?/gi, category: 'scheduled-task' },
  { re: /\b(?:tenant|subscription)\s*[:=]\s*"?([A-Za-z0-9._-]{2,64})"?/gi, category: 'cloud-tenant' },
  { re: /\b(?:bucket|container)\s*[:=]\s*"?([A-Za-z0-9._-]{2,64})"?/gi, category: 'cloud-storage' },
];

/**
 * Prose names assets without a colon: "workstation FIN-WS-014", "the historian
 * PI-HIST-02". Each pattern must capture an asset-shaped token, which keeps
 * ordinary sentences from being mined for hostnames.
 */
const ASSET_TOKEN = '[A-Z][A-Z0-9]*(?:-[A-Z0-9]+){1,4}';
const IPV4 = '(?:\\d{1,3}\\.){3}\\d{1,3}';
/** OT and host gear gets named either way: `PLC-LINE-2` or a bare address. */
const TARGET = `(?:${ASSET_TOKEN}|${IPV4})`;

/** Hostname-shaped or an IPv4 address. Case-sensitive, unlike the patterns. */
function isTargetLike(value: string): boolean {
  return new RegExp(`^(?:${ASSET_TOKEN}|${IPV4})$`).test(value);
}

/**
 * Names that only count as identifiers if they carry a separator. Without this
 * "the tenant grant was revoked" would file an artifact called `grant`.
 */
function isQualifiedName(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*[._-][a-z0-9._-]*$/i.test(value);
}

const PROSE_FIELDS: { re: RegExp; category: CategoryId; validate: (value: string) => boolean }[] = [
  { re: new RegExp(`\\bengineering workstation\\s+(?:at\\s+)?(${TARGET})`, 'gi'), category: 'engineering-workstation', validate: isTargetLike },
  { re: new RegExp(`\\b(?:domain controller|dc)\\s+(?:at\\s+)?(${TARGET})`, 'gi'), category: 'server', validate: isTargetLike },
  { re: new RegExp(`\\bhistorian\\s+(?:at\\s+)?(${TARGET})`, 'gi'), category: 'historian', validate: isTargetLike },
  { re: new RegExp(`\\b(?:plc|rtu|controller)\\s+(?:at\\s+)?(${TARGET})`, 'gi'), category: 'plc', validate: isTargetLike },
  { re: new RegExp(`\\bhmi\\s+(?:at\\s+)?(${TARGET})`, 'gi'), category: 'hmi', validate: isTargetLike },
  { re: new RegExp(`\\bscada\\s+(?:server\\s+)?(?:at\\s+)?(${TARGET})`, 'gi'), category: 'scada', validate: isTargetLike },
  { re: new RegExp(`\\bprotocol gateway\\s+(?:at\\s+)?(${TARGET})`, 'gi'), category: 'protocol-gateway', validate: isTargetLike },
  { re: new RegExp(`\\b(?:server|host)\\s+(?:at\\s+)?(${TARGET})`, 'gi'), category: 'server', validate: isTargetLike },
  { re: new RegExp(`\\b(?:workstation|endpoint|laptop|desktop|machine|device)\\s+(?:at\\s+)?(${TARGET})`, 'gi'), category: 'workstation', validate: isTargetLike },
  { re: /\b(?:storage )?bucket\s+([a-z0-9][a-z0-9._-]{2,40})/gi, category: 'cloud-storage', validate: isQualifiedName },
  { re: /\btenant\s+([a-z0-9][a-z0-9._-]{2,60})/gi, category: 'cloud-tenant', validate: isQualifiedName },
  { re: /\bOAuth (?:grant|application|consent)\s+(?:named\s+)?["“]([^"”]{2,60})["”]/gi, category: 'oauth-grant', validate: () => true },
];

/**
 * Asset-shaped tokens nobody bothered to introduce. Two or more hyphen groups,
 * or one plus a recognisable role abbreviation — enough to catch `CORP-DC-01`
 * while leaving `SHA-256` and `US-CERT` alone.
 */
const BARE_ASSET = new RegExp(`\\b(${ASSET_TOKEN})\\b`, 'g');

const ROLE_HINTS: { re: RegExp; category: CategoryId }[] = [
  { re: /ENG.*WS|EWS/, category: 'engineering-workstation' },
  { re: /HMI/, category: 'hmi' },
  { re: /PLC|RTU/, category: 'plc' },
  { re: /HIST/, category: 'historian' },
  { re: /SCADA|DCS/, category: 'scada' },
  { re: /(?:^|-)DC(?:-|\d|$)|SRV|SVR|SQL|APP|WEB|FILE/, category: 'server' },
  { re: /WS|WKS|PC|LT/, category: 'workstation' },
];

/** True when a bare token is asset-shaped enough to be worth lifting. */
function looksLikeAsset(token: string): boolean {
  const hyphens = token.split('-').length - 1;
  if (hyphens >= 2) return true;
  return ROLE_HINTS.some((hint) => hint.re.test(token));
}

function categoriseAsset(token: string): CategoryId {
  for (const hint of ROLE_HINTS) {
    if (hint.re.test(token)) return hint.category;
  }
  return 'server';
}

/**
 * Categories that carry no more meaning than "this is a value of that shape".
 * A later, more specific reading of the same artifact is allowed to replace one
 * of these; it is not allowed to overwrite something already specific.
 */
const GENERIC_CATEGORIES = new Set<CategoryId>(['unknown', 'file', 'ip-address', 'domain', 'url', 'network-traffic']);

/** `DOMAIN\user` is unambiguous enough to lift without a label. */
const NETBIOS_USER = /\b([A-Za-z0-9-]{2,20}\\[A-Za-z0-9._$-]{2,40})\b/g;

/** Named threat actors, when the report states one outright. */
const ACTOR_FIELD =
  /\b(?:threat actor|actor|adversary|intrusion set|attributed to|tracked as)\s*(?:is|:|=)?\s*"?([A-Z][A-Za-z0-9 _-]{2,40}?)"?(?=[.,;\n]|$)/g;

export interface TextParseOptions {
  /** Name shown in the source list. */
  name?: string;
}

export function parseTextReport(raw: string, options: TextParseOptions = {}): IngestResult {
  const sourceId = nextId('src');
  const warnings: string[] = [];
  const text = refang(raw);

  const nodes: GibsenNode[] = [];
  const edges: GibsenEdge[] = [];
  /**
   * Lower-cased label -> node, so one artifact mentioned five times is one node.
   * Keyed on the label alone rather than category+label: within a single report
   * the same value is the same thing, and later sentences routinely describe it
   * more precisely than the first one did.
   */
  const byKey = new Map<string, GibsenNode>();

  let currentTime: string | null = null;
  /** Artifacts created by the previous segment, for narrative chaining. */
  let previousFocus: GibsenNode | null = null;

  const upsert = (
    label: string,
    category: CategoryId,
    opts: {
      t: string | null;
      observed: boolean;
      commentary: string;
      tactic: Tactic | null;
      malicious: boolean;
      details?: Record<string, string>;
    },
  ): GibsenNode => {
    const display = truncateLabel(label);
    const key = display.toLowerCase();
    let node = byKey.get(key);

    if (!node) {
      node = makeNode({
        label: display,
        category,
        t: opts.t,
        timeBasis: opts.t ? (opts.observed ? 'observed' : 'inferred') : 'unknown',
        // Text reports are prose, not telemetry — never claim more than "possible"
        // for something a regex found, unless the sentence timestamps it.
        confidence: opts.observed ? 'probable' : 'possible',
        tactic: opts.tactic,
        details: { value: label, ...(opts.details ?? {}) },
        commentary: opts.commentary,
        compromised: opts.malicious,
        sources: [sourceId],
      });
      byKey.set(key, node);
      nodes.push(node);
      return node;
    }

    // Seen before: accept a sharper reading of what it is. "203.0.113.44" first
    // read as an address becomes a C2 server once a later sentence says so.
    if (category !== node.category && GENERIC_CATEGORIES.has(node.category)) {
      node.category = category;
      node.plane = defaultPlaneFor(category);
    }

    // Keep the earliest time and accumulate the narrative.
    if (opts.t && (!node.t || opts.t < node.t)) {
      node.t = opts.t;
      node.timeBasis = opts.observed ? 'observed' : 'inferred';
    }
    if (!node.tactic && opts.tactic) node.tactic = opts.tactic;
    node.compromised = node.compromised || opts.malicious;
    if (opts.commentary && !node.commentary.includes(opts.commentary)) {
      node.commentary = [node.commentary, opts.commentary].filter(Boolean).join('\n');
    }
    return node;
  };

  /**
   * The day the narrative is currently on. A report establishes a date once
   * and then writes "at 09:14" for the rest of the section, so the date has to
   * survive across paragraphs or every later beat loses its place on the axis.
   */
  let currentDate: string | null = null;

  // Two levels: the paragraph carries the clock, its sentences carry the verbs.
  for (const paragraph of paragraphs(text)) {
    const paragraphStamps = findTimestamps(paragraph, currentDate);
    if (paragraphStamps.length) currentDate = paragraphStamps[paragraphStamps.length - 1].iso.slice(0, 10);
    // An artifact counts as observed at this time when the paragraph that
    // introduced it stated a time — not merely because some earlier one did.
    const observed = paragraphStamps.length > 0;
    if (observed) currentTime = paragraphStamps[0].iso;

    /** Every artifact this paragraph produced, for paragraph-wide annotation. */
    const paragraphNodes: GibsenNode[] = [];
    /**
     * A sentence that names no artifact of its own — "This is attacker-controlled
     * C2 infrastructure." — is commentary about the rest of the paragraph. Its
     * techniques and its verdict are held here and applied once the paragraph is
     * finished, so they land whether the remark came before or after the facts.
     */
    const trailingTechniques: string[] = [];
    let paragraphMalicious = false;

    for (const segment of sentences(paragraph)) {
      // A timestamp inside this very sentence anchors it more precisely still.
      const own = findTimestamps(segment, currentDate);
      if (own.length) {
        currentTime = own[0].iso;
        currentDate = own[own.length - 1].iso.slice(0, 10);
      }

      const tactic = guessTactic(segment);
      const malicious = looksMalicious(segment);
      const relation = guessRelation(segment);

      /** Artifacts found in this sentence, tagged with where they appeared. */
      const candidates: { index: number; node: GibsenNode }[] = [];
      const techniques: string[] = [];
      /**
       * Character spans already spoken for. A later pattern may re-read a span
       * it fully covers — that is how "tenant contoso-eng.onmicrosoft.com"
       * sharpens a domain into a cloud tenant — but it may not carve a fragment
       * out of one, which is what turned `HKCU\Software` into an "account".
       */
      const claimed: { start: number; end: number }[] = [];

      const record = (raw: string, category: CategoryId, start: number, details?: Record<string, string>) => {
        // Captures that run to the end of a clause pick up its punctuation.
        const value = raw.trim().replace(/[.,;:!?]+$/, '');
        if (!value) return;

        const end = start + raw.length;
        const overlapping = claimed.filter((c) => start < c.end && end > c.start);
        const coversAll = overlapping.every((c) => start <= c.start && end >= c.end);
        if (!coversAll) return;

        claimed.push({ start, end });
        candidates.push({
          index: start,
          node: upsert(value, category, { t: currentTime, observed, commentary: segment, tactic, malicious, details }),
        });
      };

      /** Where a capture group actually sits, not where its whole match starts. */
      const captureIndex = (match: RegExpExecArray): number =>
        match.index + (match[1] ? match[0].indexOf(match[1]) : 0);

      // --- explicitly labelled fields ------------------------------------
      // Highest precision: the report told us what the value is.
      for (const { re, category } of LABELLED_FIELDS) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(segment)) !== null) {
          if (m[1]) record(m[1], category, captureIndex(m));
        }
      }

      // --- indicators -----------------------------------------------------
      // Ahead of the loose patterns so that a registry path or a CVE id claims
      // its whole span before anything can match a fragment of it.
      for (const ioc of extractIocs(segment)) {
        if (ioc.type === 'technique') {
          techniques.push(ioc.value.toUpperCase());
          claimed.push({ start: ioc.start, end: ioc.end });
          continue;
        }

        let category = IOC_CATEGORY[ioc.type];
        if (category === 'file') category = refineFileCategory(ioc.value);
        if (ioc.type === 'ipv4' && /\bc2\b|command[- ]and[- ]control|beacon/i.test(segment)) category = 'c2-server';

        const details: Record<string, string> = {};
        if (ioc.type === 'sha256' || ioc.type === 'sha1' || ioc.type === 'md5') details[ioc.type] = ioc.value;

        record(ioc.value, category, ioc.start, details);
      }

      NETBIOS_USER.lastIndex = 0;
      let nb: RegExpExecArray | null;
      while ((nb = NETBIOS_USER.exec(segment)) !== null) record(nb[1], 'user-account', captureIndex(nb));

      ACTOR_FIELD.lastIndex = 0;
      let am: RegExpExecArray | null;
      while ((am = ACTOR_FIELD.exec(segment)) !== null) {
        // Guard against swallowing a whole clause after "attributed to".
        if (am[1] && am[1].trim().split(/\s+/).length <= 4) record(am[1], 'threat-actor', captureIndex(am));
      }

      // --- assets named in prose ------------------------------------------
      // Runs after the indicators so that "tenant contoso-eng.onmicrosoft.com"
      // can re-read the whole domain span and sharpen its category.
      for (const { re, category, validate } of PROSE_FIELDS) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(segment)) !== null) {
          if (m[1] && validate(m[1].trim())) record(m[1], category, captureIndex(m));
        }
      }

      BARE_ASSET.lastIndex = 0;
      let ba: RegExpExecArray | null;
      while ((ba = BARE_ASSET.exec(segment)) !== null) {
        if (looksLikeAsset(ba[1])) record(ba[1], categoriseAsset(ba[1]), captureIndex(ba));
      }

      if (candidates.length === 0) {
        // Commentary about the paragraph rather than a fact of its own.
        trailingTechniques.push(...techniques);
        if (malicious) paragraphMalicious = true;
        continue;
      }

      // Chain in the order the analyst wrote them, not the order we matched them.
      const distinct: GibsenNode[] = [];
      for (const { node } of candidates.sort((a, b) => a.index - b.index)) {
        if (!distinct.includes(node)) distinct.push(node);
      }
      for (const node of distinct) {
        if (!paragraphNodes.includes(node)) paragraphNodes.push(node);
      }

      // Techniques named in a sentence annotate every artifact in it.
      if (techniques.length) {
        for (const n of distinct) n.techniques = [...new Set([...n.techniques, ...techniques])];
      }

      // --- narrative links --------------------------------------------------
      // Within a sentence, chain artifacts in reading order; its verb supplies
      // the relation.
      for (let i = 0; i < distinct.length - 1; i += 1) {
        edges.push(
          makeEdge({
            from: distinct[i].id,
            to: distinct[i + 1].id,
            relation,
            t: currentTime,
            confidence: observed ? 'possible' : 'suspected',
            commentary: segment,
            sources: [sourceId],
          }),
        );
      }

      // Across sentences, only chain when the clause names an actual behaviour;
      // otherwise mere adjacency in prose would masquerade as causation.
      if (previousFocus && relation !== 'related-to' && !distinct.includes(previousFocus)) {
        edges.push(
          makeEdge({
            from: previousFocus.id,
            to: distinct[0].id,
            relation,
            t: currentTime,
            confidence: 'suspected',
            commentary: segment,
            sources: [sourceId],
          }),
        );
      }

      previousFocus = distinct[distinct.length - 1];
    }

    // Apply whatever the paragraph's artifact-free sentences had to say.
    for (const node of paragraphNodes) {
      if (trailingTechniques.length) {
        node.techniques = [...new Set([...node.techniques, ...trailingTechniques])];
      }
      if (paragraphMalicious) node.compromised = true;
    }
  }

  if (nodes.length === 0) {
    warnings.push('No indicators, hosts or accounts were recognised in this document.');
  }
  const timed = nodes.filter((n) => n.t).length;
  if (nodes.length > 0 && timed === 0) {
    warnings.push(
      'No timestamps were found, so every artifact is unsequenced. Add times in the inspector to lay the incident out over time.',
    );
  }

  // The first artifact of the earliest segment is the natural starting pivot.
  if (nodes.length) nodes[0].pivot = true;

  return {
    nodes,
    edges,
    warnings,
    source: {
      id: sourceId,
      name: options.name ?? 'Pasted report',
      format: 'text',
      ingestedAt: new Date().toISOString(),
      nodeCount: nodes.length,
    },
  };
}
