/**
 * Cutting a diagram into pieces one at a time.
 *
 * A whole incident is one enormous wide picture. Nobody can put that on a slide
 * or a sheet of paper, so both the Slides export and the PDF cut it at the
 * acts, and each piece carries the plane gutter so it still reads on its own.
 *
 * The geometry lives here rather than in either exporter because the two have
 * to agree. A slide deck and a printed report of the same incident should not
 * break the story in different places.
 */

import type { Act } from '../layout/layout';

/** One slice of the diagram: the plane gutter, then a stretch of the timeline. */
export interface DiagramSlice {
  /** Used in the filename and printed on the piece, so keep it short. */
  name: string;
  /** Secondary line under the name — a time range, usually. */
  subtitle?: string;
  x: number;
  width: number;
}

/** Room for the header redrawn above each piece. */
export const SLIDE_HEADER_H = 52;

/** Breathing room either side of the act, so boxes do not touch the edge. */
export const SLICE_PAD = 10;

/** Below this a slice is a sliver; it borrows context from either side. */
export const SLICE_MIN_W = 700;

/** Where a slice starts in the full diagram, and how much of it to take. */
export interface SliceWindow {
  from: number;
  span: number;
}

/**
 * A single-column act would come out a sliver. Widen it symmetrically and let
 * the pieces overlap — continuity between them is a feature in a deck, and no
 * worse on the page.
 */
export function sliceWindow(slice: DiagramSlice, fullWidth: number, gutterWidth: number): SliceWindow {
  const wanted = Math.max(slice.width + SLICE_PAD * 2, SLICE_MIN_W);
  const centre = slice.x + slice.width / 2;

  let from = Math.round(centre - wanted / 2);
  let span = Math.round(wanted);

  from = Math.max(gutterWidth, Math.min(from, fullWidth - span));
  from = Math.max(gutterWidth, from);
  span = Math.max(1, Math.min(span, fullWidth - from));

  return { from, span };
}

/** The acts of an incident, as slices ready to cut on. */
export function actSlices(acts: Act[]): DiagramSlice[] {
  return acts.map((act) => ({
    name: act.label,
    subtitle: [act.from?.replace('.000Z', 'Z'), act.duration].filter(Boolean).join('  ·  '),
    x: act.x,
    width: act.width,
  }));
}

/** The line under the incident name: which piece this is, and what it covers. */
export function sliceCaption(index: number, total: number, slice: DiagramSlice): string {
  return [`${index + 1} of ${total}`, slice.name, slice.subtitle].filter(Boolean).join('   ·   ');
}
