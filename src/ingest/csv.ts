/**
 * CSV / TSV parser.
 *
 * Handles two row shapes in one file: artifact rows (anything with a label)
 * and relationship rows (anything with both a source and a target column).
 * Unrecognised columns are not discarded — they become artifact details, which
 * is usually where the interesting per-shop context lives.
 */

import type {
  CategoryId,
  Confidence,
  GibsenEdge,
  GibsenNode,
  IngestResult,
  PlaneId,
  RelationId,
  Tactic,
} from '../model/types';
import { makeEdge, makeNode, nextId } from '../model/incident';
import { ALL_PLANES, CATEGORIES, TACTICS, matchCategory, matchRelation } from '../model/taxonomy';
import { parseTimestamp, refineFileCategory, truncateLabel } from './common';

/** RFC 4180 style splitter that tolerates quoted delimiters and newlines. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  // Strip a UTF-8 BOM, which Excel loves to add and header matching hates.
  const src = text.replace(/^﻿/, '');

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Pick the delimiter that yields the most columns on the header line. */
export function sniffDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestCount = 0;
  for (const d of candidates) {
    const count = parseDelimited(firstLine, d)[0]?.length ?? 0;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/** Column role -> accepted header names, all normalised to lower snake. */
const HEADER_ALIASES: Record<string, string[]> = {
  label: ['label', 'name', 'value', 'artifact', 'indicator', 'ioc', 'entity'],
  category: ['category', 'type', 'artifact_type', 'ioc_type', 'kind'],
  plane: ['plane', 'layer', 'tier'],
  time: ['time', 'timestamp', 'datetime', 'date', 'first_seen', 'when', 'occurred', 'event_time'],
  end: ['end', 'until', 'last_seen', 'end_time', 'through', 'ended'],
  aggregate: ['aggregate', 'many', 'stands_for', 'fan'],
  count: ['count', 'quantity', 'how_many'],
  confidence: ['confidence', 'certainty'],
  tactic: ['tactic', 'phase', 'stage', 'kill_chain', 'killchain', 'attack_tactic'],
  techniques: ['technique', 'techniques', 'attack', 'mitre', 'attck', 'technique_id'],
  commentary: ['commentary', 'notes', 'note', 'analysis', 'comment', 'description', 'narrative'],
  compromised: ['compromised', 'malicious', 'attacker_controlled', 'hostile'],
  from: ['from', 'source', 'src', 'source_node', 'parent', 'from_node'],
  to: ['to', 'target', 'dst', 'destination', 'target_node', 'child', 'to_node'],
  relation: ['relation', 'relationship', 'action', 'verb', 'behaviour', 'behavior'],
};

function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Map each column index to a known role, or leave it as a detail key. */
function mapHeaders(header: string[]): { roles: Map<number, string>; detailKeys: Map<number, string> } {
  const roles = new Map<number, string>();
  const detailKeys = new Map<number, string>();
  const taken = new Set<string>();

  header.forEach((raw, index) => {
    const norm = normaliseHeader(raw);
    if (!norm) return;
    let matched: string | null = null;
    for (const [role, aliases] of Object.entries(HEADER_ALIASES)) {
      if (taken.has(role)) continue;
      if (aliases.includes(norm)) {
        matched = role;
        break;
      }
    }
    if (matched) {
      roles.set(index, matched);
      taken.add(matched);
    } else {
      detailKeys.set(index, norm);
    }
  });

  return { roles, detailKeys };
}

function coerceBoolean(value: string): boolean {
  return /^(1|y|yes|true|t)$/i.test(value.trim());
}

function coerceConfidence(value: string): Confidence | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const named = (['confirmed', 'probable', 'possible', 'suspected'] as Confidence[]).find((c) => c === v);
  if (named) return named;
  // Numeric scales: 0-100 or 0-1.
  const n = Number(v);
  if (Number.isFinite(n)) {
    const pct = n <= 1 ? n * 100 : n;
    if (pct >= 85) return 'confirmed';
    if (pct >= 60) return 'probable';
    if (pct >= 35) return 'possible';
    return 'suspected';
  }
  if (v.startsWith('high')) return 'confirmed';
  if (v.startsWith('med')) return 'probable';
  if (v.startsWith('low')) return 'possible';
  return null;
}

function coerceTactic(value: string): Tactic | null {
  const v = normaliseHeader(value).replace(/_/g, '-');
  if (!v) return null;
  const direct = TACTICS.find((t) => t.id === v);
  if (direct) return direct.id;
  const loose = TACTICS.find((t) => normaliseHeader(t.label).replace(/_/g, '-') === v);
  return loose?.id ?? null;
}

