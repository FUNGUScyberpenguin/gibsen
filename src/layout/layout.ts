/**
 * Time-driven plane layout.
 *
 * Columns are ordered time buckets, rows are the technical planes. Columns are
 * equal width rather than proportional to elapsed time on purpose: an incident
 * that jumps from a 90-second exploit chain to a dwell of three weeks would be
 * unreadable to scale, and the narrative sequence is what a GIBSEN diagram is
 * for. The real interval is always printed on the axis, so nothing is hidden.
 */

import type { GibsenEdge, GibsenNode, Incident, PlaneId } from '../model/types';
import { PLANES } from '../model/taxonomy';

export const NODE_W = 176;
export const NODE_H = 60;
const COL_GAP = 34;
const ROW_GAP = 16;
const BAND_PAD = 20;
/** Wide enough to print "Operational Technology" in full at 13px. */
export const GUTTER_W = 212;
export const HEADER_H = 72;
const CANVAS_PAD = 28;

export const COL_W = NODE_W + COL_GAP;

export type Granularity =
  | 'second'
  | 'minute'
  | 'five-minutes'
  | 'fifteen-minutes'
  | 'hour'
  | 'six-hours'
  | 'day'
  | 'week'
  | 'month'
  | 'year';

const GRANULARITY_MS: Partial<Record<Granularity, number>> = {
  second: 1000,
  minute: 60_000,
  'five-minutes': 300_000,
  'fifteen-minutes': 900_000,
  hour: 3_600_000,
  'six-hours': 21_600_000,
  day: 86_400_000,
  week: 604_800_000,
};

/** Coarsening order used when `auto` is picking a granularity. */
const LADDER: Granularity[] = [
  'second',
  'minute',
  'five-minutes',
  'fifteen-minutes',
  'hour',
  'six-hours',
  'day',
  'week',
  'month',
  'year',
];

/** Start of the bucket containing `iso`, as an ISO string. */
export function bucketStart(iso: string, granularity: Granularity): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  if (granularity === 'month') {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
  }
  if (granularity === 'year') {
    return new Date(Date.UTC(d.getUTCFullYear(), 0, 1)).toISOString();
  }
  const unit = GRANULARITY_MS[granularity] ?? 1000;
  if (granularity === 'week') {
    // Anchor weeks on Monday rather than on the Unix epoch's Thursday.
    const dayStart = Math.floor(d.getTime() / 86_400_000) * 86_400_000;
    const weekday = (new Date(dayStart).getUTCDay() + 6) % 7;
    return new Date(dayStart - weekday * 86_400_000).toISOString();
  }
  return new Date(Math.floor(d.getTime() / unit) * unit).toISOString();
}

/** Coarsest-but-still-informative granularity that fits within `maxColumns`. */
export function chooseGranularity(stamps: string[], maxColumns = 16): Granularity {
  if (stamps.length === 0) return 'minute';
  for (const g of LADDER) {
    const buckets = new Set(stamps.map((s) => bucketStart(s, g)));
    if (buckets.size <= maxColumns) return g;
  }
  return 'year';
}

export interface TimeColumn {
  /** ISO bucket start, or null for the unsequenced column. */
  key: string | null;
  index: number;
  x: number;
  /** Primary axis label, e.g. `08:12`. */
  label: string;
  /** Secondary label, only set when the day changes, e.g. `14 Mar 2024`. */
  sublabel: string | null;
  /** Gap to the previous column in human terms, e.g. `+ 3d 4h`. */
  delta: string | null;
}

export interface PlaneBand {
  plane: PlaneId;
  label: string;
  blurb: string;
  accent: string;
  extension: boolean;
  y: number;
  height: number;
}

export interface PositionedNode {
  node: GibsenNode;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Centre point, cached for edge routing. */
  cx: number;
  cy: number;
}

export interface RoutedEdge {
  edge: GibsenEdge;
  path: string;
  /** Point on the path where a label should sit. */
  labelX: number;
  labelY: number;
  /**
   * Straight-line distance between the two anchor points. The renderer uses it
   * to drop a verb that would not fit in the gap and would print over a node.
   */
  span: number;
  /** True when the edge points backwards in time — usually worth a second look. */
  retrograde: boolean;
}

export interface LayoutResult {
  width: number;
  height: number;
  columns: TimeColumn[];
  bands: PlaneBand[];
  nodes: PositionedNode[];
  edges: RoutedEdge[];
  granularity: Granularity;
  /** Nodes hidden because their plane band was collapsed away. */
  unplaced: GibsenNode[];
}

