/**
 * The incident as a sequence of beats.
 *
 * A finished diagram is a map, and a map is only self-explanatory to the
 * person who drew it. Everyone else needs to be walked through it: this is
 * where it starts, this is what happened next, this is how long the attacker
 * sat there. That walk is the whole point of the tool — the alternative is
 * handing somebody a forty-page PDF and hoping.
 *
 * A beat is one artifact, in time order, together with the behaviour that
 * brought the story to it. The behaviour is what turns a list of indicators
 * into a sentence, which is why an artifact with no connection to anything
 * already seen is narrated as exactly that rather than quietly folded in.
 */

import type { GibsenEdge, GibsenNode, Incident } from './types';
import { CATEGORY_BY_ID, PLANE_BY_ID, RELATION_BY_ID, resolvePlane } from './taxonomy';
import { elapsedInWords } from './time';

// Re-exported: the walkthrough was where this started life, and the tests and
// the export both reach for it here.
export { elapsedInWords };

export interface StoryBeat {
  /** 0-based position in the walk. */
  index: number;
  nodeId: string;
  /** The behaviour that brought the story here, if there was one. */
  edgeId: string | null;
  /** The artifact at the other end of that behaviour. */
  fromId: string | null;
  /** Everything to keep lit for this beat: the artifact and where it came from. */
  focusIds: string[];
  t: string | null;
  /** One plain sentence, readable by someone who has never seen the report. */
  sentence: string;
  /** How long since the previous beat, in words. Null on the first. */
  since: string | null;
  /** The analyst's own note, verbatim, if they wrote one. */
  commentary: string;
}

/** Chronological, with anything unsequenced left to the end. */
function inOrder(nodes: GibsenNode[]): GibsenNode[] {
  return [...nodes].sort((a, b) => {
    if (a.t && b.t) return a.t < b.t ? -1 : a.t > b.t ? 1 : 0;
    if (a.t) return -1;
    if (b.t) return 1;
    return 0;
  });
}

function describe(node: GibsenNode, incident: Incident): string {
  const category = CATEGORY_BY_ID[node.category]?.label ?? node.category;
  const plane = PLANE_BY_ID[resolvePlane(node, incident.planeSet ?? 'talk')]?.label ?? node.plane;
  return `${category.toLowerCase()} on the ${plane.toLowerCase()}`;
}

function verbOf(edge: GibsenEdge): string {
  return edge.label ?? RELATION_BY_ID[edge.relation]?.label ?? edge.relation;
}

/**
 * Turn an incident into the walk through it.
 *
 * Each artifact is attached to the story by a behaviour reaching something
 * already narrated, so the walk builds outwards from the beginning rather than
 * jumping around. Where no such behaviour exists the beat says so — a diagram
 * with a gap in it should read as having a gap in it.
 */
export function buildStory(incident: Incident): StoryBeat[] {
  const byId = new Map(incident.nodes.map((n) => [n.id, n]));
  const touching = new Map<string, GibsenEdge[]>();
  for (const node of incident.nodes) touching.set(node.id, []);
  for (const edge of incident.edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    touching.get(edge.from)?.push(edge);
    touching.get(edge.to)?.push(edge);
  }

  const beats: StoryBeat[] = [];
  const seen = new Set<string>();
  let previousTime: string | null = null;

  for (const node of inOrder(incident.nodes)) {
    const edges = touching.get(node.id) ?? [];
    // Prefer a behaviour pointing at this artifact from something already
    // narrated: that is the one that reads as "and then this happened".
    const incoming = edges.filter((e) => e.to === node.id && seen.has(e.from));
    const outgoing = edges.filter((e) => e.from === node.id && seen.has(e.to));
    const link = incoming[0] ?? outgoing[0] ?? null;
    const other = link ? byId.get(link.from === node.id ? link.to : link.from) ?? null : null;

    let sentence: string;
    if (!beats.length) {
      sentence = `The story starts with ${node.label} — ${describe(node, incident)}.`;
    } else if (link && other) {
      sentence =
        link.to === node.id
          ? `${other.label} ${verbOf(link)} ${node.label}.`
          : `${node.label} ${verbOf(link)} ${other.label}.`;
    } else {
      sentence = `${node.label} appears — ${describe(node, incident)} — with nothing yet linking it to the rest.`;
    }

    beats.push({
      index: beats.length,
      nodeId: node.id,
      edgeId: link?.id ?? null,
      fromId: other?.id ?? null,
      focusIds: other ? [node.id, other.id] : [node.id],
      t: node.t,
      sentence,
      since: previousTime && node.t ? elapsedInWords(previousTime, node.t) : null,
      commentary: node.commentary.trim(),
    });

    seen.add(node.id);
    if (node.t) previousTime = node.t;
  }

  return beats;
}
