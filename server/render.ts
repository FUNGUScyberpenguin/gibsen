/**
 * Headless rendering.
 *
 * Everything the studio can produce, produced without a browser: the diagram as
 * SVG, as PNG, as one PDF page per act, as the self-contained interactive page,
 * and the Markdown report. The drawing is done by `render/diagram.ts`, exactly
 * the code the studio runs — only the document underneath it is different — so
 * a picture made here and a picture made in the browser are the same picture.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { PDFDocument } from 'pdf-lib';

import type { Incident } from '../src/model/types';
import { layout, type Granularity } from '../src/layout/layout';
import { diagramSize, renderDiagramMarkup } from '../src/render/diagram';
import { themeByName, type Theme } from '../src/render/theme';
import { findChokePoints } from '../src/analysis/congruence';
import { toMarkdownReport } from '../src/export/report';
import { buildInteractiveHtml } from '../src/export/interactive';
import { slugify } from '../src/export/filename';
import { actSlices } from '../src/export/slices';
import { contentsPageSvg, pageHeaderSvg } from '../src/export/pages';
import { SLIDE_HEADER_H, sliceWindow, sliceCaption, type DiagramSlice } from '../src/export/slices';
import { Raster } from './raster';

export type OutputFormat = 'pdf' | 'png' | 'act-png' | 'svg' | 'html' | 'md' | 'json';

export const ALL_FORMATS: OutputFormat[] = ['pdf', 'png', 'act-png', 'svg', 'html', 'md', 'json'];

/**
 * Which font stands in for a family the machine does not have.
 *
 * The diagram asks for a stack — Segoe UI, then Helvetica Neue, then Arial,
 * then whatever counts as sans-serif. A Mac or a Windows box resolves that
 * early and these never come up. A Linux container resolves none of it, and
 * without an answer for the generic at the end of the stack the text either
 * disappears or comes out in the wrong metrics.
 */
export interface FontOptions {
  sans?: string;
  mono?: string;
  /** Extra directories to look in, for a machine with fonts outside the usual places. */
  dirs?: string[];
}

export interface RenderOptions {
  incident: Incident;
  formats?: OutputFormat[];
  theme?: 'dark' | 'light';
  /** Raster multiplier. 2 is the studio default and reads well on a projector. */
  scale?: number;
  granularity?: Granularity | 'auto';
  timeZone?: string;
  showEmptyPlanes?: boolean;
  showEdgeLabels?: boolean;
  timeToScale?: boolean;
  fonts?: FontOptions;
}

export interface WrittenFile {
  format: OutputFormat;
  path: string;
  bytes: number;
  /** What this file is, in a few words, for the caller to relay. */
  note: string;
}

export interface RenderReport {
  files: WrittenFile[];
  /** Notes worth passing back: acts found, artifacts dropped, that sort of thing. */
  warnings: string[];
  stats: {
    nodes: number;
    edges: number;
    acts: number;
    unplaced: number;
    chokePoints: number;
    diagramWidth: number;
    diagramHeight: number;
    granularity: string;
  };
}

function fontConfig(fonts: FontOptions = {}) {
  return {
    loadSystemFonts: true,
    fontDirs: fonts.dirs ?? [],
    sansSerifFamily: fonts.sans ?? 'Liberation Sans',
    monospaceFamily: fonts.mono ?? 'Liberation Mono',
    defaultFontFamily: fonts.sans ?? 'Liberation Sans',
  };
}

/**
 * Rasterise to raw pixels.
 *
 * Always at the drawing's own full size. Rendering anything at a canvas smaller
 * than its contents is what trips the marker panic described in `raster.ts`, so
 * cutting is done afterwards, on the pixels.
 */
function rasterise(markup: string, scale: number, fonts: FontOptions | undefined): Raster {
  const image = new Resvg(markup, {
    fitTo: { mode: 'zoom', value: scale },
    font: fontConfig(fonts),
  }).render();
  return new Raster(image.width, image.height, Buffer.from(image.pixels));
}