function coercePlane(value: string): PlaneId | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const direct = ALL_PLANES.find((p) => p.id === v || p.label.toLowerCase() === v);
  if (direct) return direct.id;
  if (v.startsWith('host') || v.startsWith('endpoint')) return 'host';
  if (v.startsWith('net')) return 'network';
  if (v.startsWith('cloud')) return 'cloud';
  if (v === 'ot' || v.startsWith('ics') || v.startsWith('scada') || v.startsWith('oper')) return 'ot';
  if (v.startsWith('adv') || v.startsWith('actor')) return 'adversary';
  return null;
}

/** Read a "stands for many" column into a triangle direction. */
function coerceAggregate(value: string): 'fan-out' | 'converge' | null {
  const v = value.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (!v || v === 'no' || v === 'false' || v === '0' || v === 'none') return null;
  if (/^(fan-?out|one-to-many|1-to-many|scan|sweep|enumerat\w*|out)$/.test(v)) return 'fan-out';
  if (/^(converge|many-to-one|many-to-1|sessions?|beacons?|in)$/.test(v)) return 'converge';
  // A bare truthy value means many, and fanning out is the common case.
  if (/^(yes|true|1|many)$/.test(v)) return 'fan-out';
  return null;
}

function coerceRelation(value: string): RelationId | null {
  return matchRelation(value);
}

/**
 * Infer a category from the artifact's own value when the row does not say.
 * Deliberately narrow — a wrong guess is worse than `unknown`, which at least
 * shows up as something for the analyst to fix.
 */
function inferCategory(value: string): CategoryId {
  const v = value.trim();
  if (/^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/.test(v)) return 'ip-address';
  if (/^https?:\/\//i.test(v)) return 'url';
  if (/^[a-f0-9]{32}$|^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(v)) return 'file';
  if (/^CVE-\d{4}-\d{4,7}$/i.test(v)) return 'vulnerability';
  if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v)) return 'email';
  if (/^HK(?:LM|CU|CR|U|CC)\\/i.test(v)) return 'registry-key';
  if (/^[A-Za-z]:\\/.test(v)) return refineFileCategory(v);
  if (/\.[a-z0-9]{2,4}$/i.test(v) && /\./.test(v)) {
    const refined = refineFileCategory(v);
    if (refined !== 'file') return refined;
    return 'domain';
  }
  return 'unknown';
}

