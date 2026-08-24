import { beforeEach, describe, expect, it } from 'vitest';
import { buildStory, elapsedInWords } from '../src/model/story';
import { emptyIncident, makeEdge, makeNode, mergeIngest, resetIds } from '../src/model/incident';
import { parseCsv } from '../src/ingest/csv';
import { SAMPLES } from '../src/samples';
import type { Incident } from '../src/model/types';

beforeEach(() => resetIds());

function chain(): Incident {
  const incident = emptyIncident('Tin Kettle');
  const lure = makeNode({ label: 'phishing lure', category: 'email', t: '2026-03-02T09:12:00Z' });
  const url = makeNode({ label: 'https://example.top/inv', category: 'url', t: '2026-03-02T09:13:00Z' });
  const dll = makeNode({
    label: 'tickler.dll',
    category: 'executable',
    t: '2026-03-02T09:14:00Z',
    commentary: 'Loader written to %APPDATA%.',
  });
  incident.nodes.push(lure, url, dll);
  incident.edges.push(
    makeEdge({ from: lure.id, to: url.id, relation: 'delivers' }),
    makeEdge({ from: url.id, to: dll.id, relation: 'writes' }),
  );
  return incident;
}

describe('elapsedInWords', () => {
  it('says how long, in words, to two units', () => {
    expect(elapsedInWords('2026-03-02T09:12:00Z', '2026-03-02T09:13:00Z')).toBe('1 minute later');
    expect(elapsedInWords('2026-03-02T09:12:00Z', '2026-03-02T10:29:00Z')).toBe('1 hour 17 minutes later');
    expect(elapsedInWords('2026-03-02T09:12:00Z', '2026-03-04T11:12:30Z')).toBe('2 days 2 hours later');
  });

  it('does not pretend to precision it does not have', () => {
    expect(elapsedInWords('2026-03-02T09:12:00Z', '2026-03-02T09:12:00Z')).toBe('at the same moment');
    expect(elapsedInWords('2026-03-02T09:12:00Z', '2026-03-02T09:11:00Z')).toBe('at the same moment');
  });
});

describe('buildStory', () => {
  it('walks the incident in time order', () => {
    const beats = buildStory(chain());
    expect(beats.map((b) => b.t)).toEqual([
      '2026-03-02T09:12:00.000Z',
      '2026-03-02T09:13:00.000Z',
      '2026-03-02T09:14:00.000Z',
    ]);
    expect(beats.map((b) => b.index)).toEqual([0, 1, 2]);
  });

  it('narrates each beat as a sentence somebody could read aloud', () => {
    const beats = buildStory(chain());
    expect(beats[0].sentence).toBe('The story starts with phishing lure — email message on the external network.');
    expect(beats[1].sentence).toBe('phishing lure delivers https://example.top/inv.');
    expect(beats[2].sentence).toBe('https://example.top/inv writes tickler.dll.');
  });

  it('says how long the attacker sat between beats', () => {
    const beats = buildStory(chain());
    expect(beats[0].since).toBe(null);
    expect(beats[1].since).toBe('1 minute later');
  });

  it('carries the analyst commentary through verbatim', () => {
    expect(buildStory(chain())[2].commentary).toBe('Loader written to %APPDATA%.');
  });

  it('lights the artifact and where it came from', () => {
    const beats = buildStory(chain());
    expect(beats[0].focusIds).toHaveLength(1);
    expect(beats[1].focusIds).toHaveLength(2);
    expect(beats[1].fromId).toBe(beats[0].nodeId);
  });

  it('reads a behaviour recorded backwards in the right direction', () => {
    const incident = emptyIncident('Reverse');
    const a = makeNode({ label: 'svchost.exe', category: 'process', t: '2026-03-02T09:00:00Z' });
    const b = makeNode({ label: '203.0.113.44', category: 'c2-server', t: '2026-03-02T09:31:00Z' });
    incident.nodes.push(a, b);
    // Recorded pointing at the process, from the later artifact.
    incident.edges.push(makeEdge({ from: b.id, to: a.id, relation: 'beacons-to' }));

    const beats = buildStory(incident);
    expect(beats[1].sentence).toBe('203.0.113.44 beacons to svchost.exe.');
  });

  it('says so when an artifact connects to nothing yet narrated', () => {
    const incident = emptyIncident('Orphan');
    incident.nodes.push(
      makeNode({ label: 'first.exe', category: 'executable', t: '2026-03-02T09:00:00Z' }),
      makeNode({ label: 'loose.dll', category: 'executable', t: '2026-03-02T09:05:00Z' }),
    );
    const beats = buildStory(incident);
    expect(beats[1].sentence).toContain('with nothing yet linking it to the rest');
    expect(beats[1].edgeId).toBe(null);
  });

  it('leaves unsequenced artifacts to the end rather than dropping them', () => {
    const incident = chain();
    incident.nodes.push(makeNode({ label: 'unknown.bin', category: 'file' }));
    const beats = buildStory(incident);
    expect(beats).toHaveLength(4);
    expect(beats[3].t).toBe(null);
  });

  it('covers every artifact in a real sample exactly once', () => {
    const incident = emptyIncident('Sample');
    mergeIngest(incident, parseCsv(SAMPLES.find((s) => s.id === 'malware-path')!.content));

    const beats = buildStory(incident);
    expect(beats).toHaveLength(incident.nodes.length);
    expect(new Set(beats.map((b) => b.nodeId)).size).toBe(incident.nodes.length);
    // A well-formed chain narrates as one: almost every beat has a behaviour.
    const connected = beats.filter((b) => b.edgeId).length;
    expect(connected).toBeGreaterThan(beats.length * 0.8);
  });

  it('handles an incident with nothing in it', () => {
    expect(buildStory(emptyIncident('Empty'))).toEqual([]);
  });
});

