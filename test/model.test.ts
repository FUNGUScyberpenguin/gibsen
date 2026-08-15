import { beforeEach, describe, expect, it } from 'vitest';
import {
  dedupeKey,
  emptyIncident,
  makeEdge,
  makeNode,
  mergeIngest,
  parseIncident,
  removeNode,
  resetIds,
  timeframe,
} from '../src/model/incident';
import { defaultPlaneFor, matchCategory } from '../src/model/taxonomy';
import { ICONS } from '../src/model/icons';
import { CATEGORIES } from '../src/model/taxonomy';
import type { IngestResult } from '../src/model/types';

beforeEach(() => resetIds());

describe('taxonomy', () => {
  it('gives every category a glyph', () => {
    for (const category of CATEGORIES) {
      expect(ICONS[category.id], `missing icon for ${category.id}`).toBeTruthy();
    }
  });

  it('matches foreign vocabularies onto categories', () => {
    expect(matchCategory('ipv4-addr')).toBe('ip-address');
    expect(matchCategory('ip-dst')).toBe('ip-address');
    expect(matchCategory('IP Address')).toBe('ip-address');
    expect(matchCategory('domain-name')).toBe('domain');
    expect(matchCategory('intrusion-set')).toBe('threat-actor');
  });

  it('prefers the longest alias so specific types win', () => {
    expect(matchCategory('email-gateway')).toBe('email-gateway');
    expect(matchCategory('email')).toBe('email');
  });

  it('returns null rather than guessing wildly', () => {
    expect(matchCategory('flurble')).toBeNull();
    expect(matchCategory('')).toBeNull();
    expect(matchCategory(null)).toBeNull();
  });

  it('routes categories to sensible default planes', () => {
    expect(defaultPlaneFor('plc')).toBe('ot');
    expect(defaultPlaneFor('cloud-storage')).toBe('cloud');
    expect(defaultPlaneFor('process')).toBe('host');
    expect(defaultPlaneFor('domain')).toBe('network');
    expect(defaultPlaneFor('threat-actor')).toBe('adversary');
  });
});

describe('mergeIngest', () => {
  const resultWith = (nodes: ReturnType<typeof makeNode>[], edges: ReturnType<typeof makeEdge>[] = []): IngestResult => ({
    nodes,
    edges,
    warnings: [],
    source: { id: `src-${nodes.length}`, name: 'test', format: 'csv', ingestedAt: '2024-01-01T00:00:00.000Z', nodeCount: nodes.length },
  });

  it('collapses two sightings of the same artifact into one node', () => {
    const incident = emptyIncident();
    mergeIngest(incident, resultWith([makeNode({ label: 'a.example.com', category: 'domain', t: '2024-03-02T00:00:00Z' })]));
    mergeIngest(incident, resultWith([makeNode({ label: 'A.Example.com', category: 'domain', t: '2024-03-01T00:00:00Z' })]));

    expect(incident.nodes).toHaveLength(1);
    // The earliest sighting anchors the story.
    expect(incident.nodes[0].t).toBe('2024-03-01T00:00:00.000Z');
    expect(incident.sources).toHaveLength(2);
  });

  it('keeps artifacts with the same label but different categories apart', () => {
    const incident = emptyIncident();
    mergeIngest(
      incident,
      resultWith([
        makeNode({ label: 'shared', category: 'domain' }),
        makeNode({ label: 'shared', category: 'file' }),
      ]),
    );
    expect(incident.nodes).toHaveLength(2);
  });

  it('rewrites incoming edges onto the surviving nodes', () => {
    const incident = emptyIncident();
    mergeIngest(incident, resultWith([makeNode({ label: 'a.example.com', category: 'domain' })]));

    const dupe = makeNode({ label: 'a.example.com', category: 'domain' });
    const other = makeNode({ label: '203.0.113.1', category: 'ip-address' });
    mergeIngest(incident, resultWith([dupe, other], [makeEdge({ from: dupe.id, to: other.id, relation: 'resolves-to' })]));

    expect(incident.nodes).toHaveLength(2);
    expect(incident.edges).toHaveLength(1);
    expect(incident.edges[0].from).toBe(incident.nodes[0].id);
  });

  it('drops an edge whose ends collapsed onto the same artifact', () => {
    const incident = emptyIncident();
    const a = makeNode({ label: 'same', category: 'domain' });
    const b = makeNode({ label: 'SAME', category: 'domain' });
    mergeIngest(incident, resultWith([a, b], [makeEdge({ from: a.id, to: b.id, relation: 'related-to' })]));
    expect(incident.edges).toHaveLength(0);
  });

  it('does not duplicate an identical behaviour ingested twice', () => {
    const incident = emptyIncident();
    const build = () => {
      const a = makeNode({ label: 'a.example.com', category: 'domain' });
      const b = makeNode({ label: '203.0.113.1', category: 'ip-address' });
      return resultWith([a, b], [makeEdge({ from: a.id, to: b.id, relation: 'resolves-to' })]);
    };
    mergeIngest(incident, build());
    mergeIngest(incident, build());
    expect(incident.edges).toHaveLength(1);
  });

  it('accumulates evidence rather than overwriting it', () => {
    const incident = emptyIncident();
    mergeIngest(
      incident,
      resultWith([makeNode({ label: 'x.example.com', category: 'domain', confidence: 'possible', commentary: 'first look' })]),
    );
    mergeIngest(
      incident,
      resultWith([
        makeNode({
          label: 'x.example.com',
          category: 'domain',
          confidence: 'confirmed',
          commentary: 'second look',
          compromised: true,
          techniques: ['T1071'],
        }),
      ]),
    );

    const node = incident.nodes[0];
    expect(node.confidence).toBe('confirmed');
    expect(node.compromised).toBe(true);
    expect(node.techniques).toEqual(['T1071']);
    expect(node.commentary).toContain('first look');
    expect(node.commentary).toContain('second look');
  });
});