export function parseCsv(text: string, options: { name?: string } = {}): IngestResult {
  const sourceId = nextId('src');
  const warnings: string[] = [];
  const delimiter = sniffDelimiter(text);
  const rows = parseDelimited(text, delimiter);

  if (rows.length < 2) throw new Error('CSV needs a header row and at least one data row');

  const { roles, detailKeys } = mapHeaders(rows[0]);
  const hasLabel = [...roles.values()].includes('label');
  const hasEdgeCols = [...roles.values()].includes('from') && [...roles.values()].includes('to');

  if (!hasLabel && !hasEdgeCols) {
    throw new Error(
      `Could not find a usable column. Expected one of: ${HEADER_ALIASES.label.join(', ')} — or a from/to pair.`,
    );
  }

  const nodes: GibsenNode[] = [];
  const edges: GibsenEdge[] = [];
  /** lower-cased label -> node, so edge rows can name artifacts by label. */
  const byLabel = new Map<string, GibsenNode>();
  /** Edge rows are resolved after every artifact row has been seen. */
  const pendingEdges: { from: string; to: string; relation: RelationId; t: string | null; note: string; confidence: Confidence }[] = [];

  const cellFor = (row: string[], role: string): string => {
    for (const [index, r] of roles) {
      if (r === role) return (row[index] ?? '').trim();
    }
    return '';
  };

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const label = cellFor(row, 'label');
    const from = cellFor(row, 'from');
    const to = cellFor(row, 'to');

    // Relationship row.
    if (!label && from && to) {
      const rawRelation = cellFor(row, 'relation');
      if (rawRelation && !coerceRelation(rawRelation)) {
        warnings.push(`Row ${i + 1}: behaviour "${rawRelation}" is not in the vocabulary; recorded as "related to".`);
      }
      pendingEdges.push({
        from,
        to,
        relation: coerceRelation(rawRelation) ?? 'related-to',
        t: parseTimestamp(cellFor(row, 'time')),
        note: cellFor(row, 'commentary'),
        confidence: coerceConfidence(cellFor(row, 'confidence')) ?? 'probable',
      });
      continue;
    }

    if (!label) {
      warnings.push(`Row ${i + 1} has no artifact label and no from/to pair; skipped.`);
      continue;
    }

    const rawCategory = cellFor(row, 'category');
    let category = matchCategory(rawCategory) ?? inferCategory(label);
    if (category === 'file') category = refineFileCategory(label);
    if (rawCategory && !matchCategory(rawCategory)) {
      warnings.push(`Row ${i + 1}: category "${rawCategory}" is not in the GIBSEN vocabulary; inferred "${category}".`);
    }

    const details: Record<string, string> = { value: label };
    for (const [index, key] of detailKeys) {
      const v = (row[index] ?? '').trim();
      if (v) details[key] = v;
    }

    const t = parseTimestamp(cellFor(row, 'time'));
    const tEnd = parseTimestamp(cellFor(row, 'end'));
    const techniquesRaw = cellFor(row, 'techniques');

    const aggregateKind = coerceAggregate(cellFor(row, 'aggregate'));
    const countRaw = cellFor(row, 'count');
    const count = countRaw && Number.isFinite(Number(countRaw)) ? Number(countRaw) : null;

    const node = makeNode({
      label: truncateLabel(label),
      category,
      plane: coercePlane(cellFor(row, 'plane')) ?? undefined,
      t,
      tEnd,
      timeBasis: t ? 'observed' : 'unknown',
      confidence: coerceConfidence(cellFor(row, 'confidence')) ?? 'probable',
      tactic: coerceTactic(cellFor(row, 'tactic')),
      techniques: techniquesRaw ? techniquesRaw.split(/[,;\s]+/).filter(Boolean).map((s) => s.toUpperCase()) : [],
      details,
      commentary: cellFor(row, 'commentary'),
      compromised: coerceBoolean(cellFor(row, 'compromised')),
      // A count on its own is enough to mean "many" — the direction defaults.
      aggregate: aggregateKind || count ? { kind: aggregateKind ?? 'fan-out', count } : null,
      sources: [sourceId],
    });

    nodes.push(node);
    byLabel.set(label.trim().toLowerCase(), node);

    // Some sheets mix both shapes: an artifact row that also names a parent.
    if (from && label) {
      const rawRelation = cellFor(row, 'relation');
      if (rawRelation && !coerceRelation(rawRelation)) {
        warnings.push(`Row ${i + 1}: behaviour "${rawRelation}" is not in the vocabulary; recorded as "related to".`);
      }
      pendingEdges.push({
        from,
        to: label,
        relation: coerceRelation(rawRelation) ?? 'related-to',
        t,
        note: '',
        confidence: 'probable',
      });
    }
  }

  const resolve = (label: string): GibsenNode | null => {
    const key = label.trim().toLowerCase();
    const found = byLabel.get(key);
    if (found) return found;
    // Edge rows may reference artifacts that were never given their own row.
    const created = makeNode({
      label: truncateLabel(label),
      category: inferCategory(label),
      confidence: 'possible',
      details: { value: label },
      commentary: 'Referenced by a relationship row but never defined as an artifact.',
      sources: [sourceId],
    });
    nodes.push(created);
    byLabel.set(key, created);
    return created;
  };

  for (const p of pendingEdges) {
    const from = resolve(p.from);
    const to = resolve(p.to);
    if (!from || !to || from.id === to.id) continue;
    edges.push(
      makeEdge({
        from: from.id,
        to: to.id,
        relation: p.relation,
        t: p.t,
        confidence: p.confidence,
        commentary: p.note,
        sources: [sourceId],
      }),
    );
  }

  if (nodes.length) nodes[0].pivot = true;

  const unclassified = nodes.filter((n) => n.category === 'unknown').length;
  if (unclassified > 0) {
    warnings.push(`${unclassified} artifact(s) could not be classified. Set their category in the inspector.`);
  }

  return {
    nodes,
    edges,
    warnings,
    source: {
      id: sourceId,
      name: options.name ?? 'Spreadsheet',
      format: 'csv',
      ingestedAt: new Date().toISOString(),
      nodeCount: nodes.length,
    },
  };
}

/** Column reference used by the UI's help panel and the README. */
export const CSV_COLUMN_HELP = Object.entries(HEADER_ALIASES).map(([role, aliases]) => ({ role, aliases }));

/** Every category id, for documenting what the `category` column accepts. */
export const CSV_CATEGORY_VALUES = CATEGORIES.map((c) => c.id);
