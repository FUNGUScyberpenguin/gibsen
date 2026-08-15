/** Browser download helpers for the four export formats. */

import type { Incident } from '../model/types';
import { toMarkdownReport } from './report';

/** Serialise a rendered diagram to a standalone SVG document. */
export function toSvgString(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  // Selection rings and hit-testing hooks are app state, not diagram content.
  clone.querySelectorAll('[data-node-id], [data-edge-id]').forEach((node) => {
    node.removeAttribute('data-node-id');
    node.removeAttribute('data-edge-id');
    node.removeAttribute('cursor');
  });
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
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

export function exportMarkdown(incident: Incident): void {
  downloadBlob(
    `${slugify(incident.name)}.md`,
    new Blob([toMarkdownReport(incident)], { type: 'text/markdown' }),
  );
}

/**
 * Rasterise the diagram. Because the SVG has no external references, it can be
 * loaded straight from a data URL without tainting the canvas.
 */
export async function exportPng(svg: SVGSVGElement, incident: Incident, scale = 2): Promise<void> {
  const source = toSvgString(svg);
  const width = Number(svg.getAttribute('width')) || svg.viewBox.baseVal.width;
  const height = Number(svg.getAttribute('height')) || svg.viewBox.baseVal.height;

  // encodeURIComponent keeps non-ASCII in labels intact; btoa would not.
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;

  const image = new Image();
  image.width = width;
  image.height = height;

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Could not rasterise the diagram'));
    image.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.scale(scale, scale);
  ctx.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the PNG');
  downloadBlob(`${slugify(incident.name)}.gibsen.png`, blob);
}
