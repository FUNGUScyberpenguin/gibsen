import { beforeEach, describe, expect, it } from 'vitest';
import { bucketStart, chooseGranularity, formatDelta, layout } from '../src/layout/layout';
import { emptyIncident, makeEdge, makeNode, resetIds } from '../src/model/incident';
import type { Incident } from '../src/model/types';
import { parseCsv } from '../src/ingest/csv';
import { mergeIngest } from '../src/model/incident';
import { SAMPLES } from '../src/samples';

beforeEach(() => resetIds());

describe('bucketStart', () => {
  it('floors to the requested unit', () => {
    expect(bucketStart('2024-03-14T08:12:37Z', 'minute')).toBe('2024-03-14T08:12:00.000Z');
    expect(bucketStart('2024-03-14T08:12:37Z', 'hour')).toBe('2024-03-14T08:00:00.000Z');
    expect(bucketStart('2024-03-14T08:12:37Z', 'day')).toBe('2024-03-14T00:00:00.000Z');
    expect(bucketStart('2024-03-14T08:12:37Z', 'five-minutes')).toBe('2024-03-14T08:10:00.000Z');
  });

  it('anchors weeks on Monday, not on the epoch', () => {
    // 14 Mar 2024 was a Thursday; its week starts Monday 11 Mar.
    expect(bucketStart('2024-03-14T08:12:37Z', 'week')).toBe('2024-03-11T00:00:00.000Z');
  });

  it('handles calendar months and years', () => {
    expect(bucketStart('2024-03-14T08:12:37Z', 'month')).toBe('2024-03-01T00:00:00.000Z');
    expect(bucketStart('2024-03-14T08:12:37Z', 'year')).toBe('2024-01-01T00:00:00.000Z');
  });
});

describe('chooseGranularity', () => {
  it('stays fine-grained when the incident is short', () => {
    const stamps = ['2024-03-14T08:12:00Z', '2024-03-14T08:13:00Z', '2024-03-14T08:14:00Z'];
    expect(chooseGranularity(stamps, 16)).toBe('second');
  });

  it('coarsens only as far as it needs to', () => {
    // 40 distinct minutes: per-minute overflows 16 columns, 5-minute buckets fit.
    const stamps = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2024, 2, 14, 8, i)).toISOString());
    expect(chooseGranularity(stamps, 16)).toBe('five-minutes');
  });

  it('coarsens all the way up for an incident spanning months', () => {
    const stamps = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i * 9)).toISOString());
    expect(chooseGranularity(stamps, 16)).toBe('month');
  });

  it('always returns a granularity that fits the column budget', () => {
    const stamps = Array.from({ length: 200 }, (_, i) => new Date(Date.UTC(2024, 2, 14, 0, i * 7)).toISOString());
    const granularity = chooseGranularity(stamps, 16);
    expect(new Set(stamps.map((s) => bucketStart(s, granularity))).size).toBeLessThanOrEqual(16);
  });

  it('falls back to a sane default with no timestamps', () => {
    expect(chooseGranularity([], 16)).toBe('minute');
  });
});

describe('formatDelta', () => {
  it('summarises a gap with two units of precision', () => {
    expect(formatDelta('2024-03-11T00:00:00Z', '2024-03-13T05:30:00Z')).toBe('+ 2d 5h');
    expect(formatDelta('2024-03-14T08:00:00Z', '2024-03-14T08:02:30Z')).toBe('+ 2m 30s');
  });

  it('returns null when no time passed', () => {
    expect(formatDelta('2024-03-14T08:00:00Z', '2024-03-14T08:00:00Z')).toBeNull();
  });
});

