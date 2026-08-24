/**
 * GIBSEN Studio — application shell.
 *
 * Holds the incident, wires uploads to the parsers, drives the layout and the
 * renderer, and keeps the inspector in sync with the selection. Everything runs
 * in the browser: no upload leaves the machine, which matters when the input is
 * somebody's live incident data.
 */

import './styles.css';

import type { GibsenEdge, GibsenNode, Incident, PlaneSetId } from './model/types';
import { emptyIncident, makeEdge, mergeIngest, removeNode } from './model/incident';
import { ingest } from './ingest';
import { extractPdfText, isPdf } from './ingest/pdf';
import type { Granularity } from './layout/layout';
import { GUTTER_W, layout } from './layout/layout';
import { renderDiagram } from './render/diagram';
import { findChokePoints, type ChokePoint } from './analysis/congruence';
import { themeByName } from './render/theme';
import { exportInteractive, exportJson, exportMarkdown, exportPng, exportSlices, exportSvg } from './export/download';
import { renderInspector, type Selection } from './ui/inspector';
import { closeRecord, openRecord, recordIsOpen } from './ui/modal';
import { Walkthrough } from './ui/walkthrough';
import { Autosave } from './ui/autosave';
import { h } from './ui/dom';
import { SAMPLES } from './samples';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface ViewOptions {
  granularity: Granularity | 'auto';
  theme: 'dark' | 'light';
  showLegend: boolean;
  showEdgeLabels: boolean;
  showEmptyPlanes: boolean;
  /** Ring the artifacts the rest of the chain depends on. */
  showCongruence: boolean;
  /** Let the gap before a column grow with the interval it stands for. */
  timeToScale: boolean;
  /** Name the stretches of the incident above the axis. */
  showActs: boolean;
  /**
   * Label the axis in the reader's own zone and wash the hours nobody should
   * have been working in. Storage stays UTC either way.
   */
  localTime: boolean;
}

const state = {
  incident: emptyIncident('Untitled incident'),
  selection: { kind: 'none' } as Selection,
  view: {
    granularity: 'auto',
    theme: 'dark',
    showLegend: true,
    showEdgeLabels: true,
    showEmptyPlanes: false,
    showCongruence: true,
    timeToScale: true,
    showActs: true,
    localTime: false,
  } as ViewOptions,
  zoom: { scale: 1, tx: 24, ty: 24 },
  linkSource: null as string | null,
  warnings: [] as string[],
  /** The SVG currently on screen, kept for export. */
  svg: null as SVGSVGElement | null,
};

// ---------------------------------------------------------------------------
// Element references
// ---------------------------------------------------------------------------

const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
};

const els = {
  stage: byId('stage'),
  canvas: byId('canvas'),
  canvasEmpty: byId('canvas-empty'),
  inspector: byId('inspector'),
  sidebar: byId('sidebar'),
  dropZone: byId('drop-zone'),
  fileInput: byId<HTMLInputElement>('file-input'),
  pasteArea: byId<HTMLTextAreaElement>('paste-area'),
  sampleList: byId('sample-list'),
  sourceList: byId('source-list'),
  warningsSection: byId('warnings-section'),
  warningList: byId('warning-list'),
  granularity: byId<HTMLSelectElement>('granularity'),
  planeSet: byId<HTMLSelectElement>('plane-set'),
  toggleCongruence: byId<HTMLInputElement>('toggle-congruence'),
  toggleScale: byId<HTMLInputElement>('toggle-scale'),
  toggleActs: byId<HTMLInputElement>('toggle-acts'),
  toggleLocalTime: byId<HTMLInputElement>('toggle-local-time'),
  toggleLegend: byId<HTMLInputElement>('toggle-legend'),
  toggleEdgeLabels: byId<HTMLInputElement>('toggle-edge-labels'),
  toggleEmptyPlanes: byId<HTMLInputElement>('toggle-empty-planes'),
  themeButton: byId('btn-theme'),
  exportButton: byId('btn-export'),
  exportMenu: byId('export-menu'),
  zoomLabel: byId('zoom-label'),
  linkBanner: byId('link-banner'),
  linkBannerText: byId('link-banner-text'),
  status: byId('status-text'),
};

