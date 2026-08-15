import { beforeEach, describe, expect, it } from 'vitest';
import { toMarkdownReport } from '../src/export/report';
import { emptyIncident, makeEdge, makeNode, mergeIngest, resetIds } from '../src/model/incident';
import { parseTextReport } from '../src/ingest/text';
import { SAMPLES } from '../src/samples';

beforeEach(() => resetIds());

function fixture() {
  const incident = emptyIncident('Tin Kettle');
  incident.summary = 'A fabricated intrusion used for tests.';

  const domain = makeNode({
    label: 'kettle-invoices.top',
    category: 'domain',
    t: '2024-03-11T22:04:00Z',
    confidence: 'confirmed',
    compromised: true,
    tactic: 'resource-development',
    techniques: ['T1583.001'],
    details: { value: 'kettle-invoices.top', registrar: 'Example Registrar' },
    commentary: 'Registered months ahead of the campaign.',
    logs: [{ source: 'Zeek dns.log', timestamp: '2024-03-11T22:04:00Z', excerpt: 'query kettle-invoices.top' }],
  });
  const ip = makeNode({ label: '203.0.113.44', category: 'c2-server', t: '2024-03-12T08:03:00Z', confidence: 'confirmed' });
  const loose = makeNode({ label: 'unknown.example.com', category: 'domain' });

  incident.nodes.push(domain, ip, loose);
  incident.edges.push(
    makeEdge({
      from: domain.id,
      to: ip.id,
      relation: 'resolves-to',
      t: '2024-03-12T08:00:00Z',
      commentary: 'Confirmed in passive DNS.',
    }),
  );
  return incident;
}

describe('toMarkdownReport', () => {
  it('opens with the incident name and summary', () => {
    const md = toMarkdownReport(fixture());
    expect(md).toMatch(/^# Tin Kettle/);
    expect(md).toContain('A fabricated intrusion used for tests.');
  });

  it('reports the observed window and counts', () => {
    const md = toMarkdownReport(fixture());
    // The report trims the noise-only milliseconds from display timestamps.
    expect(md).toContain('2024-03-11T22:04:00Z → 2024-03-12T08:03:00Z');
    expect(md).toContain('| **Artifacts** | 3 |');
    expect(md).toContain('| **Behaviours** | 1 |');
  });

  it('builds a timeline ordered by time', () => {
    const md = toMarkdownReport(fixture());
    const domainAt = md.indexOf('kettle-invoices.top');
    const ipAt = md.indexOf('203.0.113.44');
    expect(domainAt).toBeGreaterThan(-1);
    expect(domainAt).toBeLessThan(ipAt);
  });

  it('separates artifacts that carry no timestamp', () => {
    const md = toMarkdownReport(fixture());
    expect(md).toContain('### Unsequenced artifacts');
    expect(md).toContain('unknown.example.com');
  });

  it('writes behaviours as sentences with their commentary', () => {
    const md = toMarkdownReport(fixture());
    expect(md).toContain('`kettle-invoices.top` **resolves to** `203.0.113.44`');
    expect(md).toContain('> Confirmed in passive DNS.');
  });

  it('carries technical detail, techniques, commentary and log excerpts', () => {
    const md = toMarkdownReport(fixture());
    expect(md).toContain('| registrar | Example Registrar |');
    expect(md).toContain('**ATT&CK:** T1583.001');
    expect(md).toContain('Registered months ahead of the campaign.');
    expect(md).toContain('query kettle-invoices.top');
  });

  it('appends a plain indicator list for copy-paste', () => {
    const md = toMarkdownReport(fixture());
    expect(md).toContain('## Indicators');
    expect(md.split('## Indicators')[1]).toContain('kettle-invoices.top');
  });

  it('credits the methodology', () => {
    expect(toMarkdownReport(fixture())).toContain('Pete Hay');
  });

  it('escapes pipes so a value cannot break out of a table cell', () => {
    const incident = emptyIncident('Escaping');
    incident.nodes.push(makeNode({ label: 'a|b', category: 'domain', t: '2024-03-14T08:00:00Z' }));
    expect(toMarkdownReport(incident)).toContain('a\\|b');
  });

  it('handles an incident with nothing in it', () => {
    const md = toMarkdownReport(emptyIncident('Empty'));
    expect(md).toContain('# Empty');
    expect(md).toContain('No timestamps recorded');
    expect(md).toContain('_No artifact carries a timestamp yet._');
  });

  it('renders the full sample end to end', () => {
    const incident = emptyIncident('Sample run');
    const report = SAMPLES.find((s) => s.id === 'report')!;
    mergeIngest(incident, parseTextReport(report.content));
    const md = toMarkdownReport(incident);

    expect(md).toContain('## Timeline');
    expect(md).toContain('## Behaviours');
    expect(md.length).toBeGreaterThan(1000);
  });
});
