/**
 * The MCP server.
 *
 * Four tools, in the order they are usually wanted:
 *
 *   gibsen_schema    — the incident format, the legal vocabularies, and how to
 *                      write a good one. Read this before authoring.
 *   gibsen_ingest    — run a STIX bundle, MISP event, CSV or report through the
 *                      studio's own parsers, for a draft to correct.
 *   gibsen_validate  — check an incident before drawing it.
 *   gibsen_render    — draw it: PDF, PNG, SVG, the interactive page, the report.
 *
 * Deliberately not a tool: anything that reads intelligence and decides what
 * the artifacts are. That is the model's job, and it is better at it than the
 * regexes are. See `contract.ts`.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { AUTHORING_GUIDE, incidentJsonSchema, validateIncident, vocabularies } from './contract';
import { ALL_FORMATS, renderIncident, type OutputFormat, type RenderOptions } from './render';
import { detectFormat, ingest } from '../src/ingest';
import { emptyIncident, mergeIngest, parseIncident } from '../src/model/incident';
import type { Incident } from '../src/model/types';

const VERSION = '0.1.0';

/** Text back to the caller. Everything here answers in JSON or prose, not both. */
function text(body: string) {
  return { content: [{ type: 'text' as const, text: body }] };
}

function json(body: unknown) {
  return text(JSON.stringify(body, null, 2));
}

function fail(message: string) {
  return { ...text(message), isError: true };
}

/** An incident from either an inline object or a path on disk. */
async function readIncidentArg(args: Record<string, unknown>): Promise<Incident> {
  if (args.incident && typeof args.incident === 'object') return parseIncident(args.incident);
  if (typeof args.incident_path === 'string') {
    const raw = await readFile(resolve(args.incident_path), 'utf8');
    return parseIncident(JSON.parse(raw));
  }
  throw new Error('Pass either `incident` (the object) or `incident_path` (a .gibsen.json file).');
}

const TOOLS = [
  {
    name: 'gibsen_schema',
    description:
      'The GIBSEN incident format: the JSON schema, every legal plane, category, relation, tactic and ' +
      'confidence value, and a guide to writing an incident that reads well. Call this before authoring one.',
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          enum: ['all', 'guide', 'schema', 'vocabularies'],
          description: 'Narrow the answer. Defaults to all of it.',
        },
      },
    },
  },
  {
    name: 'gibsen_ingest',
    description:
      'Parse a STIX 2.x bundle, a MISP event, a CSV/TSV artifact table or a prose incident report into a ' +
      'draft incident, using the studio\'s own parsers. Best on the structured formats. On prose the parser ' +
      'is heuristic and deliberately conservative — read the report yourself and write the incident by hand ' +
      'instead, or use this as a starting point and correct it.',
    inputSchema: {
      type: 'object',
      required: ['content'],
      properties: {
        content: { type: 'string', description: 'The document, as text.' },
        filename: { type: 'string', description: 'Helps pick a parser when the content is ambiguous.' },
        name: { type: 'string', description: 'Name for the resulting incident.' },
      },
    },
  },
  {
    name: 'gibsen_validate',
    description:
      'Check an incident before drawing it: unknown vocabulary, edges pointing at nothing, unparseable ' +
      'timestamps, and the things that will render but say little.',
    inputSchema: {
      type: 'object',
      properties: {
        incident: { type: 'object', description: 'The incident object.' },
        incident_path: { type: 'string', description: 'Or a path to a .gibsen.json file.' },
      },
    },
  },
  {
    name: 'gibsen_render',
    description:
      'Draw an incident and write the files. PDF is a contents sheet plus one page per act; PNG is the whole ' +
      'diagram at scale; act-png is one image per act. Also produces the self-contained interactive HTML page, ' +
      'the SVG, the Markdown report and the incident JSON.',
    inputSchema: {
      type: 'object',
      required: ['out_dir'],
      properties: {
        incident: { type: 'object', description: 'The incident object.' },
        incident_path: { type: 'string', description: 'Or a path to a .gibsen.json file.' },
        out_dir: { type: 'string', description: 'Directory to write into. Created if it is not there.' },
        formats: {
          type: 'array',
          items: { enum: ALL_FORMATS },
          description: `Any of ${ALL_FORMATS.join(', ')}. Defaults to pdf and png.`,
        },
        theme: { enum: ['dark', 'light'], description: 'Dark by default. Light prints better.' },
        scale: { type: 'number', description: 'Raster multiplier. 2 by default; 3 for a large print.' },
        granularity: {
          type: 'string',
          description: 'Time bucket for the columns: auto, second, minute, five-minutes, hour, day, week, month, year.',
        },
        time_zone: { type: 'string', description: 'IANA zone for the axis labels. UTC by default.' },
        show_empty_planes: { type: 'boolean', description: 'Draw planes nothing reached. Off by default.' },
        show_edge_labels: { type: 'boolean', description: 'Print the verb on each behaviour. On by default.' },
      },
    },
  },
];

