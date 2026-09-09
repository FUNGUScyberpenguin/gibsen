/**
 * The parts of a page that are drawn rather than cut.
 *
 * An act page is mostly a rectangle taken out of the rendered diagram: the
 * plane gutter, then the stretch of timeline that act covers. What is left is
 * the header naming the incident and the act, and the contents sheet at the
 * front. Both are small pieces of SVG, built here so a rasteriser can turn them
 * into pixels next to the diagram they sit above.
 *
 * The header is redrawn rather than cropped out of the diagram for the same
 * reason the browser slide export redraws it: the incident title is far wider
 * than the gutter and would come out cut mid-word.
 */

const SANS = 'ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The colours a page needs. A `Theme` satisfies this; so does a plain object. */
export interface PageStyle {
  bg: string;
  text: string;
  textMuted: string;
  border: string;
  grid: string;
}

export interface SvgPiece {
  markup: string;
  width: number;
  height: number;
}

/** The strip above an act page: incident name, then which act this is. */
export function pageHeaderSvg(
  incidentName: string,
  caption: string,
  width: number,
  height: number,
  style: PageStyle,
): SvgPiece {
  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"` +
    ` font-family="${escapeXml(SANS)}">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${style.bg}"/>` +
    `<text x="22" y="26" fill="${style.text}" font-size="17" font-weight="600">${escapeXml(incidentName)}</text>` +
    `<text x="22" y="43" fill="${style.textMuted}" font-size="12">${escapeXml(caption)}</text>` +
    `<line x1="0" y1="${height - 0.5}" x2="${width}" y2="${height - 0.5}" stroke="${style.border}" stroke-width="1"/>` +
    `</svg>`;

  return { markup, width, height };
}

/**
 * A contents sheet: the incident, its summary, and the acts in order.
 *
 * Cheap to draw and worth the page. An act page on its own says which phase it
 * is but not how many there are, or what came before it.
 */
export function contentsPageSvg(
  incidentName: string,
  summary: string,
  lines: { label: string; detail: string }[],
  style: PageStyle,
  width = 1400,
): SvgPiece {
  const top = 96;
  const rowH = 38;
  const height = Math.max(600, top + 40 + lines.length * rowH + 60);

  const rows = lines
    .map((line, i) => {
      const y = top + 56 + i * rowH;
      return (
        `<text x="70" y="${y}" fill="${style.textMuted}" font-size="13" font-family="${escapeXml(SANS)}">${String(i + 1).padStart(2, '0')}</text>` +
        `<text x="118" y="${y}" fill="${style.text}" font-size="16" font-weight="600">${escapeXml(line.label)}</text>` +
        `<text x="118" y="${y + 17}" fill="${style.textMuted}" font-size="12.5">${escapeXml(line.detail)}</text>`
      );
    })
    .join('');

  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"` +
    ` font-family="${escapeXml(SANS)}">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${style.bg}"/>` +
    `<text x="70" y="70" fill="${style.text}" font-size="30" font-weight="600">${escapeXml(incidentName)}</text>` +
    (summary
      ? `<text x="70" y="${top}" fill="${style.textMuted}" font-size="14">${escapeXml(truncate(summary, 160))}</text>`
      : '') +
    `<line x1="70" y1="${top + 22}" x2="${width - 70}" y2="${top + 22}" stroke="${style.grid}" stroke-width="1"/>` +
    rows +
    `</svg>`;

  return { markup, width, height };
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
