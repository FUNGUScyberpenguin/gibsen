/**
 * MISP event parser.
 *
 * Accepts a bare event, `{ "Event": {...} }`, or a `{ "response": [...] }`
 * envelope. MISP objects become small clusters of artifacts anchored on their
 * first attribute, and `ObjectReference` entries link those clusters together.
 */

import type { CategoryId, GibsenEdge, GibsenNode, IngestResult, RelationId, Tactic } from '../model/types';
import { makeEdge, makeNode, nextId } from '../model/incident';
import { matchCategory } from '../model/taxonomy';
import { parseTimestamp, refineFileCategory, truncateLabel } from './common';

type Json = Record<string, any>;

const ATTRIBUTE_CATEGORY: Record<string, CategoryId> = {
  'ip-src': 'ip-address',
  'ip-dst': 'ip-address',
  'ip-src|port': 'ip-address',
  'ip-dst|port': 'ip-address',
  domain: 'domain',
  hostname: 'domain',
  'domain|ip': 'domain',
  url: 'url',
  uri: 'url',
  link: 'url',
  md5: 'file',
  sha1: 'file',
  sha256: 'file',
  sha512: 'file',
  filename: 'file',
  'filename|md5': 'file',
  'filename|sha1': 'file',
  'filename|sha256': 'file',
  'malware-sample': 'malware',
  'attachment': 'file',
  email: 'email',
  'email-src': 'email',
  'email-dst': 'email',
  'email-subject': 'email',
  'email-attachment': 'email',
  regkey: 'registry-key',
  'regkey|value': 'registry-key',
  mutex: 'process',
  'windows-service-name': 'service',
  'windows-scheduled-task': 'scheduled-task',
  'user-agent': 'network-traffic',
  'http-method': 'network-traffic',
  port: 'network-traffic',
  'x509-fingerprint-sha1': 'certificate',
  'ja3-fingerprint-md5': 'certificate',
  vulnerability: 'vulnerability',
  'threat-actor': 'threat-actor',
  campaign: 'campaign',
  'target-user': 'user-account',
  'target-machine': 'workstation',
  'target-email': 'email',
  'github-username': 'user-account',
  'whois-registrant-email': 'email',
  comment: 'unknown',
  text: 'unknown',
  other: 'unknown',
};

const MISP_CATEGORY_TACTIC: Record<string, Tactic> = {
  'payload delivery': 'initial-access',
  'network activity': 'command-and-control',
  'persistence mechanism': 'persistence',
  'artifacts dropped': 'execution',
  'payload installation': 'execution',
  'payload type': 'execution',
  'external analysis': 'reconnaissance',
  'targeting data': 'reconnaissance',
  'financial fraud': 'impact',
};

const OBJECT_RELATION: Record<string, RelationId> = {
  'downloaded-from': 'downloads-from',
  'downloads-from': 'downloads-from',
  'communicates-with': 'connects-to',
  'connects-to': 'connects-to',
  'resolves-to': 'resolves-to',
  'drops': 'writes',
  'executes': 'executes',
  'executed-by': 'executes',
  'delivers': 'delivers',
  'exploits': 'exploits',
  'contains': 'related-to',
  'included-in': 'related-to',
  'derived-from': 'related-to',
};

/** Peel the various MISP envelopes down to a list of events. */
function extractEvents(raw: unknown): Json[] {
  if (Array.isArray(raw)) return raw.flatMap((r) => extractEvents(r));
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Json;
  if (Array.isArray(obj.response)) return obj.response.flatMap((r: unknown) => extractEvents(r));
  if (obj.Event) return extractEvents(obj.Event);
  if (obj.Attribute || obj.Object || obj.info) return [obj];
  return [];
}

