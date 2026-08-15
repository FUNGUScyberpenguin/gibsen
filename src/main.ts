/**
 * GIBSEN Studio — application shell.
 *
 * Holds the incident, wires uploads to the parsers, drives the layout and the
 * renderer, and keeps the inspector in sync with the selection. Everything runs
 * in the browser: no upload leaves the machine, which matters when the input is
 * somebody's live incident data.
 */

import './styles.css';

import type { GibsenEdge, GibsenNode, Incident } from './model/types';
import { emptyIncident, makeEdge, mergeIngest, removeNode } from './model/incident';
import { ingest } from './ingest';
import type { Granularity } from './layout/layout';
import { layout } from './layout/layout';
import { renderDiagram } from './render/diagram';
import { themeByName } from './render/theme';
import { exportJson, exportMarkdown, exportPng, exportSvg } from './export/download';
import { renderInspector, type Selection } from './ui/inspector';
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

function drawDiagram(): void {
  const result = layout(state.incident, {
    granularity: state.view.granularity,
    showEmptyPlanes: state.view.showEmptyPlanes,
  });

  const svg = renderDiagram(state.incident, result, {
    theme: themeByName(state.view.theme),
    selectedId: state.selection.kind === 'node' ? state.selection.id : null,
    showLegend: state.view.showLegend,
    showEdgeLabels: state.view.showEdgeLabels,
    interactive: true,
  });

  state.svg = svg;
  els.stage.replaceChildren(svg);
  els.canvasEmpty.hidden = state.incident.nodes.length > 0;
  applyTransform();
}

function applyTransform(): void {
  const { scale, tx, ty } = state.zoom;
  els.stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  els.zoomLabel.textContent = `${Math.round(scale * 100)}%`;
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
    beginLink(id) {
      state.linkSource = id;
      const node = state.incident.nodes.find((n) => n.id === id);
      els.linkBannerText.textContent = `Linking from “${node?.label ?? id}” — click the target artifact`;
      els.linkBanner.hidden = false;
    },
    select,
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

function redrawAll(): void {
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
    const text = await file.text();
    addDocument(text, file.name);
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

  // Selection, and the second half of a link gesture.
  els.canvas.addEventListener('click', (event) => {
    const target = event.target as Element;
    const nodeEl = target.closest('[data-node-id]');
    if (nodeEl) {
      const id = nodeEl.getAttribute('data-node-id')!;
      if (state.linkSource && state.linkSource !== id) {
        completeLink(id);
        return;
      }
      select({ kind: 'node', id });
      return;
    }
    const edgeEl = target.closest('[data-edge-id]');
    if (edgeEl) {
      select({ kind: 'edge', id: edgeEl.getAttribute('data-edge-id')! });
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
  });
  const clean = renderDiagram(state.incident, result, {
    theme: themeByName(state.view.theme),
    selectedId: null,
    showLegend: state.view.showLegend,
    showEdgeLabels: state.view.showEdgeLabels,
    interactive: false,
  });

  try {
    switch (kind) {
      case 'svg':
        exportSvg(clean, state.incident);
        setStatus('SVG exported.');
        break;
      case 'png':
        setStatus('Rasterising…');
        await exportPng(clean, state.incident, 2);
        setStatus('PNG exported.');
        break;
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
      if (state.linkSource) cancelLink();
      else if (!typing) select({ kind: 'none' });
      return;
    }
    if (typing) return;

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
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

setupSidebar();
setupToolbar();
setupCanvasInteraction();
setupKeyboard();
redrawAll();
setStatus('Drop threat intelligence on the left, or load a sample, to begin.');

window.addEventListener('resize', () => applyTransform());

// Expose the incident for console debugging without shipping a devtools panel.
(window as unknown as { gibsen: { state: typeof state; incident: () => Incident; nodes: () => GibsenNode[] } }).gibsen = {
  state,
  incident: () => state.incident,
  nodes: () => state.incident.nodes,
};
