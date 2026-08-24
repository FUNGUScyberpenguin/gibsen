/**
 * SVG renderer.
 *
 * Produces a single self-contained `<svg>` element: presentation attributes
 * only, no external fonts, no CSS classes doing visual work. That constraint is
 * what lets the exact same element be shown on screen, serialised to an `.svg`
 * file and rasterised to PNG without any of the three drifting apart.
 */

import type { Incident } from '../model/types';
import type { LayoutResult, PositionedNode } from '../layout/layout';
import { COL_W, GUTTER_W } from '../layout/layout';
import { CATEGORY_BY_ID, CONFIDENCE_OPACITY, PLANE_BY_ID, RELATION_BY_ID, RELATION_FAMILY_COLOR, TACTIC_COLOR, TACTICS } from '../model/taxonomy';
import { iconFor } from '../model/icons';
import { condenseLabel, wrapLabel } from './label';
import { hasDeeperRecord } from '../model/record';
import type { Theme } from './theme';

const SVG_NS = 'http://www.w3.org/2000/svg';

const SANS = 'ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

const TITLE_H = 78;
const LEGEND_ROW_H = 22;

export interface RenderOptions {
  theme: Theme;
  selectedId?: string | null;
  /** Draw the incident name and time window above the diagram. */
  showTitle?: boolean;
  /** Draw the plane / confidence / behaviour key below the diagram. */
  showLegend?: boolean;
  showEdgeLabels?: boolean;
  /**
   * Artifact id -> how many other artifacts fall away without it. Marks the
   * points of congruence, which is where a defender gets the most leverage.
   */
  chokePoints?: Map<string, number>;
  /** Tag nodes with `data-node-id` so the app can wire up clicks. */
  interactive?: boolean;
}