export function parseMisp(raw: unknown, options: { name?: string } = {}): IngestResult {
  const sourceId = nextId('src');
  const warnings: string[] = [];
  const nodes: GibsenNode[] = [];
  const edges: GibsenEdge[] = [];

  const events = extractEvents(raw);
  if (events.length === 0) throw new Error('No MISP event found — expected an "Event" object or a "response" array');

  /** MISP object uuid -> the node other objects should point at. */
  const anchorByUuid = new Map<string, GibsenNode>();

  for (const event of events) {
    const eventTime =
      parseTimestamp(event.timestamp) ?? parseTimestamp(event.date) ?? parseTimestamp(event.publish_timestamp);

    const buildAttribute = (attr: Json): GibsenNode | null => {
      const rawType = String(attr.type ?? '').toLowerCase();
      const rawValue = String(attr.value ?? attr.value1 ?? '').trim();
      if (!rawValue) return null;

      // Composite types like `filename|sha256` pack two facts into one value.
      const typeParts = rawType.split('|');
      const valueParts = rawValue.split('|');
      const primaryType = typeParts[0];
      const primaryValue = valueParts[0];

      const details: Record<string, string> = { value: primaryValue, misp_type: rawType };
      for (let i = 1; i < typeParts.length; i += 1) {
        if (valueParts[i]) details[typeParts[i]] = valueParts[i];
      }
      if (attr.category) details.misp_category = String(attr.category);
      if (attr.comment) details.comment = String(attr.comment);

      let category =
        ATTRIBUTE_CATEGORY[rawType] ??
        ATTRIBUTE_CATEGORY[primaryType] ??
        matchCategory(primaryType) ??
        'unknown';
      if (category === 'file') category = refineFileCategory(primaryValue);

      const t = parseTimestamp(attr.timestamp) ?? eventTime;
      const mispCategory = String(attr.category ?? '').toLowerCase();

      const node = makeNode({
        label: truncateLabel(primaryValue),
        category,
        t,
        timeBasis: parseTimestamp(attr.timestamp) ? 'observed' : t ? 'inferred' : 'unknown',
        // `to_ids` means MISP considers it detection-worthy, not merely context.
        confidence: attr.to_ids ? 'probable' : 'possible',
        tactic: MISP_CATEGORY_TACTIC[mispCategory] ?? null,
        details,
        commentary: String(attr.comment ?? ''),
        compromised: Boolean(attr.to_ids),
        sources: [sourceId],
      });
      nodes.push(node);
      return node;
    };

    for (const attr of (event.Attribute ?? []) as Json[]) {
      buildAttribute(attr);
    }

    for (const obj of (event.Object ?? []) as Json[]) {
      const members = ((obj.Attribute ?? []) as Json[]).map(buildAttribute).filter((n): n is GibsenNode => !!n);
      if (members.length === 0) continue;

      const anchor = members[0];
      if (obj.uuid) anchorByUuid.set(String(obj.uuid), anchor);
      if (obj.name) anchor.details.misp_object = String(obj.name);

      // Everything else in the object describes the anchor.
      for (const member of members.slice(1)) {
        edges.push(
          makeEdge({
            from: anchor.id,
            to: member.id,
            relation: 'related-to',
            label: obj.name ? String(obj.name) : undefined,
            confidence: 'probable',
            sources: [sourceId],
          }),
        );
      }
    }

    // Galaxy clusters name the actor behind the event.
    for (const galaxy of (event.Galaxy ?? []) as Json[]) {
      for (const cluster of (galaxy.GalaxyCluster ?? []) as Json[]) {
        const value = String(cluster.value ?? '').trim();
        if (!value) continue;
        const isActor = String(galaxy.type ?? '').includes('threat-actor') || String(galaxy.type ?? '').includes('intrusion-set');
        nodes.push(
          makeNode({
            label: truncateLabel(value),
            category: isActor ? 'threat-actor' : 'campaign',
            t: eventTime,
            timeBasis: eventTime ? 'inferred' : 'unknown',
            confidence: 'possible',
            details: { galaxy: String(galaxy.name ?? galaxy.type ?? '') },
            commentary: String(cluster.description ?? ''),
            compromised: true,
            sources: [sourceId],
          }),
        );
      }
    }
  }

  // Object references, resolved after every object has an anchor.
  for (const event of events) {
    for (const obj of (event.Object ?? []) as Json[]) {
      const from = obj.uuid ? anchorByUuid.get(String(obj.uuid)) : undefined;
      if (!from) continue;
      for (const ref of (obj.ObjectReference ?? []) as Json[]) {
        const to = anchorByUuid.get(String(ref.referenced_uuid));
        if (!to) continue;
        const rawRel = String(ref.relationship_type ?? '').toLowerCase();
        const relation = OBJECT_RELATION[rawRel] ?? 'related-to';
        edges.push(
          makeEdge({
            from: from.id,
            to: to.id,
            relation,
            label: relation === 'related-to' && rawRel ? rawRel.replace(/-/g, ' ') : undefined,
            confidence: 'probable',
            sources: [sourceId],
          }),
        );
      }
    }
  }

  if (nodes.length === 0) warnings.push('The MISP event contained no attributes this parser could use.');
  if (nodes.length) nodes[0].pivot = true;

  const name = options.name ?? String(events[0]?.info ?? 'MISP event');

  return {
    nodes,
    edges,
    warnings,
    source: {
      id: sourceId,
      name,
      format: 'misp',
      ingestedAt: new Date().toISOString(),
      nodeCount: nodes.length,
    },
  };
}
