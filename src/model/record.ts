/**
 * What a box on the diagram cannot say.
 *
 * The diagram carries the shape of the incident; the record modal carries the
 * evidence. This decides which artifacts have evidence worth opening — the
 * ones whose box gets a "more" marker, so the depth is advertised rather than
 * hidden behind a click nobody knows to make.
 */

import type { GibsenNode } from './types';

/** Detail keys that only repeat what the box already shows. */
const ECHOES_THE_LABEL = new Set(['value']);

export function detailEntries(node: GibsenNode): [string, string][] {
  return Object.entries(node.details).filter(([key, value]) => !ECHOES_THE_LABEL.has(key) && value.trim() !== '');
}

/**
 * `labelShown` is what the box actually printed: if the renderer had to
 * condense the label, the full value alone is reason enough to offer the
 * record.
 */
export function hasDeeperRecord(node: GibsenNode, labelShown: string): boolean {
  if (labelShown !== node.label) return true;
  if (node.commentary.trim() !== '') return true;
  if (node.logs.length > 0) return true;
  if (node.techniques.length > 0) return true;
  return detailEntries(node).length > 0;
}