function setStatus(message: string): void {
  els.status.textContent = message;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Artifact id -> how many others depend on it. Empty when the overlay is off,
 * which is also what the renderer wants in order to skip the marking entirely.
 */
function topChokePoints(): ChokePoint[] {
  // Beyond a handful the ring stops meaning anything, so keep it to the ones
  // that actually hold the chain up.
  return findChokePoints(state.incident).slice(0, 6);
}

function chokePointMap(): Map<string, number> {
  if (!state.view.showCongruence) return new Map();
  return new Map(topChokePoints().map((c) => [c.nodeId, c.severed]));
}

/** The zone the axis is labelled in. Storage and sorting stay UTC regardless. */
function activeTimeZone(): string {
  if (!state.view.localTime) return 'UTC';
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Keeps the open incident in this browser between visits. Hooked to the redraw
 * rather than to each mutation, so no edit path can quietly miss it.
 */
const autosave = new Autosave((outcome) => {
  if (outcome === 'too-large') {
    state.warnings = [
      'This incident is too large to keep in browser storage, so it is no longer being saved automatically. Export the incident JSON to keep it.',
      ...state.warnings,
    ].slice(0, 12);
    drawWarnings();
  }
});

function drawDiagram(): void {
  const result = layout(state.incident, {
    granularity: state.view.granularity,
    showEmptyPlanes: state.view.showEmptyPlanes,
    timeToScale: state.view.timeToScale,
    showActs: state.view.showActs,
    timeZone: activeTimeZone(),
  });

  const svg = renderDiagram(state.incident, result, {
    theme: themeByName(state.view.theme),
    selectedId: state.selection.kind === 'node' ? state.selection.id : null,
    showLegend: state.view.showLegend,
    showEdgeLabels: state.view.showEdgeLabels,
    chokePoints: chokePointMap(),
    interactive: true,
  });

  autosave.schedule(state.incident);

  state.svg = svg;
  els.stage.replaceChildren(svg);
  els.canvasEmpty.hidden = state.incident.nodes.length > 0;
  applyTransform();
  walkthrough.refresh();
}

function applyTransform(): void {
  const { scale, tx, ty } = state.zoom;
  els.stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  els.zoomLabel.textContent = `${Math.round(scale * 100)}%`;
}

/**
 * The guided walkthrough. Drives the view only — stepping through an incident
 * never changes it.
 */
const walkthrough = new Walkthrough({
  container: els.canvas,
  stage: els.stage,
  focus: focusOn,
  onChange: (active) => {
    // The panels are for building the diagram, not for showing it. During a
    // walkthrough they give the whole window back to the picture.
    document.querySelector('.app')?.classList.toggle('walking', active);
    els.canvas.classList.toggle('walking', active);
    byId('btn-walk').textContent = active ? 'Leave walkthrough' : 'Walk it through';
    if (!active) setStatus('Walkthrough closed.');
  },
});

/**
 * Centre the view on a set of artifacts, at a scale somebody can read from
 * across a room. Measured off the drawn elements rather than the layout, so it
 * cannot drift out of step with what is on screen.
 */
function focusOn(nodeIds: string[]): void {
  const svg = els.stage.querySelector('svg');
  if (!svg || !nodeIds.length) return;

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const id of nodeIds) {
    const group = svg.querySelector<SVGGraphicsElement>(`[data-node-id="${CSS.escape(id)}"]`);
    if (!group) continue;
    // getBBox is in the element's own coordinates and ignores the translate
    // that puts it on the grid; getCTM is what carries it up to the diagram.
    const box = group.getBBox();
    const m = group.getCTM();
    const x = m ? m.a * box.x + m.c * box.y + m.e : box.x;
    const y = m ? m.b * box.x + m.d * box.y + m.f : box.y;
    const w = box.width * (m ? m.a : 1);
    const hgt = box.height * (m ? m.d : 1);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + w);
    bottom = Math.max(bottom, y + hgt);
  }
  if (!Number.isFinite(left)) return;

  const view = els.canvas.getBoundingClientRect();
  // Leave room for the caption bar along the bottom.
  const usableHeight = view.height - 190;
  const pad = 90;
  const fit = Math.min((view.width - pad * 2) / Math.max(right - left, 1), (usableHeight - pad) / Math.max(bottom - top, 1));
  state.zoom.scale = Math.max(0.35, Math.min(1.25, fit));

  state.zoom.tx = view.width / 2 - ((left + right) / 2) * state.zoom.scale;
  state.zoom.ty = usableHeight / 2 - ((top + bottom) / 2) * state.zoom.scale;
  applyTransform();
}