describe('acts along the walk', () => {
  it('names each beat with the phase it belongs to', () => {
    const incident = emptyIncident('Phased');
    incident.nodes.push(
      makeNode({ label: 'lure', category: 'email', t: '2026-03-02T09:00:00Z', tactic: 'initial-access' }),
      makeNode({ label: 'mshta.exe', category: 'executable', t: '2026-03-02T09:01:00Z', tactic: 'execution' }),
      makeNode({ label: 'loader.dll', category: 'executable', t: '2026-03-02T09:02:00Z', tactic: 'execution' }),
      makeNode({ label: 'ransomware', category: 'ransomware', t: '2026-03-02T09:03:00Z', tactic: 'impact' }),
    );
    expect(buildStory(incident).map((b) => b.act)).toEqual(['Initial Access', 'Execution', 'Execution', 'Impact']);
  });

  it('absorbs a lone interloper rather than breaking the phase in two', () => {
    const incident = emptyIncident('Beacon');
    incident.nodes.push(
      makeNode({ label: 'a', category: 'executable', t: '2026-03-02T09:00:00Z', tactic: 'execution' }),
      makeNode({ label: 'b', category: 'c2-server', t: '2026-03-02T09:01:00Z', tactic: 'command-and-control' }),
      makeNode({ label: 'c', category: 'executable', t: '2026-03-02T09:02:00Z', tactic: 'execution' }),
      makeNode({ label: 'd', category: 'ransomware', t: '2026-03-02T09:03:00Z', tactic: 'impact' }),
    );
    expect(buildStory(incident).map((b) => b.act)).toEqual(['Execution', 'Execution', 'Execution', 'Impact']);
  });

  it('carries an act over untagged beats, forwards and back to the start', () => {
    const incident = emptyIncident('Sparse');
    incident.nodes.push(
      makeNode({ label: 'a', category: 'file', t: '2026-03-02T09:00:00Z' }),
      makeNode({ label: 'b', category: 'executable', t: '2026-03-02T09:01:00Z', tactic: 'execution' }),
      makeNode({ label: 'c', category: 'file', t: '2026-03-02T09:02:00Z' }),
      makeNode({ label: 'd', category: 'ransomware', t: '2026-03-02T09:03:00Z', tactic: 'impact' }),
    );
    expect(buildStory(incident).map((b) => b.act)).toEqual(['Execution', 'Execution', 'Execution', 'Impact']);
  });

  it('says nothing when one act would cover the whole walk', () => {
    const incident = emptyIncident('Flat');
    incident.nodes.push(
      makeNode({ label: 'a', category: 'executable', t: '2026-03-02T09:00:00Z', tactic: 'execution' }),
      makeNode({ label: 'b', category: 'executable', t: '2026-03-02T09:01:00Z', tactic: 'execution' }),
    );
    expect(buildStory(incident).every((b) => b.act === null)).toBe(true);
  });
});
