/**
 * What an incident has to look like, and how to write a good one.
 *
 * This is the piece that makes the server worth having. The narrative parser in
 * `ingest/text.ts` is regex work: it is tuned to miss an artifact rather than
 * invent one, and it says so. A model reading the same report understands which
 * process wrote which file and why, which is exactly the judgement the regexes
 * cannot make.
 *
 * So the division of labour is: the model reads the intelligence and writes the
 * incident; this file tells it what the fields mean and which values are legal;
 * `validate` below catches what it got wrong. Every vocabulary is read out of
 * `model/taxonomy.ts` rather than restated, so the contract cannot drift from
 * the code that draws the picture.
 */

import {
  CATEGORIES,
  CATEGORY_BY_ID,
  PLANE_BY_ID,
  PLANE_SETS,
  RELATIONS,
  RELATION_BY_ID,
  TACTICS,
  CONFIDENCE_ORDER,
  planesFor,
} from '../src/model/taxonomy';
import type { CategoryId, Incident, PlaneId, PlaneSetId, RelationId } from '../src/model/types';

export const TIME_BASES = ['observed', 'inferred', 'unknown'] as const;

/** The vocabularies, laid out the way an author needs them. */
export function vocabularies() {
  return {
    planeSets: PLANE_SETS.map((set) => ({
      id: set.id,
      label: set.label,
      blurb: set.blurb,
      planes: planesFor(set.id).map((plane) => ({
        id: plane.id,
        label: plane.label,
        holds: plane.blurb,
      })),
    })),
    categories: CATEGORIES.map((category) => ({
      id: category.id,
      label: category.label,
      defaultPlane: category.plane,
    })),
    relations: RELATIONS.map((relation) => ({ id: relation.id, label: relation.label, family: relation.family })),
    tactics: TACTICS.map((tactic) => tactic.id),
    confidence: [...CONFIDENCE_ORDER],
    timeBasis: [...TIME_BASES],
  };
}

/**
 * The guidance that turns a legal incident into a readable one.
 *
 * Written for a model that has just read a threat report and is about to write
 * the JSON. Every line here is a mistake worth heading off rather than a
 * restatement of the schema.
 */
export const AUTHORING_GUIDE = `
How to turn threat intelligence into a GIBSEN incident.

The diagram is a threat matrix: time runs left to right, artifact planes run top
to bottom. The reader's question is "what happened, in what order, and where do
I go looking for it" — so the two things that carry the picture are timestamps
and planes.

NODES ARE THINGS, NOT EVENTS
Each node is an artifact: a file, a process, an address, an account, a registry
key. Not "attacker sent phishing email" — that is an edge between an email and
an inbox. If a label reads like a sentence, it is an edge in disguise.

TIME
Every node wants a \`t\` in ISO 8601 with a Z. Where the report gives a real
timestamp, use it and set \`timeBasis: "observed"\`. Where you are placing an
artifact by reasoning — it must have existed before the thing it delivered —
set \`timeBasis: "inferred"\` and pick a defensible instant. Only leave \`t\` null
when there is genuinely no way to order it; those artifacts do not appear on
the axis at all.

Give an artifact \`tEnd\` when it stayed live over a period. A staged archive
written at 08:00, read at 09:00 and deleted at 14:00 is one box spanning six
hours, not three boxes.

TACTICS ARE WHAT MAKE THE ACTS
Set \`tactic\` on every node you can. The acts of the incident — the named
stretches of the story, and the pages a PDF is cut into — are derived from the
tactics along the timeline. An incident with no tactics renders as one
undifferentiated picture.

CONFIDENCE IS NOT DECORATION
\`confirmed\` means the evidence is in hand. \`suspected\` means somebody's
reasonable guess. It changes how solidly the artifact is drawn, so a reader can
see at a glance which parts of the story are load-bearing. Vendor reporting is
usually \`probable\` at best unless the report says how it was observed.

MARK THE ATTACKER'S SIDE
\`compromised: true\` on anything attacker-controlled or known-compromised: the
C2 domain, the dropped binary, the account they took. It is drawn in red.
\`pivot: true\` on the one artifact the investigation started from.

EDGES ARE BEHAVIOURS
An edge says what one artifact did to another, with a verb from the relation
list. Prefer the specific verb: \`beacons-to\` over \`connects-to\`,
\`inhibits-recovery\` over \`deletes\`. Connect the chain end to end — delivery to
execution to persistence to impact — because the analysis that finds points of
congruence walks those edges, and a disconnected node contributes nothing to it.

DETAILS AND LOGS ARE THE REPORT
\`details\` takes hashes, command lines, ports, user names: anything an analyst
would want to copy. \`logs\` takes the evidence, with the source named
("EDR", "Zeek conn.log", "AzureAD SignInLogs") and the line quoted.
\`commentary\` is one or two sentences on why this artifact matters to the story.
Together they are what turns the picture into something a colleague can act on,
and they are what the Markdown report and the record modal are built from.

AGGREGATES
When one thing reaches many — a host sweeping a subnet, a beacon hitting the
same endpoint a thousand times — use one node with \`aggregate\` set rather than
a hundred boxes. \`fan-out\` is one reaching many, \`converge\` is many reaching
one.

WHAT NOT TO DO
Do not invent artifacts the report does not support. An incident that is honest
about being thin is more useful than one padded out with plausible-looking
addresses. Where you inferred rather than observed, say so in the confidence
and the time basis, and it will be drawn that way.
`.trim();