describe('dedupeKey', () => {
  it('is case and whitespace insensitive', () => {
    expect(dedupeKey({ category: 'domain', label: ' A.COM ' })).toBe(dedupeKey({ category: 'domain', label: 'a.com' }));
  });
});

describe('parseIncident', () => {
  it('round-trips a saved incident', () => {
    const incident = emptyIncident('Round trip');
    const a = makeNode({ label: 'a.example.com', category: 'domain', t: '2024-03-01T00:00:00Z' });
    const b = makeNode({ label: '203.0.113.1', category: 'ip-address' });
    incident.nodes.push(a, b);
    incident.edges.push(makeEdge({ from: a.id, to: b.id, relation: 'resolves-to' }));

    const restored = parseIncident(JSON.parse(JSON.stringify(incident)));
    expect(restored.name).toBe('Round trip');
    expect(restored.nodes.map((n) => n.label)).toEqual(['a.example.com', '203.0.113.1']);
    expect(restored.edges).toHaveLength(1);
    expect(restored.edges[0].from).toBe(a.id);
  });

  it('repairs an incomplete but recognisable file', () => {
    const restored = parseIncident({ gibsen: 1, nodes: [{ label: 'partial' }], edges: [] });
    expect(restored.nodes[0].category).toBe('unknown');
    expect(restored.nodes[0].confidence).toBe('probable');
    expect(restored.nodes[0].plane).toBe('host');
  });

  it('drops edges that point at missing artifacts', () => {
    const restored = parseIncident({
      gibsen: 1,
      nodes: [{ id: 'n1', label: 'a' }],
      edges: [{ from: 'n1', to: 'ghost', relation: 'related-to' }],
    });
    expect(restored.edges).toHaveLength(0);
  });

  it('rejects files that are not incidents', () => {
    expect(() => parseIncident({ hello: 'world' })).toThrow(/missing "gibsen": 1/);
    expect(() => parseIncident({ gibsen: 1 })).toThrow(/required/);
    expect(() => parseIncident(null)).toThrow(/expected a JSON object/);
  });
});

describe('incident mutation', () => {
  it('removes a node together with every edge touching it', () => {
    const incident = emptyIncident();
    const a = makeNode({ label: 'a', category: 'domain' });
    const b = makeNode({ label: 'b', category: 'ip-address' });
    const c = makeNode({ label: 'c', category: 'file' });
    incident.nodes.push(a, b, c);
    incident.edges.push(
      makeEdge({ from: a.id, to: b.id, relation: 'resolves-to' }),
      makeEdge({ from: b.id, to: c.id, relation: 'writes' }),
    );

    removeNode(incident, b.id);
    expect(incident.nodes.map((n) => n.label)).toEqual(['a', 'c']);
    expect(incident.edges).toHaveLength(0);
  });

  it('reports the observed window, ignoring unsequenced artifacts', () => {
    const incident = emptyIncident();
    incident.nodes.push(
      makeNode({ label: 'a', category: 'domain', t: '2024-03-02T00:00:00Z' }),
      makeNode({ label: 'b', category: 'domain', t: '2024-03-01T00:00:00Z' }),
      makeNode({ label: 'c', category: 'domain' }),
    );
    expect(timeframe(incident)).toEqual({
      start: '2024-03-01T00:00:00.000Z',
      end: '2024-03-02T00:00:00.000Z',
    });
  });

  it('reports a null window when nothing is timed', () => {
    expect(timeframe(emptyIncident())).toEqual({ start: null, end: null });
  });
});