/**
 * Render an incident to files on disk.
 *
 * `outDir` is created if it is not there. Filenames are derived from the
 * incident name, so two renders of the same incident overwrite rather than
 * pile up.
 */
export async function renderIncident(outDir: string, options: RenderOptions): Promise<RenderReport> {
  const {
    incident,
    formats = ['pdf', 'png'],
    scale = 2,
    granularity = 'auto',
    timeZone = 'UTC',
    showEmptyPlanes = false,
    showEdgeLabels = true,
    timeToScale = true,
    fonts,
  } = options;

  const theme: Theme = themeByName(options.theme ?? 'dark');
  const warnings: string[] = [];

  const result = layout(incident, {
    granularity,
    planeSet: incident.planeSet,
    showEmptyPlanes,
    timeToScale,
    showActs: true,
    timeZone,
  });

  const chokePoints = findChokePoints(incident);
  const chokeMap = new Map(chokePoints.map((c) => [c.nodeId, c.severed]));

  if (result.unplaced.length > 0) {
    warnings.push(
      `${result.unplaced.length} artifact(s) were left out because their plane band was collapsed away: ` +
        result.unplaced.map((n) => n.label).join(', '),
    );
  }
  const undated = incident.nodes.filter((n) => !n.t).length;
  if (undated > 0) {
    warnings.push(`${undated} artifact(s) carry no timestamp, so they are not sequenced on the axis.`);
  }

  const full = { theme, selectedId: null, showTitle: true, showLegend: true, showEdgeLabels, chokePoints: chokeMap };
  const size = diagramSize(incident, result, full);
  const markup = renderDiagramMarkup(incident, result, { ...full, interactive: false });

  await mkdir(outDir, { recursive: true });
  const stem = slugify(incident.name);
  const files: WrittenFile[] = [];

  async function write(format: OutputFormat, name: string, data: string | Buffer, note: string): Promise<void> {
    const path = join(outDir, name);
    await writeFile(path, data);
    files.push({ format, path, bytes: Buffer.byteLength(data as string | Uint8Array), note });
  }

  const wanted = new Set(formats);

  if (wanted.has('svg')) {
    await write(
      'svg',
      `${stem}.gibsen.svg`,
      `<?xml version="1.0" encoding="UTF-8"?>\n${markup}`,
      'The diagram as vector art. No external fonts or images, so it opens anywhere.',
    );
  }

  if (wanted.has('png')) {
    await write(
      'png',
      `${stem}.gibsen.png`,
      rasterise(markup, scale, fonts).toPng(),
      `The whole diagram at ${scale}x — ${Math.round(size.width * scale)} by ${Math.round(size.height * scale)} pixels.`,
    );
  }

  // Act pages: the same cut the Slides export makes, so a deck and a report
  // break the story in the same places.
  const slices = actSlices(result.acts);
  const needsPages = (wanted.has('act-png') || wanted.has('pdf')) && slices.length > 0;

  if (!slices.length && (wanted.has('act-png') || wanted.has('pdf'))) {
    warnings.push(
      'The incident could not be cut into acts, so there is one page holding the whole diagram. ' +
        'Give the artifacts ATT&CK tactics and the acts appear.',
    );
  }

  // Without the title or the legend: the title is far wider than the gutter and
  // would come out cut mid-word, and a key sliced down the middle reads as
  // damage. Both are redrawn in the page header instead.
  const pageOptions = { ...full, showTitle: false, showLegend: false, interactive: false };
  const pageSize = needsPages ? diagramSize(incident, result, pageOptions) : size;
  const pageArt = needsPages ? rasterise(renderDiagramMarkup(incident, result, pageOptions), scale, fonts) : null;

  /** One act, cut out of the rendered diagram with its header drawn above it. */
  function composePage(slice: DiagramSlice, index: number): Raster {
    const art = pageArt!;
    const { from, span } = sliceWindow(slice, pageSize.width, pageSize.gutterWidth);
    const width = Math.round((pageSize.gutterWidth + span) * scale);
    const headerH = Math.round(SLIDE_HEADER_H * scale);
    const page = new Raster(width, headerH + art.height);
    page.fill(theme.bg);

    const header = rasterise(
      pageHeaderSvg(
        incident.name,
        sliceCaption(index, slices.length, slice),
        pageSize.gutterWidth + span,
        SLIDE_HEADER_H,
        theme,
      ).markup,
      scale,
      fonts,
    );
    page.blit(header, 0, 0, header.width, header.height, 0, 0);

    // The gutter first — the plane names are what make a page legible alone —
    // then the stretch of timeline this act covers, butted up against it.
    const gutterPx = Math.round(pageSize.gutterWidth * scale);
    page.blit(art, 0, 0, gutterPx, art.height, 0, headerH);
    page.blit(art, Math.round(from * scale), 0, Math.round(span * scale), art.height, gutterPx, headerH);

    return page;
  }

  if (wanted.has('act-png')) {
    for (const [index, slice] of slices.entries()) {
      const label = slugify(slice.name) || String(index + 1);
      await write(
        'act-png',
        `${stem}-${String(index + 1).padStart(2, '0')}-${label}.png`,
        composePage(slice, index).toPng(),
        `Act ${index + 1} of ${slices.length}: ${slice.name}.`,
      );
    }
  }

  if (wanted.has('pdf')) {
    const pdf = await PDFDocument.create();
    pdf.setTitle(incident.name);
    if (incident.summary) pdf.setSubject(incident.summary);
    pdf.setProducer('GIBSEN Studio');

    /** Place one raster on a page of its own size, edge to edge. */
    async function addPage(raster: Raster): Promise<void> {
      const image = await pdf.embedPng(raster.toPng());
      // The page is measured in points at 1x, so a 2x raster lands at 144dpi
      // rather than coming out twice the size of the one before it.
      const width = raster.width / scale;
      const height = raster.height / scale;
      pdf.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
    }

    if (needsPages) {
      const contents = contentsPageSvg(
        incident.name,
        incident.summary,
        result.acts.map((act) => ({
          label: act.label,
          detail: [act.from?.replace('.000Z', 'Z'), act.duration].filter(Boolean).join('  ·  '),
        })),
        theme,
      );
      await addPage(rasterise(contents.markup, scale, fonts));
      for (const [index, slice] of slices.entries()) await addPage(composePage(slice, index));
    } else {
      await addPage(rasterise(markup, scale, fonts));
    }

    await write(
      'pdf',
      `${stem}.gibsen.pdf`,
      Buffer.from(await pdf.save()),
      needsPages
        ? `Contents sheet, then one page per act (${slices.length}).`
        : 'One page holding the whole diagram.',
    );
  }

  if (wanted.has('html')) {
    const interactiveMarkup = renderDiagramMarkup(incident, result, { ...full, interactive: true });
    await write(
      'html',
      `${stem}.gibsen.html`,
      buildInteractiveHtml({ incident, svgMarkup: interactiveMarkup, theme, chokePoints }),
      'One self-contained page: pan, zoom, search, open the record. No network needed.',
    );
  }

  if (wanted.has('md')) {
    await write('md', `${stem}.md`, toMarkdownReport(incident), 'The walkthrough written down, then the full record.');
  }

  if (wanted.has('json')) {
    await write(
      'json',
      `${stem}.gibsen.json`,
      JSON.stringify(incident, null, 2),
      'The incident itself. Open it in the studio to keep editing.',
    );
  }

  return {
    files,
    warnings,
    stats: {
      nodes: incident.nodes.length,
      edges: incident.edges.length,
      acts: result.acts.length,
      unplaced: result.unplaced.length,
      chokePoints: chokePoints.length,
      diagramWidth: Math.round(size.width),
      diagramHeight: Math.round(size.height),
      granularity: result.granularity,
    },
  };
}
