/**
 * Time-driven artifact-plane layout.
 *
 * The X axis is time and the Y axis clusters artifacts by where you go looking
 * for them.
 *
 * Columns are not drawn to scale — three weeks of dwell beside a 90-second
 * exploit chain would be unreadable — but nor are they all the same width, or
 * the shape of the attack disappears entirely. The gap before a column grows
 * with the logarithm of the real interval, so a minute and a day look
 * different without a day swamping the page. Where even that runs out of room
 * the axis says so with a break, rather than quietly compressing. The exact
 * interval is printed either way, so nothing is hidden.
 */

import type { GibsenEdge, GibsenNode, Incident, PlaneId, PlaneSetId, Tactic } from '../model/types';
import { TACTICS, planesFor, resolvePlane } from '../model/taxonomy';
import { elapsedInWords } from '../model/time';

/** Baseline node box. The real width and height come out of `layout`, which
 * sizes them to the labels the incident actually contains. */
export const NODE_W = 240;
export const NODE_H = 60;
/** Extra height per wrapped line of label beyond the first. */
const LABEL_LINE_H = 15;
/** Characters that fit on one line of the label at 12px monospace. */
const LABEL_CHARS_PER_LINE = Math.floor((NODE_W - 24) / (12 * 0.601));
const LABEL_MAX_LINES = 2;
const COL_GAP = 34;
const ROW_GAP = 16;
const BAND_PAD = 20;
/** Boundary seams get less breathing room — they are a line, not a region. */
const SEAM_PAD = 8;
/** Wide enough to print "Operational Technology" in full at 13px. */
export const GUTTER_W = 212;
export const HEADER_H = 72;
const CANVAS_PAD = 28;

export const COL_W = NODE_W + COL_GAP;

/**
 * How much wider the gap before a column gets for each doubling of the real
 * interval. Logarithmic because incidents span six orders of magnitude — a
 * two-second gap and a two-week gap belong on the same axis.
 */
const GAP_PER_DOUBLING = 27;
/**
 * Past this the gap stops growing. A wide diagram is free; an empty one is
 * not, and a reader scrolling through a thousand pixels of nothing has lost
 * the thread by the time they arrive.
 */
const GAP_MAX = 320;
/**
 * How many times the typical step a gap has to be before the axis marks it.
 * Measured against the median rather than the shortest interval: a report full
 * of one-second bursts should not have every ordinary pause torn open.
 */
const DWELL_RATIO = 20;
/** Height of the band of named acts above the time axis. */
const ACT_BAND_H = 34;

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

/**
 * Coarsest-but-still-informative granularity that fits within `maxColumns`.
 *
 * The budget is deliberately loose. Coarsening merges distinct events into one
 * column, and the X axis exists precisely to keep them apart — so a wide
 * diagram is the right trade against a diagram that has quietly stopped
 * distinguishing 09:14 from 09:18.
 */
export function chooseGranularity(stamps: string[], maxColumns = 200): Granularity {
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
  /** Blank space drawn before this column, standing for the interval. */
  gapBefore: number;
  /** Outside working hours in the zone the axis is showing. */
  outOfHours: boolean;
  /**
   * Set when the gap was too large to draw even at log scale, and the axis is
   * showing a break. Carries the words to print across it.
   */
  elided: string | null;
}

export interface PlaneBand {
  plane: PlaneId;
  label: string;
  blurb: string;
  accent: string;
  extension: boolean;
  /** Drawn as a seam between neighbouring bands rather than as a band. */
  boundary: boolean;
  y: number;
  height: number;
}

/**
 * A named stretch of the incident, taken from the ATT&CK tactics already on
 * the artifacts. Six labels above the axis is what an audience carries out of
 * the room; two hundred columns is not.
 */
export interface Act {
  tactic: Tactic;
  label: string;
  startCol: number;
  endCol: number;
  x: number;
  width: number;
  /** First and last instant covered, and how long that was, in words. */
  from: string | null;
  to: string | null;
  duration: string | null;
}

