/**
 * Self-contained interactive HTML export.
 *
 * One file you can email, drop on a share or open from `file://`. It carries
 * the diagram, the whole incident record and a few hundred lines of script,
 * and it makes no network requests at all — which is the only way a page
 * holding someone's live incident data is safe to hand around.
 *
 * The interaction it exists for is the one the method depends on: an overview
 * you can take in at a glance, and the function-level detail one hover or click
 * away, rather than a wall of text nobody reads or a picture that says nothing.
 * The detail opens as a modal over the diagram and then gets out of the way,
 * which is what lets the boxes underneath stay small enough to read.
 *
 * This module is a pure string builder — it takes already-serialised SVG rather
 * than rendering it — so the whole page can be built and asserted on in a test
 * without a DOM.
 */

import type { Incident } from '../model/types';
import type { ChokePoint } from '../analysis/congruence';
import type { Theme } from '../render/theme';
import { CATEGORY_BY_ID, PLANE_BY_ID, RELATION_BY_ID, TACTICS, resolvePlane } from '../model/taxonomy';
import { timeframe } from '../model/incident';
import { buildStory } from '../model/story';

export interface InteractiveInput {
  incident: Incident;
  /** Serialised `<svg>` markup, with `data-node-id` hooks left intact. */
  svgMarkup: string;
  theme: Theme;
  chokePoints?: ChokePoint[];
}

/** Text destined for HTML content or an attribute. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * JSON destined for a `<script>` block. Escaping `<` is what stops a string
 * containing `</script>` from ending the block early, which is the classic way
 * an embedded payload breaks — or worse, escapes — its container.
 */
function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Everything the page needs, flattened so the embedded script stays simple:
 * labels resolved, connections pre-joined, choke points folded in.
 */
function buildPayload(incident: Incident, chokePoints: ChokePoint[]) {
  const byId = new Map(incident.nodes.map((n) => [n.id, n]));
  // The plane as drawn, not as stored: a registry key lands on the registry
  // seam in the diagram and must not say "hosts" in the record beside it.
  const planeSet = incident.planeSet ?? 'talk';
  const severedBy = new Map(chokePoints.map((c) => [c.nodeId, c]));

  const artifacts = incident.nodes.map((n) => {
    const choke = severedBy.get(n.id);
    return {
      id: n.id,
      label: n.label,
      category: CATEGORY_BY_ID[n.category]?.label ?? n.category,
      plane: PLANE_BY_ID[resolvePlane(n, planeSet)]?.label ?? n.plane,
      t: n.t,
      tEnd: n.tEnd ?? null,
      timeBasis: n.timeBasis,
      confidence: n.confidence,
      tactic: n.tactic ? (TACTICS.find((x) => x.id === n.tactic)?.label ?? n.tactic) : null,
      techniques: n.techniques,
      details: Object.entries(n.details).map(([k, v]) => [k, v]),
      logs: n.logs.map((l) => ({ source: l.source, timestamp: l.timestamp ?? null, excerpt: l.excerpt })),
      commentary: n.commentary,
      compromised: n.compromised,
      pivot: n.pivot,
      aggregate: n.aggregate ?? null,
      severs: choke ? choke.severed : 0,
      // Pre-joined so the page never has to walk the edge list.
      links: incident.edges
        .filter((e) => e.from === n.id || e.to === n.id)
        .map((e) => {
          const outgoing = e.from === n.id;
          const other = byId.get(outgoing ? e.to : e.from);
          return {
            id: e.id,
            outgoing,
            verb: e.label ?? RELATION_BY_ID[e.relation]?.label ?? e.relation,
            otherId: other?.id ?? '',
            otherLabel: other?.label ?? '(missing)',
          };
        }),
      /** Lower-cased haystack for the search box. */
      search: [n.label, CATEGORY_BY_ID[n.category]?.label ?? n.category, n.commentary, ...n.techniques, ...Object.values(n.details)]
        .join(' ')
        .toLowerCase(),
    };
  });

  const behaviours = incident.edges.map((e) => ({
    id: e.id,
    verb: e.label ?? RELATION_BY_ID[e.relation]?.label ?? e.relation,
    fromLabel: byId.get(e.from)?.label ?? '(missing)',
    toLabel: byId.get(e.to)?.label ?? '(missing)',
    fromId: e.from,
    toId: e.to,
    t: e.t ?? null,
    confidence: e.confidence,
    commentary: e.commentary ?? '',
  }));

  return { artifacts, behaviours, story: buildStory(incident) };
}

