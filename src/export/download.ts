/** Browser download helpers for the export formats. */

import type { Incident } from '../model/types';
import type { ChokePoint } from '../analysis/congruence';
import type { Theme } from '../render/theme';
import { toMarkdownReport } from './report';
import { buildInteractiveHtml } from './interactive';

/**
 * Serialise a rendered diagram.
 *
 * `keepHooks` decides whether the `data-node-id` attributes survive. A flat SVG
 * has no use for them and they are app state, not diagram content — but the
 * interactive export is built entirely on them.
 */
export function serialiseSvg(svg: SVGSVGElement, keepHooks = false): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  if (!keepHooks) {
    // The "more" marker is an invitation to click; on a flat file it is noise.
    clone.querySelectorAll('[data-more-for]').forEach((node) => node.remove());
    clone.querySelectorAll('[data-node-id], [data-edge-id]').forEach((node) => {
      node.removeAttribute('data-node-id');
      node.removeAttribute('data-edge-id');
      node.removeAttribute('cursor');
    });
  }
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  return new XMLSerializer().serializeToString(clone);
}

/** Serialise a rendered diagram to a standalone SVG document. */
export function toSvgString(svg: SVGSVGElement): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialiseSvg(svg, false)}`;
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the navigation has definitely started.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Filesystem-safe stem derived from the incident name. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'incident';
}

export function exportSvg(svg: SVGSVGElement, incident: Incident): void {
  downloadBlob(`${slugify(incident.name)}.gibsen.svg`, new Blob([toSvgString(svg)], { type: 'image/svg+xml' }));
}

export function exportJson(incident: Incident): void {
  downloadBlob(
    `${slugify(incident.name)}.gibsen.json`,
    new Blob([JSON.stringify(incident, null, 2)], { type: 'application/json' }),
  );
}

/**
 * A single self-contained page: the diagram, the whole record and the script to
 * explore it. Deliberately one file, so it can be attached to a ticket or an
 * email and still work with no network at all.
 */
export function exportInteractive(
  svg: SVGSVGElement,
  incident: Incident,
  theme: Theme,
  chokePoints: ChokePoint[],
): void {
  const html = buildInteractiveHtml({
    incident,
    svgMarkup: serialiseSvg(svg, true),
    theme,
    chokePoints,
  });
  downloadBlob(`${slugify(incident.name)}.gibsen.html`, new Blob([html], { type: 'text/html;charset=utf-8' }));
}

export function exportMarkdown(incident: Incident): void {
  downloadBlob(
    `${slugify(incident.name)}.md`,
    new Blob([toMarkdownReport(incident)], { type: 'text/markdown' }),
  );
}

/** Load a rendered diagram as an image, ready to draw into a canvas. */
async function rasterise(svg: SVGSVGElement): Promise<{ image: HTMLImageElement; width: number; height: number }> {
  const source = toSvgString(svg);
  const width = Number(svg.getAttribute('width')) || svg.viewBox.baseVal.width;
  const height = Number(svg.getAttribute('height')) || svg.viewBox.baseVal.height;

  // encodeURIComponent keeps non-ASCII in labels intact; btoa would not.
  const image = new Image();
  image.width = width;
  image.height = height;

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Could not rasterise the diagram'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  });

  return { image, width, height };
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the PNG');
  return blob;
}

/** One slice of the diagram: the plane gutter, then a stretch of the timeline. */
export interface DiagramSlice {
  /** Used in the filename and printed on the slide, so keep it short. */
  name: string;
  /** Secondary line under the name — a time range, usually. */
  subtitle?: string;
  x: number;
  width: number;
}

export interface SliceStyle {
  background: string;
  text: string;
  muted: string;
  border: string;
}

const SLIDE_HEADER_H = 52;
const SLICE_PAD = 10;
/** Below this a slice is a sliver; it borrows context from either side. */
const SLICE_MIN_W = 700;

const SLIDE_SANS = 'ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * Export one PNG per slice, each carrying the plane gutter so it can be read
 * on its own, under a header naming the incident and the phase.
 *
 * A whole incident is one enormous wide image that nobody can put on a slide.
 * Cut at the acts and each piece is a picture of one phase, at a size a
 * projector can actually show.
 */
export async function exportSlices(
  svg: SVGSVGElement,
  incident: Incident,
  slices: DiagramSlice[],
  gutterWidth: number,
  style: SliceStyle,
  scale = 2,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const { image, width: fullWidth, height } = await rasterise(svg);
  const stem = slugify(incident.name);
  let written = 0;

  for (const [index, slice] of slices.entries()) {
    // A single-column act would come out a sliver. Widen it symmetrically and
    // let the slides overlap — continuity between them is a feature in a deck.
    const wanted = Math.max(slice.width + SLICE_PAD * 2, SLICE_MIN_W);
    const centre = slice.x + slice.width / 2;
    let from = Math.round(centre - wanted / 2);
    let span = Math.round(wanted);

    from = Math.max(gutterWidth, Math.min(from, fullWidth - span));
    from = Math.max(gutterWidth, from);
    span = Math.max(1, Math.min(span, fullWidth - from));

    const canvasW = gutterWidth + span;
    const canvasH = height + SLIDE_HEADER_H;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(canvasW * scale);
    canvas.height = Math.round(canvasH * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.scale(scale, scale);

    ctx.fillStyle = style.background;
    ctx.fillRect(0, 0, canvasW, canvasH);

    // A header drawn here rather than cropped out of the diagram: the incident
    // title is far wider than the gutter and would come out cut mid-word.
    ctx.fillStyle = style.text;
    ctx.font = `600 17px ${SLIDE_SANS}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(incident.name, 22, 26);

    ctx.fillStyle = style.muted;
    ctx.font = `12px ${SLIDE_SANS}`;
    const caption = [`${index + 1} of ${slices.length}`, slice.name, slice.subtitle].filter(Boolean).join('   ·   ');
    ctx.fillText(caption, 22, 43);

    ctx.strokeStyle = style.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, SLIDE_HEADER_H - 0.5);
    ctx.lineTo(canvasW, SLIDE_HEADER_H - 0.5);
    ctx.stroke();

    // The gutter first — the plane names are what make a slice legible alone —
    // then the stretch of timeline this act covers, butted up against it.
    ctx.drawImage(image, 0, 0, gutterWidth, height, 0, SLIDE_HEADER_H, gutterWidth, height);
    ctx.drawImage(image, from, 0, span, height, gutterWidth, SLIDE_HEADER_H, span, height);

    const label = slugify(slice.name) || String(index + 1);
    downloadBlob(`${stem}-${String(index + 1).padStart(2, '0')}-${label}.png`, await canvasToBlob(canvas));
    written += 1;
    onProgress?.(written, slices.length);

    // Browsers throttle a burst of downloads; a beat between them is the
    // difference between seven files and one plus a blocked-popup warning.
    if (index < slices.length - 1) await new Promise((resolve) => setTimeout(resolve, 350));
  }

  return written;
}

/**
 * Rasterise the diagram. Because the SVG has no external references, it can be
 * loaded straight from a data URL without tainting the canvas.
 */
export async function exportPng(svg: SVGSVGElement, incident: Incident, scale = 2): Promise<void> {
  const { image, width, height } = await rasterise(svg);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.scale(scale, scale);
  ctx.drawImage(image, 0, 0, width, height);

  downloadBlob(`${slugify(incident.name)}.gibsen.png`, await canvasToBlob(canvas));
}