function drawInspector(): void {
  renderInspector(els.inspector, state.incident, state.selection, {
    patchNode(id, patch) {
      const node = state.incident.nodes.find((n) => n.id === id);
      if (!node) return;
      Object.assign(node, patch);
      state.incident.updatedAt = new Date().toISOString();
      drawDiagram();
    },
    patchEdge(id, patch) {
      const edge = state.incident.edges.find((e) => e.id === id);
      if (!edge) return;
      Object.assign(edge, patch);
      state.incident.updatedAt = new Date().toISOString();
      drawDiagram();
    },
    patchIncident(patch) {
      Object.assign(state.incident, patch);
      drawDiagram();
    },
    deleteNode(id) {
      removeNode(state.incident, id);
      select({ kind: 'none' });
      setStatus('Artifact deleted.');
    },
    deleteEdge(id) {
      state.incident.edges = state.incident.edges.filter((e) => e.id !== id);
      select({ kind: 'none' });
      setStatus('Behaviour deleted.');
    },
    flipEdge(id) {
      const edge = state.incident.edges.find((e) => e.id === id);
      if (!edge) return;
      [edge.from, edge.to] = [edge.to, edge.from];
      drawDiagram();
      drawInspector();
    },
    openRecord(id) {
      showRecord({ kind: 'node', id });
    },
    beginLink(id) {
      state.linkSource = id;
      const node = state.incident.nodes.find((n) => n.id === id);
      els.linkBannerText.textContent = `Linking from “${node?.label ?? id}” — click the target artifact`;
      els.linkBanner.hidden = false;
    },
    select,
  });
}

/**
 * The full record, in a modal. The diagram keeps only what fits a box; this is
 * where the value, the detail, the logs and the reasoning live, so opening one
 * artifact never costs the reader the picture behind it.
 */
function showRecord(target: Selection): void {
  const severed = chokePointMap();
  openRecord(state.incident, target, {
    edit: (selection) => select(selection),
    severedBy: (id) => severed.get(id) ?? 0,
  });
}

function select(selection: Selection): void {
  state.selection = selection;
  drawDiagram();
  drawInspector();
}

function drawSources(): void {
  els.sourceList.replaceChildren();
  if (state.incident.sources.length === 0) {
    els.sourceList.append(h('p', { class: 'empty-hint', text: 'Nothing ingested yet.' }));
    return;
  }
  for (const source of state.incident.sources) {
    els.sourceList.append(
      h(
        'div',
        { class: 'source', title: `Ingested ${source.ingestedAt}` },
        h('span', { class: 'source-format', text: source.format }),
        h('span', { class: 'source-name', text: source.name }),
        h('span', { class: 'source-count', text: `${source.nodeCount}` }),
      ),
    );
  }
}

function drawWarnings(): void {
  els.warningList.replaceChildren();
  els.warningsSection.hidden = state.warnings.length === 0;
  for (const warning of state.warnings) {
    els.warningList.append(h('li', { text: warning }));
  }
}