const PAGE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
  display: grid;
  grid-template-rows: auto 1fr auto;
}
[hidden] { display: none !important; }

.bar {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  padding: 10px 18px;
  background: var(--surface);
}
header.bar { border-bottom: 1px solid var(--border); }
.bar h1 { margin: 0; font-size: 15px; font-weight: 600; }
.bar .meta { font-family: var(--mono); font-size: 10.5px; color: var(--muted); margin-top: 2px; }
.spacer { flex: 1; }

.control { display: flex; align-items: center; gap: 6px; }
button, input[type="search"] {
  font: inherit; color: var(--text);
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 10px;
  cursor: pointer;
}
input[type="search"] { cursor: text; min-width: 180px; }
button:hover { border-color: var(--accent); }
button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
.zoom-label { font-family: var(--mono); font-size: 11px; color: var(--muted); min-width: 42px; text-align: center; }

main { position: relative; overflow: hidden; }
#stage { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
#stage svg { display: block; }
main.grabbing { cursor: grabbing; }
main { cursor: grab; }

/* Search and filter dim the artifacts that do not match. */
#stage svg [data-node-id] { transition: opacity .12s ease; }
#stage svg [data-node-id].dim { opacity: .12; }
#stage svg [data-node-id].hit { cursor: pointer; }

#tooltip {
  position: fixed; z-index: 40; pointer-events: none;
  max-width: 320px; padding: 8px 10px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 7px; box-shadow: 0 10px 30px rgb(0 0 0 / 35%);
}
#tooltip .tt-label { font-family: var(--mono); font-size: 12px; word-break: break-all; }
#tooltip .tt-sub { font-size: 10.5px; color: var(--muted); margin-top: 3px; }
#tooltip .tt-note { font-size: 11px; margin-top: 6px; color: var(--text); }

/* Walking the incident holds the rest of the diagram back so the eye knows
   where to look, and says in a sentence what just happened. */
#stage svg.walking [data-node-id],
#stage svg.walking [data-edge-id] { opacity: .1; transition: opacity .18s ease; }
#stage svg.walking [data-node-id].lit,
#stage svg.walking [data-edge-id].lit { opacity: 1; }

#walkbar {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 45;
  padding: 14px 20px 16px;
  background: var(--surface); border-top: 1px solid var(--border);
  box-shadow: 0 -18px 34px rgb(0 0 0 / 40%);
}
#walkbar .head { display: flex; align-items: baseline; gap: 12px; font-size: 11px; color: var(--muted); }
#walkbar .count { font-family: var(--mono); color: var(--accent); }
#walkbar .when { font-family: var(--mono); }
#walkbar .since { color: var(--congruence); }
#walkbar .grow { flex: 1; }
/* Big enough to read from the back of a room, because that is where it is read. */
#walkbar .sentence { margin: 8px 0 0; font-size: 17px; line-height: 1.45; overflow-wrap: anywhere; }
#walkbar .note { margin: 6px 0 0; max-width: 90ch; font-size: 13px; line-height: 1.55; color: var(--muted); }
#walkbar .controls { display: flex; align-items: center; gap: 14px; margin-top: 12px; }
#walkbar .track { display: flex; flex: 1; gap: 2px; min-width: 0; }
#walkbar .tick {
  flex: 1; min-width: 2px; height: 6px; padding: 0;
  background: var(--border); border: none; border-radius: 3px;
}
#walkbar .tick:hover { background: var(--muted); }
#walkbar .tick.done { background: var(--accent); opacity: .55; }
#walkbar .tick.now { background: var(--accent); height: 10px; opacity: 1; }

/* The record is a modal, not a panel pinned to the diagram: the box on the
   diagram says which artifact this is, and everything that makes it evidence
   opens over the top and then gets out of the way again. */