/** JSON Schema for the incident, for tools that want to validate the shape. */
export function incidentJsonSchema(): Record<string, unknown> {
  const vocab = vocabularies();
  return {
    type: 'object',
    required: ['gibsen', 'name', 'nodes', 'edges'],
    properties: {
      gibsen: { const: 1, description: 'Format marker. Always 1.' },
      id: { type: 'string' },
      name: { type: 'string', description: 'Incident name, shown as the diagram title.' },
      summary: { type: 'string', description: 'A sentence or two. Appears on the PDF contents sheet.' },
      planeSet: {
        enum: vocab.planeSets.map((set) => set.id),
        description:
          'Which family of artifact planes to draw against. Defaults to "talk", the set from the original ' +
          'talk, which splits the host into memory, registry and file system. "domain" is the coarser set: ' +
          'adversary, cloud, network, host, OT.',
      },
      nodes: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'label', 'category'],
          properties: {
            id: { type: 'string', description: 'Unique within the incident. Edges refer to it.' },
            label: { type: 'string', description: 'Short: a filename, a hostname, an address.' },
            category: { enum: vocab.categories.map((c) => c.id) },
            plane: { enum: Object.keys(PLANE_BY_ID), description: 'Omit to take the category default.' },
            t: { type: ['string', 'null'], description: 'ISO 8601 with a Z, or null when unsequenced.' },
            tEnd: { type: ['string', 'null'], description: 'Set when the artifact stayed live over a period.' },
            timeBasis: { enum: [...TIME_BASES] },
            confidence: { enum: vocab.confidence },
            tactic: { enum: [...vocab.tactics, null] },
            techniques: { type: 'array', items: { type: 'string' }, description: 'ATT&CK IDs, e.g. T1059.001.' },
            details: { type: 'object', additionalProperties: { type: 'string' } },
            logs: {
              type: 'array',
              items: {
                type: 'object',
                required: ['source', 'excerpt'],
                properties: {
                  source: { type: 'string' },
                  timestamp: { type: ['string', 'null'] },
                  excerpt: { type: 'string' },
                },
              },
            },
            commentary: { type: 'string' },
            compromised: { type: 'boolean' },
            pivot: { type: 'boolean' },
            aggregate: {
              type: ['object', 'null'],
              properties: {
                kind: { enum: ['fan-out', 'converge'] },
                count: { type: ['number', 'null'] },
                of: { type: 'string' },
              },
            },
          },
        },
      },
      edges: {
        type: 'array',
        items: {
          type: 'object',
          required: ['from', 'to', 'relation'],
          properties: {
            id: { type: 'string' },
            from: { type: 'string', description: 'Node id.' },
            to: { type: 'string', description: 'Node id.' },
            relation: { enum: vocab.relations.map((r) => r.id) },
            label: { type: 'string', description: 'Overrides the relation name on the edge.' },
            t: { type: ['string', 'null'] },
            confidence: { enum: vocab.confidence },
            commentary: { type: 'string' },
          },
        },
      },
    },
  };
}

export interface Problem {
  severity: 'error' | 'warning';
  where: string;
  message: string;
}

/**
 * Check an incident before it is drawn.
 *
 * Errors are things that will not render or will render wrong. Warnings are
 * things that will render but will not say much — an incident with no tactics
 * cannot be cut into acts, and one with no timestamps has no axis to speak of.
 */