/** Push incident-owned view state back into the toolbar controls. */
function syncToolbar(): void {
  els.planeSet.value = state.incident.planeSet ?? 'talk';
}

function redrawAll(): void {
  syncToolbar();
  drawDiagram();
  drawInspector();
  drawSources();
  drawWarnings();
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

function addDocument(content: string, filename: string): void {
  let outcome;
  try {
    outcome = ingest(content, filename);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.warnings = [`${filename || 'Pasted text'}: ${message}`, ...state.warnings].slice(0, 12);
    drawWarnings();
    setStatus(`Could not read ${filename || 'the pasted text'}.`);
    return;
  }

  if (outcome.kind === 'incident') {
    state.incident = outcome.incident;
    state.warnings = [];
    state.selection = { kind: 'none' };
    redrawAll();
    fitToWindow();
    setStatus(`Opened “${state.incident.name}” — ${state.incident.nodes.length} artifacts.`);
    return;
  }

  const before = state.incident.nodes.length;
  mergeIngest(state.incident, outcome.result);
  const added = state.incident.nodes.length - before;
  const merged = outcome.result.nodes.length - added;

  // An untitled incident takes its name from the first thing dropped on it.
  if (state.incident.name === 'Untitled incident' && outcome.result.source.name) {
    state.incident.name = outcome.result.source.name.replace(/\.[a-z0-9]+$/i, '');
  }

  state.warnings = [...outcome.result.warnings, ...state.warnings].slice(0, 12);
  redrawAll();
  fitToWindow();
  setStatus(
    `${outcome.result.source.format.toUpperCase()}: ${added} new artifact${added === 1 ? '' : 's'}` +
      (merged > 0 ? `, ${merged} merged into existing` : '') +
      `, ${outcome.result.edges.length} behaviour${outcome.result.edges.length === 1 ? '' : 's'}.`,
  );
}

async function addFiles(files: FileList | File[]): Promise<void> {
  for (const file of Array.from(files)) {
    const buffer = await file.arrayBuffer();

    // Extensions lie; the magic number does not. Threat intelligence turns up
    // as a PDF more often than as anything else, and the alternative to
    // reading it here is somebody copy-pasting a report a page at a time.
    if (isPdf(new Uint8Array(buffer.slice(0, 8)))) {
      setStatus(`Reading ${file.name}…`);
      try {
        const pdf = await extractPdfText(buffer);
        if (!pdf.text.trim()) {
          state.warnings = [
            `${file.name}: no text layer — this looks like a scan, so it needs OCR before the parser can read it.`,
            ...state.warnings,
          ].slice(0, 12);
          drawWarnings();
          setStatus(`${file.name} has no text to read.`);
          continue;
        }
        addDocument(pdf.text, file.name.replace(/\.pdf$/i, '.txt'));
        setStatus(
          `${file.name}: ${pdf.pages} page${pdf.pages === 1 ? '' : 's'} read` +
            (pdf.furnitureDropped ? `, ${pdf.furnitureDropped} header/footer lines dropped` : '') +
            ` — ${state.incident.nodes.length} artifacts so far.`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        state.warnings = [`${file.name}: could not read the PDF — ${message}`, ...state.warnings].slice(0, 12);
        drawWarnings();
        setStatus(`Could not read ${file.name}.`);
      }
      continue;
    }

    addDocument(new TextDecoder().decode(buffer), file.name);
  }
}

// ---------------------------------------------------------------------------
// Zoom and pan
// ---------------------------------------------------------------------------

function fitToWindow(): void {
  const svg = state.svg;
  if (!svg) return;
  const width = svg.viewBox.baseVal.width || 1;
  const height = svg.viewBox.baseVal.height || 1;
  const rect = els.canvas.getBoundingClientRect();
  const padding = 32;

  const scale = Math.min((rect.width - padding * 2) / width, (rect.height - padding * 2) / height, 1);
  state.zoom.scale = Math.max(scale, 0.08);
  state.zoom.tx = Math.max(padding, (rect.width - width * state.zoom.scale) / 2);
  state.zoom.ty = Math.max(padding, (rect.height - height * state.zoom.scale) / 2);
  applyTransform();
}

function zoomAt(factor: number, clientX: number, clientY: number): void {
  const rect = els.canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const next = Math.min(4, Math.max(0.08, state.zoom.scale * factor));
  // Keep the point under the cursor fixed while the scale changes.
  const ratio = next / state.zoom.scale;
  state.zoom.tx = x - (x - state.zoom.tx) * ratio;
  state.zoom.ty = y - (y - state.zoom.ty) * ratio;
  state.zoom.scale = next;
  applyTransform();
}

function setupCanvasInteraction(): void {
  els.canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      // Trackpad pinch arrives as ctrlKey+wheel; plain wheel scrolls the canvas.
      if (event.ctrlKey || event.metaKey) {
        zoomAt(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX, event.clientY);
      } else {
        state.zoom.tx -= event.deltaX;
        state.zoom.ty -= event.deltaY;
        applyTransform();
      }
    },
    { passive: false },
  );

  let panning = false;
  let originX = 0;
  let originY = 0;

  els.canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const target = event.target as Element;
    // Dragging a node should not pan; clicking it selects instead.
    if (target.closest('[data-node-id]') || target.closest('[data-edge-id]')) return;
    // Nor should pressing one of the controls floating over the canvas.
    // Capturing the pointer here would retarget the click to the canvas and
    // the button underneath the finger would never see it.
    if (target.closest('.canvas-hud, .walk-bar, .link-banner, .canvas-empty')) return;
    panning = true;
    originX = event.clientX - state.zoom.tx;
    originY = event.clientY - state.zoom.ty;
    els.canvas.classList.add('panning');
    els.canvas.setPointerCapture(event.pointerId);
  });

  els.canvas.addEventListener('pointermove', (event) => {
    if (!panning) return;
    state.zoom.tx = event.clientX - originX;
    state.zoom.ty = event.clientY - originY;
    applyTransform();
  });

  const endPan = (event: PointerEvent) => {
    if (!panning) return;
    panning = false;
    els.canvas.classList.remove('panning');
    if (els.canvas.hasPointerCapture(event.pointerId)) els.canvas.releasePointerCapture(event.pointerId);
  };
  els.canvas.addEventListener('pointerup', endPan);
  els.canvas.addEventListener('pointercancel', endPan);

  // Selecting redraws the whole diagram, so the browser never sees two clicks
  // land on the same element and never fires `dblclick`. Track it ourselves
  // against the artifact id, which survives the redraw.
  let lastHit = { id: '', at: 0 };
  const isSecondClick = (id: string, at: number): boolean => {
    const again = lastHit.id === id && at - lastHit.at < 450;
    lastHit = again ? { id: '', at: 0 } : { id, at };
    return again;
  };

  // Selection, and the second half of a link gesture.
  els.canvas.addEventListener('click', (event) => {
    const target = event.target as Element;

    // The "more" marker is the advertised way in: it is only drawn on the
    // artifacts that actually have something more to show.
    const moreEl = state.linkSource ? null : target.closest('[data-more-for]');
    if (moreEl) {
      const id = moreEl.getAttribute('data-more-for')!;
      lastHit = { id: '', at: 0 };
      select({ kind: 'node', id });
      showRecord({ kind: 'node', id });
      return;
    }

    const nodeEl = target.closest('[data-node-id]');
    if (nodeEl) {
      const id = nodeEl.getAttribute('data-node-id')!;
      if (state.linkSource && state.linkSource !== id) {
        completeLink(id);
        return;
      }
      select({ kind: 'node', id });
      // A double-click anywhere on an artifact opens the same record, for
      // anyone who never notices the marker.
      if (isSecondClick(id, event.timeStamp)) showRecord({ kind: 'node', id });
      return;
    }
    const edgeEl = target.closest('[data-edge-id]');
    if (edgeEl) {
      const id = edgeEl.getAttribute('data-edge-id')!;
      select({ kind: 'edge', id });
      if (isSecondClick(id, event.timeStamp)) showRecord({ kind: 'edge', id });
      return;
    }
    if (!panning) select({ kind: 'none' });
  });
}

