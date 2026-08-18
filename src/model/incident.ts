/**
 * Incident construction, merging and validation.
 *
 * Parsers never build `GibsenNode`s by hand — they go through `makeNode` so
 * that defaults, id generation and dedupe keys stay in one place.
 */

import type {
  CategoryId,
  Confidence,
  GibsenEdge,
  GibsenNode,
  Incident,
  IngestResult,
  PlaneId,
  RelationId,
  TimeBasis,
} from './types';
import { defaultPlaneFor } from './taxonomy';
import { parseTimestamp } from './time';

let counter = 0;

/** Monotonic id. Deterministic within a run, which keeps tests readable. */
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter.toString(36)}`;
}

/** Reset the id counter. Test-only. */
export function resetIds(): void {
  counter = 0;
}

export interface NodeInit {
  label: string;
  category: CategoryId;
  plane?: PlaneId;
  t?: string | null;
  tEnd?: string | null;
  timeBasis?: TimeBasis;
  confidence?: Confidence;
  tactic?: GibsenNode['tactic'];
  techniques?: string[];
  details?: Record<string, string>;
  logs?: GibsenNode['logs'];
  commentary?: string;
  compromised?: boolean;
  pivot?: boolean;
  aggregate?: GibsenNode['aggregate'];
  sources?: string[];
}

export function makeNode(init: NodeInit): GibsenNode {
  // Normalised here rather than in each caller, so that comparing two `t`
  // values as strings is always a valid chronological comparison.
  const t = parseTimestamp(init.t);
  return {
    id: nextId('n'),
    label: init.label.trim() || '(unnamed)',
    category: init.category,
    plane: init.plane ?? defaultPlaneFor(init.category),
    t,
    // An end before the start is a data error, not a zero-length artifact.
    tEnd: (() => {
      const end = parseTimestamp(init.tEnd);
      return end && t && end > t ? end : null;
    })(),
    timeBasis: init.timeBasis ?? (t ? 'observed' : 'unknown'),
    confidence: init.confidence ?? 'probable',
    tactic: init.tactic ?? null,
    techniques: init.techniques ?? [],
    details: init.details ?? {},
    logs: init.logs ?? [],
    commentary: init.commentary ?? '',
    compromised: init.compromised ?? false,
    pivot: init.pivot ?? false,
    aggregate: init.aggregate ?? null,
    sources: init.sources ?? [],
  };
}

export interface EdgeInit {
  from: string;
  to: string;
  relation: RelationId;
  label?: string;
  t?: string | null;
  confidence?: Confidence;
  commentary?: string;
  sources?: string[];
}

export function makeEdge(init: EdgeInit): GibsenEdge {
  return {
    id: nextId('e'),
    from: init.from,
    to: init.to,
    relation: init.relation,
    label: init.label,
    t: parseTimestamp(init.t),
    confidence: init.confidence ?? 'probable',
    commentary: init.commentary ?? '',
    sources: init.sources ?? [],
  };
}

export function emptyIncident(name = 'Untitled incident'): Incident {
  const now = new Date().toISOString();
  return {
    gibsen: 1,
    id: nextId('i'),
    name,
    summary: '',
    createdAt: now,
    updatedAt: now,
    planeSet: 'talk',
    nodes: [],
    edges: [],
    sources: [],
  };
}

/**
 * Identity of an artifact for dedupe purposes. Two uploads describing the same
 * IP should produce one node carrying both sources, not two stacked nodes.
 */
export function dedupeKey(node: Pick<GibsenNode, 'category' | 'label'>): string {
  return `${node.category}::${node.label.trim().toLowerCase()}`;
}

/** Merge two nodes describing the same artifact, keeping the richer values. */
function mergeNode(target: GibsenNode, incoming: GibsenNode): void {
  // Prefer the earliest observed timestamp — the first sighting anchors the story.
  if (incoming.t && (!target.t || incoming.t < target.t)) {
    target.t = incoming.t;
    target.timeBasis = incoming.timeBasis;
  }
  if (rankConfidence(incoming.confidence) < rankConfidence(target.confidence)) {
    target.confidence = incoming.confidence;
  }
  // The artifact was live until the later of the two observations.
  if (incoming.tEnd && (!target.tEnd || incoming.tEnd > target.tEnd)) target.tEnd = incoming.tEnd;
  if (!target.aggregate && incoming.aggregate) target.aggregate = incoming.aggregate;
  target.compromised = target.compromised || incoming.compromised;
  target.pivot = target.pivot || incoming.pivot;
  if (!target.tactic && incoming.tactic) target.tactic = incoming.tactic;
  target.techniques = unique([...target.techniques, ...incoming.techniques]);
  target.sources = unique([...target.sources, ...incoming.sources]);
  target.logs = [...target.logs, ...incoming.logs];
  for (const [k, v] of Object.entries(incoming.details)) {
    if (!target.details[k]) target.details[k] = v;
  }
  if (incoming.commentary && !target.commentary.includes(incoming.commentary)) {
    target.commentary = [target.commentary, incoming.commentary].filter(Boolean).join('\n\n');
  }
}

function rankConfidence(c: Confidence): number {
  return ['confirmed', 'probable', 'possible', 'suspected'].indexOf(c);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/**
 * Fold an ingest result into an incident, deduping artifacts by identity and
 * rewriting the incoming edges onto whichever node survived.
 */
export function mergeIngest(incident: Incident, result: IngestResult): Incident {
  const byKey = new Map<string, GibsenNode>();
  for (const n of incident.nodes) byKey.set(dedupeKey(n), n);

  // Incoming node id -> id of the node it ended up as.
  const remap = new Map<string, string>();

  for (const incoming of result.nodes) {
    const key = dedupeKey(incoming);
    const existing = byKey.get(key);
    if (existing) {
      mergeNode(existing, incoming);
      remap.set(incoming.id, existing.id);
    } else {
      byKey.set(key, incoming);
      incident.nodes.push(incoming);
      remap.set(incoming.id, incoming.id);
    }
  }

  const seenEdges = new Set(incident.edges.map((e) => `${e.from}|${e.relation}|${e.to}`));
  for (const edge of result.edges) {
    const from = remap.get(edge.from) ?? edge.from;
    const to = remap.get(edge.to) ?? edge.to;
    if (from === to) continue; // dedupe collapsed both ends onto one artifact
    const sig = `${from}|${edge.relation}|${to}`;
    if (seenEdges.has(sig)) continue;
    seenEdges.add(sig);
    incident.edges.push({ ...edge, from, to });
  }

  incident.sources.push(result.source);
  incident.updatedAt = new Date().toISOString();
  return incident;
}

/**
 * Validate and normalise a parsed `.gibsen.json`. Throws on anything that is
 * not recognisably an incident; repairs anything merely incomplete, so a file
 * hand-edited by an analyst still loads.
 */
export function parseIncident(raw: unknown): Incident {
  if (!raw || typeof raw !== 'object') throw new Error('Not a GIBSEN incident: expected a JSON object');
  const obj = raw as Record<string, unknown>;
  if (obj.gibsen !== 1) throw new Error('Not a GIBSEN incident: missing "gibsen": 1 marker');
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) {
    throw new Error('Not a GIBSEN incident: "nodes" and "edges" arrays are required');
  }

  const nodes = (obj.nodes as Partial<GibsenNode>[]).map((n) => ({
    ...makeNode({
      label: String(n.label ?? '(unnamed)'),
      category: (n.category ?? 'unknown') as CategoryId,
      plane: n.plane,
      t: n.t ?? null,
      tEnd: n.tEnd ?? null,
      timeBasis: n.timeBasis,
      confidence: n.confidence,
      tactic: n.tactic,
      techniques: n.techniques ?? [],
      details: n.details ?? {},
      logs: n.logs ?? [],
      commentary: n.commentary ?? '',
      compromised: n.compromised ?? false,
      pivot: n.pivot ?? false,
      aggregate: n.aggregate ?? null,
      sources: n.sources ?? [],
    }),
    // Preserve the original id so edges keep resolving.
    id: String(n.id ?? nextId('n')),
  }));

  const ids = new Set(nodes.map((n) => n.id));
  const edges = (obj.edges as Partial<GibsenEdge>[])
    .filter((e) => ids.has(String(e.from)) && ids.has(String(e.to)))
    .map((e) => ({
      ...makeEdge({
        from: String(e.from),
        to: String(e.to),
        relation: (e.relation ?? 'related-to') as RelationId,
        label: e.label,
        t: e.t ?? null,
        confidence: e.confidence,
        commentary: e.commentary ?? '',
        sources: e.sources ?? [],
      }),
      id: String(e.id ?? nextId('e')),
    }));

  const now = new Date().toISOString();
  return {
    gibsen: 1,
    id: String(obj.id ?? nextId('i')),
    name: String(obj.name ?? 'Untitled incident'),
    summary: String(obj.summary ?? ''),
    createdAt: String(obj.createdAt ?? now),
    updatedAt: now,
    planeSet: obj.planeSet === 'domain' ? 'domain' : 'talk',
    nodes,
    edges,
    sources: Array.isArray(obj.sources) ? (obj.sources as Incident['sources']) : [],
  };
}

/** Remove a node and every edge touching it. */
export function removeNode(incident: Incident, nodeId: string): void {
  incident.nodes = incident.nodes.filter((n) => n.id !== nodeId);
  incident.edges = incident.edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
  incident.updatedAt = new Date().toISOString();
}

/** The observed time window of the incident, ignoring unsequenced artifacts. */
export function timeframe(incident: Incident): { start: string | null; end: string | null } {
  const stamps = incident.nodes.map((n) => n.t).filter((t): t is string => Boolean(t)).sort();
  return { start: stamps[0] ?? null, end: stamps[stamps.length - 1] ?? null };
}
