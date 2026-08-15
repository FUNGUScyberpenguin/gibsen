/**
 * STIX 2.x bundle parser.
 *
 * Handles the shapes that actually turn up in shared CTI: SCOs (observables),
 * the common SDOs, `indicator` pattern strings, `relationship` SROs and
 * `sighting`s. ATT&CK `attack-pattern` objects are folded into the artifacts
 * that reference them rather than drawn as nodes, since a technique is a
 * property of a behaviour, not an artifact on a plane.
 */

import type { CategoryId, GibsenEdge, GibsenNode, IngestResult, RelationId } from '../model/types';
import { makeEdge, makeNode, nextId } from '../model/incident';
import { parseTimestamp, refineFileCategory, truncateLabel } from './common';

type StixObject = Record<string, any>;

const TYPE_CATEGORY: Record<string, CategoryId> = {
  'ipv4-addr': 'ip-address',
  'ipv6-addr': 'ip-address',
  'domain-name': 'domain',
  url: 'url',
  file: 'file',
  directory: 'file',
  process: 'process',
  'user-account': 'user-account',
  'windows-registry-key': 'registry-key',
  'email-addr': 'email',
  'email-message': 'email',
  'network-traffic': 'network-traffic',
  'autonomous-system': 'network-traffic',
  'x509-certificate': 'certificate',
  mutex: 'process',
  software: 'tool',
  malware: 'malware',
  'threat-actor': 'threat-actor',
  'intrusion-set': 'threat-actor',
  campaign: 'campaign',
  tool: 'tool',
  vulnerability: 'vulnerability',
  identity: 'user-account',
  infrastructure: 'server',
};

const RELATIONSHIP_MAP: Record<string, RelationId> = {
  'communicates-with': 'connects-to',
  'beacons-to': 'beacons-to',
  'downloads': 'downloads-from',
  'downloaded-from': 'downloads-from',
  'drops': 'writes',
  'exploits': 'exploits',
  'delivers': 'delivers',
  'resolves-to': 'resolves-to',
  'hosts': 'hosts',
  'impersonates': 'impersonates',
  'exfiltrates-to': 'exfiltrates-to',
  'authenticates-to': 'authenticates-to',
  'connects-to': 'connects-to',
  'controls': 'connects-to',
  'compromises': 'moves-laterally-to',
};

/** Best display label for an observable or domain object. */
function labelFor(o: StixObject): string {
  const direct =
    o.name ??
    o.value ??
    o.key ??
    o.subject ??
    o.command_line ??
    o.user_id ??
    o.account_login ??
    o.path ??
    o.serial_number;
  if (direct) return String(direct);

  if (o.hashes && typeof o.hashes === 'object') {
    const h = o.hashes as Record<string, string>;
    const first = h['SHA-256'] ?? h['SHA-1'] ?? h['MD5'] ?? Object.values(h)[0];
    if (first) return String(first);
  }
  if (o.type === 'network-traffic') {
    const proto = Array.isArray(o.protocols) ? o.protocols.join('/') : 'flow';
    return `${proto} ${o.src_port ?? '?'}→${o.dst_port ?? '?'}`;
  }
  if (o.type === 'autonomous-system' && o.number) return `AS${o.number}`;
  if (o.pid) return `pid ${o.pid}`;
  return o.type ? String(o.type) : '(unnamed)';
}