function completeLink(targetId: string): void {
  const from = state.linkSource;
  if (!from) return;
  const edge: GibsenEdge = makeEdge({ from, to: targetId, relation: 'related-to', confidence: 'probable' });
  state.incident.edges.push(edge);
  cancelLink();
  select({ kind: 'edge', id: edge.id });
  setStatus('Behaviour added — set the relation in the inspector.');
}

function cancelLink(): void {
  state.linkSource = null;
  els.linkBanner.hidden = true;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function setupSidebar(): void {
  for (const sample of SAMPLES) {
    els.sampleList.append(
      h(
        'button',
        {
          class: 'sample',
          on: { click: () => addDocument(sample.content, sample.filename) },
        },
        h('strong', { text: sample.label }),
        h('span', { text: sample.description }),
      ),
    );
  }

  byId('btn-browse').addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => {
    if (els.fileInput.files) void addFiles(els.fileInput.files);
    els.fileInput.value = '';
  });

  byId('btn-paste').addEventListener('click', () => {
    const text = els.pasteArea.value.trim();
    if (!text) {
      setStatus('Nothing to add — the paste box is empty.');
      return;
    }
    addDocument(text, '');
    els.pasteArea.value = '';
  });

  byId('btn-reset').addEventListener('click', () => {
    if (state.incident.nodes.length && !confirm('Discard the current incident and start again?')) return;
    state.incident = emptyIncident('Untitled incident');
    state.selection = { kind: 'none' };
    state.warnings = [];
    autosave.clear();
    cancelLink();
    redrawAll();
    setStatus('New incident started.');
  });

  // Drag and drop anywhere over the sidebar or the canvas.
  for (const zone of [els.dropZone, els.canvas]) {
    zone.addEventListener('dragover', (event) => {
      event.preventDefault();
      els.dropZone.classList.add('dragging');
    });
    zone.addEventListener('dragleave', () => els.dropZone.classList.remove('dragging'));
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      els.dropZone.classList.remove('dragging');
      if (event.dataTransfer?.files?.length) void addFiles(event.dataTransfer.files);
    });
  }
}

