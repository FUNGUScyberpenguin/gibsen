/**
 * The record modal.
 *
 * A box on the diagram has room for what an artifact *is*. Everything that
 * makes it evidence — the full value, the hashes, the command line, the log
 * line it came out of, the analyst's reasoning — lives here, so the diagram
 * stays a map rather than becoming a report nobody can read at a glance.
 *
 * Read-only by design. Editing stays in the inspector: a modal that changes
 * the diagram underneath itself is a bad place to be typing.
 */

import type { GibsenEdge, GibsenNode, Incident } from '../model/types';
import type { Selection } from './inspector';
import { CATEGORY_BY_ID, PLANE_BY_ID, RELATION_BY_ID, TACTICS, resolvePlane } from '../model/taxonomy';
import { detailEntries } from '../model/record';
import { iconFor } from '../model/icons';
import { h, icon } from './dom';

export interface ModalHandlers {
  /** Close the modal and select the target in the inspector for editing. */
  edit(selection: Selection): void;
  /** How many artifacts fall away without this one, if it is a choke point. */
  severedBy(id: string): number;
}

interface OpenModal {
  root: HTMLElement;
  show(target: Selection): void;
  close(): void;
  isOpen(): boolean;
}

let current: OpenModal | null = null;

/** Timestamps read better without the millisecond field the parser adds. */
function stamp(value: string): string {
  return value.replace('.000Z', 'Z');
}

function when(node: GibsenNode): string {
  if (!node.t) return 'unsequenced';
  const start = (node.timeBasis === 'inferred' ? '~' : '') + stamp(node.t);
  return node.tEnd ? `${start}  →  ${stamp(node.tEnd)}` : start;
}

function section(title: string, ...body: (Node | null | false)[]): HTMLElement {
  return h('section', { class: 'record-section' }, h('h3', { class: 'section-title', text: title }), ...body);
}

/**
 * The one place a value is shown whole. Long paths still have to wrap, so give
 * the browser break opportunities where the value already has seams — nothing
 * reads worse than a hash split at a backslash's neighbour.
 */
function breakable(text: string): (Node | string)[] {
  const pieces: (Node | string)[] = [];
  for (const chunk of text.split(/(?<=[\\/@:?&=])/)) {
    pieces.push(chunk, document.createElement('wbr'));
  }
  pieces.pop();
  return pieces;
}

function badge(text: string, tone?: string): HTMLElement {
  return h('span', { class: tone ? `badge ${tone}` : 'badge', text });
}

/**
 * A value worth copying is a value worth being able to copy. Every long
 * technical string in here gets its own button rather than relying on the
 * reader to select text inside a scrolling panel.
 */
