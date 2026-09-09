/**
 * The two documents the renderer can draw into.
 *
 * The string one is exercised all over `headless.test.ts`. The DOM one is not,
 * because these tests run in Node — so it gets a stand-in `document` here,
 * enough to catch the renderer reaching for an API the browser adapter does not
 * forward.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DOM_SVG_DOC, StringSvgDoc, serialiseNode, SVG_NS } from '../src/render/svg-doc';
import { emptyIncident, makeNode, resetIds } from '../src/model/incident';
import { layout } from '../src/layout/layout';
import { renderDiagram, renderDiagramMarkup } from '../src/render/diagram';
import { DARK } from '../src/render/theme';

describe('StringSvgDoc', () => {
  it('serialises attributes and children', () => {
    const doc = new StringSvgDoc();
    const g = doc.create('g');
    g.setAttribute('transform', 'translate(4, 8)');
    const text = doc.create('text');
    text.setAttribute('x', '10');
    text.append('hello');
    g.append(text);

    expect(serialiseNode(g)).toBe('<g transform="translate(4, 8)"><text x="10">hello</text></g>');
  });

  it('closes an empty element rather than leaving a stray tag', () => {
    const doc = new StringSvgDoc();
    const rect = doc.create('rect');
    rect.setAttribute('width', '10');
    expect(serialiseNode(rect)).toBe('<rect width="10"/>');
  });

  it('escapes what would otherwise end an attribute or a tag early', () => {
    const doc = new StringSvgDoc();
    const node = doc.create('text');
    node.setAttribute('data-label', 'a "quoted" <thing> & more');
    node.append('5 < 6 & "so on"');
    const out = serialiseNode(node);

    expect(out).toContain('data-label="a &quot;quoted&quot; &lt;thing&gt; &amp; more"');
    expect(out).toContain('>5 &lt; 6 &amp; "so on"<');
  });

  it('drops control bytes that would make the file unparseable', () => {
    // Command lines and log excerpts come out of real captures and carry these
    // now and then. One of them in an attribute breaks the whole document.
    const doc = new StringSvgDoc();
    const node = doc.create('text');
    node.append('before\u0000\u0008after');
    node.setAttribute('title', 'x\u001Fy');
    const out = serialiseNode(node);

    expect(out).toContain('>beforeafter<');
    expect(out).toContain('title="xy"');
  });

  it('passes icon markup through as written', () => {
    const doc = new StringSvgDoc();
    const icon = doc.create('g');
    icon.innerHTML = '<path d="M12 3.2 19.4 6"/>';
    expect(serialiseNode(icon)).toBe('<g><path d="M12 3.2 19.4 6"/></g>');
  });

  it('refuses to serialise something it did not build', () => {
    expect(() => serialiseNode({ setAttribute() {}, append() {}, innerHTML: '' })).toThrow(/StringSvgDoc/);
  });
});

describe('DOM_SVG_DOC', () => {
  const original = (globalThis as any).document;

  /** Just enough of an element for the renderer, recording what it was asked. */
  function fakeDocument() {
    const created: { tag: string; ns: string }[] = [];
    return {
      created,
      createElementNS(ns: string, tag: string) {
        created.push({ ns, tag });
        return {
          ns,
          tag,
          attrs: {} as Record<string, string>,
          children: [] as unknown[],
          innerHTML: '',
          setAttribute(name: string, value: string) {
            this.attrs[name] = value;
          },
          append(...nodes: unknown[]) {
            this.children.push(...nodes);
          },
        };
      },
    };
  }

  beforeEach(() => resetIds());
  afterEach(() => {
    (globalThis as any).document = original;
  });

  it('makes elements in the SVG namespace through the global document', () => {
    const fake = fakeDocument();
    (globalThis as any).document = fake;

    const node = DOM_SVG_DOC.create('circle');
    node.setAttribute('r', '4');

    expect(fake.created).toEqual([{ ns: SVG_NS, tag: 'circle' }]);
    expect((node as any).attrs.r).toBe('4');
  });

  it('draws a whole diagram without reaching past setAttribute, append and innerHTML', () => {
    const fake = fakeDocument();
    (globalThis as any).document = fake;

    const incident = emptyIncident('DOM adapter check');
    incident.nodes.push(
      makeNode({ label: 'invoice.docm', category: 'file', t: '2026-01-04T09:00:00Z', tactic: 'initial-access' }),
      makeNode({ label: 'powershell.exe', category: 'process', t: '2026-01-04T09:01:00Z', tactic: 'execution' }),
    );

    const svg: any = renderDiagram(incident, layout(incident, {}), { theme: DARK });

    expect(svg.tag).toBe('svg');
    expect(fake.created.length).toBeGreaterThan(20);
    expect(fake.created.every((e) => e.ns === SVG_NS)).toBe(true);
  });

  it('goes back to the DOM after a headless render', () => {
    const incident = emptyIncident('Restores the document');
    incident.nodes.push(makeNode({ label: 'a.exe', category: 'executable', t: '2026-01-04T09:00:00Z' }));
    const result = layout(incident, {});

    renderDiagramMarkup(incident, result, { theme: DARK });

    const fake = fakeDocument();
    (globalThis as any).document = fake;
    renderDiagram(incident, result, { theme: DARK });
    expect(fake.created.length).toBeGreaterThan(0);
  });
});