export interface PositionedNode {
  node: GibsenNode;
  /** The plane it was drawn in, already resolved against the active set. */
  plane: PlaneId;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Centre point, cached for edge routing. */
  cx: number;
  cy: number;
  /** True when the node was widened to cover a period rather than an instant. */
  spanning: boolean;
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
  planeSet: PlaneSetId;
  /** The zone the axis was labelled in. */
  timeZone: string;
  /** Named stretches of the incident, empty when the tactics do not support any. */
  acts: Act[];
  /** Top margin actually used, which grows to make room for the acts band. */
  headerHeight: number;
  /** Box size chosen for this incident's labels; the renderer uses these. */
  nodeWidth: number;
  nodeHeight: number;
  /** How many lines the longest label needs, 1 to 3. */
  labelLines: number;
  /** Nodes hidden because their plane band was collapsed away. */
  unplaced: GibsenNode[];
}

export interface LayoutOptions {
  granularity?: Granularity | 'auto';
  /** Which family of artifact planes to draw against. */
  planeSet?: PlaneSetId;
  /**
   * Draw planes that contain no artifacts. Off by default because an empty band
   * is noise rather than because of the height — turn it on to show explicitly
   * that, say, nothing reached OT.
   */
  showEmptyPlanes?: boolean;
  maxColumns?: number;
  /**
   * Let the gap before a column grow with the interval it stands for. On by
   * default: without it the diagram records the sequence but hides the rhythm.
   */
  timeToScale?: boolean;
  /** Draw the band of named acts above the axis. */
  showActs?: boolean;
  /**
   * IANA zone the axis is labelled in. Storage and sorting stay UTC; this only
   * changes what the reader is shown, and what counts as out of hours.
   */
  timeZone?: string;
}

/**
 * An instant, read in whichever zone the axis is being shown in.
 *
 * Everything is stored and compared as UTC — that is the only way the sort is
 * trustworthy — but "03:14 on a Sunday" is a fact about the victim's clock,
 * not about Greenwich, and it is one of the things a diagram should be able to
 * say out loud.
 */
interface ZonedParts {
  year: string;
  month: string;
  day: string;
  weekday: string;
  hour: number;
  minute: string;
  second: string;
}

const ZONE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function zonedParts(iso: string, timeZone: string): ZonedParts {
  let formatter = ZONE_FORMATTERS.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour12: false,
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    ZONE_FORMATTERS.set(timeZone, formatter);
  }

  const found: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(iso))) found[part.type] = part.value;

  return {
    year: found.year ?? '',
    month: found.month ?? '',
    day: found.day ?? '',
    weekday: found.weekday ?? '',
    // Midnight comes back as 24 in some locales.
    hour: Number(found.hour ?? '0') % 24,
    minute: found.minute ?? '00',
    second: found.second ?? '00',
  };
}

/** Outside 08:00–18:00 on a weekday, in the zone the axis is showing. */
function isOutOfHours(iso: string, timeZone: string): boolean {
  const p = zonedParts(iso, timeZone);
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return true;
  return p.hour < 8 || p.hour >= 18;
}

