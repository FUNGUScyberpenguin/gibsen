/**
 * Format detection and dispatch.
 *
 * Analysts drop in whatever they have. This picks a parser from the content
 * first and the filename second, so a `.txt` holding a STIX bundle still lands
 * in the STIX parser.
 */

import type { Incident, IngestResult } from '../model/types';
import { parseIncident } from '../model/incident';
import { parseCsv, parseDelimited, sniffDelimiter } from './csv';
import { parseMisp } from './misp';
import { parseStix } from './stix';
import { parseTextReport } from './text';

export type SourceFormat = 'gibsen' | 'stix' | 'misp' | 'csv' | 'text';

export type IngestOutcome =
  /** A parsed contribution to merge into the open incident. */
  | { kind: 'ingest'; result: IngestResult }
  /** A whole saved incident, which replaces rather than merges. */
  | { kind: 'incident'; incident: Incident };

export interface DetectedFormat {
  format: SourceFormat;
  /** Parsed JSON, when the content was JSON — saves parsing twice. */
  json?: unknown;
}

/** Decide which parser owns a blob of text. */
export function detectFormat(content: string, filename = ''): DetectedFormat {
  const trimmed = content.trim();
  const lower = filename.toLowerCase();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      // Malformed JSON is more useful read as prose than rejected outright.
      return { format: 'text' };
    }

    const probe = Array.isArray(json) ? (json[0] as Record<string, unknown>) : (json as Record<string, unknown>);
    if (probe && typeof probe === 'object') {
      if ((json as Record<string, unknown>).gibsen === 1) return { format: 'gibsen', json };
      if (probe.Event || probe.response || probe.Attribute || probe.Galaxy) return { format: 'misp', json };
      if (
        probe.type === 'bundle' ||
        Array.isArray(probe.objects) ||
        probe.spec_version ||
        (typeof probe.type === 'string' && typeof probe.id === 'string' && String(probe.id).includes('--'))
      ) {
        return { format: 'stix', json };
      }
    }
    // Unrecognised JSON: STIX is the more common shape, let it try and fail.
    return { format: 'stix', json };
  }

  if (/\.(?:csv|tsv|psv)$/.test(lower)) return { format: 'csv' };

  // Header-ish first line plus consistent column counts reads as a table.
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length >= 2) {
    const delimiter = sniffDelimiter(trimmed);
    const rows = parseDelimited(lines.slice(0, 5).join('\n'), delimiter);
    const widths = rows.map((r) => r.length);
    if (widths[0] >= 2 && widths.every((w) => w === widths[0])) return { format: 'csv' };
  }

  return { format: 'text' };
}

/** Parse one uploaded or pasted document. */
export function ingest(content: string, filename = ''): IngestOutcome {
  const { format, json } = detectFormat(content, filename);
  const name = filename || undefined;

  switch (format) {
    case 'gibsen':
      return { kind: 'incident', incident: parseIncident(json) };
    case 'stix':
      return { kind: 'ingest', result: parseStix(json, { name }) };
    case 'misp':
      return { kind: 'ingest', result: parseMisp(json, { name }) };
    case 'csv':
      return { kind: 'ingest', result: parseCsv(content, { name }) };
    case 'text':
    default:
      return { kind: 'ingest', result: parseTextReport(content, { name }) };
  }
}

export { parseCsv, parseMisp, parseStix, parseTextReport };
export type { IngestResult };
