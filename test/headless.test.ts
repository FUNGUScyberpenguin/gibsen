/**
 * The headless path, end to end.
 *
 * These are slow by the standards of the rest of the suite — they rasterise
 * real pictures — but they are the only thing standing between a change to the
 * renderer and an MCP server that quietly emits blank pages.
 */

import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { beforeEach, describe, expect, it } from 'vitest';

import { emptyIncident, mergeIngest, resetIds } from '../src/model/incident';
import { parseCsv } from '../src/ingest/csv';
import { layout } from '../src/layout/layout';
import { renderDiagramMarkup, diagramSize } from '../src/render/diagram';
import { DARK } from '../src/render/theme';
import { renderIncident } from '../server/render';
import type { Incident } from '../src/model/types';

beforeEach(() => resetIds());

async function sampleIncident(): Promise<Incident> {
  const csv = await readFile(join(process.cwd(), 'samples', 'artifacts.csv'), 'utf8');
  const incident = emptyIncident('Headless render check');
  mergeIngest(incident, parseCsv(csv, { name: 'artifacts.csv' }));
  return incident;
}

describe('renderDiagramMarkup', () => {
  it('draws without a DOM and comes back as parseable markup', async () => {
    const incident = await sampleIncident();
    const result = layout(incident, {});
    const markup = renderDiagramMarkup(incident, result, { theme: DARK });

    expect(markup.startsWith('<svg')).toBe(true);
    expect(markup.endsWith('</svg>')).toBe(true);
    // Every artifact should have put its label somewhere in the picture.
    expect(markup).toContain(incident.nodes[0].label);
  });

  it('escapes the double quotes inside the font stack', async () => {
    const incident = await sampleIncident();
    const markup = renderDiagramMarkup(incident, layout(incident, {}), { theme: DARK });
    // `font-family="… "Segoe UI" …"` unescaped ends the attribute early and
    // makes the whole file unparseable. It is the first thing that breaks.
    expect(markup).toContain('&quot;Segoe UI&quot;');
    expect(markup).not.toContain('"Segoe UI"');
  });

  it('leaves the app hooks out unless asked', async () => {
    const incident = await sampleIncident();
    const result = layout(incident, {});
    expect(renderDiagramMarkup(incident, result, { theme: DARK })).not.toContain('data-node-id');
    expect(renderDiagramMarkup(incident, result, { theme: DARK, interactive: true })).toContain('data-node-id');
  });

  it('agrees with the size it promised', async () => {
    const incident = await sampleIncident();
    const result = layout(incident, {});
    const options = { theme: DARK, showTitle: false, showLegend: false };
    const size = diagramSize(incident, result, options);
    const markup = renderDiagramMarkup(incident, result, options);
    expect(markup).toContain(`width="${size.width}"`);
    expect(markup).toContain(`height="${size.height}"`);
  });
});

describe('renderIncident', () => {
  it('writes every format, and the rasters are real images', async () => {
    const incident = await sampleIncident();
    const dir = await mkdtemp(join(tmpdir(), 'gibsen-render-'));

    try {
      const report = await renderIncident(dir, {
        incident,
        formats: ['pdf', 'png', 'svg', 'html', 'md', 'json'],
        scale: 1,
      });

      const byFormat = new Map(report.files.map((f) => [f.format, f]));
      expect([...byFormat.keys()].sort()).toEqual(['html', 'json', 'md', 'pdf', 'png', 'svg']);

      for (const file of report.files) {
        const info = await stat(file.path);
        expect(info.size, `${file.format} is empty`).toBeGreaterThan(0);
        expect(info.size).toBe(file.bytes);
      }

      const png = await readFile(byFormat.get('png')!.path);
      expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      // A blank canvas of this size compresses to almost nothing.
      expect(png.length).toBeGreaterThan(20_000);

      const pdf = await readFile(byFormat.get('pdf')!.path);
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');

      expect(report.stats.nodes).toBe(incident.nodes.length);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('cuts the PDF into one page per act when the tactics allow it', async () => {
    const incident = await sampleIncident();
    const dir = await mkdtemp(join(tmpdir(), 'gibsen-acts-'));

    try {
      const report = await renderIncident(dir, { incident, formats: ['pdf', 'act-png'], scale: 1 });
      const actPngs = report.files.filter((f) => f.format === 'act-png');

      expect(report.stats.acts).toBeGreaterThan(1);
      expect(actPngs).toHaveLength(report.stats.acts);

      for (const file of actPngs) {
        const bytes = await readFile(file.path);
        // Each act page carries the gutter and a stretch of timeline, so it is
        // never the near-empty file a broken clip path would produce.
        expect(bytes.length, `${file.path} looks blank`).toBeGreaterThan(10_000);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