export function validateIncident(raw: unknown): { problems: Problem[]; ok: boolean } {
  const problems: Problem[] = [];
  const push = (severity: Problem['severity'], where: string, message: string) =>
    problems.push({ severity, where, message });

  if (!raw || typeof raw !== 'object') {
    return { problems: [{ severity: 'error', where: 'incident', message: 'Not an object.' }], ok: false };
  }

  const incident = raw as Partial<Incident>;

  if (incident.gibsen !== 1) push('error', 'incident.gibsen', 'Must be the number 1.');
  if (!incident.name) push('warning', 'incident.name', 'No name; the diagram title will be empty.');
  if (!Array.isArray(incident.nodes)) {
    push('error', 'incident.nodes', 'Missing or not an array.');
    return { problems, ok: false };
  }
  if (!Array.isArray(incident.edges)) push('error', 'incident.edges', 'Missing or not an array.');

  // Note there is no check that a node's plane belongs to the chosen set. A
  // plane from the other set is normal rather than wrong: categories carry
  // domain-set defaults, the studio draws against the talk set out of the box,
  // and the renderer folds each plane onto its nearest equivalent. Warning
  // about it would fire on almost every incident and mean nothing.
  const planeSet: PlaneSetId = incident.planeSet ?? 'talk';
  if (!PLANE_SETS.some((set) => set.id === planeSet)) {
    push('error', 'incident.planeSet', `Unknown plane set "${planeSet}".`);
  }

  const ids = new Set<string>();
  const tactics = new Set<string>();
  let dated = 0;

  for (const [index, node] of incident.nodes.entries()) {
    const where = `nodes[${index}]${node?.label ? ` (${node.label})` : ''}`;
    if (!node || typeof node !== 'object') {
      push('error', where, 'Not an object.');
      continue;
    }
    if (!node.id) push('error', where, 'No id; edges cannot refer to it.');
    else if (ids.has(node.id)) push('error', where, `Duplicate id "${node.id}".`);
    else ids.add(node.id);

    if (!node.label) push('error', where, 'No label; the box will be blank.');
    if (!CATEGORY_BY_ID[node.category as CategoryId]) {
      push('error', where, `Unknown category "${node.category}". See the category list in gibsen_schema.`);
    }
    if (node.plane && !PLANE_BY_ID[node.plane as PlaneId]) {
      push('error', where, `Unknown plane "${node.plane}".`);
    }

    if (node.t) {
      if (Number.isNaN(Date.parse(node.t))) push('error', where, `Unparseable timestamp "${node.t}".`);
      else dated += 1;
    }
    if (node.tEnd) {
      if (Number.isNaN(Date.parse(node.tEnd))) push('error', where, `Unparseable tEnd "${node.tEnd}".`);
      else if (node.t && Date.parse(node.tEnd) < Date.parse(node.t)) {
        push('error', where, 'tEnd is before t.');
      }
    }
    if (node.confidence && !CONFIDENCE_ORDER.includes(node.confidence)) {
      push('error', where, `Unknown confidence "${node.confidence}".`);
    }
    if (node.tactic) {
      if (!TACTICS.some((tactic) => tactic.id === node.tactic)) {
        push('error', where, `Unknown tactic "${node.tactic}".`);
      } else {
        tactics.add(node.tactic);
      }
    }
  }

  for (const [index, edge] of (incident.edges ?? []).entries()) {
    const where = `edges[${index}]`;
    if (!edge || typeof edge !== 'object') {
      push('error', where, 'Not an object.');
      continue;
    }
    if (!ids.has(edge.from)) push('error', where, `"from" points at "${edge.from}", which is not a node id.`);
    if (!ids.has(edge.to)) push('error', where, `"to" points at "${edge.to}", which is not a node id.`);
    if (edge.from === edge.to) push('warning', where, 'Points at itself; it will not be drawn usefully.');
    if (!RELATION_BY_ID[edge.relation as RelationId]) {
      push('error', where, `Unknown relation "${edge.relation}". See the relation list in gibsen_schema.`);
    }
  }

  if (incident.nodes.length === 0) push('error', 'incident.nodes', 'No artifacts; there is nothing to draw.');
  if (dated === 0 && incident.nodes.length > 0) {
    push('warning', 'incident.nodes', 'No artifact carries a timestamp, so there is no timeline to lay out.');
  } else if (dated < incident.nodes.length) {
    push('warning', 'incident.nodes', `${incident.nodes.length - dated} artifact(s) have no timestamp and will not be sequenced.`);
  }
  if (tactics.size === 0) {
    push('warning', 'incident.nodes', 'No artifact carries a tactic, so the incident cannot be cut into acts and the PDF will be one page.');
  }

  return { problems, ok: !problems.some((p) => p.severity === 'error') };
}