export interface LayoutOptions {
  granularity?: Granularity | 'auto';
  /** Draw planes that contain no artifacts. Off by default to save height. */
  showEmptyPlanes?: boolean;
  maxColumns?: number;
}

function formatColumnLabel(iso: string, granularity: Granularity): { label: string; sublabel: string } {
  const d = new Date(iso);
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  const withSeconds = `${time}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
  const day = `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;

  switch (granularity) {
    case 'second':
      return { label: withSeconds, sublabel: day };
    case 'minute':
    case 'five-minutes':
    case 'fifteen-minutes':
    case 'hour':
    case 'six-hours':
      return { label: time, sublabel: day };
    case 'day':
    case 'week':
      return { label: day, sublabel: '' };
    case 'month':
      return { label: d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' }), sublabel: String(d.getUTCFullYear()) };
    case 'year':
    default:
      return { label: String(d.getUTCFullYear()), sublabel: '' };
  }
}

/** Human-readable gap between two ISO timestamps, e.g. `+ 2d 5h`. */
export function formatDelta(fromIso: string, toIso: string): string | null {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;

  const units: [number, string][] = [
    [86_400_000, 'd'],
    [3_600_000, 'h'],
    [60_000, 'm'],
    [1000, 's'],
  ];

  const parts: string[] = [];
  let rest = ms;
  for (const [size, suffix] of units) {
    const n = Math.floor(rest / size);
    if (n > 0) {
      parts.push(`${n}${suffix}`);
      rest -= n * size;
    }
    if (parts.length === 2) break;
  }
  return parts.length ? `+ ${parts.join(' ')}` : null;
}

export function layout(incident: Incident, options: LayoutOptions = {}): LayoutResult {
  const stamps = incident.nodes.map((n) => n.t).filter((t): t is string => Boolean(t));
  const granularity =
    !options.granularity || options.granularity === 'auto'
      ? chooseGranularity(stamps, options.maxColumns ?? 16)
      : options.granularity;

  // --- columns ----------------------------------------------------------
  const bucketKeys = [...new Set(stamps.map((s) => bucketStart(s, granularity)))].sort();
  const hasUnsequenced = incident.nodes.some((n) => !n.t);

  const columns: TimeColumn[] = [];
  let index = 0;
  if (hasUnsequenced) {
    columns.push({
      key: null,
      index: index++,
      x: GUTTER_W + CANVAS_PAD,
      label: 'Unsequenced',
      sublabel: null,
      delta: null,
    });
  }

  let previousDay = '';
  for (const key of bucketKeys) {
    const { label, sublabel } = formatColumnLabel(key, granularity);
    const showSub = sublabel && sublabel !== previousDay;
    if (sublabel) previousDay = sublabel;
    const prevKey = bucketKeys[bucketKeys.indexOf(key) - 1];
    columns.push({
      key,
      index,
      x: GUTTER_W + CANVAS_PAD + index * COL_W,
      label,
      sublabel: showSub ? sublabel : null,
      delta: prevKey ? formatDelta(prevKey, key) : null,
    });
    index += 1;
  }

  if (columns.length === 0) {
    // Nothing to draw, but keep one column so the axis still renders.
    columns.push({ key: null, index: 0, x: GUTTER_W + CANVAS_PAD, label: 'Unsequenced', sublabel: null, delta: null });
  }

  const columnIndexByKey = new Map<string | null, number>(columns.map((c) => [c.key, c.index]));

  // --- assign nodes to cells -------------------------------------------
  /** `${plane}|${columnIndex}` -> nodes stacked in that cell. */
  const cells = new Map<string, GibsenNode[]>();
  const occupiedPlanes = new Set<PlaneId>();

  // Stable ordering inside a cell: pivot first, then by time, then by label.
  const ordered = [...incident.nodes].sort((a, b) => {
    if (a.pivot !== b.pivot) return a.pivot ? -1 : 1;
    if (a.t && b.t && a.t !== b.t) return a.t < b.t ? -1 : 1;
    return a.label.localeCompare(b.label);
  });

  for (const node of ordered) {
    const key = node.t ? bucketStart(node.t, granularity) : null;
    const col = columnIndexByKey.get(key) ?? 0;
    const cellKey = `${node.plane}|${col}`;
    const bucket = cells.get(cellKey);
    if (bucket) bucket.push(node);
    else cells.set(cellKey, [node]);
    occupiedPlanes.add(node.plane);
  }

  // --- plane bands ------------------------------------------------------
  const visiblePlanes = PLANES.filter((p) => options.showEmptyPlanes || occupiedPlanes.has(p.id));
  const bands: PlaneBand[] = [];
  let y = HEADER_H + CANVAS_PAD;

  for (const plane of visiblePlanes) {
    let maxStack = 1;
    for (const col of columns) {
      const count = cells.get(`${plane.id}|${col.index}`)?.length ?? 0;
      if (count > maxStack) maxStack = count;
    }
    const height = BAND_PAD * 2 + maxStack * NODE_H + (maxStack - 1) * ROW_GAP;
    bands.push({
      plane: plane.id,
      label: plane.label,
      blurb: plane.blurb,
      accent: plane.accent,
      extension: Boolean(plane.extension),
      y,
      height,
    });
    y += height;
  }

  const bandByPlane = new Map(bands.map((b) => [b.plane, b]));

  // --- position nodes ---------------------------------------------------
  const positioned: PositionedNode[] = [];
  const unplaced: GibsenNode[] = [];

  for (const [cellKey, members] of cells) {
    const [planeId, colStr] = cellKey.split('|');
    const band = bandByPlane.get(planeId as PlaneId);
    if (!band) {
      unplaced.push(...members);
      continue;
    }
    const column = columns[Number(colStr)];
    members.forEach((node, row) => {
      const x = column.x;
      const nodeY = band.y + BAND_PAD + row * (NODE_H + ROW_GAP);
      positioned.push({
        node,
        x,
        y: nodeY,
        w: NODE_W,
        h: NODE_H,
        cx: x + NODE_W / 2,
        cy: nodeY + NODE_H / 2,
      });
    });
  }

  const posById = new Map(positioned.map((p) => [p.node.id, p]));

  // --- route edges ------------------------------------------------------
  const routed: RoutedEdge[] = [];
  for (const edge of incident.edges) {
    const a = posById.get(edge.from);
    const b = posById.get(edge.to);
    if (!a || !b) continue;
    routed.push(routeEdge(edge, a, b));
  }

  const width = GUTTER_W + CANVAS_PAD * 2 + columns.length * COL_W;
  const height = y + CANVAS_PAD;

  return { width, height, columns, bands, nodes: positioned, edges: routed, granularity, unplaced };
}

/**
 * Route one edge as a cubic bezier, choosing horizontal or vertical ports by
 * whichever axis dominates. Keeps arrows readable without a routing graph.
 */
function routeEdge(edge: GibsenEdge, a: PositionedNode, b: PositionedNode): RoutedEdge {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const horizontal = Math.abs(dx) >= Math.abs(dy);

  let sx: number;
  let sy: number;
  let tx: number;
  let ty: number;
  let c1x: number;
  let c1y: number;
  let c2x: number;
  let c2y: number;

  if (horizontal) {
    const forward = dx >= 0;
    sx = forward ? a.x + a.w : a.x;
    sy = a.cy;
    tx = forward ? b.x : b.x + b.w;
    ty = b.cy;
    const reach = Math.max(40, Math.abs(tx - sx) * 0.45);
    c1x = sx + (forward ? reach : -reach);
    c1y = sy;
    c2x = tx - (forward ? reach : -reach);
    c2y = ty;
  } else {
    const down = dy >= 0;
    sx = a.cx;
    sy = down ? a.y + a.h : a.y;
    tx = b.cx;
    ty = down ? b.y : b.y + b.h;
    const reach = Math.max(34, Math.abs(ty - sy) * 0.5);
    c1x = sx;
    c1y = sy + (down ? reach : -reach);
    c2x = tx;
    c2y = ty - (down ? reach : -reach);
  }

  const path = `M ${round(sx)} ${round(sy)} C ${round(c1x)} ${round(c1y)}, ${round(c2x)} ${round(c2y)}, ${round(tx)} ${round(ty)}`;

  // Midpoint of a cubic bezier at t=0.5.
  const labelX = (sx + 3 * c1x + 3 * c2x + tx) / 8;
  const labelY = (sy + 3 * c1y + 3 * c2y + ty) / 8;

  const retrograde = Boolean(a.node.t && b.node.t && b.node.t < a.node.t);
  const span = Math.hypot(tx - sx, ty - sy);

  return { edge, path, labelX: round(labelX), labelY: round(labelY), span: round(span), retrograde };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