type Attrs = Record<string, string | number | undefined | null>;

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string)[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    node.setAttribute(k, String(v));
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** Approximate glyph width; good enough to decide where to put an ellipsis. */
function fitText(text: string, maxWidth: number, fontSize: number, mono: boolean): string {
  const charWidth = fontSize * (mono ? 0.601 : 0.545);
  const max = Math.floor(maxWidth / charWidth);
  if (text.length <= max) return text;
  if (max <= 1) return '…';
  return `${text.slice(0, max - 1)}…`;
}

function sanitiseId(color: string): string {
  return color.replace(/[^a-z0-9]/gi, '');
}

/** Colour of a node's accent bar and icon, taken from the plane as drawn. */
function nodeAccent(placed: PositionedNode, theme: Theme): string {
  if (placed.node.compromised) return theme.danger;
  return PLANE_BY_ID[placed.plane]?.accent ?? theme.textMuted;
}

export function renderDiagram(incident: Incident, result: LayoutResult, options: RenderOptions): SVGSVGElement {
  const { theme } = options;
  const showTitle = options.showTitle ?? true;
  const showLegend = options.showLegend ?? true;
  const showEdgeLabels = options.showEdgeLabels ?? true;

  const topOffset = showTitle ? TITLE_H : 0;
  // planes, confidence, behaviour, markers — plus a tactics line when earned.
  const legendRows = 4 + (incident.nodes.some((n) => n.tactic) ? 1 : 0);
  const legendHeight = showLegend ? LEGEND_ROW_H * legendRows + 30 : 0;
  const totalWidth = Math.max(result.width, 620);
  const totalHeight = topOffset + result.height + legendHeight;

  const svg = el('svg', {
    xmlns: SVG_NS,
    'xmlns:xlink': 'http://www.w3.org/1999/xlink',
    viewBox: `0 0 ${totalWidth} ${totalHeight}`,
    width: totalWidth,
    height: totalHeight,
    'font-family': SANS,
  });

  // --- markers ----------------------------------------------------------
  const defs = el('defs');
  const arrowColors = new Set<string>([theme.textMuted]);
  for (const { edge } of result.edges) {
    arrowColors.add(RELATION_FAMILY_COLOR[RELATION_BY_ID[edge.relation]?.family ?? 'generic']);
  }
  for (const color of arrowColors) {
    defs.append(
      el(
        'marker',
        {
          id: `gib-arrow-${sanitiseId(color)}`,
          viewBox: '0 0 10 10',
          refX: 9,
          refY: 5,
          markerWidth: 6,
          markerHeight: 6,
          orient: 'auto-start-reverse',
        },
        el('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: color }),
      ),
    );
  }
  svg.append(defs);

  svg.append(el('rect', { x: 0, y: 0, width: totalWidth, height: totalHeight, fill: theme.bg }));

  // --- title ------------------------------------------------------------
  if (showTitle) {
    const stamps = incident.nodes.map((n) => n.t).filter((t): t is string => Boolean(t)).sort();
    const window =
      stamps.length > 0
        ? `${stamps[0].replace('.000Z', 'Z')} → ${stamps[stamps.length - 1].replace('.000Z', 'Z')}`
        : 'No timestamps recorded';

    svg.append(
      el(
        'text',
        { x: 28, y: 36, fill: theme.text, 'font-size': 19, 'font-weight': 600 },
        fitText(incident.name, totalWidth - 56, 19, false),
      ),
      el(
        'text',
        { x: 28, y: 57, fill: theme.textMuted, 'font-size': 11.5, 'font-family': MONO },
        `${window}   ·   ${incident.nodes.length} artifacts   ·   ${incident.edges.length} behaviours   ·   grouped by ${result.granularity.replace(/-/g, ' ')}`,
      ),
      el('line', { x1: 0, y1: TITLE_H - 12, x2: totalWidth, y2: TITLE_H - 12, stroke: theme.grid, 'stroke-width': 1 }),
    );
  }

  const root = el('g', { transform: `translate(0, ${topOffset})` });
  svg.append(root);

  // --- plane bands ------------------------------------------------------
  const bandsGroup = el('g');
  result.bands.forEach((band, i) => {
    if (band.boundary) {
      // A seam, not a region: the registry is drawn on the line between memory
      // and disk because it genuinely lives in both.
      bandsGroup.append(
        el('rect', { x: 0, y: band.y, width: totalWidth, height: band.height, fill: theme.bg, 'fill-opacity': 0.35 }),
        el('line', { x1: 0, y1: band.y, x2: totalWidth, y2: band.y, stroke: band.accent, 'stroke-width': 1, 'stroke-dasharray': '6 5', 'stroke-opacity': 0.7 }),
        el('line', { x1: 0, y1: band.y + band.height, x2: totalWidth, y2: band.y + band.height, stroke: band.accent, 'stroke-width': 1, 'stroke-dasharray': '6 5', 'stroke-opacity': 0.7 }),
        el(
          'text',
          { x: 32, y: band.y + band.height / 2 + 4, fill: band.accent, 'font-size': 11, 'font-weight': 600 },
          fitText(band.label, GUTTER_W - 44, 11, false),
        ),
      );
      return;
    }

    const fill = band.extension ? theme.extensionTint : i % 2 === 0 ? theme.bandTint : theme.bandTintAlt;
    bandsGroup.append(
      el('rect', {
        x: 0,
        y: band.y,
        width: totalWidth,
        height: band.height,
        fill,
        stroke: theme.grid,
        'stroke-width': 1,
        'stroke-dasharray': band.extension ? '4 4' : undefined,
      }),
      // Accent spine down the left of the gutter.
      el('rect', { x: 18, y: band.y + 14, width: 3, height: Math.max(band.height - 28, 8), fill: band.accent, rx: 1.5 }),
      el(
        'text',
        { x: 32, y: band.y + 28, fill: theme.text, 'font-size': 13, 'font-weight': 600 },
        fitText(band.label, GUTTER_W - 44, 13, false),
      ),
      el(
        'text',
        { x: 32, y: band.y + 45, fill: theme.textMuted, 'font-size': 10 },
        fitText(band.blurb, GUTTER_W - 44, 10, false),
      ),
    );
    if (band.extension) {
      bandsGroup.append(
        el('text', { x: 32, y: band.y + 60, fill: theme.textMuted, 'font-size': 9, 'font-style': 'italic' }, 'annotation rail'),
      );
    }
  });
  root.append(bandsGroup);

  // --- time axis --------------------------------------------------------
  const axis = el('g');
  const headerH = result.headerHeight;
  const diagramBottom = result.height;

  // Out-of-hours first, underneath everything else on the axis: a wash behind
  // the columns nobody should have been working in. Attackers keeping office
  // hours is a finding; so is a 03:00 Sunday, and neither is legible from a
  // timestamp column you have to read one entry at a time.
  for (const column of result.columns) {
    if (!column.outOfHours) continue;
    axis.append(
      el('rect', {
        x: column.x - 17 - column.gapBefore,
        y: headerH,
        width: COL_W + column.gapBefore,
        height: Math.max(0, diagramBottom - 12 - headerH),
        fill: theme.textMuted,
        'fill-opacity': 0.055,
      }),
    );
  }

  for (const column of result.columns) {
    const x = column.x;
    axis.append(
      el('line', {
        x1: x - 17,
        y1: headerH,
        x2: x - 17,
        y2: diagramBottom - 12,
        stroke: theme.grid,
        'stroke-width': 1,
        'stroke-dasharray': column.key === null ? '3 5' : undefined,
      }),
    );

    const labelFill = column.key === null ? theme.textMuted : theme.text;
    axis.append(
      el(
        'text',
        { x, y: headerH - 26, fill: labelFill, 'font-size': 12, 'font-weight': 600, 'font-family': MONO },
        fitText(column.label, COL_W - 18, 12, true),
      ),
    );
    if (column.sublabel) {
      axis.append(
        el('text', { x, y: headerH - 42, fill: theme.textMuted, 'font-size': 10 }, column.sublabel),
      );
    }
    if (column.delta) {
      axis.append(
        el(
          'text',
          { x: x - 22, y: headerH - 26, fill: theme.textMuted, 'font-size': 9.5, 'text-anchor': 'end', 'font-family': MONO },
          column.delta,
        ),
      );
    }

    // A gap too long to draw even at log scale gets said out loud, with the
    // torn-axis mark that admits the diagram is compressing here.
    if (column.elided) {
      const mid = x - 17 - column.gapBefore / 2;
      const zig = 8;
      // The classic torn axis: two parallel zigzags saying the diagram is not
      // to scale across this stretch, and how much it is standing in for.
      const tear = (offset: number) => {
        let d = `M ${mid + offset} ${headerH}`;
        for (let yy = headerH; yy < diagramBottom - 12; yy += zig * 2) {
          d += ` l ${zig} ${zig} l ${-zig} ${zig}`;
        }
        return el('path', {
          d,
          fill: 'none',
          stroke: theme.textMuted,
          'stroke-width': 1,
          'stroke-opacity': 0.32,
          'stroke-linejoin': 'round',
        });
      };
      const pillW = Math.round(column.elided.length * 9.5 * 0.545) + 20;
      axis.append(
        tear(-5),
        tear(3),
        el('rect', {
          x: mid - pillW / 2, y: headerH - 12, width: pillW, height: 17, rx: 8.5,
          fill: theme.bg, stroke: theme.border, 'stroke-width': 1,
        }),
        el(
          'text',
          { x: mid, y: headerH + 0.5, fill: theme.textMuted, 'font-size': 9.5, 'text-anchor': 'middle' },
          column.elided,
        ),
      );
    }
  }

  // --- acts -------------------------------------------------------------
  // Six names above the axis is what an audience carries out of the room.
  for (const act of result.acts) {
    const accent = TACTIC_COLOR[act.tactic] ?? theme.textMuted;
    axis.append(
      el('rect', {
        x: act.x, y: 14, width: Math.max(act.width, 8), height: 22, rx: 6,
        fill: accent, 'fill-opacity': 0.13, stroke: accent, 'stroke-opacity': 0.5, 'stroke-width': 1,
      }),
    );
    const caption = act.duration ? `${act.label}  ·  ${act.duration}` : act.label;
    axis.append(
      el(
        'text',
        {
          x: act.x + Math.max(act.width, 8) / 2, y: 29,
          fill: theme.text, 'font-size': 10.5, 'font-weight': 600,
          'text-anchor': 'middle', 'letter-spacing': 0.3,
        },
        fitText(caption, Math.max(act.width, 8) - 14, 10.5, false),
      ),
    );
  }
  axis.append(
    el('line', {
      x1: GUTTER_W,
      y1: headerH - 12,
      x2: totalWidth - 20,
      y2: headerH - 12,
      stroke: theme.border,
      'stroke-width': 1.2,
      'marker-end': `url(#gib-arrow-${sanitiseId(theme.textMuted)})`,
    }),
    el(
      'text',
      { x: 22, y: headerH - 26, fill: theme.textMuted, 'font-size': 10, 'letter-spacing': 1.2 },
      // Naming the zone on the axis, so nobody reads a local clock as UTC.
      result.timeZone === 'UTC' ? 'TIME → UTC' : `TIME → ${result.timeZone}`,
    ),
  );
  root.append(axis);

  // --- edges (under nodes) ---------------------------------------------
  const edgeGroup = el('g');
  for (const routed of result.edges) {
    const def = RELATION_BY_ID[routed.edge.relation];
    const color = RELATION_FAMILY_COLOR[def?.family ?? 'generic'];
    const opacity = CONFIDENCE_OPACITY[routed.edge.confidence] ?? 0.8;

    // One group per behaviour, so the verb dims and selects with the line it
    // belongs to rather than behaving like a separate object.
    const group = el('g', { 'data-edge-id': options.interactive ? routed.edge.id : undefined });
    edgeGroup.append(group);

    group.append(
      el('path', {
        d: routed.path,
        fill: 'none',
        stroke: color,
        'stroke-width': routed.retrograde ? 1.3 : 1.7,
        'stroke-opacity': opacity,
        'stroke-dasharray': routed.edge.confidence === 'suspected' || routed.retrograde ? '5 4' : undefined,
        'marker-end': `url(#gib-arrow-${sanitiseId(color)})`,
      }),
    );

    const text = routed.edge.label ?? def?.label ?? routed.edge.relation;
    const width = text.length * 5.2 + 10;

    // A verb printed across a gap narrower than itself lands on top of the
    // artifacts it connects. The relation is still in the inspector and the
    // report, so dropping the label here costs nothing but noise.
    if (showEdgeLabels && routed.span >= width + 12) {
      group.append(
        el('rect', {
          x: routed.labelX - width / 2,
          y: routed.labelY - 8,
          width,
          height: 15,
          rx: 7.5,
          fill: theme.bg,
          'fill-opacity': 0.88,
        }),
        el(
          'text',
          {
            x: routed.labelX,
            y: routed.labelY + 3,
            fill: color,
            'font-size': 9.5,
            'text-anchor': 'middle',
            'fill-opacity': opacity,
          },
          text,
        ),
      );
    }
  }
  root.append(edgeGroup);

  // --- nodes ------------------------------------------------------------
  const nodeGroup = el('g');
  let anyRecordMarkers = false;
  for (const placed of result.nodes) {
    const { node } = placed;
    const accent = nodeAccent(placed, theme);
    const selected = options.selectedId === node.id;
    const borderOpacity = CONFIDENCE_OPACITY[node.confidence] ?? 1;
    const severed = options.chokePoints?.get(node.id) ?? 0;
    const boxWidth = result.nodeWidth;

    const group = el('g', {
      transform: `translate(${placed.x}, ${placed.y})`,
      'data-node-id': options.interactive ? node.id : undefined,
      cursor: options.interactive ? 'pointer' : undefined,
    });

    const tooltip = [
      node.label,
      CATEGORY_BY_ID[node.category]?.label ?? node.category,
      node.tEnd ? `${node.t} → ${node.tEnd}` : (node.t ?? 'unsequenced'),
      severed > 0 ? `Point of congruence — ${severed} artifact(s) depend on it` : null,
    ].filter(Boolean).join('\n');
    group.append(el('title', {}, tooltip));

    if (selected) {
      group.append(
        el('rect', {
          x: -4, y: -4, width: placed.w + 8, height: placed.h + 8, rx: 10,
          fill: 'none', stroke: theme.pivot, 'stroke-width': 2,
        }),
      );
    }

    // A point of congruence gets an outer ring, so it reads as load-bearing
    // even when the diagram is zoomed too far out to read the labels.
    if (severed > 0) {
      group.append(
        el('rect', {
          x: -2.5, y: -2.5, width: placed.w + 5, height: placed.h + 5, rx: 9,
          fill: 'none', stroke: theme.congruence, 'stroke-width': 1.4, 'stroke-dasharray': '3 3', 'stroke-opacity': 0.9,
        }),
      );
    }

    if (node.aggregate) {
      // Many artifacts at once, drawn as one triangle rather than one line per
      // endpoint: widening when a single thing reaches many, narrowing when
      // many reach a single thing.
      const w = placed.w;
      const h = placed.h;
      const fanOut = node.aggregate.kind === 'fan-out';
      const d = fanOut
        ? `M 3 ${h / 2} L ${w - 3} 4 L ${w - 3} ${h - 4} Z`
        : `M ${w - 3} ${h / 2} L 3 4 L 3 ${h - 4} Z`;

      group.append(
        el('path', {
          d,
          fill: accent,
          // A triangle stretched across the whole timeline is a legitimate
          // thing to draw — a beacon really did run for twenty hours — but at
          // that width a solid wedge swamps everything under it.
          'fill-opacity': placed.spanning ? 0.07 : 0.13,
          stroke: accent,
          'stroke-width': node.compromised ? 1.6 : 1.2,
          'stroke-opacity': borderOpacity,
          'stroke-linejoin': 'round',
          'stroke-dasharray': node.confidence === 'suspected' ? '4 3' : undefined,
        }),
      );

      // Label at the leading edge rather than the wide end. A triangle that
      // spans two hours is over a thousand pixels across, and a label parked at
      // its far end sits nowhere near the artifact it connects to.
      const anchorX = 14;
      const anchor = 'start';
      const labelWidth = Math.min(w, result.nodeWidth * 1.4) - 28;
      const count = node.aggregate.count;
      group.append(
        el(
          'text',
          { x: anchorX, y: h / 2 - 2, fill: theme.text, 'font-size': 11, 'font-family': MONO, 'text-anchor': anchor },
          fitText(condenseLabel(node.label, Math.floor(labelWidth / (11 * 0.601))), labelWidth, 11, true),
        ),
        el(
          'text',
          { x: anchorX, y: h / 2 + 12, fill: theme.textMuted, 'font-size': 9.5, 'text-anchor': anchor },
          fitText(
            [count ? `×${count}` : 'many', node.aggregate.of ?? (fanOut ? 'targets' : 'sessions')].join(' '),
            labelWidth,
            9.5,
            false,
          ),
        ),
      );

      nodeGroup.append(group);
      continue;
    }

    group.append(
      el('rect', {
        x: 0, y: 0, width: placed.w, height: placed.h, rx: 7,
        fill: theme.surface,
        stroke: node.compromised ? theme.danger : theme.border,
        'stroke-width': node.compromised ? 1.5 : 1,
        'stroke-opacity': borderOpacity,
        'stroke-dasharray': node.confidence === 'suspected' ? '4 3' : undefined,
      }),
      // Plane accent spine.
      el('path', { d: `M 3.5 4 L 3.5 ${placed.h - 4}`, stroke: accent, 'stroke-width': 3, 'stroke-linecap': 'round' }),
    );

    // An artifact that was live over a period carries a rule to its far end,
    // so the eye reads the box as a duration rather than a very wide instant.
    if (placed.spanning) {
      group.append(
        el('line', {
          x1: boxWidth - 14, y1: placed.h - 13, x2: placed.w - 10, y2: placed.h - 13,
          stroke: accent, 'stroke-width': 1, 'stroke-dasharray': '2 3', 'stroke-opacity': 0.65,
        }),
        el('line', {
          x1: placed.w - 10, y1: placed.h - 17, x2: placed.w - 10, y2: placed.h - 9,
          stroke: accent, 'stroke-width': 1, 'stroke-opacity': 0.65,
        }),
      );
      if (node.tEnd) {
        group.append(
          el(
            'text',
            { x: placed.w - 14, y: 22, fill: theme.textMuted, 'font-size': 9, 'font-family': MONO, 'text-anchor': 'end' },
            `until ${node.tEnd.slice(11, 16)}`,
          ),
        );
      }
    }

    const icon = el('g', {
      transform: 'translate(13, 9) scale(0.83)',
      fill: 'none',
      stroke: accent,
      'stroke-width': 1.7,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    });
    icon.innerHTML = iconFor(node.category);
    group.append(icon);

    group.append(
      el(
        'text',
        { x: 38, y: 22, fill: theme.textMuted, 'font-size': 9.5, 'letter-spacing': 0.3 },
        fitText((CATEGORY_BY_ID[node.category]?.label ?? node.category).toUpperCase(), boxWidth - 60, 9.5, false),
      ),
    );

    // The label gets as many lines as this incident's longest one needed. Past
    // that the middle is dropped rather than the tail, and the box earns a
    // "more" marker — the full value is in the record, one click away.
    const labelChars = Math.floor((Math.max(placed.w, boxWidth) - 24) / (12 * 0.601));
    const lines = wrapLabel(node.label, labelChars, result.labelLines);
    lines.forEach((line, i) => {
      group.append(
        el(
          'text',
          { x: 12, y: 45 + i * 15, fill: theme.text, 'font-size': 12, 'font-family': MONO },
          line,
        ),
      );
    });

    // Badges along the top-right of the first column's worth of box.
    let badgeX = Math.min(placed.w, boxWidth) - 12;

    // Only on screen: on paper a "there is more" marker points nowhere, so the
    // whole marker is one group the flat exporters can lift back out.
    if (options.interactive && hasDeeperRecord(node, lines.join(''))) {
      anyRecordMarkers = true;
      const more = el('g', { 'data-more-for': node.id, cursor: 'pointer' });
      more.append(
        // A generous hit area first, underneath: the glyph is a few pixels wide.
        el('rect', { x: badgeX - 12, y: 3, width: 23, height: 22, rx: 5, fill: 'transparent' }),
        el(
          'text',
          {
            x: badgeX + 1, y: 18, fill: theme.textMuted, 'font-size': 14, 'font-family': SANS,
            'text-anchor': 'end', 'letter-spacing': 0.5,
          },
          '\u22ef',
        ),
        el('title', {}, 'Open the full record'),
      );
      group.append(more);
      badgeX -= 15;
    }
    if (node.pivot) {
      group.append(el('circle', { cx: badgeX, cy: 14, r: 4.2, fill: theme.pivot }));
      badgeX -= 13;
    }
    if (node.compromised) {
      group.append(el('circle', { cx: badgeX, cy: 14, r: 4.2, fill: theme.danger }));
      badgeX -= 13;
    }
    if (node.timeBasis === 'inferred') {
      group.append(
        el('text', { x: badgeX + 4, y: 18, fill: theme.textMuted, 'font-size': 11, 'text-anchor': 'end' }, '~'),
      );
    }

    nodeGroup.append(group);
  }
  root.append(nodeGroup);

  // --- legend -----------------------------------------------------------
  if (showLegend) {
    svg.append(renderLegend(incident, result, theme, totalWidth, topOffset + result.height, options, anyRecordMarkers));
  }

  return svg;
}

function renderLegend(
  incident: Incident,
  result: LayoutResult,
  theme: Theme,
  width: number,
  y: number,
  options: RenderOptions,
  /** Whether any box was actually given a "more in the record" marker. */
  anyRecordMarkers: boolean,
): SVGGElement {
  const group = el('g', { transform: `translate(0, ${y})` });
  group.append(el('line', { x1: 0, y1: 8, x2: width, y2: 8, stroke: theme.grid, 'stroke-width': 1 }));

  const row = (index: number) => 8 + 22 + index * LEGEND_ROW_H;
  const heading = (x: number, r: number, text: string) =>
    group.append(el('text', { x, y: row(r), fill: theme.textMuted, 'font-size': 10, 'font-weight': 600 }, text));

  // Row 1: the planes this diagram actually uses, in drawing order.
  heading(28, 0, 'PLANES');
  let x = 98;
  for (const band of result.bands) {
    group.append(
      el('rect', { x, y: row(0) - 8, width: 10, height: 10, rx: 2, fill: band.accent }),
      el('text', { x: x + 16, y: row(0), fill: theme.text, 'font-size': 10.5 }, band.label),
    );
    x += 26 + band.label.length * 6;
  }

  // Row 2: the confidence ramp.
  heading(28, 1, 'CONFIDENCE');
  x = 98;
  for (const level of ['confirmed', 'probable', 'possible', 'suspected'] as const) {
    group.append(
      el('rect', {
        x, y: row(1) - 9, width: 12, height: 12, rx: 3,
        fill: theme.surface,
        stroke: theme.border,
        'stroke-opacity': CONFIDENCE_OPACITY[level],
        'stroke-dasharray': level === 'suspected' ? '3 2' : undefined,
      }),
      el('text', { x: x + 18, y: row(1), fill: theme.text, 'font-size': 10.5 }, level),
    );
    x += 30 + level.length * 6;
  }

  // Row 3: behaviour families in use.
  heading(28, 2, 'BEHAVIOUR');
  x = 98;
  const families = [...new Set(incident.edges.map((e) => RELATION_BY_ID[e.relation]?.family ?? 'generic'))];
  for (const family of families) {
    const color = RELATION_FAMILY_COLOR[family];
    group.append(
      el('line', { x1: x, y1: row(2) - 4, x2: x + 18, y2: row(2) - 4, stroke: color, 'stroke-width': 2 }),
      el('text', { x: x + 24, y: row(2), fill: theme.text, 'font-size': 10.5 }, family),
    );
    x += 34 + family.length * 6;
  }

  // Row 4: the node markers, only those the diagram is actually using.
  heading(28, 3, 'MARKERS');
  x = 98;
  const marker = (draw: () => void, label: string) => {
    draw();
    group.append(el('text', { x: x + 18, y: row(3), fill: theme.text, 'font-size': 10.5 }, label));
    x += 26 + label.length * 6;
  };

  if (incident.nodes.some((n) => n.pivot)) {
    marker(() => group.append(el('circle', { cx: x + 5, cy: row(3) - 3.5, r: 4.2, fill: theme.pivot })), 'pivot');
  }
  if (incident.nodes.some((n) => n.compromised)) {
    marker(() => group.append(el('circle', { cx: x + 5, cy: row(3) - 3.5, r: 4.2, fill: theme.danger })), 'attacker-controlled');
  }
  if (incident.nodes.some((n) => n.timeBasis === 'inferred')) {
    marker(
      () => group.append(el('text', { x: x + 1, y: row(3) + 1, fill: theme.textMuted, 'font-size': 12 }, '~')),
      'inferred time',
    );
  }
  if (result.nodes.some((p) => p.spanning)) {
    marker(
      () =>
        group.append(
          el('rect', { x, y: row(3) - 8, width: 22, height: 10, rx: 2, fill: 'none', stroke: theme.textMuted, 'stroke-width': 1 }),
        ),
      'spans a period',
    );
    x += 6;
  }
  if (incident.nodes.some((n) => n.aggregate)) {
    marker(
      () =>
        group.append(
          el('path', { d: `M ${x} ${row(3) - 3.5} L ${x + 13} ${row(3) - 9} L ${x + 13} ${row(3) + 2} Z`, fill: 'none', stroke: theme.textMuted, 'stroke-width': 1.2 }),
        ),
      'many artifacts',
    );
  }
  if (options.chokePoints && options.chokePoints.size > 0) {
    marker(
      () =>
        group.append(
          el('rect', {
            x, y: row(3) - 9, width: 13, height: 13, rx: 3,
            fill: 'none', stroke: theme.congruence, 'stroke-width': 1.4, 'stroke-dasharray': '3 3',
          }),
        ),
      'point of congruence',
    );
  }

  if (result.columns.some((c) => c.outOfHours)) {
    marker(
      () =>
        group.append(
          el('rect', { x, y: row(3) - 9, width: 14, height: 13, rx: 2, fill: theme.textMuted, 'fill-opacity': 0.14 }),
        ),
      'outside working hours',
    );
  }
  if (result.columns.some((c) => c.elided)) {
    marker(
      () =>
        group.append(
          el('path', {
            d: `M ${x + 5} ${row(3) - 9} l 5 4.5 l -5 4.5 l 5 4.5`,
            fill: 'none', stroke: theme.textMuted, 'stroke-width': 1, 'stroke-linejoin': 'round',
          }),
        ),
      'time not to scale across here',
    );
  }

  // Only on screen, and only if some box actually carries one.
  if (anyRecordMarkers) {
    marker(
      () => group.append(el('text', { x: x + 1, y: row(3) + 1, fill: theme.textMuted, 'font-size': 13 }, '\u22ef')),
      'more in the record — click it',
    );
  }

  const tactics = [...new Set(incident.nodes.map((n) => n.tactic).filter(Boolean))];
  if (tactics.length) {
    const names = tactics.map((t) => TACTICS.find((d) => d.id === t)?.label ?? t).join(' · ');
    group.append(
      el(
        'text',
        { x: 28, y: row(4), fill: theme.textMuted, 'font-size': 9.5 },
        fitText(`Tactics observed: ${names}`, width - 56, 9.5, false),
      ),
    );
  }

  return group;
}