describe('layout', () => {
  const build = (): Incident => {
    const incident = emptyIncident('Layout fixture');
    const a = makeNode({ label: 'a.example.com', category: 'domain', t: '2024-03-14T08:00:00Z' });
    const b = makeNode({ label: '203.0.113.1', category: 'ip-address', t: '2024-03-14T09:00:00Z' });
    const c = makeNode({ label: 'loader.dll', category: 'executable', t: '2024-03-14T09:00:00Z' });
    const d = makeNode({ label: 'orphan', category: 'file' });
    incident.nodes.push(a, b, c, d);
    incident.edges.push(makeEdge({ from: a.id, to: b.id, relation: 'resolves-to' }));
    return incident;
  };

  it('gives each time bucket its own column, ordered left to right', () => {
    const result = layout(build(), { granularity: 'hour' });
    const timed = result.columns.filter((c) => c.key !== null);
    expect(timed.map((c) => c.key)).toEqual(['2024-03-14T08:00:00.000Z', '2024-03-14T09:00:00.000Z']);
    expect(timed[0].x).toBeLessThan(timed[1].x);
  });

  it('puts unsequenced artifacts in a leading column of their own', () => {
    const result = layout(build(), { granularity: 'hour' });
    expect(result.columns[0].key).toBeNull();
    expect(result.columns[0].label).toBe('Unsequenced');
  });

  it('omits the unsequenced column when everything is timed', () => {
    const incident = emptyIncident();
    incident.nodes.push(makeNode({ label: 'a', category: 'domain', t: '2024-03-14T08:00:00Z' }));
    expect(layout(incident).columns.every((c) => c.key !== null)).toBe(true);
  });

  it('hides empty planes by default and shows them on request', () => {
    const incident = build();
    expect(layout(incident).bands.map((b) => b.plane)).toEqual(['external-network', 'host-filesystem']);
    expect(layout(incident, { showEmptyPlanes: true }).bands).toHaveLength(8);
    expect(layout(incident, { planeSet: 'domain', showEmptyPlanes: true }).bands).toHaveLength(5);
  });

  const fourPlanes = () => {
    const incident = emptyIncident();
    incident.nodes.push(
      makeNode({ label: 'plc', category: 'plc', t: '2024-03-14T08:00:00Z' }),
      makeNode({ label: 'host', category: 'workstation', t: '2024-03-14T08:00:00Z' }),
      makeNode({ label: 'bucket', category: 'cloud-storage', t: '2024-03-14T08:00:00Z' }),
      makeNode({ label: 'dom', category: 'domain', t: '2024-03-14T08:00:00Z' }),
    );
    return incident;
  };

  it('orders the technical-domain bands cloud → network → host → OT', () => {
    const bands = layout(fourPlanes(), { planeSet: 'domain' }).bands;
    expect(bands.map((b) => b.plane)).toEqual(['cloud', 'network', 'host', 'ot']);
  });

  it("splits network and host the way the talk's artifact planes do", () => {
    const bands = layout(fourPlanes(), { planeSet: 'talk' }).bands;
    // A workstation is a network artifact in the talk's split, not a host plane.
    expect(bands.map((b) => b.plane)).toEqual(['cloud', 'external-network', 'internal-network', 'ot']);
  });

  it('puts the registry on a seam between memory and disk', () => {
    const incident = emptyIncident();
    incident.nodes.push(
      makeNode({ label: 'proc', category: 'process', t: '2024-03-14T08:00:00Z' }),
      makeNode({ label: 'HKCU\\Run\\X', category: 'registry-key', t: '2024-03-14T08:00:00Z' }),
      makeNode({ label: 'a.dll', category: 'executable', t: '2024-03-14T08:00:00Z' }),
    );
    const bands = layout(incident, { planeSet: 'talk' }).bands;
    expect(bands.map((b) => b.plane)).toEqual(['host-memory', 'host-registry', 'host-filesystem']);
    expect(bands.find((b) => b.plane === 'host-registry')?.boundary).toBe(true);
    expect(bands.filter((b) => b.plane !== 'host-registry').every((b) => !b.boundary)).toBe(true);
  });

  it('stacks bands top to bottom without gaps or overlaps', () => {
    const bands = layout(fourPlanes()).bands;
    for (let i = 1; i < bands.length; i += 1) {
      expect(bands[i].y).toBe(bands[i - 1].y + bands[i - 1].height);
    }
  });

  it('keeps a node in whichever plane the analyst moved it to', () => {
    const incident = emptyIncident();
    const node = makeNode({ label: 'odd', category: 'domain', t: '2024-03-14T08:00:00Z', plane: 'host-memory' });
    incident.nodes.push(node);
    expect(layout(incident, { planeSet: 'talk' }).bands.map((b) => b.plane)).toEqual(['host-memory']);
    // That plane is not in the other set, so the category decides there instead.
    expect(layout(incident, { planeSet: 'domain' }).bands.map((b) => b.plane)).toEqual(['network']);
  });

  it('stacks artifacts sharing a plane and a time bucket without overlapping', () => {
    const incident = emptyIncident();
    incident.nodes.push(
      makeNode({ label: 'one', category: 'workstation', t: '2024-03-14T08:00:00Z' }),
      makeNode({ label: 'two', category: 'server', t: '2024-03-14T08:00:30Z' }),
    );
    const result = layout(incident, { granularity: 'hour' });
    const [first, second] = result.nodes.sort((a, b) => a.y - b.y);
    expect(first.x).toBe(second.x);
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.h);
  });

  it('places every artifact exactly once', () => {
    const incident = build();
    const result = layout(incident);
    expect(result.nodes).toHaveLength(incident.nodes.length);
    expect(result.unplaced).toHaveLength(0);
    expect(new Set(result.nodes.map((n) => n.node.id)).size).toBe(incident.nodes.length);
  });

  it('keeps every node inside its plane band', () => {
    const result = layout(build());
    const bandFor = new Map(result.bands.map((b) => [b.plane, b]));
    for (const placed of result.nodes) {
      const band = bandFor.get(placed.plane)!;
      expect(placed.y).toBeGreaterThanOrEqual(band.y);
      expect(placed.y + placed.h).toBeLessThanOrEqual(band.y + band.height);
    }
  });

  it('routes an edge between the two artifacts it joins', () => {
    const result = layout(build());
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].path).toMatch(/^M [\d.-]+ [\d.-]+ C /);
    expect(result.edges[0].retrograde).toBe(false);
  });

  it('draws an artifact with an end time across the columns it was live for', () => {
    const incident = emptyIncident();
    incident.nodes.push(
      makeNode({
        label: 'staged.zip',
        category: 'archive',
        t: '2024-03-14T08:00:00Z',
        tEnd: '2024-03-14T11:00:00Z',
      }),
      makeNode({ label: 'other', category: 'file', t: '2024-03-14T09:00:00Z' }),
    );
    const result = layout(incident, { granularity: 'hour' });

    // The end time earns a column of its own even though nothing starts there.
    // 10:00 gets none, because nothing at all happened then — columns are
    // ordered buckets that hold something, not a continuous ruler.
    expect(result.columns.map((c) => c.key)).toEqual([
      '2024-03-14T08:00:00.000Z',
      '2024-03-14T09:00:00.000Z',
      '2024-03-14T11:00:00.000Z',
    ]);

    const staged = result.nodes.find((p) => p.node.label === 'staged.zip')!;
    expect(staged.spanning).toBe(true);
    expect(staged.w).toBeGreaterThan(result.nodes.find((p) => p.node.label === 'other')!.w);
  });

  it('lets two artifacts share a lane when their spans do not overlap', () => {
    const incident = emptyIncident();
    incident.nodes.push(
      makeNode({ label: 'early', category: 'file', t: '2024-03-14T08:00:00Z', tEnd: '2024-03-14T09:00:00Z' }),
      makeNode({ label: 'late', category: 'file', t: '2024-03-14T11:00:00Z', tEnd: '2024-03-14T12:00:00Z' }),
    );
    const result = layout(incident, { granularity: 'hour' });
    const [a, b] = result.nodes;
    expect(a.y).toBe(b.y);
  });

  it('gives overlapping spans lanes of their own', () => {
    const incident = emptyIncident();
    incident.nodes.push(
      makeNode({ label: 'one', category: 'file', t: '2024-03-14T08:00:00Z', tEnd: '2024-03-14T11:00:00Z' }),
      makeNode({ label: 'two', category: 'file', t: '2024-03-14T09:00:00Z', tEnd: '2024-03-14T12:00:00Z' }),
    );
    const result = layout(incident, { granularity: 'hour' });
    const [a, b] = result.nodes.sort((x, y) => x.y - y.y);
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.h);
  });

  it('ignores an end time that precedes the start', () => {
    const node = makeNode({ label: 'bad', category: 'file', t: '2024-03-14T09:00:00Z', tEnd: '2024-03-14T08:00:00Z' });
    expect(node.tEnd).toBeNull();
  });

  it('measures each edge span so the renderer can drop labels that will not fit', () => {
    const result = layout(build());
    expect(result.edges[0].span).toBeGreaterThan(0);
  });

  it('flags an edge that points backwards in time', () => {
    const incident = emptyIncident();
    const later = makeNode({ label: 'later', category: 'domain', t: '2024-03-14T10:00:00Z' });
    const earlier = makeNode({ label: 'earlier', category: 'domain', t: '2024-03-14T08:00:00Z' });
    incident.nodes.push(later, earlier);
    incident.edges.push(makeEdge({ from: later.id, to: earlier.id, relation: 'related-to' }));
    expect(layout(incident).edges[0].retrograde).toBe(true);
  });

  it('drops an edge whose endpoints are missing rather than throwing', () => {
    const incident = build();
    incident.edges.push(makeEdge({ from: 'ghost-a', to: 'ghost-b', relation: 'related-to' }));
    expect(layout(incident).edges).toHaveLength(1);
  });

  it('survives an empty incident', () => {
    const result = layout(emptyIncident());
    expect(result.nodes).toHaveLength(0);
    expect(result.columns).toHaveLength(1);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it('lays out the full sample spreadsheet across every plane it touches', () => {
    const incident = emptyIncident('Sample');
    const csv = SAMPLES.find((s) => s.id === 'csv')!;
    mergeIngest(incident, parseCsv(csv.content));

    const domain = layout(incident, { planeSet: 'domain' });
    expect(domain.bands.map((b) => b.plane)).toEqual(['cloud', 'network', 'host', 'ot']);

    const talk = layout(incident, { planeSet: 'talk' });
    expect(talk.bands.map((b) => b.plane)).toEqual([
      'cloud',
      'external-network',
      'internal-network',
      'host-memory',
      'host-registry',
      'host-filesystem',
      'ot',
    ]);

    expect(talk.nodes).toHaveLength(incident.nodes.length);
    expect(talk.columns.length).toBeGreaterThan(1);
  });
});