function formatColumnLabel(iso: string, granularity: Granularity, timeZone: string): { label: string; sublabel: string } {
  const p = zonedParts(iso, timeZone);
  const time = `${String(p.hour).padStart(2, '0')}:${p.minute}`;
  const withSeconds = `${time}:${p.second}`;
  const day = `${p.day} ${p.month} ${p.year}`;
  const d = new Date(iso);

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
      return { label: d.toLocaleString('en-GB', { month: 'long', timeZone }), sublabel: p.year };
    case 'year':
    default:
      return { label: p.year, sublabel: '' };
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

/** One artifact's plane and the columns it occupies. */
interface Placement {
  node: GibsenNode;
  plane: PlaneId;
  startCol: number;
  endCol: number;
}

/** Lines a label needs at the fixed node width, capped. */
export function labelLineCount(label: string): number {
  return Math.min(LABEL_MAX_LINES, Math.max(1, Math.ceil(label.length / LABEL_CHARS_PER_LINE)));
}

/**
 * Name the stretches of the incident from the tactics on its artifacts.
 *
 * Each column takes the tactic most of its artifacts carry, ties going to the
 * one further along the ATT&CK order because progress is the story. Runs of
 * the same tactic then merge into one act. A column with no tagged artifact
 * inherits whatever act it fell inside, so a quiet stretch does not break a
 * phase in half.
 */
function deriveActs(
  columns: TimeColumn[],
  placements: Placement[],
): { tactic: Tactic; startCol: number; endCol: number }[] {
  const rank = new Map(TACTICS.map((t, i) => [t.id, i]));
  const perColumn: (Tactic | null)[] = columns.map(() => null);

  const counts: Map<Tactic, number>[] = columns.map(() => new Map());
  for (const p of placements) {
    if (!p.node.tactic) continue;
    // A long-running artifact votes only where it starts. Its presence in the
    // later columns is duration, not a new event, and letting a twenty-hour
    // beacon stuff "command and control" into every column it crosses drowns
    // out the phases that actually happened during it.
    const bucket = counts[p.startCol];
    if (bucket) bucket.set(p.node.tactic, (bucket.get(p.node.tactic) ?? 0) + 1);
  }

  counts.forEach((bucket, c) => {
    let best: Tactic | null = null;
    let bestCount = 0;
    for (const [tactic, count] of bucket) {
      const better = count > bestCount || (count === bestCount && (rank.get(tactic) ?? 0) > (rank.get(best!) ?? -1));
      if (better) {
        best = tactic;
        bestCount = count;
      }
    }
    perColumn[c] = best;
  });

  // A single column of another tactic between two of the same one is a beacon
  // checking in mid-phase, not a phase of its own.
  for (let c = 1; c < perColumn.length - 1; c += 1) {
    if (perColumn[c - 1] && perColumn[c - 1] === perColumn[c + 1] && perColumn[c] !== perColumn[c - 1]) {
      perColumn[c] = perColumn[c - 1];
    }
  }

  const acts: { tactic: Tactic; startCol: number; endCol: number }[] = [];
  perColumn.forEach((tactic, c) => {
    // An untagged column extends the act it sits inside rather than ending it.
    if (!tactic) {
      if (acts.length) acts[acts.length - 1].endCol = c;
      return;
    }
    const open = acts[acts.length - 1];
    if (open && open.tactic === tactic) open.endCol = c;
    else acts.push({ tactic, startCol: c, endCol: c });
  });

  // Untagged columns before the first act have nothing to extend, and a band
  // that starts a third of the way along reads as a rendering fault. The
  // opening act reaches back to the start of the axis.
  if (acts.length) acts[0].startCol = 0;

  // One act covering everything says nothing that the title does not.
  return acts.length >= 2 ? acts : [];
}

export function layout(incident: Incident, options: LayoutOptions = {}): LayoutResult {
  const planeSet = options.planeSet ?? incident.planeSet ?? 'talk';

  // One box size for the whole diagram, tall enough for its longest label.
  // Uniform beats snug: it keeps the lane packing and the column grid honest.
  const labelLines = incident.nodes.reduce((most, n) => Math.max(most, labelLineCount(n.label)), 1);
  const nodeHeight = NODE_H + (labelLines - 1) * LABEL_LINE_H;

  // An artifact that spans time puts a stamp at each end, and both deserve a
  // column — the delete at the far end is as much an event as the write.
  const stamps: string[] = [];
  for (const n of incident.nodes) {
    if (n.t) stamps.push(n.t);
    if (n.t && n.tEnd) stamps.push(n.tEnd);
  }

  const granularity =
    !options.granularity || options.granularity === 'auto'
      ? chooseGranularity(stamps, options.maxColumns ?? 200)
      : options.granularity;

  // --- columns ----------------------------------------------------------
  const bucketKeys = [...new Set(stamps.map((s) => bucketStart(s, granularity)))].sort();
  const hasUnsequenced = incident.nodes.some((n) => !n.t);

  const toScale = options.timeToScale ?? true;
  const timeZone = options.timeZone ?? 'UTC';

  /**
   * The shortest real interval in the incident, used as the unit the others
   * are measured against. Scaling from the smallest gap rather than from a
   * fixed constant is what keeps a four-minute intrusion and a four-month
   * campaign both legible on the same rules.
   */
  let unit = Number.POSITIVE_INFINITY;
  for (let i = 1; i < bucketKeys.length; i += 1) {
    const step = Date.parse(bucketKeys[i]) - Date.parse(bucketKeys[i - 1]);
    if (step > 0) unit = Math.min(unit, step);
  }
  if (!Number.isFinite(unit) || unit <= 0) unit = GRANULARITY_MS[granularity] ?? 60_000;

  /** The typical step, used to decide which gaps are dwell rather than pace. */
  const steps: number[] = [];
  for (let i = 1; i < bucketKeys.length; i += 1) {
    const step = Date.parse(bucketKeys[i]) - Date.parse(bucketKeys[i - 1]);
    if (step > 0) steps.push(step);
  }
  steps.sort((a, b) => a - b);
  const median = steps.length ? steps[Math.floor(steps.length / 2)] : unit;

  /**
   * Blank space standing for an interval, and whether the axis should say out
   * loud what it is compressing. A gap is marked when it dwarfs the pace of
   * the rest of the incident — that is the dwell an audience should notice —
   * or when it ran out of room to be drawn honestly.
   */
  const gapFor = (fromIso: string, toIso: string): { gap: number; elided: string | null } => {
    if (!toScale) return { gap: 0, elided: null };
    const ms = Date.parse(toIso) - Date.parse(fromIso);
    if (!Number.isFinite(ms) || ms <= unit) return { gap: 0, elided: null };

    const wanted = GAP_PER_DOUBLING * Math.log2(ms / unit);
    const dwell = ms >= median * DWELL_RATIO;
    const gap = Math.min(Math.round(wanted), GAP_MAX);
    return { gap, elided: dwell || wanted > GAP_MAX ? elapsedInWords(fromIso, toIso) : null };
  };

  const columns: TimeColumn[] = [];
  let index = 0;
  let cursor = GUTTER_W + CANVAS_PAD;

  if (hasUnsequenced) {
    columns.push({
      key: null,
      index: index++,
      x: cursor,
      label: 'Unsequenced',
      sublabel: null,
      delta: null,
      gapBefore: 0,
      elided: null,
      outOfHours: false,
    });
    cursor += COL_W;
  }

  let previousDay = '';
  bucketKeys.forEach((key, position) => {
    const { label, sublabel } = formatColumnLabel(key, granularity, timeZone);
    const showSub = sublabel && sublabel !== previousDay;
    if (sublabel) previousDay = sublabel;
    const prevKey = bucketKeys[position - 1];
    const { gap, elided } = prevKey ? gapFor(prevKey, key) : { gap: 0, elided: null };

    cursor += gap;
    columns.push({
      key,
      index,
      x: cursor,
      label,
      sublabel: showSub ? sublabel : null,
      delta: prevKey ? formatDelta(prevKey, key) : null,
      gapBefore: gap,
      elided,
      outOfHours: isOutOfHours(key, timeZone),
    });
    cursor += COL_W;
    index += 1;
  });

  if (columns.length === 0) {
    // Nothing to draw, but keep one column so the axis still renders.
    columns.push({
      key: null,
      index: 0,
      x: GUTTER_W + CANVAS_PAD,
      label: 'Unsequenced',
      sublabel: null,
      delta: null,
      gapBefore: 0,
      elided: null,
      outOfHours: false,
    });
  }

  const columnIndexByKey = new Map<string | null, number>(columns.map((c) => [c.key, c.index]));

  /** Column holding this instant, falling back to the nearest earlier one. */
  const columnForTime = (iso: string): number => {
    const key = bucketStart(iso, granularity);
    const exact = columnIndexByKey.get(key);
    if (exact !== undefined) return exact;
    let best = 0;
    for (const column of columns) {
      if (column.key && column.key <= key) best = column.index;
    }
    return best;
  };

  // --- assign each artifact a plane and a column interval ---------------
  // Stable ordering: pivot first, then by time, then by label.
  const ordered = [...incident.nodes].sort((a, b) => {
    if (a.pivot !== b.pivot) return a.pivot ? -1 : 1;
    if (a.t && b.t && a.t !== b.t) return a.t < b.t ? -1 : 1;
    if (a.t && !b.t) return -1;
    if (!a.t && b.t) return 1;
    return a.label.localeCompare(b.label);
  });

  const placements: Placement[] = ordered.map((node) => {
    const startCol = node.t ? columnForTime(node.t) : (columnIndexByKey.get(null) ?? 0);
    const endCol = node.t && node.tEnd ? Math.max(startCol, columnForTime(node.tEnd)) : startCol;
    return { node, plane: resolvePlane(node, planeSet), startCol, endCol };
  });

  // --- plane bands ------------------------------------------------------
  const occupied = new Set(placements.map((p) => p.plane));
  const visiblePlanes = planesFor(planeSet).filter((p) => options.showEmptyPlanes || occupied.has(p.id));

  /**
   * Greedy interval partitioning per plane: walk the artifacts left to right
   * and drop each into the first lane whose previous occupant has finished.
   * For point-in-time artifacts this degenerates to the obvious stacking.
   */
  const laneOf = new Map<GibsenNode, number>();
  const laneCount = new Map<PlaneId, number>();

  for (const plane of visiblePlanes) {
    const members = placements
      .filter((p) => p.plane === plane.id)
      .sort((a, b) => a.startCol - b.startCol || ordered.indexOf(a.node) - ordered.indexOf(b.node));

    /** Last column occupied in each lane. */
    const laneEnds: number[] = [];
    for (const p of members) {
      let lane = laneEnds.findIndex((end) => end < p.startCol);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(p.endCol);
      } else {
        laneEnds[lane] = p.endCol;
      }
      laneOf.set(p.node, lane);
    }
    laneCount.set(plane.id, Math.max(1, laneEnds.length));
  }

  const bands: PlaneBand[] = [];
  // Acts are needed before the bands are placed: the band of names sits above
  // the axis and everything below it has to start lower.
  const actRuns = (options.showActs ?? true) ? deriveActs(columns, placements) : [];
  const headerHeight = HEADER_H + (actRuns.length ? ACT_BAND_H : 0);

  let y = headerHeight + CANVAS_PAD;

  for (const plane of visiblePlanes) {
    const lanes = laneCount.get(plane.id) ?? 1;
    const pad = plane.boundary ? SEAM_PAD : BAND_PAD;
    const height = pad * 2 + lanes * nodeHeight + (lanes - 1) * ROW_GAP;
    bands.push({
      plane: plane.id,
      label: plane.label,
      blurb: plane.blurb,
      accent: plane.accent,
      extension: Boolean(plane.extension),
      boundary: Boolean(plane.boundary),
      y,
      height,
    });
    y += height;
  }

  const bandByPlane = new Map(bands.map((b) => [b.plane, b]));

  // --- position nodes ---------------------------------------------------
  const positioned: PositionedNode[] = [];
  const unplaced: GibsenNode[] = [];

  for (const p of placements) {
    const band = bandByPlane.get(p.plane);
    if (!band) {
      unplaced.push(p.node);
      continue;
    }
    const lane = laneOf.get(p.node) ?? 0;
    const pad = band.boundary ? SEAM_PAD : BAND_PAD;
    const x = columns[p.startCol].x;
    const nodeY = band.y + pad + lane * (nodeHeight + ROW_GAP);
    const w = columns[p.endCol].x - columns[p.startCol].x + NODE_W;

    positioned.push({
      node: p.node,
      plane: p.plane,
      x,
      y: nodeY,
      w,
      h: nodeHeight,
      cx: x + w / 2,
      cy: nodeY + nodeHeight / 2,
      spanning: p.endCol > p.startCol,
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

  const last = columns[columns.length - 1];
  const width = last.x + COL_W + CANVAS_PAD;
  const height = y + CANVAS_PAD;

  const acts: Act[] = actRuns.map((run) => {
    const from = columns[run.startCol].key;
    const to = columns[run.endCol].key;
    return {
      tactic: run.tactic,
      label: TACTICS.find((t) => t.id === run.tactic)?.label ?? run.tactic,
      startCol: run.startCol,
      endCol: run.endCol,
      x: columns[run.startCol].x - 17,
      width: columns[run.endCol].x + COL_W - 17 - columns[run.startCol].x,
      from,
      to,
      duration: from && to && from !== to ? elapsedInWords(from, to).replace(/ later$/, '') : null,
    };
  });

  return {
    width,
    height,
    columns,
    bands,
    nodes: positioned,
    edges: routed,
    granularity,
    planeSet,
    timeZone,
    acts,
    headerHeight,
    nodeWidth: NODE_W,
    nodeHeight,
    labelLines,
    unplaced,
  };
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
