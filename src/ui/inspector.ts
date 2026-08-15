/**
 * The inspector panel.
 *
 * A GIBSEN node is a database record as much as a picture, so this is where the
 * technical detail, the forensic log excerpts and the analyst commentary get
 * attached. Built fresh whenever the selection changes and then mutated in
 * place, so typing in a textarea never loses focus to a re-render.
 */

import type { Confidence, GibsenEdge, GibsenNode, Incident, PlaneId, TimeBasis } from '../model/types';
import { CATEGORIES, PLANES, RELATIONS, TACTICS, categoriesByPlane } from '../model/taxonomy';
import { iconFor } from '../model/icons';
import { parseTimestamp } from '../ingest/common';
import { clear, field, h, select } from './dom';

export type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | { kind: 'none' };

export interface InspectorHandlers {
  patchNode(id: string, patch: Partial<GibsenNode>): void;
  patchEdge(id: string, patch: Partial<GibsenEdge>): void;
  patchIncident(patch: Partial<Incident>): void;
  deleteNode(id: string): void;
  deleteEdge(id: string): void;
  flipEdge(id: string): void;
  beginLink(id: string): void;
  select(selection: Selection): void;
}

const CONFIDENCE_OPTIONS = (['confirmed', 'probable', 'possible', 'suspected'] as Confidence[]).map((c) => ({
  value: c,
  label: c,
}));

const TIME_BASIS_OPTIONS = (['observed', 'inferred', 'unknown'] as TimeBasis[]).map((t) => ({ value: t, label: t }));

export function renderInspector(
  container: HTMLElement,
  incident: Incident,
  selection: Selection,
  handlers: InspectorHandlers,
): void {
  clear(container);

  if (selection.kind === 'node') {
    const node = incident.nodes.find((n) => n.id === selection.id);
    if (node) {
      container.append(nodePanel(node, incident, handlers));
      return;
    }
  }
  if (selection.kind === 'edge') {
    const edge = incident.edges.find((e) => e.id === selection.id);
    if (edge) {
      container.append(edgePanel(edge, incident, handlers));
      return;
    }
  }
  container.append(incidentPanel(incident, handlers));
}

// ---------------------------------------------------------------------------
// Incident-level panel (nothing selected)
// ---------------------------------------------------------------------------

function incidentPanel(incident: Incident, handlers: InspectorHandlers): HTMLElement {
  const planeCounts = PLANES.map((p) => ({
    plane: p,
    count: incident.nodes.filter((n) => n.plane === p.id).length,
  })).filter((entry) => entry.count > 0);

  const unsequenced = incident.nodes.filter((n) => !n.t).length;

  return h(
    'div',
    { class: 'panel' },
    h('h2', { class: 'panel-title', text: 'Incident' }),
    field(
      'Name',
      h('input', {
        type: 'text',
        value: incident.name,
        on: { input: (e) => handlers.patchIncident({ name: (e.target as HTMLInputElement).value }) },
      }),
    ),
    field(
      'Summary',
      h('textarea', {
        rows: 4,
        value: incident.summary,
        placeholder: 'One paragraph an executive could read.',
        on: { input: (e) => handlers.patchIncident({ summary: (e.target as HTMLTextAreaElement).value }) },
      }),
    ),
    h(
      'div',
      { class: 'stat-grid' },
      stat('Artifacts', String(incident.nodes.length)),
      stat('Behaviours', String(incident.edges.length)),
      stat('Unsequenced', String(unsequenced)),
      stat('Sources', String(incident.sources.length)),
    ),
    planeCounts.length
      ? h(
          'div',
          { class: 'panel-section' },
          h('h3', { class: 'section-title', text: 'Plane coverage' }),
          ...planeCounts.map((entry) =>
            h(
              'div',
              { class: 'plane-row' },
              h('span', { class: 'plane-dot', attrs: { style: `background:${entry.plane.accent}` } }),
              h('span', { class: 'plane-name', text: entry.plane.label }),
              h('span', { class: 'plane-count', text: String(entry.count) }),
            ),
          ),
        )
      : null,
    h(
      'p',
      { class: 'empty-hint' },
      'Select an artifact on the diagram to edit its details, logs and commentary.',
    ),
  );
}

function stat(label: string, value: string): HTMLElement {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-value', text: value }), h('span', { class: 'stat-label', text: label }));
}

// ---------------------------------------------------------------------------
// Node panel
// ---------------------------------------------------------------------------

