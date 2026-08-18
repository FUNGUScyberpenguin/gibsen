/**
 * Points of congruence.
 *
 * The analytic payoff of a good incident diagram: once the whole chain is laid
 * out, the artifacts every later step depends on become obvious, and those are
 * where a detection or a response action buys the most. A campaign with four
 * lures and three payloads that all funnel through one signed binary reaching
 * the internet has one real weak point, not seven.
 *
 * These are the cut vertices of the incident graph, but ranked from the
 * incident's own starting point: what a defender wants to know is how much of
 * the chain stops working if this one artifact is taken away, and "away from
 * where the intrusion began" is the only reading of that question that is
 * useful. Direction on the edges is ignored — an artifact is a dependency
 * whether the behaviour was recorded pointing at it or away from it.
 */

import type { GibsenNode, Incident } from '../model/types';

export interface ChokePoint {
  nodeId: string;
  /** How many artifacts stop being reachable from the origin without this one. */
  severed: number;
  /** Which artifacts those are. Populated for the highest-ranked points only. */
  severedIds: string[];
}

export interface ChokePointOptions {
  /** Ignore points that isolate fewer artifacts than this. */
  minSevered?: number;
  /**
   * How many top-ranked points get their `severedIds` filled in. Counts are
   * always exact; only the id lists are bounded, because a long linear chain
   * would otherwise materialise a quadratic number of them for no one to read.
   */
  detail?: number;
}

/** Undirected adjacency over the artifacts, ignoring dangling and self edges. */
function adjacency(incident: Incident): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const node of incident.nodes) adj.set(node.id, []);
  for (const edge of incident.edges) {
    if (edge.from === edge.to) continue;
    const a = adj.get(edge.from);
    const b = adj.get(edge.to);
    if (!a || !b) continue;
    a.push(edge.to);
    b.push(edge.from);
  }
  return adj;
}

/**
 * Where the intrusion started, as far as this cluster is concerned: the
 * analyst's pivot if one of them is here, otherwise the earliest artifact.
 */
function originOf(members: GibsenNode[]): GibsenNode {
  const pivot = members.find((n) => n.pivot);
  if (pivot) return pivot;
  const timed = members.filter((n) => n.t).sort((a, b) => (a.t! < b.t! ? -1 : 1));
  return timed[0] ?? members[0];
}

export function findChokePoints(incident: Incident, options: ChokePointOptions = {}): ChokePoint[] {
  const minSevered = options.minSevered ?? 1;
  const detail = options.detail ?? 12;
  if (incident.nodes.length < 3 || incident.edges.length === 0) return [];

  const adj = adjacency(incident);
  const byId = new Map(incident.nodes.map((n) => [n.id, n]));

  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const size = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const children = new Map<string, string[]>();
  /** Nodes in discovery order; a subtree is a contiguous slice of it. */
  const preorder: string[] = [];

  /** Walk one cluster from its origin, filling in the DFS tree. */
  const walk = (root: string) => {
    parent.set(root, null);
    disc.set(root, preorder.length);
    low.set(root, preorder.length);
    size.set(root, 1);
    children.set(root, []);
    preorder.push(root);

    // Iterative, so that a long linear intrusion cannot overflow the stack.
    const stack: { node: string; neighbours: string[]; index: number }[] = [
      { node: root, neighbours: adj.get(root) ?? [], index: 0 },
    ];

    while (stack.length) {
      const frame = stack[stack.length - 1];

      if (frame.index < frame.neighbours.length) {
        const next = frame.neighbours[frame.index];
        frame.index += 1;

        if (!disc.has(next)) {
          parent.set(next, frame.node);
          children.get(frame.node)!.push(next);
          disc.set(next, preorder.length);
          low.set(next, preorder.length);
          size.set(next, 1);
          children.set(next, []);
          preorder.push(next);
          stack.push({ node: next, neighbours: adj.get(next) ?? [], index: 0 });
        } else if (next !== parent.get(frame.node)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, disc.get(next)!));
        }
        continue;
      }

      stack.pop();
      const up = parent.get(frame.node);
      if (up) {
        low.set(up, Math.min(low.get(up)!, low.get(frame.node)!));
        size.set(up, size.get(up)! + size.get(frame.node)!);
      }
    }
  };

  // Each disconnected cluster is walked from its own origin.
  const roots: string[] = [];
  const clusters = new Map<string, GibsenNode[]>();
  for (const node of incident.nodes) {
    if (disc.has(node.id)) continue;
    // Collect the cluster first so its origin can be chosen before walking it.
    const members: GibsenNode[] = [];
    const seen = new Set([node.id]);
    const queue = [node.id];
    while (queue.length) {
      const current = queue.pop()!;
      const found = byId.get(current);
      if (found) members.push(found);
      for (const next of adj.get(current) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    const root = originOf(members).id;
    roots.push(root);
    clusters.set(root, members);
    walk(root);
  }

  const rootSet = new Set(roots);

  /** Preorder slice covering a DFS subtree. */
  const subtree = (id: string) => preorder.slice(disc.get(id)!, disc.get(id)! + size.get(id)!);

  const found: { nodeId: string; severed: number; cut: string[] }[] = [];

  for (const node of incident.nodes) {
    const id = node.id;
    if (!disc.has(id)) continue;
    const kids = children.get(id) ?? [];

    if (rootSet.has(id)) {
      // Removing the origin scatters its branches; the largest survives as the
      // remaining chain and everything else is counted as cut away.
      if (kids.length < 2) continue;
      const sizes = kids.map((k) => size.get(k)!);
      const biggest = Math.max(...sizes);
      const severed = sizes.reduce((a, b) => a + b, 0) - biggest;
      if (severed < minSevered) continue;
      const dropped = kids.filter((_, i) => sizes[i] !== biggest || i !== sizes.indexOf(biggest));
      found.push({ nodeId: id, severed, cut: dropped });
      continue;
    }

    // A non-root artifact is load-bearing for any child that cannot reach
    // above it by some other route.
    const stranded = kids.filter((k) => low.get(k)! >= disc.get(id)!);
    if (stranded.length === 0) continue;
    const severed = stranded.reduce((total, k) => total + size.get(k)!, 0);
    if (severed < minSevered) continue;
    found.push({ nodeId: id, severed, cut: stranded });
  }

  found.sort((a, b) => b.severed - a.severed || a.nodeId.localeCompare(b.nodeId));

  return found.map((entry, rank) => ({
    nodeId: entry.nodeId,
    severed: entry.severed,
    severedIds: rank < detail ? entry.cut.flatMap((child) => subtree(child)) : [],
  }));
}
