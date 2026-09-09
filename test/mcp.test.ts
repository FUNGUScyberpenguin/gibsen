/**
 * The MCP surface, driven over a real client rather than by calling the
 * handlers directly — so a broken tool schema or a handler that throws instead
 * of answering shows up here rather than in somebody's editor.
 */

import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from '../server/mcp';

let client: Client;

const INCIDENT = {
  gibsen: 1,
  name: 'Server side check',
  summary: 'Three artifacts, enough to make acts.',
  nodes: [
    { id: 'n1', label: 'invoice.docm', category: 'file', t: '2026-01-04T09:00:00Z', tactic: 'initial-access', confidence: 'confirmed', compromised: true, pivot: true },
    { id: 'n2', label: 'powershell.exe', category: 'process', t: '2026-01-04T09:01:00Z', tactic: 'execution', confidence: 'confirmed' },
    { id: 'n3', label: 'cdn.example-updates.net', category: 'c2-server', t: '2026-01-04T09:03:00Z', tactic: 'command-and-control', confidence: 'probable', compromised: true },
  ],
  edges: [
    { from: 'n1', to: 'n2', relation: 'executes', confidence: 'confirmed' },
    { from: 'n2', to: 'n3', relation: 'beacons-to', confidence: 'probable' },
  ],
};

/** The text of a tool answer, parsed when it is JSON. */
async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const result: any = await client.callTool({ name, arguments: args });
  const body = result.content?.[0]?.text ?? '';
  if (result.isError) return { isError: true, text: body };
  try {
    return JSON.parse(body);
  } catch {
    return { text: body };
  }
}

beforeAll(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '1' }, { capabilities: {} });
  await Promise.all([createServer().connect(serverSide), client.connect(clientSide)]);
});

afterAll(async () => {
  await client.close();
});

describe('tool listing', () => {
  it('offers the four tools, each with a schema', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'gibsen_ingest',
      'gibsen_render',
      'gibsen_schema',
      'gibsen_validate',
    ]);
    for (const tool of tools) {
      expect(tool.description, `${tool.name} has no description`).toBeTruthy();
      expect(tool.inputSchema.type).toBe('object');
    }
  });
});

describe('gibsen_schema', () => {
  it('answers with everything by default', async () => {
    const all = await call('gibsen_schema');
    expect(all.guide).toContain('NODES ARE THINGS');
    expect(all.vocabularies.categories.length).toBeGreaterThan(50);
    expect(all.schema.properties.nodes).toBeTruthy();
  });

  it('narrows to one section when asked', async () => {
    const vocab = await call('gibsen_schema', { section: 'vocabularies' });
    expect(vocab.guide).toBeUndefined();
    expect(vocab.tactics).toContain('impact');
  });
});

describe('gibsen_ingest', () => {
  it('parses a CSV table into an incident', async () => {
    const csv = await readFile(join(process.cwd(), 'samples', 'artifacts.csv'), 'utf8');
    const answer = await call('gibsen_ingest', { content: csv, filename: 'artifacts.csv', name: 'From CSV' });
    expect(answer.format).toBe('csv');
    expect(answer.incident.name).toBe('From CSV');
    expect(answer.incident.nodes.length).toBeGreaterThan(5);
  });

  it('says out loud when the prose parser did the work', async () => {
    const report = await readFile(join(process.cwd(), 'samples', 'incident-report.md'), 'utf8');
    const answer = await call('gibsen_ingest', { content: report, filename: 'report.md' });
    expect(answer.format).toBe('text');
    expect(answer.note).toContain('heuristic');
  });

  it('refuses an empty document rather than returning an empty incident', async () => {
    const answer = await call('gibsen_ingest', { content: '   ' });
    expect(answer.isError).toBe(true);
  });
});

describe('gibsen_validate', () => {
  it('passes a good incident and fails a broken one', async () => {
    expect((await call('gibsen_validate', { incident: INCIDENT })).ok).toBe(true);

    const broken = { ...INCIDENT, edges: [{ from: 'n1', to: 'ghost', relation: 'executes' }] };
    const answer = await call('gibsen_validate', { incident: broken });
    expect(answer.ok).toBe(false);
    expect(answer.problems.some((p: any) => p.message.includes('ghost'))).toBe(true);
  });

  it('asks for an argument when given none', async () => {
    expect((await call('gibsen_validate')).isError).toBe(true);
  });
});

describe('gibsen_render', () => {
  it('writes the files and reports what it drew', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gibsen-mcp-'));
    try {
      const answer = await call('gibsen_render', {
        incident: INCIDENT,
        out_dir: dir,
        formats: ['pdf', 'png', 'md'],
        scale: 1,
      });

      expect(answer.files.map((f: any) => f.format).sort()).toEqual(['md', 'pdf', 'png']);
      expect(answer.stats.acts).toBe(3);
      for (const file of answer.files) {
        expect((await readFile(file.path)).length).toBe(file.bytes);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('needs somewhere to write', async () => {
    expect((await call('gibsen_render', { incident: INCIDENT })).isError).toBe(true);
  });

  it('reports a bad incident as an error rather than drawing nonsense', async () => {
    const answer = await call('gibsen_render', { incident: { name: 'no marker' }, out_dir: tmpdir() });
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain('gibsen');
  });
});