/** Non-label fields worth carrying into the inspector. */
function detailsFor(o: StixObject): Record<string, string> {
  const details: Record<string, string> = {};
  const carry = [
    'pid',
    'command_line',
    'src_port',
    'dst_port',
    'protocols',
    'size',
    'account_type',
    'is_privileged',
    'description',
    'aliases',
    'malware_types',
    'infrastructure_types',
    'roles',
    'sophistication',
    'number',
    'subject',
    'path',
  ];
  for (const k of carry) {
    const v = o[k];
    if (v === undefined || v === null || v === '') continue;
    details[k] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  if (o.hashes && typeof o.hashes === 'object') {
    for (const [alg, val] of Object.entries(o.hashes as Record<string, string>)) {
      details[alg.toLowerCase()] = String(val);
    }
  }
  return details;
}

function timeFor(o: StixObject): string | null {
  return (
    parseTimestamp(o.first_observed) ??
    parseTimestamp(o.first_seen) ??
    parseTimestamp(o.valid_from) ??
    parseTimestamp(o.created) ??
    parseTimestamp(o.modified) ??
    null
  );
}

/** Refine a generic STIX type using the object's own fields. */
function categoryFor(o: StixObject): CategoryId {
  const base = TYPE_CATEGORY[o.type] ?? 'unknown';

  if (o.type === 'file') {
    const name = o.name ? String(o.name) : '';
    return name ? refineFileCategory(name) : 'file';
  }
  if (o.type === 'malware') {
    const kinds: string[] = (o.malware_types ?? []).map((t: string) => String(t).toLowerCase());
    if (kinds.includes('ransomware')) return 'ransomware';
    if (kinds.includes('backdoor') || kinds.includes('remote-access-trojan')) return 'backdoor';
    if (kinds.includes('webshell')) return 'webshell';
    return 'malware';
  }
  if (o.type === 'infrastructure') {
    const kinds: string[] = (o.infrastructure_types ?? []).map((t: string) => String(t).toLowerCase());
    if (kinds.some((k) => k.includes('command-and-control'))) return 'c2-server';
    if (kinds.some((k) => k.includes('phishing'))) return 'email-gateway';
    if (kinds.some((k) => k.includes('exfiltration'))) return 'cloud-storage';
    return 'server';
  }
  return base;
}

/** Pull `type:property = 'value'` triples out of a STIX pattern string. */
export function parseStixPattern(pattern: string): { type: string; value: string }[] {
  const out: { type: string; value: string }[] = [];
  const re = /([a-z0-9-]+):([a-z0-9_.[\]'"-]+)\s*(?:=|LIKE|MATCHES)\s*'([^']+)'/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pattern)) !== null) {
    out.push({ type: m[1].toLowerCase(), value: m[3] });
  }
  return out;
}

/** ATT&CK technique id from an object's external references, if present. */
function techniqueId(o: StixObject): string | null {
  const refs = Array.isArray(o.external_references) ? o.external_references : [];
  for (const r of refs) {
    if (String(r?.source_name ?? '').toLowerCase().includes('mitre') && r?.external_id) {
      return String(r.external_id).toUpperCase();
    }
  }
  return null;
}

function cveId(o: StixObject): string | null {
  const refs = Array.isArray(o.external_references) ? o.external_references : [];
  for (const r of refs) {
    if (String(r?.source_name ?? '').toLowerCase() === 'cve' && r?.external_id) return String(r.external_id);
  }
  return null;
}

export function parseStix(raw: unknown, options: { name?: string } = {}): IngestResult {
  const sourceId = nextId('src');
  const warnings: string[] = [];
  const nodes: GibsenNode[] = [];
  const edges: GibsenEdge[] = [];

  const root = raw as StixObject;
  const objects: StixObject[] = Array.isArray(root?.objects)
    ? root.objects
    : Array.isArray(raw)
      ? (raw as StixObject[])
      : root?.type
        ? [root]
        : [];

  if (objects.length === 0) throw new Error('No STIX objects found — expected a bundle with an "objects" array');

  /** STIX id -> our node id. */
  const nodeByStixId = new Map<string, GibsenNode>();
  /** attack-pattern STIX id -> ATT&CK technique id. */
  const techniqueByStixId = new Map<string, string>();
  const relationships: StixObject[] = [];
  const sightings: StixObject[] = [];

  // Pass 1: index attack patterns so `uses` edges can annotate instead of draw.
  for (const o of objects) {
    if (o?.type === 'attack-pattern') {
      const tid = techniqueId(o);
      if (tid && o.id) techniqueByStixId.set(String(o.id), tid);
    }
  }

  // Pass 2: build nodes.
  for (const o of objects) {
    if (!o || typeof o !== 'object' || !o.type) continue;
    const type = String(o.type);

    if (type === 'relationship') {
      relationships.push(o);
      continue;
    }
    if (type === 'sighting') {
      sightings.push(o);
      continue;
    }
    if (
      type === 'attack-pattern' ||
      type === 'bundle' ||
      type === 'marking-definition' ||
      type === 'language-content' ||
      type === 'extension-definition' ||
      type === 'observed-data' ||
      type === 'note' ||
      type === 'opinion' ||
      type === 'grouping' ||
      type === 'report' ||
      type === 'course-of-action' ||
      type === 'location'
    ) {
      continue;
    }

    // `indicator` carries its artifacts inside a pattern string.
    if (type === 'indicator') {
      const pattern = String(o.pattern ?? '');
      const parts = parseStixPattern(pattern);
      if (parts.length === 0) {
        warnings.push(`Indicator ${o.id ?? ''} had a pattern this parser could not read.`);
        continue;
      }
      const t = timeFor(o);
      for (const part of parts) {
        let category = TYPE_CATEGORY[part.type] ?? 'unknown';
        if (category === 'file') category = refineFileCategory(part.value);
        const node = makeNode({
          label: truncateLabel(part.value),
          category,
          t,
          timeBasis: t ? 'observed' : 'unknown',
          // An indicator asserts maliciousness by definition.
          confidence: 'probable',
          compromised: true,
          details: { value: part.value, ...(o.name ? { indicator: String(o.name) } : {}), pattern },
          commentary: String(o.description ?? ''),
          sources: [sourceId],
        });
        nodes.push(node);
        // Only the first observable of a multi-part pattern claims the STIX id,
        // which is what relationship edges will attach to.
        if (o.id && !nodeByStixId.has(String(o.id))) nodeByStixId.set(String(o.id), node);
      }
      continue;
    }

    const category = categoryFor(o);
    const t = timeFor(o);
    const details = detailsFor(o);
    const cve = cveId(o);
    if (cve) details.cve = cve;

    const node = makeNode({
      label: truncateLabel(cve && category === 'vulnerability' ? cve : labelFor(o)),
      category,
      t,
      timeBasis: t ? 'observed' : 'unknown',
      confidence: 'probable',
      details: { ...details, stix_type: type },
      commentary: String(o.description ?? ''),
      compromised:
        category === 'malware' ||
        category === 'ransomware' ||
        category === 'backdoor' ||
        category === 'webshell' ||
        category === 'c2-server' ||
        category === 'threat-actor',
      sources: [sourceId],
    });
    nodes.push(node);
    if (o.id) nodeByStixId.set(String(o.id), node);
  }

  // Pass 3: relationships become edges, except `uses` onto a technique.
  for (const rel of relationships) {
    const type = String(rel.relationship_type ?? 'related-to');
    const sourceNode = nodeByStixId.get(String(rel.source_ref));
    const targetStixId = String(rel.target_ref);

    const technique = techniqueByStixId.get(targetStixId);
    if (technique && sourceNode) {
      sourceNode.techniques = [...new Set([...sourceNode.techniques, technique])];
      continue;
    }

    const targetNode = nodeByStixId.get(targetStixId);
    if (!sourceNode || !targetNode) continue;

    const relation = RELATIONSHIP_MAP[type] ?? 'related-to';
    edges.push(
      makeEdge({
        from: sourceNode.id,
        to: targetNode.id,
        relation,
        // Keep the original verb visible when we had to fall back.
        label: relation === 'related-to' && type !== 'related-to' ? type.replace(/-/g, ' ') : undefined,
        t: parseTimestamp(rel.start_time) ?? parseTimestamp(rel.created) ?? null,
        confidence: 'probable',
        commentary: String(rel.description ?? ''),
        sources: [sourceId],
      }),
    );
  }

  // Pass 4: sightings sharpen a node's time and confidence.
  for (const s of sightings) {
    const node = nodeByStixId.get(String(s.sighting_of_ref));
    if (!node) continue;
    const seen = parseTimestamp(s.first_seen) ?? parseTimestamp(s.created);
    if (seen && (!node.t || seen < node.t)) {
      node.t = seen;
      node.timeBasis = 'observed';
    }
    node.confidence = 'confirmed';
    if (s.count) node.details.sighting_count = String(s.count);
  }

  if (nodes.length) nodes[0].pivot = true;

  return {
    nodes,
    edges,
    warnings,
    source: {
      id: sourceId,
      name: options.name ?? 'STIX bundle',
      format: 'stix',
      ingestedAt: new Date().toISOString(),
      nodeCount: nodes.length,
    },
  };
}
