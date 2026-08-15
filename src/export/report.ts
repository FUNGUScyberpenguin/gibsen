/**
 * Markdown incident report.
 *
 * The diagram is the artifact people look at; this is the one they paste into
 * a ticket. It is generated from the same incident object, so the narrative and
 * the picture cannot drift apart.
 */

import type { Incident, GibsenNode } from '../model/types';
import { CATEGORY_BY_ID, PLANE_BY_ID, RELATION_BY_ID, TACTICS } from '../model/taxonomy';
import { timeframe } from '../model/incident';

function tacticLabel(node: GibsenNode): string {
  if (!node.tactic) return '—';
  return TACTICS.find((t) => t.id === node.tactic)?.label ?? node.tactic;
}

/** Pipe characters would break out of a Markdown table cell. */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}

/** Whole-second timestamps read better without their noise-only milliseconds. */
function stamp(iso: string): string {
  return iso.replace('.000Z', 'Z');
}

function displayTime(node: GibsenNode): string {
  if (!node.t) return 'unsequenced';
  return node.timeBasis === 'inferred' ? `~${stamp(node.t)}` : stamp(node.t);
}

export function toMarkdownReport(incident: Incident): string {
  const lines: string[] = [];
  const { start, end } = timeframe(incident);

  lines.push(`# ${incident.name}`, '');
  if (incident.summary.trim()) lines.push(incident.summary.trim(), '');

  lines.push(
    '| | |',
    '| --- | --- |',
    `| **Window** | ${start && end ? `${stamp(start)} → ${stamp(end)}` : 'No timestamps recorded'} |`,
    `| **Artifacts** | ${incident.nodes.length} |`,
    `| **Behaviours** | ${incident.edges.length} |`,
    `| **Sources** | ${incident.sources.length ? incident.sources.map((s) => `${s.name} (${s.format})`).join(', ') : '—'} |`,
    `| **Generated** | ${new Date().toISOString()} |`,
    '',
  );

  // --- timeline ---------------------------------------------------------
  const sequenced = incident.nodes
    .filter((n) => n.t)
    .sort((a, b) => (a.t! < b.t! ? -1 : a.t! > b.t! ? 1 : a.label.localeCompare(b.label)));
  const unsequenced = incident.nodes.filter((n) => !n.t);

  lines.push('## Timeline', '');
  if (sequenced.length === 0) {
    lines.push('_No artifact carries a timestamp yet._', '');
  } else {
    lines.push(
      '| Time (UTC) | Plane | Artifact | Category | Tactic | Confidence |',
      '| --- | --- | --- | --- | --- | --- |',
    );
    for (const n of sequenced) {
      lines.push(
        `| ${displayTime(n)} | ${PLANE_BY_ID[n.plane]?.label ?? n.plane} | \`${cell(n.label)}\`${n.compromised ? ' ⚠' : ''} | ${
          CATEGORY_BY_ID[n.category]?.label ?? n.category
        } | ${tacticLabel(n)} | ${n.confidence} |`,
      );
    }
    lines.push('');
  }

  if (unsequenced.length) {
    lines.push('### Unsequenced artifacts', '');
    for (const n of unsequenced) {
      lines.push(`- \`${n.label}\` — ${CATEGORY_BY_ID[n.category]?.label ?? n.category} (${n.confidence})`);
    }
    lines.push('');
  }

  // --- behaviours -------------------------------------------------------
  if (incident.edges.length) {
    const byId = new Map(incident.nodes.map((n) => [n.id, n]));
    lines.push('## Behaviours', '');
    const sorted = [...incident.edges].sort((a, b) => {
      const at = a.t ?? byId.get(a.from)?.t ?? '';
      const bt = b.t ?? byId.get(b.from)?.t ?? '';
      return at < bt ? -1 : at > bt ? 1 : 0;
    });
    for (const e of sorted) {
      const from = byId.get(e.from);
      const to = byId.get(e.to);
      if (!from || !to) continue;
      const verb = e.label ?? RELATION_BY_ID[e.relation]?.label ?? e.relation;
      const when = e.t ? ` _(${e.t.replace('.000Z', 'Z')})_` : '';
      lines.push(`- \`${from.label}\` **${verb}** \`${to.label}\`${when} — ${e.confidence}`);
      if (e.commentary?.trim()) lines.push(`  > ${e.commentary.trim().replace(/\n+/g, ' ')}`);
    }
    lines.push('');
  }

  // --- artifact detail --------------------------------------------------
  const documented = incident.nodes.filter(
    (n) => n.commentary.trim() || Object.keys(n.details).length > 1 || n.logs.length || n.techniques.length,
  );
  if (documented.length) {
    lines.push('## Artifact detail', '');
    const order = [...documented].sort((a, b) => {
      if (a.t && b.t) return a.t < b.t ? -1 : 1;
      if (a.t) return -1;
      if (b.t) return 1;
      return a.label.localeCompare(b.label);
    });

    for (const n of order) {
      lines.push(`### \`${n.label}\``, '');
      lines.push(
        `- **Category:** ${CATEGORY_BY_ID[n.category]?.label ?? n.category} · **Plane:** ${
          PLANE_BY_ID[n.plane]?.label ?? n.plane
        } · **Seen:** ${displayTime(n)} · **Confidence:** ${n.confidence}`,
      );
      if (n.techniques.length) lines.push(`- **ATT&CK:** ${n.techniques.join(', ')}`);
      if (n.tactic) lines.push(`- **Tactic:** ${tacticLabel(n)}`);
      if (n.compromised) lines.push('- **Attacker-controlled or compromised**');

      const details = Object.entries(n.details).filter(([k]) => k !== 'value');
      if (details.length) {
        lines.push('', '| Field | Value |', '| --- | --- |');
        for (const [k, v] of details) lines.push(`| ${cell(k)} | ${cell(v)} |`);
      }

      if (n.commentary.trim()) {
        lines.push('', '**Analyst commentary**', '');
        for (const para of n.commentary.trim().split(/\n+/)) lines.push(`> ${para}`);
      }

      if (n.logs.length) {
        lines.push('', '**Supporting logs**', '');
        for (const log of n.logs) {
          lines.push(`- _${log.source}_${log.timestamp ? ` @ ${log.timestamp}` : ''}`);
          lines.push('  ```', `  ${log.excerpt.replace(/\n/g, '\n  ')}`, '  ```');
        }
      }
      lines.push('');
    }
  }

  // --- indicator appendix -----------------------------------------------
  const iocCategories = new Set(['ip-address', 'domain', 'url', 'file', 'executable', 'script', 'archive', 'email', 'certificate']);
  const iocs = incident.nodes.filter((n) => iocCategories.has(n.category));
  if (iocs.length) {
    lines.push('## Indicators', '');
    const grouped = new Map<string, GibsenNode[]>();
    for (const n of iocs) {
      const key = CATEGORY_BY_ID[n.category]?.label ?? n.category;
      const list = grouped.get(key);
      if (list) list.push(n);
      else grouped.set(key, [n]);
    }
    for (const [group, members] of [...grouped].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`**${group}**`, '');
      lines.push('```');
      for (const m of members) lines.push(m.details.value ?? m.label);
      lines.push('```', '');
    }
  }

  lines.push(
    '---',
    '',
    '_Diagram and report produced with GIBSEN Studio. GIBSEN (Graphical Information Base for Security Event Notation) is a visual language devised by Pete Hay of Arbitr Security._',
  );

  return lines.join('\n');
}
