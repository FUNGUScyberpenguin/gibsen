import { beforeEach, describe, expect, it } from 'vitest';
import { AUTHORING_GUIDE, incidentJsonSchema, validateIncident, vocabularies } from '../server/contract';
import { emptyIncident, makeEdge, makeNode, resetIds } from '../src/model/incident';
import { CATEGORIES, RELATIONS, TACTICS } from '../src/model/taxonomy';
import type { Incident } from '../src/model/types';

beforeEach(() => resetIds());

function usable(): Incident {
  const incident = emptyIncident('Contract check');
  const file = makeNode({ label: 'invoice.docm', category: 'file', t: '2026-01-04T09:00:00Z', tactic: 'initial-access' });
  const proc = makeNode({ label: 'powershell.exe', category: 'process', t: '2026-01-04T09:01:00Z', tactic: 'execution' });
  incident.nodes.push(file, proc);
  incident.edges.push(makeEdge({ from: file.id, to: proc.id, relation: 'executes' }));
  return incident;
}

describe('vocabularies', () => {
  it('reads the lists out of the taxonomy rather than restating them', () => {
    const vocab = vocabularies();
    expect(vocab.categories).toHaveLength(CATEGORIES.length);
    expect(vocab.relations).toHaveLength(RELATIONS.length);
    expect(vocab.tactics).toHaveLength(TACTICS.length);
    expect(vocab.planeSets.map((set) => set.id).sort()).toEqual(['domain', 'talk']);
  });

  it('gives every plane set its planes in drawing order', () => {
    const talk = vocabularies().planeSets.find((set) => set.id === 'talk');
    expect(talk?.planes[0].id).toBe('adversary');
    expect(talk?.planes.map((p) => p.id)).toContain('host-registry');
  });
});

describe('incidentJsonSchema', () => {
  it('constrains the fields a model most often gets wrong', () => {
    const schema = incidentJsonSchema() as any;
    const node = schema.properties.nodes.items.properties;
    expect(node.category.enum).toContain('ransomware');
    expect(node.tactic.enum).toContain('exfiltration');
    expect(schema.properties.edges.items.properties.relation.enum).toContain('beacons-to');
  });
});

describe('AUTHORING_GUIDE', () => {
  it('says the things that stop a diagram being useful', () => {
    expect(AUTHORING_GUIDE).toContain('NODES ARE THINGS, NOT EVENTS');
    expect(AUTHORING_GUIDE).toContain('TACTICS ARE WHAT MAKE THE ACTS');
  });
});

describe('validateIncident', () => {
  it('passes a usable incident', () => {
    const { ok, problems } = validateIncident(usable());
    expect(ok).toBe(true);
    expect(problems.filter((p) => p.severity === 'error')).toEqual([]);
  });

  it('rejects anything that is not an incident', () => {
    expect(validateIncident(null).ok).toBe(false);
    expect(validateIncident({ nodes: [], edges: [] }).ok).toBe(false);
  });

  it('catches an edge pointing at a node that is not there', () => {
    const incident = usable();
    incident.edges.push(makeEdge({ from: incident.nodes[0].id, to: 'nope', relation: 'writes' }));
    const { ok, problems } = validateIncident(incident);
    expect(ok).toBe(false);
    expect(problems.some((p) => p.message.includes('"nope"'))).toBe(true);
  });

  it('catches unknown vocabulary rather than letting it draw as "unknown"', () => {
    const incident = usable();
    (incident.nodes[0] as any).category = 'toaster';
    (incident.nodes[1] as any).tactic = 'sneaking-about';
    const { ok, problems } = validateIncident(incident);
    expect(ok).toBe(false);
    expect(problems.some((p) => p.message.includes('toaster'))).toBe(true);
    expect(problems.some((p) => p.message.includes('sneaking-about'))).toBe(true);
  });

  it('catches duplicate ids and unparseable times', () => {
    const incident = usable();
    incident.nodes[1].id = incident.nodes[0].id;
    incident.nodes[0].t = 'last Tuesday';
    const { problems } = validateIncident(incident);
    expect(problems.some((p) => p.message.includes('Duplicate id'))).toBe(true);
    expect(problems.some((p) => p.message.includes('last Tuesday'))).toBe(true);
  });

  it('catches a span that ends before it starts', () => {
    const incident = usable();
    incident.nodes[0].tEnd = '2026-01-04T08:00:00Z';
    expect(validateIncident(incident).problems.some((p) => p.message.includes('tEnd is before t'))).toBe(true);
  });

  it('warns rather than fails when nothing carries a tactic', () => {
    const incident = usable();
    for (const node of incident.nodes) node.tactic = null;
    const { ok, problems } = validateIncident(incident);
    expect(ok).toBe(true);
    expect(problems.some((p) => p.severity === 'warning' && p.message.includes('acts'))).toBe(true);
  });

  it('does not complain about planes from the other set, which is the normal case', () => {
    // Categories carry domain-set planes; the studio draws against the talk
    // set. Every incident would trip a plane warning if one existed.
    const { problems } = validateIncident(usable());
    expect(problems.some((p) => p.message.toLowerCase().includes('plane'))).toBe(false);
  });
});
