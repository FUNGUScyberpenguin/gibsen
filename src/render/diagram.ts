/**
 * SVG renderer.
 *
 * Produces a single self-contained `<svg>` element: presentation attributes
 * only, no external fonts, no CSS classes doing visual work. That constraint is
 * what lets the exact same element be shown on screen, serialised to an `.svg`
 * file and rasterised to PNG without any of the three drifting apart.
 */

import type { GibsenNode, Incident } from '../model/types';
import type { LayoutResult } from '../layout/layout';
import { COL_W, GUTTER_W, HEADER_H } from '../layout/layout';
import { CATEGORY_BY_ID, CONFIDENCE_OPACITY, PLANE_BY_ID, RELATION_BY_ID, RELATION_FAMILY_COLOR, TACTICS } from '../model/taxonomy';
import { iconFor } from '../model/icons';
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

/** Colour of a node's accent bar and icon. */
function nodeAccent(node: GibsenNode, theme: Theme): string {
  if (node.compromised) return theme.danger;
  return PLANE_BY_ID[node.plane]?.accent ?? theme.textMuted;
}

export function renderDiagram(incident: Incident, result: LayoutResult, options: RenderOptions): SVGSVGElement {
  const { theme } = options;
  const showTitle = options.showTitle ?? true;
  const showLegend = options.showLegend ?? true;
  const showEdgeLabels = options.showEdgeLabels ?? true;

  const topOffset = showTitle ? TITLE_H : 0;
  const legendHeight = showLegend ? LEGEND_ROW_H * 3 + 34 : 0;
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
  const diagramBottom = result.height;
  for (const column of result.columns) {
    const x = column.x;
    axis.append(
      el('line', {
        x1: x - 17,
        y1: HEADER_H,
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
        { x, y: HEADER_H - 26, fill: labelFill, 'font-size': 12, 'font-weight': 600, 'font-family': MONO },
        fitText(column.label, COL_W - 18, 12, true),
      ),
    );
    if (column.sublabel) {
      axis.append(
        el('text', { x, y: HEADER_H - 42, fill: theme.textMuted, 'font-size': 10 }, column.sublabel),
      );
    }
    if (column.delta) {
      axis.append(
        el(
          'text',
          { x: x - 22, y: HEADER_H - 26, fill: theme.textMuted, 'font-size': 9.5, 'text-anchor': 'end', 'font-family': MONO },
          column.delta,
        ),
      );
    }
  }
  axis.append(
    el('line', {
      x1: GUTTER_W,
      y1: HEADER_H - 12,
      x2: totalWidth - 20,
      y2: HEADER_H - 12,
      stroke: theme.border,
      'stroke-width': 1.2,
      'marker-end': `url(#gib-arrow-${sanitiseId(theme.textMuted)})`,
    }),
    el('text', { x: 22, y: HEADER_H - 26, fill: theme.textMuted, 'font-size': 10, 'letter-spacing': 1.2 }, 'TIME →'),
  );
  root.append(axis);

  // --- edges (under nodes) ---------------------------------------------
  const edgeGroup = el('g');
  for (const routed of result.edges) {
    const def = RELATION_BY_ID[routed.edge.relation];
    const color = RELATION_FAMILY_COLOR[def?.family ?? 'generic'];
    const opacity = CONFIDENCE_OPACITY[routed.edge.confidence] ?? 0.8;

    edgeGroup.append(
      el('path', {
        d: routed.path,
        fill: 'none',
        stroke: color,
        'stroke-width': routed.retrograde ? 1.3 : 1.7,
        'stroke-opacity': opacity,
        'stroke-dasharray': routed.edge.confidence === 'suspected' || routed.retrograde ? '5 4' : undefined,
        'marker-end': `url(#gib-arrow-${sanitiseId(color)})`,
        'data-edge-id': options.interactive ? routed.edge.id : undefined,
      }),
    );

    const text = routed.edge.label ?? def?.label ?? routed.edge.relation;
    const width = text.length * 5.2 + 10;

    // A verb printed across a gap narrower than itself lands on top of the
    // artifacts it connects. The relation is still in the inspector and the
    // report, so dropping the label here costs nothing but noise.
    if (showEdgeLabels && routed.span >= width + 12) {
      edgeGroup.append(
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
  for (const placed of result.nodes) {
    const { node } = placed;
    const accent = nodeAccent(node, theme);
    const selected = options.selectedId === node.id;
    const borderOpacity = CONFIDENCE_OPACITY[node.confidence] ?? 1;

    const group = el('g', {
      transform: `translate(${placed.x}, ${placed.y})`,
      'data-node-id': options.interactive ? node.id : undefined,
      cursor: options.interactive ? 'pointer' : undefined,
    });

    group.append(
      el('title', {}, `${node.label}\n${CATEGORY_BY_ID[node.category]?.label ?? node.category}\n${node.t ?? 'unsequenced'}`),
    );

    if (selected) {
      group.append(
        el('rect', {
          x: -4,
          y: -4,
          width: placed.w + 8,
          height: placed.h + 8,
          rx: 10,
          fill: 'none',
          stroke: theme.pivot,
          'stroke-width': 2,
        }),
      );
    }

    group.append(
      el('rect', {
        x: 0,
        y: 0,
        width: placed.w,
        height: placed.h,
        rx: 7,
        fill: theme.surface,
        stroke: node.compromised ? theme.danger : theme.border,
        'stroke-width': node.compromised ? 1.5 : 1,
        'stroke-opacity': borderOpacity,
        'stroke-dasharray': node.confidence === 'suspected' ? '4 3' : undefined,
      }),
      // Plane accent spine.
      el('path', { d: `M 3.5 4 L 3.5 ${placed.h - 4}`, stroke: accent, 'stroke-width': 3, 'stroke-linecap': 'round' }),
    );

    // Icon.
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
        fitText((CATEGORY_BY_ID[node.category]?.label ?? node.category).toUpperCase(), placed.w - 60, 9.5, false),
      ),
      el(
        'text',
        { x: 12, y: 45, fill: theme.text, 'font-size': 12, 'font-family': MONO },
        fitText(node.label, placed.w - 24, 12, true),
      ),
    );

    // Badges along the top-right.
    let badgeX = placed.w - 12;
    if (node.pivot) {
      group.append(el('circle', { cx: badgeX, cy: 14, r: 4.2, fill: theme.pivot }));
      group.append(el('title', {}, 'Investigation pivot'));
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
    svg.append(renderLegend(incident, theme, totalWidth, topOffset + result.height));
  }

  return svg;
}

function renderLegend(incident: Incident, theme: Theme, width: number, y: number): SVGGElement {
  const group = el('g', { transform: `translate(0, ${y})` });
  group.append(el('line', { x1: 0, y1: 8, x2: width, y2: 8, stroke: theme.grid, 'stroke-width': 1 }));

  const row = (index: number) => 8 + 22 + index * LEGEND_ROW_H;

  // Row 1: the planes present in this diagram.
  const planes = [...new Set(incident.nodes.map((n) => n.plane))];
  let x = 28;
  group.append(el('text', { x, y: row(0), fill: theme.textMuted, 'font-size': 10, 'font-weight': 600 }, 'PLANES'));
  x += 70;
  for (const planeId of planes) {
    const plane = PLANE_BY_ID[planeId];
    if (!plane) continue;
    group.append(
      el('rect', { x, y: row(0) - 8, width: 10, height: 10, rx: 2, fill: plane.accent }),
      el('text', { x: x + 16, y: row(0), fill: theme.text, 'font-size': 10.5 }, plane.label),
    );
    x += 26 + plane.label.length * 6;
  }

  // Row 2: confidence ramp and the two node badges.
  x = 28;
  group.append(el('text', { x, y: row(1), fill: theme.textMuted, 'font-size': 10, 'font-weight': 600 }, 'CONFIDENCE'));
  x += 70;
  for (const level of ['confirmed', 'probable', 'possible', 'suspected'] as const) {
    group.append(
      el('rect', {
        x,
        y: row(1) - 9,
        width: 12,
        height: 12,
        rx: 3,
        fill: theme.surface,
        stroke: theme.border,
        'stroke-opacity': CONFIDENCE_OPACITY[level],
        'stroke-dasharray': level === 'suspected' ? '3 2' : undefined,
      }),
      el('text', { x: x + 18, y: row(1), fill: theme.text, 'font-size': 10.5 }, level),
    );
    x += 30 + level.length * 6;
  }
  group.append(
    el('circle', { cx: x + 6, cy: row(1) - 3.5, r: 4.2, fill: theme.pivot }),
    el('text', { x: x + 16, y: row(1), fill: theme.text, 'font-size': 10.5 }, 'pivot'),
    el('circle', { cx: x + 62, cy: row(1) - 3.5, r: 4.2, fill: theme.danger }),
    el('text', { x: x + 72, y: row(1), fill: theme.text, 'font-size': 10.5 }, 'attacker-controlled'),
  );

  // Row 3: behaviour families actually used, plus tactic coverage.
  x = 28;
  group.append(el('text', { x, y: row(2), fill: theme.textMuted, 'font-size': 10, 'font-weight': 600 }, 'BEHAVIOUR'));
  x += 70;
  const families = [...new Set(incident.edges.map((e) => RELATION_BY_ID[e.relation]?.family ?? 'generic'))];
  for (const family of families) {
    const color = RELATION_FAMILY_COLOR[family];
    group.append(
      el('line', { x1: x, y1: row(2) - 4, x2: x + 18, y2: row(2) - 4, stroke: color, 'stroke-width': 2 }),
      el('text', { x: x + 24, y: row(2), fill: theme.text, 'font-size': 10.5 }, family),
    );
    x += 34 + family.length * 6;
  }

  const tactics = [...new Set(incident.nodes.map((n) => n.tactic).filter(Boolean))];
  if (tactics.length) {
    const names = tactics.map((t) => TACTICS.find((d) => d.id === t)?.label ?? t).join(' · ');
    group.append(
      el(
        'text',
        { x: 28, y: row(3), fill: theme.textMuted, 'font-size': 9.5 },
        fitText(`Tactics observed: ${names}`, width - 56, 9.5, false),
      ),
    );
  }

  return group;
}
