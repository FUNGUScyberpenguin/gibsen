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

  it('does not coarsen away distinct events just to stay narrow', () => {
    // 40 separate minutes stay 40 separate columns by default: merging them
    // would destroy the sequence the X axis exists to show.
    const stamps = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2024, 2, 14, 8, i)).toISOString());
    expect(chooseGranularity(stamps)).toBe('second');
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

  it('sizes the box to the longest label in the incident', () => {
    const short = emptyIncident();
    short.nodes.push(makeNode({ label: 'a.example.com', category: 'domain', t: '2024-03-14T08:00:00Z' }));
    const shortResult = layout(short);
    expect(shortResult.labelLines).toBe(1);

    const long = emptyIncident();
    long.nodes.push(
      makeNode({
        label: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\KettleUpdate',
        category: 'registry-key',
        t: '2024-03-14T08:00:00Z',
      }),
    );
    const longResult = layout(long);
    expect(longResult.labelLines).toBeGreaterThan(1);
    // Every box grows together, so the lane packing and column grid stay square.
    expect(longResult.nodeHeight).toBeGreaterThan(shortResult.nodeHeight);
    expect(longResult.nodes.every((n) => n.h === longResult.nodeHeight)).toBe(true);
  });

  it('keeps a long identifier intact rather than eliding its middle', () => {
    const incident = emptyIncident();
    const label = 'HKLM\\System\\CurrentControlSet\\Services\\TicklerSvc';
    incident.nodes.push(makeNode({ label, category: 'registry-key', t: '2024-03-14T08:00:00Z' }));
    const result = layout(incident);
    // Three lines at this width is more than enough for a path of this length.
    expect(result.labelLines * Math.floor((result.nodeWidth - 24) / (12 * 0.601))).toBeGreaterThanOrEqual(label.length);
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

// ---------------------------------------------------------------------------
// The elastic axis
// ---------------------------------------------------------------------------

/** An incident whose artifacts sit at the given offsets, in minutes. */
function atMinutes(offsets: number[], tactics: (string | null)[] = []): Incident {
  const incident = emptyIncident('Paced');
  offsets.forEach((minutes, i) => {
    incident.nodes.push(
      makeNode({
        label: `artifact-${i}`,
        category: 'file',
        t: new Date(Date.UTC(2026, 2, 2, 9, 0) + minutes * 60_000).toISOString(),
        tactic: (tactics[i] ?? null) as never,
      }),
    );
  });
  return incident;
}

describe('columns to scale', () => {
  it('leaves no gap before the first column', () => {
    const { columns } = layout(atMinutes([0, 1, 2]), { granularity: 'minute' });
    expect(columns[0].gapBefore).toBe(0);
  });

  it('gives a longer interval a wider gap', () => {
    // One minute, then ten, then four hours.
    const { columns } = layout(atMinutes([0, 1, 11, 251]), { granularity: 'minute' });
    const gaps = columns.map((c) => c.gapBefore);

    expect(gaps[0]).toBe(0);
    expect(gaps[1]).toBe(0); // the unit interval itself earns no extra room
    expect(gaps[2]).toBeGreaterThan(gaps[1]);
    expect(gaps[3]).toBeGreaterThan(gaps[2]);
  });

  it('grows with the logarithm, so a long dwell cannot swamp the page', () => {
    const { columns } = layout(atMinutes([0, 1, 3, 1441]), { granularity: 'minute' });
    const [, , twoMinutes, oneDay] = columns.map((c) => c.gapBefore);

    // A day is 720× two minutes; its gap is nowhere near 720× as wide.
    expect(oneDay).toBeGreaterThan(twoMinutes);
    expect(oneDay).toBeLessThan(twoMinutes * 12);
  });

  it('says so out loud when a gap is too long to draw', () => {
    // Sixty days after the opening move.
    const { columns } = layout(atMinutes([0, 1, 2, 60 * 24 * 60]), { granularity: 'minute' });
    const last = columns[columns.length - 1];

    expect(last.elided).toBeTruthy();
    expect(last.elided).toMatch(/^\d+ days/);
    // Capped rather than allowed to run away.
    expect(last.gapBefore).toBeLessThan(400);
  });

  it('keeps the columns in order and the diagram wide enough for them', () => {
    const result = layout(atMinutes([0, 1, 11, 251]), { granularity: 'minute' });
    const xs = result.columns.map((c) => c.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(result.width).toBeGreaterThan(xs[xs.length - 1]);
  });

  it('falls back to even columns when asked', () => {
    const spaced = layout(atMinutes([0, 1, 11, 251]), { granularity: 'minute', timeToScale: false });
    expect(spaced.columns.every((c) => c.gapBefore === 0)).toBe(true);
    expect(spaced.columns.every((c) => c.elided === null)).toBe(true);

    // And the even layout is the narrower of the two.
    const scaled = layout(atMinutes([0, 1, 11, 251]), { granularity: 'minute' });
    expect(spaced.width).toBeLessThan(scaled.width);
  });

  it('stretches a spanning artifact to the column its end really falls in', () => {
    const incident = emptyIncident('Beacon');
    incident.nodes.push(
      makeNode({ label: 'start', category: 'file', t: '2026-03-02T09:00:00Z' }),
      makeNode({ label: 'gap', category: 'file', t: '2026-03-02T09:01:00Z' }),
      makeNode({
        label: 'svchost.exe',
        category: 'process',
        t: '2026-03-02T09:00:00Z',
        tEnd: '2026-03-02T13:00:00Z',
      }),
      makeNode({ label: 'end', category: 'file', t: '2026-03-02T13:00:00Z' }),
    );

    const result = layout(incident, { granularity: 'minute' });
    const beacon = result.nodes.find((n) => n.node.label === 'svchost.exe')!;
    const lastColumn = result.columns[result.columns.length - 1];

    expect(beacon.spanning).toBe(true);
    // Its right edge lands on the final column, gaps included.
    expect(beacon.x + beacon.w).toBeCloseTo(lastColumn.x + result.nodeWidth, 0);
  });
});

// ---------------------------------------------------------------------------
// Acts
// ---------------------------------------------------------------------------

describe('acts', () => {
  it('merges a run of columns sharing a tactic into one named act', () => {
    const incident = atMinutes([0, 1, 2, 3], ['execution', 'execution', 'impact', 'impact']);
    const { acts } = layout(incident, { granularity: 'minute' });

    expect(acts.map((a) => a.label)).toEqual(['Execution', 'Impact']);
    expect(acts[0].startCol).toBe(0);
    expect(acts[1].startCol).toBe(2);
  });

  it('reaches back to the start of the axis when the opening columns are untagged', () => {
    const incident = atMinutes([0, 1, 2, 3], [null, null, 'execution', 'impact']);
    const { acts } = layout(incident, { granularity: 'minute' });

    // A band that starts a third of the way along reads as a rendering fault.
    expect(acts[0].startCol).toBe(0);
    expect(acts[0].x).toBeLessThanOrEqual(layout(incident, { granularity: 'minute' }).columns[0].x);
  });

  it('absorbs a single interloping column rather than breaking the phase in two', () => {
    // A beacon checking in mid-execution is not a phase of its own.
    const incident = atMinutes([0, 1, 2], ['execution', 'command-and-control', 'execution']);
    const { acts } = layout(incident, { granularity: 'minute' });
    expect(acts).toEqual([]); // one act covering everything is dropped as saying nothing
  });

  it('lets an untagged column extend the act it sits inside', () => {
    const incident = atMinutes([0, 1, 2, 3], ['execution', null, 'impact', 'impact']);
    const { acts } = layout(incident, { granularity: 'minute' });

    expect(acts.map((a) => a.label)).toEqual(['Execution', 'Impact']);
    expect(acts[0].endCol).toBe(1);
  });

  it('says nothing when one act would cover the whole incident', () => {
    const incident = atMinutes([0, 1, 2], ['execution', 'execution', 'execution']);
    expect(layout(incident, { granularity: 'minute' }).acts).toEqual([]);
  });

  it('says nothing when no artifact carries a tactic', () => {
    expect(layout(atMinutes([0, 1, 2]), { granularity: 'minute' }).acts).toEqual([]);
  });

  it('reports how long an act ran, when it ran across more than one column', () => {
    const incident = atMinutes([0, 1, 2, 62], ['execution', 'execution', 'execution', 'impact']);
    const { acts } = layout(incident, { granularity: 'minute' });
    expect(acts[0].duration).toBe('2 minutes');
    expect(acts[1].duration).toBe(null);
  });

  it('makes room above the axis only when there are acts to put there', () => {
    const withActs = layout(atMinutes([0, 1], ['execution', 'impact']), { granularity: 'minute' });
    const without = layout(atMinutes([0, 1]), { granularity: 'minute' });

    expect(withActs.headerHeight).toBeGreaterThan(without.headerHeight);
    // And everything below starts lower to match.
    expect(withActs.bands[0].y).toBeGreaterThan(without.bands[0].y);
  });

  it('can be turned off', () => {
    const off = layout(atMinutes([0, 1], ['execution', 'impact']), { granularity: 'minute', showActs: false });
    expect(off.acts).toEqual([]);
    expect(off.headerHeight).toBe(layout(atMinutes([0, 1]), { granularity: 'minute' }).headerHeight);
  });

  it('names the phases of a real sample in kill-chain order', () => {
    const incident = emptyIncident('Sample');
    mergeIngest(incident, parseCsv(SAMPLES.find((s) => s.id === 'malware-path')!.content));

    const { acts } = layout(incident);
    const labels = acts.map((a) => a.label);

    expect(acts.length).toBeGreaterThan(2);
    expect(labels[0]).toBe('Initial Access');
    expect(labels).toContain('Impact');
    expect(labels).toContain('Exfiltration');
    // Whatever the phases turn out to be, they tile the axis in order.
    acts.forEach((act, i) => {
      expect(act.endCol).toBeGreaterThanOrEqual(act.startCol);
      if (i > 0) expect(act.startCol).toBeGreaterThan(acts[i - 1].endCol);
    });
  });

  it('does not let one long-running artifact stamp its tactic over the whole incident', () => {
    const incident = emptyIncident('Beacon');
    incident.nodes.push(
      makeNode({ label: 'lure', category: 'email', t: '2026-03-02T09:00:00Z', tactic: 'initial-access' }),
      makeNode({
        label: 'svchost.exe',
        category: 'process',
        t: '2026-03-02T09:01:00Z',
        tEnd: '2026-03-02T09:05:00Z',
        tactic: 'command-and-control',
      }),
      makeNode({ label: 'ransomware', category: 'ransomware', t: '2026-03-02T09:04:00Z', tactic: 'impact' }),
      makeNode({ label: 'note.txt', category: 'ransom-note', t: '2026-03-02T09:05:00Z', tactic: 'impact' }),
    );

    // The beacon spans to the end, but impact still gets its own act.
    expect(layout(incident, { granularity: 'minute' }).acts.map((a) => a.label)).toContain('Impact');
  });
});

describe('the axis in a reader’s own zone', () => {
  /** 09:00 UTC on a Monday in March, which is 04:00 in New York. */
  const morning = () => atMinutes([0, 1, 2]);

  it('labels the axis in UTC by default, and says so', () => {
    const result = layout(morning(), { granularity: 'minute' });
    expect(result.timeZone).toBe('UTC');
    expect(result.columns[0].label).toBe('09:00');
  });

  it('relabels the columns without touching what is stored', () => {
    const incident = morning();
    const stored = incident.nodes.map((n) => n.t);
    const result = layout(incident, { granularity: 'minute', timeZone: 'America/New_York' });

    expect(result.columns[0].label).toBe('04:00');
    expect(result.timeZone).toBe('America/New_York');
    // Sorting and storage stay UTC: that is the only way the order is trustworthy.
    expect(incident.nodes.map((n) => n.t)).toEqual(stored);
    expect(result.columns[0].key).toBe('2026-03-02T09:00:00.000Z');
  });

  it('marks the hours nobody should have been working in', () => {
    // 09:00 UTC is inside working hours; 04:00 in New York is not.
    expect(layout(morning(), { granularity: 'minute' }).columns.every((c) => !c.outOfHours)).toBe(true);
    expect(
      layout(morning(), { granularity: 'minute', timeZone: 'America/New_York' }).columns.every((c) => c.outOfHours),
    ).toBe(true);
  });

  it('counts a weekend as out of hours whatever the clock says', () => {
    const incident = emptyIncident('Weekend');
    // 7 March 2026 is a Saturday; 14:00 would be working hours on a weekday.
    incident.nodes.push(
      makeNode({ label: 'a', category: 'file', t: '2026-03-06T14:00:00Z' }),
      makeNode({ label: 'b', category: 'file', t: '2026-03-07T14:00:00Z' }),
    );
    const { columns } = layout(incident, { granularity: 'hour' });
    expect(columns.map((c) => c.outOfHours)).toEqual([false, true]);
  });

  it('never marks the unsequenced column, which has no clock at all', () => {
    const incident = emptyIncident('Loose');
    incident.nodes.push(
      makeNode({ label: 'a', category: 'file' }),
      makeNode({ label: 'b', category: 'file', t: '2026-03-02T03:00:00Z' }),
    );
    const { columns } = layout(incident, { granularity: 'hour' });
    expect(columns[0].key).toBe(null);
    expect(columns[0].outOfHours).toBe(false);
  });
});
