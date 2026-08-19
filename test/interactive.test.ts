import { beforeEach, describe, expect, it } from 'vitest';
import { buildInteractiveHtml } from '../src/export/interactive';
import { emptyIncident, makeEdge, makeNode, mergeIngest, resetIds } from '../src/model/incident';
import { findChokePoints } from '../src/analysis/congruence';
import { parseCsv } from '../src/ingest/csv';
import { DARK } from '../src/render/theme';
import { SAMPLES } from '../src/samples';
import type { Incident } from '../src/model/types';

beforeEach(() => resetIds());

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><g data-node-id="n-1"></g></svg>';

function fixture(): Incident {
  const incident = emptyIncident('Tin Kettle');
  const a = makeNode({
    label: 'kettle-invoices.top',
    category: 'domain',
    t: '2024-03-11T22:04:00Z',
    commentary: 'Registered months ahead of the campaign.',
    details: { registrar: 'Example Registrar' },
    logs: [{ source: 'Zeek dns.log', timestamp: '2024-03-11T22:04:00Z', excerpt: 'query kettle-invoices.top' }],
    compromised: true,
  });
  const b = makeNode({ label: '203.0.113.44', category: 'c2-server', t: '2024-03-12T08:03:00Z' });
  incident.nodes.push(a, b);
  incident.edges.push(makeEdge({ from: a.id, to: b.id, relation: 'resolves-to' }));
  return incident;
}

const build = (incident = fixture()) =>
  buildInteractiveHtml({ incident, svgMarkup: SVG, theme: DARK, chokePoints: [] });

describe('buildInteractiveHtml', () => {
  it('produces a complete standalone document', () => {
    const html = build();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
    expect(html).toContain('<style>');
    expect(html).toContain('<script>');
  });

  it('embeds the diagram markup as given', () => {
    expect(build()).toContain('data-node-id="n-1"');
  });

  it('embeds the full record so the page needs no companion file', () => {
    const html = build();
    expect(html).toContain('kettle-invoices.top');
    expect(html).toContain('Example Registrar');
    expect(html).toContain('query kettle-invoices.top');
    expect(html).toContain('Registered months ahead of the campaign.');
  });

  it('pre-joins connections so the page can walk between artifacts', () => {
    const html = build();
    const payload = JSON.parse(
      html.split('<script type="application/json" id="gibsen-data">')[1].split('</script>')[0],
    );
    const domain = payload.artifacts.find((a: { label: string }) => a.label === 'kettle-invoices.top');
    expect(domain.links).toHaveLength(1);
    expect(domain.links[0].verb).toBe('resolves to');
    expect(domain.links[0].otherLabel).toBe('203.0.113.44');
  });

  it('makes no network requests of any kind', () => {
    const html = build();
    expect(html).not.toMatch(/<script[^>]+\bsrc=/i);
    expect(html).not.toMatch(/<link[^>]+\bhref=/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  it('cannot be broken out of by hostile artifact content', () => {
    const incident = emptyIncident('Nasty');
    incident.nodes.push(
      makeNode({
        label: '</script><script>alert(1)</script>',
        category: 'unknown',
        commentary: '</script><img src=x onerror=alert(2)>',
      }),
    );
    const html = buildInteractiveHtml({ incident, svgMarkup: SVG, theme: DARK });

    // The payload block must contain exactly one closing tag: its own.
    const payloadBlock = html.split('<script type="application/json" id="gibsen-data">')[1];
    const jsonText = payloadBlock.split('</script>')[0];
    expect(jsonText).not.toContain('<');
    expect(() => JSON.parse(jsonText)).not.toThrow();
    // The value survives intact once parsed, merely escaped in transit.
    expect(JSON.parse(jsonText).artifacts[0].label).toBe('</script><script>alert(1)</script>');
  });

  it('escapes the incident name in the title and heading', () => {
    const incident = emptyIncident('<img src=x onerror=alert(1)>');
    const html = buildInteractiveHtml({ incident, svgMarkup: SVG, theme: DARK });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('offers only the filters the incident can actually use', () => {
    const clean = emptyIncident('Clean');
    clean.nodes.push(makeNode({ label: 'a', category: 'domain', t: '2024-03-11T22:04:00Z' }));
    const html = buildInteractiveHtml({ incident: clean, svgMarkup: SVG, theme: DARK });
    expect(html).not.toContain('data-filter="compromised"');
    expect(html).not.toContain('data-filter="choke"');
    expect(html).not.toContain('data-filter="unsequenced"');

    // The fixture has an attacker-controlled artifact, so that one appears.
    expect(build()).toContain('data-filter="compromised"');
  });

  it('carries the choke-point ranking through to the page', () => {
    const incident = emptyIncident('Sample');
    mergeIngest(incident, parseCsv(SAMPLES.find((s) => s.id === 'csv')!.content));
    const chokePoints = findChokePoints(incident).slice(0, 6);
    const html = buildInteractiveHtml({ incident, svgMarkup: SVG, theme: DARK, chokePoints });

    expect(html).toContain('data-filter="choke"');
    const payload = JSON.parse(
      html.split('<script type="application/json" id="gibsen-data">')[1].split('</script>')[0],
    );
    const severing = payload.artifacts.filter((a: { severs: number }) => a.severs > 0);
    expect(severing.length).toBeGreaterThan(0);
  });

  it('paints its own colours so the page does not depend on a host stylesheet', () => {
    const html = build();
    expect(html).toContain(`--bg:${DARK.bg}`);
    expect(html).toContain(`--congruence:${DARK.congruence}`);
  });

  it('opens the record as a modal over the diagram, not a panel beside it', () => {
    const html = build();

    // The card sits outside <main>, so the backdrop — not the canvas — takes
    // the click that closes it.
    expect(html).toContain('<div id="modal" hidden>');
    expect(html).toContain('aria-modal="true"');
    expect(html).not.toContain('<aside id="detail"');
    expect(html.indexOf('</main>')).toBeLessThan(html.indexOf('id="modal"'));

    expect(html).toContain('#modal {');
    expect(html).toContain('if (e.target === modal) clearSelection();');
  });

  it('lets a reader copy a value the diagram only shows in short', () => {
    const html = build();
    expect(html).toContain('Copy value');
    // Works from file://, where the clipboard API may not be handed over.
    expect(html).toContain("document.execCommand('copy')");
  });

  it('handles an incident with nothing in it', () => {
    const html = buildInteractiveHtml({ incident: emptyIncident('Empty'), svgMarkup: SVG, theme: DARK });
    expect(html).toContain('No timestamps recorded');
    expect(html).toContain('0 artifacts');
  });
});
