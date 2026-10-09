#!/usr/bin/env node
/**
 * The command line, for when an MCP client is not in the picture.
 *
 * Takes an incident, or anything the studio can read — a STIX bundle, a MISP
 * event, a CSV, a report — and writes the pictures.
 */

import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { ALL_FORMATS, renderIncident, type OutputFormat, type RenderOptions } from './render';
import { validateIncident } from './contract';
import { ingest } from '../src/ingest';
import { emptyIncident, mergeIngest } from '../src/model/incident';
import type { Incident } from '../src/model/types';

const USAGE = `
gibsen-render — draw a GIBSEN diagram without a browser

  gibsen-render <input> [options]

  <input>   A .gibsen.json incident, or a STIX bundle, MISP event, CSV/TSV
            artifact table or prose report to parse first.

Options
  --out <dir>          Where to write. Default: the working directory.
  --formats <list>     Comma-separated. ${ALL_FORMATS.join(', ')}.
                       Default: pdf,png
  --theme <name>       dark (default) or light.
  --scale <n>          Raster multiplier. Default 2.
  --granularity <g>    auto (default), second, minute, five-minutes, hour,
                       day, week, month, year.
  --time-zone <zone>   IANA zone for the axis labels. Default UTC.
  --name <name>        Incident name, when parsing something that has none.
  --empty-planes       Draw planes nothing reached.
  --no-edge-labels     Leave the verb off each behaviour.
  --help               This.
`.trim();

interface Args {
  input: string;
  out: string;
  name?: string;
  options: Partial<RenderOptions>;
}

function parseArgs(argv: string[]): Args | null {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return null;

  const args: Args = { input: '', out: process.cwd(), options: {} };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`);
      i += 1;
      return next;
    };

    switch (arg) {
      case '--out': args.out = value(); break;
      case '--formats': args.options.formats = value().split(',').map((f) => f.trim()) as OutputFormat[]; break;
      case '--theme': args.options.theme = value() === 'light' ? 'light' : 'dark'; break;
      case '--scale': args.options.scale = Number(value()); break;
      case '--granularity': args.options.granularity = value() as RenderOptions['granularity']; break;
      case '--time-zone': args.options.timeZone = value(); break;
      case '--name': args.name = value(); break;
      case '--empty-planes': args.options.showEmptyPlanes = true; break;
      case '--no-edge-labels': args.options.showEdgeLabels = false; break;
      default:
        if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
        args.input = arg;
    }
  }

  return args.input ? args : null;
}

/** Read the input, whatever it turns out to be. */
async function loadIncident(path: string, name?: string): Promise<{ incident: Incident; warnings: string[] }> {
  const content = await readFile(resolve(path), 'utf8');
  const outcome = ingest(content, basename(path));

  if (outcome.kind === 'incident') return { incident: outcome.incident, warnings: [] };

  const incident = emptyIncident(name ?? basename(path).replace(/\.[^.]+$/, ''));
  mergeIngest(incident, outcome.result);
  return { incident, warnings: outcome.result.warnings };
}

async function run(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.log(USAGE);
    return process.argv.length > 2 ? 0 : 1;
  }

  const { incident, warnings } = await loadIncident(args.input, args.name);
  const check = validateIncident(incident);

  for (const problem of check.problems) {
    console.error(`${problem.severity === 'error' ? 'error' : 'note '}  ${problem.where}: ${problem.message}`);
  }
  if (!check.ok) {
    console.error('\nRefusing to draw an incident with errors in it.');
    return 1;
  }

  const report = await renderIncident(resolve(args.out), { ...args.options, incident });

  for (const warning of [...warnings, ...report.warnings]) console.error(`note   ${warning}`);
  for (const file of report.files) {
    console.log(`${file.path}  (${(file.bytes / 1024).toFixed(0)} KB)  ${file.note}`);
  }

  const { nodes, edges, acts, chokePoints } = report.stats;
  console.log(`\n${nodes} artifacts, ${edges} behaviours, ${acts} acts, ${chokePoints} points of congruence.`);
  return 0;
}

run().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