function setupToolbar(): void {
  els.granularity.addEventListener('change', () => {
    state.view.granularity = els.granularity.value as ViewOptions['granularity'];
    drawDiagram();
  });

  els.planeSet.addEventListener('change', () => {
    state.incident.planeSet = els.planeSet.value as PlaneSetId;
    drawDiagram();
    drawInspector();
    setStatus(`Drawing against the ${els.planeSet.selectedOptions[0]?.text ?? 'selected'} plane set.`);
  });

  els.toggleCongruence.addEventListener('change', () => {
    state.view.showCongruence = els.toggleCongruence.checked;
    drawDiagram();
  });

  els.toggleScale.addEventListener('change', () => {
    state.view.timeToScale = els.toggleScale.checked;
    drawDiagram();
  });

  els.toggleActs.addEventListener('change', () => {
    state.view.showActs = els.toggleActs.checked;
    drawDiagram();
  });

  els.toggleLocalTime.addEventListener('change', () => {
    state.view.localTime = els.toggleLocalTime.checked;
    drawDiagram();
    setStatus(state.view.localTime ? `Axis in ${activeTimeZone()}. Stored times are still UTC.` : 'Axis in UTC.');
  });

  els.toggleLegend.addEventListener('change', () => {
    state.view.showLegend = els.toggleLegend.checked;
    drawDiagram();
  });
  els.toggleEdgeLabels.addEventListener('change', () => {
    state.view.showEdgeLabels = els.toggleEdgeLabels.checked;
    drawDiagram();
  });
  els.toggleEmptyPlanes.addEventListener('change', () => {
    state.view.showEmptyPlanes = els.toggleEmptyPlanes.checked;
    drawDiagram();
  });

  els.themeButton.addEventListener('click', () => {
    state.view.theme = state.view.theme === 'dark' ? 'light' : 'dark';
    els.themeButton.textContent = state.view.theme === 'dark' ? 'Light' : 'Dark';
    drawDiagram();
  });

  byId('btn-walk').addEventListener('click', () => {
    if (walkthrough.active) {
      walkthrough.stop();
      return;
    }
    if (!walkthrough.start(state.incident)) {
      setStatus('Nothing to walk through yet — load some intelligence first.');
      return;
    }
    select({ kind: 'none' });
    setStatus('Walkthrough — arrow keys or space to step, Esc to leave.');
  });

  byId('btn-fit').addEventListener('click', fitToWindow);
  byId('btn-zoom-in').addEventListener('click', () => {
    const rect = els.canvas.getBoundingClientRect();
    zoomAt(1.15, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  byId('btn-zoom-out').addEventListener('click', () => {
    const rect = els.canvas.getBoundingClientRect();
    zoomAt(1 / 1.15, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  byId('btn-cancel-link').addEventListener('click', cancelLink);

  els.exportButton.addEventListener('click', (event) => {
    event.stopPropagation();
    els.exportMenu.hidden = !els.exportMenu.hidden;
  });
  document.addEventListener('click', () => {
    els.exportMenu.hidden = true;
  });

  els.exportMenu.addEventListener('click', (event) => {
    const button = (event.target as Element).closest('[data-export]');
    if (!button) return;
    els.exportMenu.hidden = true;
    void runExport(button.getAttribute('data-export')!);
  });
}

async function runExport(kind: string): Promise<void> {
  if (state.incident.nodes.length === 0) {
    setStatus('Nothing to export yet.');
    return;
  }

  // Export without the selection ring, so the file is clean.
  const result = layout(state.incident, {
    granularity: state.view.granularity,
    showEmptyPlanes: state.view.showEmptyPlanes,
    timeToScale: state.view.timeToScale,
    showActs: state.view.showActs,
    timeZone: activeTimeZone(),
  });
  const clean = renderDiagram(state.incident, result, {
    theme: themeByName(state.view.theme),
    selectedId: null,
    showLegend: state.view.showLegend,
    showEdgeLabels: state.view.showEdgeLabels,
    chokePoints: chokePointMap(),
    // Hooks are kept so the interactive export can wire itself up; the flat
    // SVG and PNG exporters strip them on the way out.
    interactive: true,
  });

  try {
    switch (kind) {
      case 'html':
        exportInteractive(clean, state.incident, themeByName(state.view.theme), topChokePoints());
        setStatus('Interactive page exported — one file, opens anywhere.');
        break;
      case 'svg':
        exportSvg(clean, state.incident);
        setStatus('SVG exported.');
        break;
      case 'png':
        setStatus('Rasterising…');
        await exportPng(clean, state.incident, 2);
        setStatus('PNG exported.');
        break;
      case 'slides': {
        // One image per act. A whole incident is one enormous wide picture
        // that nobody can put on a slide; an act is a picture of one phase.
        const slices = result.acts.map((act) => ({
          name: act.label,
          subtitle: [act.from?.replace('.000Z', 'Z'), act.duration].filter(Boolean).join('  ·  '),
          x: act.x,
          width: act.width,
        }));
        if (!slices.length) {
          setStatus('No acts to cut on — the artifacts need ATT&CK tactics first. Exporting one PNG instead.');
          await exportPng(clean, state.incident, 2);
          break;
        }
        setStatus(`Rasterising ${slices.length} slides…`);
        // Without the legend: a key sliced down the middle reads as damage,
        // and a slide has the acts band and the plane gutter to explain it.
        // Without the incident title or the legend: the title is far wider
        // than the gutter and would come out cut mid-word, and a key sliced
        // down the middle reads as damage. Both are redrawn as a slide header.
        const theme = themeByName(state.view.theme);
        const forSlides = renderDiagram(state.incident, result, {
          theme,
          selectedId: null,
          showTitle: false,
          showLegend: false,
          showEdgeLabels: state.view.showEdgeLabels,
          chokePoints: chokePointMap(),
          interactive: false,
        });
        const written = await exportSlices(
          forSlides,
          state.incident,
          slices,
          GUTTER_W,
          { background: theme.bg, text: theme.text, muted: theme.textMuted, border: theme.border },
          2,
          (done, total) => setStatus(`Slide ${done} of ${total}…`),
        );
        setStatus(`${written} slides exported, one per act.`);
        break;
      }
      case 'json':
        exportJson(state.incident);
        setStatus('Incident JSON exported.');
        break;
      case 'md':
        exportMarkdown(state.incident);
        setStatus('Markdown report exported.');
        break;
      default:
        break;
    }
  } catch (error) {
    setStatus(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function setupKeyboard(): void {
  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

    if (event.key === 'Escape') {
      if (recordIsOpen()) closeRecord();
      else if (walkthrough.active) walkthrough.stop();
      else if (state.linkSource) cancelLink();
      else if (!typing) select({ kind: 'none' });
      return;
    }
    // The record is modal: while it is up, the diagram's own keys are not.
    // Without this, Enter on its Close button would close and reopen it.
    if (recordIsOpen()) return;
    if (typing) return;

    // Stepping keys, so the walkthrough can be driven from a presenter remote
    // as well as from the buttons.
    if (walkthrough.active) {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === ' ' || event.key === 'PageDown') {
        walkthrough.step(1);
        event.preventDefault();
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') {
        walkthrough.step(-1);
        event.preventDefault();
        return;
      }
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (state.selection.kind === 'node') {
        removeNode(state.incident, state.selection.id);
        select({ kind: 'none' });
        event.preventDefault();
      } else if (state.selection.kind === 'edge') {
        const id = state.selection.id;
        state.incident.edges = state.incident.edges.filter((e) => e.id !== id);
        select({ kind: 'none' });
        event.preventDefault();
      }
    }
    if (event.key === 'f') fitToWindow();
    if (event.key === 'Enter' && state.selection.kind !== 'none') {
      showRecord(state.selection);
      event.preventDefault();
    }
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

setupSidebar();
setupToolbar();
setupCanvasInteraction();
setupKeyboard();

// Pick up where the last visit left off. Nothing has left the machine — this
// is the same browser's own storage — but say so, because an incident already
// on screen at boot is otherwise alarming.
const restored = autosave.restore();
if (restored) {
  state.incident = restored.incident;
  redrawAll();
  fitToWindow();
  const when = restored.savedAt ? ` (saved ${restored.savedAt.replace('.000Z', 'Z')})` : '';
  setStatus(
    `Restored “${state.incident.name}” — ${state.incident.nodes.length} artifacts${when}. “Start a new incident” clears it.`,
  );
} else {
  redrawAll();
  setStatus('Drop threat intelligence on the left, or load a sample, to begin.');
}

// A debounce never fires on the way out of the tab.
window.addEventListener('beforeunload', () => autosave.saveNow(state.incident));

window.addEventListener('resize', () => applyTransform());

// Expose the incident for console debugging without shipping a devtools panel.
(window as unknown as { gibsen: { state: typeof state; incident: () => Incident; nodes: () => GibsenNode[] } }).gibsen = {
  state,
  incident: () => state.incident,
  nodes: () => state.incident.nodes,
};
