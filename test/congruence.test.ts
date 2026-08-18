import { beforeEach, describe, expect, it } from 'vitest';
import { findChokePoints } from '../src/analysis/congruence';
import { emptyIncident, makeEdge, makeNode, mergeIngest, resetIds } from '../src/model/incident';
import type { GibsenNode, Incident } from '../src/model/types';
import { parseCsv } from '../src/ingest/csv';
import { SAMPLES } from '../src/samples';

beforeEach(() => resetIds());

/** Build an incident from a compact `a->b` edge list. */
function graph(edges: string[]): { incident: Incident; byLabel: Map<string, GibsenNode> } {
  const incident = emptyIncident('Graph');
  const byLabel = new Map<string, GibsenNode>();
  const node = (label: string) => {
    let found = byLabel.get(label);
    if (!found) {
      found = makeNode({ label, category: 'unknown' });
      byLabel.set(label, found);
      incident.nodes.push(found);
    }
    return found;
  };
  for (const spec of edges) {
    const [from, to] = spec.split('->');
    incident.edges.push(makeEdge({ from: node(from).id, to: node(to).id, relation: 'related-to' }));
  }
  return { incident, byLabel };
}

const labelsOf = (incident: Incident, ids: string[]) => {
  const byId = new Map(incident.nodes.map((n) => [n.id, n]));
  return ids.map((id) => byId.get(id)!.label).sort();
};

describe('findChokePoints', () => {
  it('reports what stops working downstream, not what is left upstream', () => {
    // One entry, a funnel through mshta, then the payloads diverge.
    const { incident, byLabel } = graph([
      'email->lure', 'lure->mshta', 'mshta->stage2', 'stage2->payloadA', 'stage2->payloadB',
    ]);

    const points = findChokePoints(incident);
    const byNode = new Map(points.map((p) => [p.nodeId, p]));

    const mshta = byNode.get(byLabel.get('mshta')!.id)!;
    expect(labelsOf(incident, mshta.severedIds)).toEqual(['payloadA', 'payloadB', 'stage2']);

    // The nearer the entry point, the more of the chain an artifact holds up.
    expect(points[0].nodeId).toBe(byLabel.get('lure')!.id);
    expect(points[0].severed).toBe(4);
  });

  it('anchors on the analyst pivot when one is set', () => {
    const { incident, byLabel } = graph(['a->b', 'b->c', 'c->d']);
    // With d as the declared starting point the chain is read the other way.
    byLabel.get('d')!.pivot = true;
    const points = findChokePoints(incident);
    expect(points[0].nodeId).toBe(byLabel.get('c')!.id);
    expect(labelsOf(incident, points[0].severedIds)).toEqual(['a', 'b']);
  });

  it('ranks by how much of the chain each one is holding up', () => {
    const { incident, byLabel } = graph(['a->b', 'b->c', 'c->d', 'd->e']);
    const points = findChokePoints(incident);
    // Every interior node of a chain is a cut vertex; the ranking is the point.
    expect(points.map((p) => p.nodeId)).toContain(byLabel.get('b')!.id);
    expect(points[0].severed).toBeGreaterThanOrEqual(points[points.length - 1].severed);
  });

  it('ignores direction — a dependency is a dependency', () => {
    const forward = graph(['a->hub', 'hub->b']);
    const backward = graph(['hub->a', 'b->hub']);
    expect(findChokePoints(forward.incident)).toHaveLength(1);
    expect(findChokePoints(backward.incident)).toHaveLength(1);
  });

  it('finds nothing in a graph with no single point of failure', () => {
    // A triangle: any one artifact can go and the other two stay joined.
    const { incident } = graph(['a->b', 'b->c', 'c->a']);
    expect(findChokePoints(incident)).toEqual([]);
  });

  it('finds nothing when there are no behaviours at all', () => {
    const incident = emptyIncident();
    for (const label of ['a', 'b', 'c']) incident.nodes.push(makeNode({ label, category: 'unknown' }));
    expect(findChokePoints(incident)).toEqual([]);
  });

  it('handles an incident too small to have a middle', () => {
    const { incident } = graph(['a->b']);
    expect(findChokePoints(incident)).toEqual([]);
    expect(findChokePoints(emptyIncident())).toEqual([]);
  });

  it('respects a minimum severed count', () => {
    const { incident } = graph(['a->b', 'b->c', 'c->d', 'd->e', 'e->f']);
    const all = findChokePoints(incident);
    const strict = findChokePoints(incident, { minSevered: 2 });
    expect(strict.length).toBeLessThan(all.length);
    expect(strict.every((p) => p.severed >= 2)).toBe(true);
  });

  it('stays fast on a chain long enough to overflow a recursive walk', () => {
    const specs: string[] = [];
    for (let i = 0; i < 5000; i += 1) specs.push(`n${i}->n${i + 1}`);
    const { incident } = graph(specs);
    expect(() => findChokePoints(incident)).not.toThrow();
    expect(findChokePoints(incident).length).toBeGreaterThan(0);
  });

  it('handles several disconnected clusters at once', () => {
    const { incident, byLabel } = graph(['a->b', 'b->c', 'x->y', 'y->z']);
    const ids = findChokePoints(incident).map((p) => p.nodeId);
    expect(ids).toContain(byLabel.get('b')!.id);
    expect(ids).toContain(byLabel.get('y')!.id);
  });

  it('picks the lateral-movement hop out of the sample spreadsheet', () => {
    const incident = emptyIncident('Sample');
    mergeIngest(incident, parseCsv(SAMPLES.find((s) => s.id === 'csv')!.content));
    const byId = new Map(incident.nodes.map((n) => [n.id, n]));
    const points = findChokePoints(incident);
    const labels = points.map((p) => byId.get(p.nodeId)!.label);

    // Breaking the hop to the domain controller strands the whole OT branch.
    expect(labels[0]).toBe('CORP-DC-01');
    expect(labelsOf(incident, points[0].severedIds)).toContain('PLC-LINE-2');
    // The fraudulent consent holds up the cloud branch behind it.
    expect(labels).toContain('Kettle Reporting');
  });
});