export function createServer(): Server {
  const server = new Server(
    { name: 'gibsen', version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    try {
      switch (request.params.name) {
        case 'gibsen_schema': {
          const section = (args.section as string) ?? 'all';
          if (section === 'guide') return text(AUTHORING_GUIDE);
          if (section === 'schema') return json(incidentJsonSchema());
          if (section === 'vocabularies') return json(vocabularies());
          return json({
            guide: AUTHORING_GUIDE,
            schema: incidentJsonSchema(),
            vocabularies: vocabularies(),
          });
        }

        case 'gibsen_ingest': {
          const content = args.content;
          if (typeof content !== 'string' || !content.trim()) return fail('`content` is required and must be text.');
          const filename = typeof args.filename === 'string' ? args.filename : '';
          const detected = detectFormat(content, filename);
          const outcome = ingest(content, filename);

          if (outcome.kind === 'incident') {
            return json({ format: 'gibsen', incident: outcome.incident, warnings: [] });
          }

          const incident = emptyIncident(
            typeof args.name === 'string' && args.name ? args.name : filename || 'Untitled incident',
          );
          mergeIngest(incident, outcome.result);

          return json({
            format: detected.format,
            incident,
            warnings: outcome.result.warnings,
            note:
              detected.format === 'text'
                ? 'Parsed by the heuristic narrative reader. It misses more than it invents — read the source and correct this before rendering.'
                : undefined,
          });
        }

        case 'gibsen_validate': {
          const raw =
            args.incident ??
            (typeof args.incident_path === 'string'
              ? JSON.parse(await readFile(resolve(args.incident_path), 'utf8'))
              : null);
          if (!raw) return fail('Pass either `incident` or `incident_path`.');
          return json(validateIncident(raw));
        }

        case 'gibsen_render': {
          if (typeof args.out_dir !== 'string' || !args.out_dir) return fail('`out_dir` is required.');
          const incident = await readIncidentArg(args);

          const options: RenderOptions = { incident };
          if (Array.isArray(args.formats)) options.formats = args.formats as OutputFormat[];
          if (args.theme === 'light' || args.theme === 'dark') options.theme = args.theme;
          if (typeof args.scale === 'number') options.scale = Math.min(Math.max(args.scale, 0.5), 4);
          if (typeof args.granularity === 'string') options.granularity = args.granularity as RenderOptions['granularity'];
          if (typeof args.time_zone === 'string') options.timeZone = args.time_zone;
          if (typeof args.show_empty_planes === 'boolean') options.showEmptyPlanes = args.show_empty_planes;
          if (typeof args.show_edge_labels === 'boolean') options.showEdgeLabels = args.show_edge_labels;

          const check = validateIncident(incident);
          const report = await renderIncident(resolve(args.out_dir), options);

          return json({
            ...report,
            warnings: [...check.problems.filter((p) => p.severity === 'warning').map((p) => `${p.where}: ${p.message}`), ...report.warnings],
          });
        }

        default:
          return fail(`Unknown tool "${request.params.name}".`);
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  });

  return server;
}

export async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