#modal {
  position: fixed; inset: 0; z-index: 50;
  display: flex; align-items: center; justify-content: center;
  padding: 4vh 4vw;
  background: rgb(3 8 18 / 62%);
}
#detail {
  position: relative; width: min(720px, 100%); max-height: 92vh;
  overflow-y: auto; padding: 20px 24px 24px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; box-shadow: 0 24px 70px rgb(0 0 0 / 55%);
  outline: none;
}
#detail .close { position: absolute; top: 12px; right: 14px; padding: 2px 8px; }
#detail h2 { margin: 0 34px 2px 0; font-size: 16px; font-family: var(--mono); overflow-wrap: anywhere; }
#detail .sub { font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; }
#detail .copy { margin-top: 10px; padding: 2px 9px; font-size: 10.5px; color: var(--muted); background: none; }
#detail .copy:hover { color: var(--text); }
#detail h3 {
  margin: 18px 0 7px; font-size: 10px; font-weight: 600;
  letter-spacing: .8px; text-transform: uppercase; color: var(--muted);
}
.badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.badge {
  font-size: 10.5px; padding: 2px 8px; border-radius: 20px;
  border: 1px solid var(--border); color: var(--muted);
}
.badge.bad { color: var(--danger); border-color: var(--danger); }
.badge.pivot { color: var(--pivot); border-color: var(--pivot); }
.badge.choke { color: var(--congruence); border-color: var(--congruence); }

table.kv { width: 100%; border-collapse: collapse; }
table.kv td { padding: 4px 6px; vertical-align: top; border-top: 1px solid var(--border); font-size: 11.5px; }
table.kv td:first-child { color: var(--muted); width: 38%; word-break: break-word; }
table.kv td:last-child { font-family: var(--mono); word-break: break-all; }

.log { margin-bottom: 10px; }
.log .log-head { font-size: 10.5px; color: var(--muted); margin-bottom: 4px; }
.log pre {
  margin: 0; padding: 8px; overflow-x: auto;
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
  font-family: var(--mono); font-size: 11px; line-height: 1.5;
}
.commentary p { margin: 0 0 8px; font-size: 12px; line-height: 1.6; }