function copyable(value: string, label = 'Copy value'): HTMLElement {
  const button = h('button', {
    class: 'btn-copy',
    title: 'Copy to clipboard',
    text: label,
    on: {
      click: async (event: MouseEvent) => {
        const target = event.currentTarget as HTMLButtonElement;
        try {
          await navigator.clipboard.writeText(value);
          target.textContent = 'Copied';
        } catch {
          target.textContent = 'Blocked';
        }
        window.setTimeout(() => {
          target.textContent = label;
        }, 1400);
      },
    },
  });
  return button;
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

function nodeBody(node: GibsenNode, incident: Incident, handlers: ModalHandlers, navigate: (s: Selection) => void): HTMLElement[] {
  const plane = PLANE_BY_ID[resolvePlane(node, incident.planeSet ?? 'talk')];
  const category = CATEGORY_BY_ID[node.category];
  const severed = handlers.severedBy(node.id);
  const details = detailEntries(node);
  const connections = incident.edges.filter((e) => e.from === node.id || e.to === node.id);
  const byId = new Map(incident.nodes.map((n) => [n.id, n]));

  const glyph = icon(iconFor(node.category));
  glyph.setAttribute('width', '22');
  glyph.setAttribute('height', '22');
  glyph.setAttribute('class', 'record-glyph');
  if (plane) glyph.setAttribute('stroke', plane.accent);

  const head = h(
    'div',
    { class: 'record-head' },
    glyph,
    h(
      'div',
      { class: 'record-head-text' },
      h('h2', { class: 'record-title' }, ...breakable(node.label)),
      h('p', {
        class: 'record-sub',
        text: [category?.label ?? node.category, plane?.label ?? node.plane].join('  ·  '),
      }),
      copyable(node.label),
    ),
  );

  const badges = h(
    'div',
    { class: 'badges' },
    badge(node.confidence),
    node.timeBasis === 'inferred' ? badge('inferred time') : null,
    node.tactic ? badge(TACTICS.find((t) => t.id === node.tactic)?.label ?? node.tactic) : null,
    node.compromised ? badge('attacker-controlled', 'bad') : null,
    node.pivot ? badge('investigation pivot', 'pivot') : null,
    severed > 0 ? badge(`point of congruence — ${severed} depend on it`, 'choke') : null,
    node.aggregate
      ? badge(
          `${node.aggregate.kind === 'fan-out' ? 'reaches' : 'reached by'} ${
            node.aggregate.count ? `×${node.aggregate.count}` : 'many'
          }${node.aggregate.of ? ` ${node.aggregate.of}` : ''}`,
        )
      : null,
  );

  const body: HTMLElement[] = [head, badges, section('Seen', h('p', { class: 'record-line', text: when(node) }))];

  if (node.techniques.length) {
    body.push(section('ATT&CK', h('p', { class: 'record-line', text: node.techniques.join(', ') })));
  }

  if (details.length) {
    body.push(
      section(
        'Technical detail',
        h(
          'table',
          { class: 'kv-table' },
          ...details.map(([key, value]) =>
            h(
              'tr',
              {},
              h('td', { class: 'kv-table-key', text: key }),
              h('td', { class: 'kv-table-value', text: value }),
              h('td', { class: 'kv-table-copy' }, copyable(value, 'Copy')),
            ),
          ),
        ),
      ),
    );
  }

  if (node.commentary.trim()) {
    body.push(
      section(
        'Analyst commentary',
        h(
          'div',
          { class: 'record-prose' },
          ...node.commentary
            .split(/\n+/)
            .filter((p) => p.trim())
            .map((p) => h('p', { text: p })),
        ),
      ),
    );
  }

  if (node.logs.length) {
    body.push(
      section(
        'Forensic logs',
        ...node.logs.map((log) =>
          h(
            'div',
            { class: 'record-log' },
            h('div', {
              class: 'record-log-head',
              text: [log.source || 'log', log.timestamp ? stamp(log.timestamp) : null].filter(Boolean).join('  ·  '),
            }),
            h('pre', { text: log.excerpt }),
          ),
        ),
      ),
    );
  }

  body.push(
    section(
      `Connections (${connections.length})`,
      connections.length === 0
        ? h('p', { class: 'record-line', text: 'Nothing links to this artifact yet.' })
        : h(
            'div',
            { class: 'record-links' },
            ...connections.map((edge) => {
              const outgoing = edge.from === node.id;
              const other = byId.get(outgoing ? edge.to : edge.from);
              const verb = edge.label ?? RELATION_BY_ID[edge.relation]?.label ?? edge.relation;
              return h(
                'button',
                {
                  class: 'record-link',
                  on: { click: () => other && navigate({ kind: 'node', id: other.id }) },
                },
                h('span', { class: 'record-link-dir', text: outgoing ? '→' : '←' }),
                h('span', { class: 'record-link-verb', text: verb }),
                h('span', { class: 'record-link-target', text: other?.label ?? '(missing)' }),
              );
            }),
          ),
    ),
  );

  return body;
}

function edgeBody(edge: GibsenEdge, incident: Incident, navigate: (s: Selection) => void): HTMLElement[] {
  const byId = new Map(incident.nodes.map((n) => [n.id, n]));
  const from = byId.get(edge.from);
  const to = byId.get(edge.to);
  const verb = edge.label ?? RELATION_BY_ID[edge.relation]?.label ?? edge.relation;

  const end = (node: GibsenNode | undefined, direction: string) =>
    h(
      'button',
      { class: 'record-link', on: { click: () => node && navigate({ kind: 'node', id: node.id }) } },
      h('span', { class: 'record-link-dir', text: direction === 'from' ? '←' : '→' }),
      h('span', { class: 'record-link-verb', text: direction }),
      h('span', { class: 'record-link-target', text: node?.label ?? '(missing)' }),
    );

  const body: HTMLElement[] = [
    h(
      'div',
      { class: 'record-head' },
      h(
        'div',
        { class: 'record-head-text' },
        h('h2', { class: 'record-title', text: verb }),
        h('p', { class: 'record-sub', text: 'behaviour' }),
      ),
    ),
    h('div', { class: 'badges' }, badge(edge.confidence), badge(edge.t ? stamp(edge.t) : 'no time recorded')),
    section('Ends', h('div', { class: 'record-links' }, end(from, 'from'), end(to, 'to'))),
  ];

  if (edge.commentary?.trim()) {
    body.push(
      section(
        'Commentary',
        h(
          'div',
          { class: 'record-prose' },
          ...edge.commentary
            .split(/\n+/)
            .filter((p) => p.trim())
            .map((p) => h('p', { text: p })),
        ),
      ),
    );
  }

  return body;
}

// ---------------------------------------------------------------------------
// The modal itself
// ---------------------------------------------------------------------------

export function openRecord(incident: Incident, target: Selection, handlers: ModalHandlers): void {
  closeRecord();
  if (target.kind === 'none') return;

  let showing: Selection = target;

  const content = h('div', { class: 'record-content' });
  const dialog = h(
    'div',
    { class: 'record-dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Artifact record', tabindex: '-1' } },
    content,
  );
  const backdrop = h('div', { class: 'record-backdrop' }, dialog);

  const close = () => closeRecord();

  const draw = (next: Selection) => {
    showing = next;
    content.replaceChildren();

    const closeButton = h('button', {
      class: 'record-close',
      text: '×',
      title: 'Close (Esc)',
      attrs: { 'aria-label': 'Close' },
      on: { click: close },
    });
    content.append(closeButton);

    if (next.kind === 'node') {
      const node = incident.nodes.find((n) => n.id === next.id);
      if (!node) return close();
      content.append(...nodeBody(node, incident, handlers, draw));
    } else if (next.kind === 'edge') {
      const edge = incident.edges.find((e) => e.id === next.id);
      if (!edge) return close();
      content.append(...edgeBody(edge, incident, draw));
    }

    content.append(
      h(
        'div',
        { class: 'record-actions' },
        h('button', {
          class: 'btn',
          text: 'Edit in the inspector',
          on: {
            click: () => {
              close();
              handlers.edit(showing);
            },
          },
        }),
        h('button', { class: 'btn btn-primary', text: 'Close', on: { click: close } }),
      ),
    );
    dialog.scrollTop = 0;
  };

  // A click on the backdrop closes; a click inside the card must not.
  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop) close();
  });

  document.body.append(backdrop);
  draw(target);
  dialog.focus();

  current = {
    root: backdrop,
    show: draw,
    close,
    isOpen: () => true,
  };
}

export function closeRecord(): void {
  if (!current) return;
  current.root.remove();
  current = null;
}

export function recordIsOpen(): boolean {
  return current !== null;
}