function nodePanel(node: GibsenNode, incident: Incident, handlers: InspectorHandlers): HTMLElement {
  const patch = (p: Partial<GibsenNode>) => handlers.patchNode(node.id, p);

  const glyph = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  glyph.setAttribute('viewBox', '0 0 24 24');
  glyph.setAttribute('class', 'panel-glyph');
  glyph.setAttribute('fill', 'none');
  glyph.setAttribute('stroke', 'currentColor');
  glyph.setAttribute('stroke-width', '1.6');
  glyph.setAttribute('stroke-linecap', 'round');
  glyph.setAttribute('stroke-linejoin', 'round');
  glyph.innerHTML = iconFor(node.category);

  const timeHint = h('span', { class: 'field-hint', text: node.t ? `Parsed as ${node.t}` : 'Blank leaves the artifact unsequenced.' });
  const timeInput = h('input', {
    type: 'text',
    value: node.t ?? '',
    placeholder: '2024-03-14T08:12:00Z',
    on: {
      change: (e) => {
        const raw = (e.target as HTMLInputElement).value.trim();
        if (!raw) {
          patch({ t: null, timeBasis: 'unknown' });
          timeHint.textContent = 'Blank leaves the artifact unsequenced.';
          return;
        }
        const iso = parseTimestamp(raw);
        if (!iso) {
          timeHint.textContent = 'Not a date this tool recognises — try an ISO 8601 value.';
          return;
        }
        patch({ t: iso, timeBasis: node.timeBasis === 'unknown' ? 'observed' : node.timeBasis });
        timeHint.textContent = `Parsed as ${iso}`;
      },
    },
  });

  const connections = incident.edges.filter((e) => e.from === node.id || e.to === node.id);

  return h(
    'div',
    { class: 'panel' },
    h(
      'div',
      { class: 'panel-head' },
      glyph,
      h(
        'div',
        {},
        h('h2', { class: 'panel-title', text: node.label }),
        h('span', { class: 'panel-subtitle', text: CATEGORIES.find((c) => c.id === node.category)?.label ?? node.category }),
      ),
    ),

    field(
      'Label',
      h('input', {
        type: 'text',
        value: node.label,
        on: { input: (e) => patch({ label: (e.target as HTMLInputElement).value }) },
      }),
    ),

    h(
      'div',
      { class: 'field-row' },
      field(
        'Category',
        select(
          categoriesByPlane().flatMap(({ plane, categories }) =>
            categories.map((c) => ({ value: c.id, label: c.label, group: plane.label })),
          ),
          node.category,
          (value) => patch({ category: value as GibsenNode['category'] }),
        ),
      ),
      field(
        'Plane',
        select(
          PLANES.map((p) => ({ value: p.id, label: p.label })),
          node.plane,
          (value) => patch({ plane: value as PlaneId }),
        ),
      ),
    ),

    h('div', { class: 'field-row' }, h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Time (UTC)' }), timeInput, timeHint)),

    h(
      'div',
      { class: 'field-row' },
      field(
        'Time basis',
        select(TIME_BASIS_OPTIONS, node.timeBasis, (value) => patch({ timeBasis: value as TimeBasis })),
      ),
      field(
        'Confidence',
        select(CONFIDENCE_OPTIONS, node.confidence, (value) => patch({ confidence: value as Confidence })),
      ),
    ),

    h(
      'div',
      { class: 'field-row' },
      field(
        'Tactic',
        select(
          [{ value: '', label: '—' }, ...TACTICS.map((t) => ({ value: t.id, label: t.label }))],
          node.tactic ?? '',
          (value) => patch({ tactic: (value || null) as GibsenNode['tactic'] }),
        ),
      ),
      field(
        'ATT&CK techniques',
        h('input', {
          type: 'text',
          value: node.techniques.join(', '),
          placeholder: 'T1566.001, T1059',
          on: {
            change: (e) =>
              patch({
                techniques: (e.target as HTMLInputElement).value
                  .split(/[,;\s]+/)
                  .filter(Boolean)
                  .map((s) => s.toUpperCase()),
              }),
          },
        }),
      ),
    ),

    h(
      'div',
      { class: 'checkbox-row' },
      checkbox('Attacker-controlled', node.compromised, (v) => patch({ compromised: v })),
      checkbox('Investigation pivot', node.pivot, (v) => patch({ pivot: v })),
    ),

    field(
      'Analyst commentary',
      h('textarea', {
        rows: 5,
        value: node.commentary,
        placeholder: 'Why does this artifact matter to the story?',
        on: { input: (e) => patch({ commentary: (e.target as HTMLTextAreaElement).value }) },
      }),
    ),

    detailsEditor(node, patch),
    logsEditor(node, patch),
    connectionsList(node, connections, incident, handlers),

    h(
      'div',
      { class: 'panel-actions' },
      h('button', { class: 'btn', text: 'Link from here…', on: { click: () => handlers.beginLink(node.id) } }),
      h('button', { class: 'btn btn-danger', text: 'Delete artifact', on: { click: () => handlers.deleteNode(node.id) } }),
    ),
  );
}

function checkbox(label: string, value: boolean, onChange: (value: boolean) => void): HTMLElement {
  return h(
    'label',
    { class: 'checkbox' },
    h('input', { type: 'checkbox', checked: value, on: { change: (e) => onChange((e.target as HTMLInputElement).checked) } }),
    h('span', { text: label }),
  );
}

function detailsEditor(node: GibsenNode, patch: (p: Partial<GibsenNode>) => void): HTMLElement {
  const list = h('div', { class: 'kv-list' });

  const redraw = () => {
    clear(list);
    const entries = Object.entries(node.details);
    if (entries.length === 0) list.append(h('p', { class: 'empty-hint', text: 'No technical detail recorded.' }));

    for (const [key, value] of entries) {
      list.append(
        h(
          'div',
          { class: 'kv-row' },
          h('input', {
            class: 'kv-key',
            type: 'text',
            value: key,
            on: {
              change: (e) => {
                const newKey = (e.target as HTMLInputElement).value.trim();
                if (!newKey || newKey === key) return;
                const next = { ...node.details };
                delete next[key];
                next[newKey] = value;
                patch({ details: next });
                redraw();
              },
            },
          }),
          h('input', {
            class: 'kv-value',
            type: 'text',
            value,
            on: {
              input: (e) => patch({ details: { ...node.details, [key]: (e.target as HTMLInputElement).value } }),
            },
          }),
          h('button', {
            class: 'btn-icon',
            text: '×',
            title: 'Remove',
            on: {
              click: () => {
                const next = { ...node.details };
                delete next[key];
                patch({ details: next });
                redraw();
              },
            },
          }),
        ),
      );
    }
  };
  redraw();

  return h(
    'div',
    { class: 'panel-section' },
    h('h3', { class: 'section-title', text: 'Technical detail' }),
    list,
    h('button', {
      class: 'btn btn-small',
      text: '+ Add field',
      on: {
        click: () => {
          let key = 'field';
          let n = 1;
          while (node.details[key]) key = `field_${(n += 1)}`;
          patch({ details: { ...node.details, [key]: '' } });
          redraw();
        },
      },
    }),
  );
}

function logsEditor(node: GibsenNode, patch: (p: Partial<GibsenNode>) => void): HTMLElement {
  const list = h('div', { class: 'log-list' });

  const redraw = () => {
    clear(list);
    if (node.logs.length === 0) list.append(h('p', { class: 'empty-hint', text: 'No log excerpts attached.' }));

    node.logs.forEach((log, index) => {
      const update = (p: Partial<typeof log>) => {
        const next = node.logs.map((l, i) => (i === index ? { ...l, ...p } : l));
        patch({ logs: next });
      };

      list.append(
        h(
          'div',
          { class: 'log-row' },
          h(
            'div',
            { class: 'log-row-head' },
            h('input', {
              class: 'log-source',
              type: 'text',
              value: log.source,
              placeholder: 'Source (EDR, Zeek, SignInLogs…)',
              on: { input: (e) => update({ source: (e.target as HTMLInputElement).value }) },
            }),
            h('input', {
              class: 'log-time',
              type: 'text',
              value: log.timestamp ?? '',
              placeholder: 'Timestamp',
              on: { change: (e) => update({ timestamp: parseTimestamp((e.target as HTMLInputElement).value) }) },
            }),
            h('button', {
              class: 'btn-icon',
              text: '×',
              title: 'Remove',
              on: {
                click: () => {
                  patch({ logs: node.logs.filter((_, i) => i !== index) });
                  redraw();
                },
              },
            }),
          ),
          h('textarea', {
            rows: 3,
            value: log.excerpt,
            placeholder: 'Paste the log line or the query that found it.',
            on: { input: (e) => update({ excerpt: (e.target as HTMLTextAreaElement).value }) },
          }),
        ),
      );
    });
  };
  redraw();

  return h(
    'div',
    { class: 'panel-section' },
    h('h3', { class: 'section-title', text: 'Forensic logs' }),
    list,
    h('button', {
      class: 'btn btn-small',
      text: '+ Add excerpt',
      on: {
        click: () => {
          patch({ logs: [...node.logs, { source: '', timestamp: node.t, excerpt: '' }] });
          redraw();
        },
      },
    }),
  );
}

function connectionsList(
  node: GibsenNode,
  connections: GibsenEdge[],
  incident: Incident,
  handlers: InspectorHandlers,
): HTMLElement {
  const byId = new Map(incident.nodes.map((n) => [n.id, n]));

  return h(
    'div',
    { class: 'panel-section' },
    h('h3', { class: 'section-title', text: `Connections (${connections.length})` }),
    connections.length === 0
      ? h('p', { class: 'empty-hint', text: 'Nothing links to this artifact yet.' })
      : h(
          'div',
          { class: 'connection-list' },
          ...connections.map((edge) => {
            const outgoing = edge.from === node.id;
            const other = byId.get(outgoing ? edge.to : edge.from);
            const verb = edge.label ?? RELATIONS.find((r) => r.id === edge.relation)?.label ?? edge.relation;
            return h(
              'button',
              {
                class: 'connection',
                on: { click: () => handlers.select({ kind: 'edge', id: edge.id }) },
              },
              h('span', { class: 'connection-dir', text: outgoing ? '→' : '←' }),
              h('span', { class: 'connection-verb', text: verb }),
              h('span', { class: 'connection-target', text: other?.label ?? '(missing)' }),
            );
          }),
        ),
  );
}

// ---------------------------------------------------------------------------
// Edge panel
// ---------------------------------------------------------------------------

function edgePanel(edge: GibsenEdge, incident: Incident, handlers: InspectorHandlers): HTMLElement {
  const patch = (p: Partial<GibsenEdge>) => handlers.patchEdge(edge.id, p);
  const byId = new Map(incident.nodes.map((n) => [n.id, n]));
  const from = byId.get(edge.from);
  const to = byId.get(edge.to);

  return h(
    'div',
    { class: 'panel' },
    h('h2', { class: 'panel-title', text: 'Behaviour' }),
    h(
      'div',
      { class: 'edge-ends' },
      h('button', {
        class: 'edge-end',
        text: from?.label ?? '(missing)',
        on: { click: () => from && handlers.select({ kind: 'node', id: from.id }) },
      }),
      h('span', { class: 'edge-arrow', text: '→' }),
      h('button', {
        class: 'edge-end',
        text: to?.label ?? '(missing)',
        on: { click: () => to && handlers.select({ kind: 'node', id: to.id }) },
      }),
    ),

    field(
      'Relation',
      select(
        RELATIONS.map((r) => ({ value: r.id, label: r.label, group: r.family })),
        edge.relation,
        (value) => patch({ relation: value as GibsenEdge['relation'] }),
      ),
    ),
    field(
      'Label override',
      h('input', {
        type: 'text',
        value: edge.label ?? '',
        placeholder: 'Leave blank to use the relation name',
        on: { input: (e) => patch({ label: (e.target as HTMLInputElement).value || undefined }) },
      }),
    ),
    h(
      'div',
      { class: 'field-row' },
      field(
        'Time (UTC)',
        h('input', {
          type: 'text',
          value: edge.t ?? '',
          placeholder: 'Optional',
          on: { change: (e) => patch({ t: parseTimestamp((e.target as HTMLInputElement).value) }) },
        }),
      ),
      field(
        'Confidence',
        select(CONFIDENCE_OPTIONS, edge.confidence, (value) => patch({ confidence: value as Confidence })),
      ),
    ),
    field(
      'Commentary',
      h('textarea', {
        rows: 4,
        value: edge.commentary ?? '',
        on: { input: (e) => patch({ commentary: (e.target as HTMLTextAreaElement).value }) },
      }),
    ),
    h(
      'div',
      { class: 'panel-actions' },
      h('button', { class: 'btn', text: 'Reverse direction', on: { click: () => handlers.flipEdge(edge.id) } }),
      h('button', { class: 'btn btn-danger', text: 'Delete behaviour', on: { click: () => handlers.deleteEdge(edge.id) } }),
    ),
  );
}