.links { display: flex; flex-direction: column; gap: 4px; }
.link-row {
  display: grid; grid-template-columns: 14px auto 1fr; gap: 7px; align-items: baseline;
  width: 100%; text-align: left; padding: 6px 8px;
  background: var(--surface-alt); border: 1px solid transparent; border-radius: 6px;
}
.link-row:hover { border-color: var(--accent); }
.link-row .dir { color: var(--accent); font-family: var(--mono); }
.link-row .verb { font-size: 11px; color: var(--muted); }
.link-row .other { font-family: var(--mono); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

footer.bar {
  justify-content: space-between; gap: 12px;
  padding: 7px 18px;
  border-top: 1px solid var(--border);
  font-size: 10.5px; line-height: 1.5; color: var(--muted);
}
footer.bar span { min-width: 0; }
footer.bar span:last-child { text-align: right; }
.empty { font-size: 11px; color: var(--muted); }

@media (max-width: 900px) {
  /* The attribution is the first thing to go when the bar gets tight. */
  footer.bar span:last-child { display: none; }
}
@media (max-width: 760px) {
  #walkbar .sentence { font-size: 15px; }
  #walkbar .note { display: none; }
  #modal { padding: 0; }
  #detail { max-height: 100vh; border-radius: 0; }
  .bar .meta { display: none; }
}
`;

/**
 * The page script. Written without template literals so that it can sit inside
 * one here without a thicket of escapes.
 */
const PAGE_JS = `
(function () {
  'use strict';
  var DATA = JSON.parse(document.getElementById('gibsen-data').textContent);
  var byId = {};
  DATA.artifacts.forEach(function (a) { byId[a.id] = a; });
  var edgeById = {};
  DATA.behaviours.forEach(function (b) { edgeById[b.id] = b; });

  var main = document.querySelector('main');
  var stage = document.getElementById('stage');
  var svg = stage.querySelector('svg');
  var tooltip = document.getElementById('tooltip');
  var modal = document.getElementById('modal');
  var detail = document.getElementById('detail');
  var search = document.getElementById('search');
  var zoomLabel = document.getElementById('zoom-label');

  var view = { scale: 1, x: 24, y: 24 };
  var filter = null;

  // ---- helpers ----------------------------------------------------------
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function groups() { return svg.querySelectorAll('[data-node-id]'); }
  /** A value only the modal shows in full is a value worth being able to copy. */
  function copyButton(value) {
    var button = el('button', 'copy', 'Copy value');
    button.addEventListener('click', function () {
      var done = function (ok) {
        button.textContent = ok ? 'Copied' : 'Blocked';
        setTimeout(function () { button.textContent = 'Copy value'; }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(function () { done(true); }, function () { done(false); });
        return;
      }
      // file:// without a clipboard API still has the old selection trick.
      var box = document.createElement('textarea');
      box.value = value;
      box.setAttribute('readonly', 'readonly');
      box.style.position = 'fixed';
      box.style.opacity = '0';
      document.body.appendChild(box);
      box.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      document.body.removeChild(box);
      done(ok);
    });
    return button;
  }
  function when(a) {
    if (!a.t) return 'unsequenced';
    var start = (a.timeBasis === 'inferred' ? '~' : '') + a.t.replace('.000Z', 'Z');
    return a.tEnd ? start + '  \\u2192  ' + a.tEnd.replace('.000Z', 'Z') : start;
  }

  // ---- zoom and pan -----------------------------------------------------
  function applyView() {
    stage.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.scale + ')';
    zoomLabel.textContent = Math.round(view.scale * 100) + '%';
  }
  function fit() {
    var box = svg.viewBox.baseVal;
    var rect = main.getBoundingClientRect();
    var pad = 28;
    var scale = Math.min((rect.width - pad * 2) / (box.width || 1), (rect.height - pad * 2) / (box.height || 1), 1);
    view.scale = Math.max(scale, 0.05);
    view.x = Math.max(pad, (rect.width - box.width * view.scale) / 2);
    view.y = Math.max(pad, (rect.height - box.height * view.scale) / 2);
    applyView();
  }
  function zoomAt(factor, cx, cy) {
    var rect = main.getBoundingClientRect();
    var px = cx - rect.left, py = cy - rect.top;
    var next = Math.min(6, Math.max(0.05, view.scale * factor));
    var ratio = next / view.scale;
    view.x = px - (px - view.x) * ratio;
    view.y = py - (py - view.y) * ratio;
    view.scale = next;
    applyView();
  }

  main.addEventListener('wheel', function (e) {
    e.preventDefault();
    // Trackpad pinch arrives as ctrl+wheel; a plain wheel scrolls the canvas.
    if (e.ctrlKey || e.metaKey) zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
    else { view.x -= e.deltaX; view.y -= e.deltaY; applyView(); }
  }, { passive: false });

  var panning = false, originX = 0, originY = 0, moved = false;
  function hit(target, selector) { return target && target.closest ? target.closest(selector) : null; }

  main.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || walkbar.contains(e.target)) return;
    moved = false;
    // A press on an artifact is a click, not a pan. Capturing the pointer here
    // would retarget the click to the canvas and the artifact would never see it.
    if (hit(e.target, '[data-node-id]') || hit(e.target, '[data-edge-id]')) return;
    panning = true;
    originX = e.clientX - view.x; originY = e.clientY - view.y;
    main.classList.add('grabbing');
    main.setPointerCapture(e.pointerId);
  });
  main.addEventListener('pointermove', function (e) {
    if (!panning) return;
    var nx = e.clientX - originX, ny = e.clientY - originY;
    if (Math.abs(nx - view.x) > 2 || Math.abs(ny - view.y) > 2) moved = true;
    view.x = nx; view.y = ny; applyView();
  });
  function endPan(e) {
    if (!panning) return;
    panning = false;
    main.classList.remove('grabbing');
    if (main.hasPointerCapture(e.pointerId)) main.releasePointerCapture(e.pointerId);
  }
  main.addEventListener('pointerup', endPan);
  main.addEventListener('pointercancel', endPan);

  document.getElementById('zoom-in').addEventListener('click', function () {
    var r = main.getBoundingClientRect(); zoomAt(1.2, r.left + r.width / 2, r.top + r.height / 2);
  });
  document.getElementById('zoom-out').addEventListener('click', function () {
    var r = main.getBoundingClientRect(); zoomAt(1 / 1.2, r.left + r.width / 2, r.top + r.height / 2);
  });
  document.getElementById('fit').addEventListener('click', fit);

  // ---- hover ------------------------------------------------------------
  function showTooltip(a, x, y) {
    tooltip.replaceChildren();
    tooltip.appendChild(el('div', 'tt-label', a.label));
    var bits = [a.category, a.plane, when(a)];
    tooltip.appendChild(el('div', 'tt-sub', bits.join('  \\u00b7  ')));
    var marks = [a.confidence];
    if (a.tactic) marks.push(a.tactic);
    if (a.compromised) marks.push('attacker-controlled');
    if (a.severs) marks.push('point of congruence \\u2014 ' + a.severs + ' depend on it');
    tooltip.appendChild(el('div', 'tt-sub', marks.join('  \\u00b7  ')));
    if (a.commentary) {
      var first = a.commentary.split('\\n')[0];
      tooltip.appendChild(el('div', 'tt-note', first.length > 180 ? first.slice(0, 179) + '\\u2026' : first));
    }
    tooltip.hidden = false;
    var box = tooltip.getBoundingClientRect();
    var left = Math.min(x + 16, window.innerWidth - box.width - 12);
    var top = Math.min(y + 16, window.innerHeight - box.height - 12);
    tooltip.style.left = Math.max(8, left) + 'px';
    tooltip.style.top = Math.max(8, top) + 'px';
  }

  main.addEventListener('mousemove', function (e) {
    var over = hit(e.target, '[data-node-id]');
    if (!over || panning) { tooltip.hidden = true; return; }
    var a = byId[over.getAttribute('data-node-id')];
    if (a) showTooltip(a, e.clientX, e.clientY); else tooltip.hidden = true;
  });
  main.addEventListener('mouseleave', function () { tooltip.hidden = true; });

  // ---- detail panel -----------------------------------------------------
  function section(title) { return el('h3', null, title); }

  function selectArtifact(id) {
    var a = byId[id];
    if (!a) return;
    detail.replaceChildren();

    var close = el('button', 'close', '\\u00d7');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', clearSelection);
    detail.appendChild(close);

    detail.appendChild(el('h2', null, a.label));
    detail.appendChild(el('div', 'sub', a.category + '  \\u00b7  ' + a.plane));
    detail.appendChild(copyButton(a.label));

    var badges = el('div', 'badges');
    badges.appendChild(el('span', 'badge', a.confidence));
    if (a.timeBasis === 'inferred') badges.appendChild(el('span', 'badge', 'inferred time'));
    if (a.tactic) badges.appendChild(el('span', 'badge', a.tactic));
    if (a.compromised) badges.appendChild(el('span', 'badge bad', 'attacker-controlled'));
    if (a.pivot) badges.appendChild(el('span', 'badge pivot', 'investigation pivot'));
    if (a.severs) badges.appendChild(el('span', 'badge choke', 'severs ' + a.severs));
    if (a.aggregate) {
      var many = a.aggregate.count ? '\\u00d7' + a.aggregate.count : 'many';
      badges.appendChild(el('span', 'badge', (a.aggregate.kind === 'fan-out' ? 'reaches ' : 'reached by ') + many));
    }
    detail.appendChild(badges);

    detail.appendChild(section('Seen'));
    detail.appendChild(el('div', 'empty', when(a)));

    if (a.techniques.length) {
      detail.appendChild(section('ATT&CK'));
      detail.appendChild(el('div', 'empty', a.techniques.join(', ')));
    }

    var details = a.details.filter(function (kv) { return kv[0] !== 'value'; });
    if (details.length) {
      detail.appendChild(section('Technical detail'));
      var table = el('table', 'kv');
      details.forEach(function (kv) {
        var tr = document.createElement('tr');
        tr.appendChild(el('td', null, kv[0]));
        tr.appendChild(el('td', null, kv[1]));
        table.appendChild(tr);
      });
      detail.appendChild(table);
    }

    if (a.commentary) {
      detail.appendChild(section('Analyst commentary'));
      var wrap = el('div', 'commentary');
      a.commentary.split(/\\n+/).forEach(function (p) { if (p.trim()) wrap.appendChild(el('p', null, p)); });
      detail.appendChild(wrap);
    }

    if (a.logs.length) {
      detail.appendChild(section('Forensic logs'));
      a.logs.forEach(function (log) {
        var box = el('div', 'log');
        box.appendChild(el('div', 'log-head', log.source + (log.timestamp ? '  \\u00b7  ' + log.timestamp : '')));
        box.appendChild(el('pre', null, log.excerpt));
        detail.appendChild(box);
      });
    }

    detail.appendChild(section('Connections (' + a.links.length + ')'));
    if (!a.links.length) {
      detail.appendChild(el('div', 'empty', 'Nothing links to this artifact.'));
    } else {
      var links = el('div', 'links');
      a.links.forEach(function (link) {
        var row = el('button', 'link-row');
        row.appendChild(el('span', 'dir', link.outgoing ? '\\u2192' : '\\u2190'));
        row.appendChild(el('span', 'verb', link.verb));
        row.appendChild(el('span', 'other', link.otherLabel));
        row.addEventListener('click', function () { selectArtifact(link.otherId); });
        links.appendChild(row);
      });
      detail.appendChild(links);
    }

    modal.hidden = false;
    detail.scrollTop = 0;
    detail.focus();
    highlight(id);
    if (history.replaceState) history.replaceState(null, '', '#' + encodeURIComponent(id));
  }

  function selectBehaviour(id) {
    var b = edgeById[id];
    if (!b) return;
    detail.replaceChildren();
    var close = el('button', 'close', '\\u00d7');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', clearSelection);
    detail.appendChild(close);

    detail.appendChild(el('h2', null, b.verb));
    detail.appendChild(el('div', 'sub', 'behaviour'));

    var links = el('div', 'links');
    [[b.fromId, b.fromLabel, 'from'], [b.toId, b.toLabel, 'to']].forEach(function (end) {
      var row = el('button', 'link-row');
      row.appendChild(el('span', 'dir', end[2] === 'from' ? '\\u2190' : '\\u2192'));
      row.appendChild(el('span', 'verb', end[2]));
      row.appendChild(el('span', 'other', end[1]));
      row.addEventListener('click', function () { selectArtifact(end[0]); });
      links.appendChild(row);
    });
    detail.appendChild(section('Ends'));
    detail.appendChild(links);

    detail.appendChild(section('Recorded'));
    detail.appendChild(el('div', 'empty', (b.t ? b.t.replace('.000Z', 'Z') : 'no time recorded') + '  \\u00b7  ' + b.confidence));

    if (b.commentary) {
      detail.appendChild(section('Commentary'));
      var wrap = el('div', 'commentary');
      b.commentary.split(/\\n+/).forEach(function (p) { if (p.trim()) wrap.appendChild(el('p', null, p)); });
      detail.appendChild(wrap);
    }
    modal.hidden = false;
    detail.scrollTop = 0;
    detail.focus();
  }

  function highlight(id) {
    Array.prototype.forEach.call(groups(), function (g) {
      g.setAttribute('data-selected', g.getAttribute('data-node-id') === id ? 'true' : 'false');
    });
  }
  function clearSelection() {
    modal.hidden = true;
    highlight(null);
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
  }

  main.addEventListener('click', function (e) {
    if (moved) return;
    var node = hit(e.target, '[data-node-id]');
    if (node) { selectArtifact(node.getAttribute('data-node-id')); return; }
    var edge = hit(e.target, '[data-edge-id]');
    if (edge) { selectBehaviour(edge.getAttribute('data-edge-id')); return; }
    clearSelection();
  });

  // Anywhere on the dimmed backdrop closes; inside the card does not.
  modal.addEventListener('pointerdown', function (e) { if (e.target === modal) clearSelection(); });

  // ---- walkthrough ------------------------------------------------------
  // The reason the page exists: an incident somebody can be shown rather than
  // handed. One beat at a time, the rest of the diagram held back, and a
  // sentence underneath saying what just happened.
  var walkbar = document.getElementById('walkbar');
  var walkButton = document.getElementById('walk');
  var story = DATA.story || [];
  var beatAt = -1;

  function walking() { return beatAt >= 0; }

  function focusOn(ids) {
    var left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    ids.forEach(function (id) {
      var g = svg.querySelector('[data-node-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
      if (!g) return;
      // getBBox is in the element's own coordinates and ignores the translate
      // that puts it on the grid; getCTM is what carries it up to the diagram.
      var box = g.getBBox();
      var m = g.getCTM();
      var x = m ? m.a * box.x + m.c * box.y + m.e : box.x;
      var y = m ? m.b * box.x + m.d * box.y + m.f : box.y;
      var w = box.width * (m ? m.a : 1);
      var h = box.height * (m ? m.d : 1);
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x + w); bottom = Math.max(bottom, y + h);
    });
    if (!isFinite(left)) return;

    var rect = main.getBoundingClientRect();
    var usable = rect.height - walkbar.offsetHeight - 24;
    var pad = 90;
    var fit = Math.min((rect.width - pad * 2) / Math.max(right - left, 1), (usable - pad) / Math.max(bottom - top, 1));
    view.scale = Math.max(0.35, Math.min(1.25, fit));
    view.x = rect.width / 2 - ((left + right) / 2) * view.scale;
    view.y = usable / 2 - ((top + bottom) / 2) * view.scale;
    applyView();
  }

  function paintBeat() {
    var beat = story[beatAt];
    var lit = {};
    beat.focusIds.forEach(function (id) { lit[id] = true; });

    svg.classList.add('walking');
    Array.prototype.forEach.call(groups(), function (g) {
      g.classList.toggle('lit', !!lit[g.getAttribute('data-node-id')]);
    });
    Array.prototype.forEach.call(svg.querySelectorAll('[data-edge-id]'), function (g) {
      g.classList.toggle('lit', g.getAttribute('data-edge-id') === beat.edgeId);
    });

    walkbar.replaceChildren();
    var head = el('div', 'head');
    head.appendChild(el('span', 'count', (beatAt + 1) + ' / ' + story.length));
    head.appendChild(el('span', 'when', beat.t ? beat.t.replace('.000Z', 'Z') : 'no time recorded'));
    if (beat.since) head.appendChild(el('span', 'since', beat.since));
    head.appendChild(el('span', 'grow'));
    var leave = el('button', null, 'Leave the walkthrough');
    leave.addEventListener('click', stopWalk);
    head.appendChild(leave);
    walkbar.appendChild(head);

    walkbar.appendChild(el('p', 'sentence', beat.sentence));
    if (beat.commentary) walkbar.appendChild(el('p', 'note', beat.commentary));

    var controls = el('div', 'controls');
    var back = el('button', null, '\u2190 Back');
    back.disabled = beatAt === 0;
    back.addEventListener('click', function () { stepWalk(-1); });
    controls.appendChild(back);

    var track = el('div', 'track');
    story.forEach(function (b, i) {
      var tick = el('button', 'tick' + (i === beatAt ? ' now' : i < beatAt ? ' done' : ''));
      tick.title = (i + 1) + '. ' + b.sentence;
      tick.addEventListener('click', function () { goToBeat(i); });
      track.appendChild(tick);
    });
    controls.appendChild(track);

    var next = el('button', null, beatAt === story.length - 1 ? 'Finish' : 'Next \u2192');
    next.addEventListener('click', function () {
      if (beatAt === story.length - 1) stopWalk(); else stepWalk(1);
    });
    controls.appendChild(next);
    walkbar.appendChild(controls);

    focusOn(beat.focusIds);
  }

  function goToBeat(index) {
    if (!walking() || index < 0 || index >= story.length) return;
    beatAt = index;
    paintBeat();
  }
  function stepWalk(delta) { goToBeat(beatAt + delta); }

  function startWalk() {
    if (!story.length) return;
    clearSelection();
    beatAt = 0;
    walkbar.hidden = false;
    walkButton.textContent = 'Leave walkthrough';
    walkButton.setAttribute('aria-pressed', 'true');
    paintBeat();
  }
  function stopWalk() {
    if (!walking()) return;
    beatAt = -1;
    walkbar.hidden = true;
    walkButton.textContent = 'Walk it through';
    walkButton.setAttribute('aria-pressed', 'false');
    svg.classList.remove('walking');
    Array.prototype.forEach.call(svg.querySelectorAll('.lit'), function (g) { g.classList.remove('lit'); });
    fit();
  }

  if (!story.length) walkButton.hidden = true;
  walkButton.addEventListener('click', function () { walking() ? stopWalk() : startWalk(); });

  // ---- search and filters ----------------------------------------------
  function matches(a) {
    var q = search.value.trim().toLowerCase();
    if (q && a.search.indexOf(q) === -1) return false;
    if (filter === 'compromised' && !a.compromised) return false;
    if (filter === 'choke' && !a.severs) return false;
    if (filter === 'unsequenced' && a.t) return false;
    return true;
  }
  function applyFilters() {
    Array.prototype.forEach.call(groups(), function (g) {
      var a = byId[g.getAttribute('data-node-id')];
      g.classList.toggle('dim', !!a && !matches(a));
    });
  }
  search.addEventListener('input', applyFilters);

  Array.prototype.forEach.call(document.querySelectorAll('[data-filter]'), function (button) {
    button.addEventListener('click', function () {
      var value = button.getAttribute('data-filter');
      filter = filter === value ? null : value;
      Array.prototype.forEach.call(document.querySelectorAll('[data-filter]'), function (other) {
        other.setAttribute('aria-pressed', other.getAttribute('data-filter') === filter ? 'true' : 'false');
      });
      applyFilters();
    });
  });

  // ---- keyboard ---------------------------------------------------------
  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.key === 'Escape') {
      if (typing) e.target.blur();
      else if (walking()) stopWalk();
      else clearSelection();
      return;
    }
    if (typing) return;
    // Stepping keys, so the walk can be driven from a presenter remote.
    if (walking()) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault(); stepWalk(1); return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault(); stepWalk(-1); return;
      }
    }
    if (e.key === '/') { e.preventDefault(); search.focus(); }
    if (e.key === 'f') fit();
    if (e.key === 'w') walking() ? stopWalk() : startWalk();
  });

  // ---- boot -------------------------------------------------------------
  Array.prototype.forEach.call(groups(), function (g) { g.classList.add('hit'); });
  fit();
  window.addEventListener('resize', applyView);

  var hash = decodeURIComponent((location.hash || '').replace(/^#/, ''));
  if (hash && byId[hash]) selectArtifact(hash);
})();
`;

export function buildInteractiveHtml(input: InteractiveInput): string {
  const { incident, svgMarkup, theme } = input;
  const chokePoints = input.chokePoints ?? [];
  const payload = buildPayload(incident, chokePoints);
  const { start, end } = timeframe(incident);

  const window =
    start && end
      ? `${start.replace('.000Z', 'Z')} → ${end.replace('.000Z', 'Z')}`
      : 'No timestamps recorded';

  const meta = [
    window,
    `${incident.nodes.length} artifacts`,
    `${incident.edges.length} behaviours`,
    `${incident.sources.length} source${incident.sources.length === 1 ? '' : 's'}`,
  ].join('   ·   ');

  const vars = [
    `--bg:${theme.bg}`,
    `--surface:${theme.surface}`,
    `--surface-alt:${theme.surfaceAlt}`,
    `--border:${theme.border}`,
    `--text:${theme.text}`,
    `--muted:${theme.textMuted}`,
    `--accent:${PLANE_BY_ID.cloud.accent}`,
    `--danger:${theme.danger}`,
    `--pivot:${theme.pivot}`,
    `--congruence:${theme.congruence}`,
    `--sans:ui-sans-serif,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif`,
    `--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace`,
  ].join(';');

  const hasChoke = chokePoints.length > 0;
  const hasCompromised = incident.nodes.some((n) => n.compromised);
  const hasUnsequenced = incident.nodes.some((n) => !n.t);

  const filterButtons = [
    hasCompromised ? '<button data-filter="compromised" aria-pressed="false">Attacker-controlled</button>' : '',
    hasChoke ? '<button data-filter="choke" aria-pressed="false">Choke points</button>' : '',
    hasUnsequenced ? '<button data-filter="unsequenced" aria-pressed="false">Unsequenced</button>' : '',
  ].join('\n          ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(incident.name)} — incident diagram</title>
<meta name="description" content="Interactive incident threat matrix. ${escapeHtml(meta)}">
<style>:root{${vars}}
${PAGE_CSS}</style>
</head>
<body>

<header class="bar">
  <div>
    <h1>${escapeHtml(incident.name)}</h1>
    <div class="meta">${escapeHtml(meta)}</div>
  </div>
  <div class="spacer"></div>
  <div class="control">
    <input type="search" id="search" placeholder="Search artifacts…  ( / )" aria-label="Search artifacts">
    ${filterButtons}
  </div>
  <div class="control">
    <button id="zoom-out" aria-label="Zoom out">−</button>
    <span class="zoom-label" id="zoom-label">100%</span>
    <button id="zoom-in" aria-label="Zoom in">+</button>
    <button id="fit">Fit</button>
    <button id="walk">Walk it through</button>
  </div>
</header>

<main>
  <div id="stage">${svgMarkup}</div>
  <div id="walkbar" hidden></div>
</main>

<div id="modal" hidden>
  <div id="detail" role="dialog" aria-modal="true" aria-label="Artifact record" tabindex="-1"></div>
</div>

<div id="tooltip" hidden></div>

<footer class="bar">
  <span>Walk it through to be shown the incident a beat at a time · hover for a summary, click for the full record · drag to pan, ctrl+scroll to zoom</span>
  <span>Built with GIBSEN Studio — an independent implementation of the incident threat matrix taught by Pete Hay in &ldquo;The Importance of Arts and Crafts in ThreatOps&rdquo;.</span>
</footer>

<script type="application/json" id="gibsen-data">${escapeJsonForScript(payload)}</script>
<script>${PAGE_JS}</script>
</body>
</html>
`;
}
