import { beforeEach, describe, expect, it } from 'vitest';
import { detectFormat, ingest } from '../src/ingest';
import { parseCsv, parseDelimited, sniffDelimiter } from '../src/ingest/csv';
import { parseMisp } from '../src/ingest/misp';
import { parseStix, parseStixPattern } from '../src/ingest/stix';
import { parseTextReport } from '../src/ingest/text';
import { resetIds } from '../src/model/incident';
import { SAMPLES } from '../src/samples';

beforeEach(() => resetIds());

const sample = (id: string) => {
  const found = SAMPLES.find((s) => s.id === id);
  if (!found) throw new Error(`missing sample ${id}`);
  return found;
};

// ---------------------------------------------------------------------------

describe('detectFormat', () => {
  it('recognises a STIX bundle', () => {
    expect(detectFormat(sample('stix').content, 'stix-bundle.json').format).toBe('stix');
  });

  it('recognises a MISP event', () => {
    expect(detectFormat('{"Event":{"info":"x","Attribute":[]}}').format).toBe('misp');
  });

  it('recognises a saved incident', () => {
    expect(detectFormat('{"gibsen":1,"nodes":[],"edges":[]}').format).toBe('gibsen');
  });

  it('recognises a table by shape, without needing the extension', () => {
    expect(detectFormat('artifact,category\nfoo,domain\nbar,url').format).toBe('csv');
  });

  it('falls back to prose', () => {
    expect(detectFormat('On Tuesday the attacker did something.').format).toBe('text');
  });

  it('reads malformed JSON as prose rather than throwing', () => {
    expect(detectFormat('{ this is not json').format).toBe('text');
  });
});

// ---------------------------------------------------------------------------

describe('parseTextReport', () => {
  const result = () => parseTextReport(sample('report').content, { name: 'report.md' });

  it('extracts artifacts across all four technical planes', () => {
    const planes = new Set(result().nodes.map((n) => n.plane));
    expect(planes.has('cloud')).toBe(true);
    expect(planes.has('network')).toBe(true);
    expect(planes.has('host')).toBe(true);
    expect(planes.has('ot')).toBe(true);
  });

  it('carries the timestamp forward to artifacts in the same paragraph', () => {
    const domain = result().nodes.find((n) => n.label === 'kettle-invoices.top');
    expect(domain?.t).toBe('2024-03-11T22:04:00.000Z');
    expect(domain?.timeBasis).toBe('observed');
  });

  it('lifts hostnames named in prose and categorises them by role', () => {
    const nodes = result().nodes;
    const find = (label: string) => nodes.find((n) => n.label === label);

    expect(find('FIN-WS-014')?.category).toBe('workstation');
    expect(find('CORP-DC-01')?.category).toBe('server');
    expect(find('ENG-WS-03')?.category).toBe('engineering-workstation');
    expect(find('PI-HIST-02')?.category).toBe('historian');
    expect(find('PLC-LINE-2')?.category).toBe('plc');
  });

  it('does not mistake CVE ids or hashes for hostnames', () => {
    const labels = result().nodes.map((n) => n.label);
    expect(labels.some((l) => l.startsWith('SHA-'))).toBe(false);
    const cve = result().nodes.find((n) => n.label.startsWith('CVE-'));
    if (cve) expect(cve.category).toBe('vulnerability');
  });

  it('attaches ATT&CK techniques to the artifacts named alongside them', () => {
    const nodes = result().nodes;
    // The loader is named inside a URL, so the URL is the artifact that carries
    // the technique from that sentence.
    const withTechnique = nodes.filter((n) => n.techniques.includes('T1059.001'));
    expect(withTechnique.length).toBeGreaterThan(0);
    expect(nodes.some((n) => n.techniques.includes('T1566.001'))).toBe(true);
  });

  it('picks up domain accounts and cloud objects', () => {
    const nodes = result().nodes;
    expect(nodes.find((n) => n.label === 'CORP\\svc-backup')?.category).toBe('user-account');
    expect(nodes.find((n) => n.label === 'kettle-drop-eu')?.category).toBe('cloud-storage');
  });

  it('derives behaviours from the verbs in each sentence', () => {
    const { edges } = result();
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.some((e) => e.relation === 'beacons-to' || e.relation === 'exfiltrates-to')).toBe(true);
  });

  it('marks attacker-controlled artifacts', () => {
    const c2 = result().nodes.find((n) => n.label === '203.0.113.44');
    expect(c2?.compromised).toBe(true);
  });

  it('warns when a document yields nothing', () => {
    const empty = parseTextReport('Nothing of interest was written down.');
    expect(empty.nodes).toHaveLength(0);
    expect(empty.warnings.join(' ')).toMatch(/No indicators/i);
  });

  it('warns when nothing carries a timestamp', () => {
    const untimed = parseTextReport('The host talked to 198.51.100.23 repeatedly.');
    expect(untimed.nodes.length).toBeGreaterThan(0);
    expect(untimed.warnings.join(' ')).toMatch(/unsequenced/i);
  });

  it('never claims more than "probable" for something a regex found', () => {
    expect(result().nodes.every((n) => n.confidence === 'probable' || n.confidence === 'possible')).toBe(true);
  });

  it('mentions one artifact once, however many times the report names it', () => {
    const labels = result().nodes.map((n) => n.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('upgrades a generic reading when a later sentence is more specific', () => {
    const parsed = parseTextReport(
      '2024-03-01T00:00:00Z The host resolved 198.51.100.9 during the session.\n\n' +
        '2024-03-01T01:00:00Z The loader began beaconing to 198.51.100.9. This is attacker-controlled C2 infrastructure.',
    );
    const matches = parsed.nodes.filter((n) => n.label === '198.51.100.9');
    expect(matches).toHaveLength(1);
    expect(matches[0].category).toBe('c2-server');
    // The earliest sighting still anchors the artifact on the timeline.
    expect(matches[0].t).toBe('2024-03-01T00:00:00.000Z');
  });

  it('does not let a generic reading overwrite a specific one', () => {
    const parsed = parseTextReport(
      '2024-03-01T00:00:00Z The loader beaconed to 198.51.100.9 as C2.\n\n' +
        '2024-03-01T01:00:00Z Traffic to 198.51.100.9 continued.',
    );
    expect(parsed.nodes.find((n) => n.label === '198.51.100.9')?.category).toBe('c2-server');
  });

  it('applies a verdict stated in its own sentence to the paragraph it describes', () => {
    const parsed = parseTextReport(
      '2024-03-01T00:00:00Z Traffic reached 198.51.100.9 on 443. This is attacker-controlled infrastructure. T1071.001',
    );
    const node = parsed.nodes.find((n) => n.label === '198.51.100.9');
    expect(node?.compromised).toBe(true);
    expect(node?.techniques).toContain('T1071.001');
  });

  it('strips punctuation that a capture ran into', () => {
    const parsed = parseTextReport('2024-03-01T00:00:00Z Content was staged into the bucket loot-drop-eu.');
    expect(parsed.nodes.find((n) => n.category === 'cloud-storage')?.label).toBe('loot-drop-eu');
  });

  it('does not carve fragments out of a registry path', () => {
    const parsed = parseTextReport(
      '2024-03-01T00:00:00Z Persistence at HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\Evil.',
    );
    expect(parsed.nodes.filter((n) => n.category === 'registry-key')).toHaveLength(1);
    // `HKCU\Software` and friends look like DOMAIN\user but are not accounts.
    expect(parsed.nodes.filter((n) => n.category === 'user-account')).toHaveLength(0);
  });

  it('still reads a real domain account alongside a path', () => {
    const parsed = parseTextReport('2024-03-01T00:00:00Z CORP\\svc-backup wrote C:\\Windows\\Temp\\a.dll.');
    expect(parsed.nodes.find((n) => n.category === 'user-account')?.label).toBe('CORP\\svc-backup');
  });

  it('will not file a bare common word as a named artifact', () => {
    const parsed = parseTextReport('2024-03-01T00:00:00Z The tenant grant was revoked and the bucket policy fixed.');
    expect(parsed.nodes.some((n) => n.label === 'grant' || n.label === 'policy')).toBe(false);
  });

  it('sharpens an indicator when prose names what it is', () => {
    const parsed = parseTextReport(
      '2024-03-01T00:00:00Z The actor authenticated to the Entra ID tenant contoso-eng.onmicrosoft.com.',
    );
    const node = parsed.nodes.find((n) => n.label === 'contoso-eng.onmicrosoft.com');
    expect(node?.category).toBe('cloud-tenant');
    expect(node?.plane).toBe('cloud');
  });

  it('recognises OT gear addressed by IP rather than by hostname', () => {
    const parsed = parseTextReport(
      '2024-03-01T00:00:00Z The actor reached the protocol gateway at 10.20.4.9 and the HMI at 10.20.4.21.',
    );
    expect(parsed.nodes.find((n) => n.label === '10.20.4.9')?.category).toBe('protocol-gateway');
    expect(parsed.nodes.find((n) => n.label === '10.20.4.21')?.category).toBe('hmi');
    expect(parsed.nodes.filter((n) => n.plane === 'ot')).toHaveLength(2);
  });

  it('reads a hard-wrapped paragraph as one thought', () => {
    const wrapped =
      '2024-03-01T00:00:00Z The actor moved laterally to the domain\ncontroller CORP-DC-01 over SMB.';
    const node = parseTextReport(wrapped).nodes.find((n) => n.label === 'CORP-DC-01');
    expect(node?.category).toBe('server');
    expect(node?.timeBasis).toBe('observed');
  });
});

// ---------------------------------------------------------------------------

describe('parseStix', () => {
  const result = () => parseStix(JSON.parse(sample('stix').content), { name: 'bundle.json' });

  it('maps observables and domain objects onto categories', () => {
    const nodes = result().nodes;
    const find = (label: string) => nodes.find((n) => n.label === label);

    expect(find('203.0.113.44')?.category).toBe('ip-address');
    expect(find('kettle-invoices.top')?.category).toBe('domain');
    expect(find('KettleLoader')?.category).toBe('backdoor');
    expect(find('TIN KETTLE')?.category).toBe('threat-actor');
    expect(find('Kettle C2 node')?.category).toBe('c2-server');
  });

  it('places the actor on the adversary rail and observables on their planes', () => {
    const nodes = result().nodes;
    expect(nodes.find((n) => n.label === 'TIN KETTLE')?.plane).toBe('adversary');
    expect(nodes.find((n) => n.label === '203.0.113.44')?.plane).toBe('network');
  });

  it('turns relationships into edges', () => {
    const { nodes, edges } = result();
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const resolves = edges.find((e) => e.relation === 'resolves-to');
    expect(byId.get(resolves!.from)?.label).toBe('kettle-invoices.top');
    expect(byId.get(resolves!.to)?.label).toBe('203.0.113.44');
  });

  it('folds attack-pattern references into techniques instead of drawing them', () => {
    const { nodes } = result();
    expect(nodes.some((n) => n.label === 'Spearphishing Attachment')).toBe(false);
    expect(nodes.find((n) => n.label === 'TIN KETTLE')?.techniques).toContain('T1566.001');
  });

  it('expands an indicator pattern into observables', () => {
    const url = result().nodes.find((n) => n.category === 'url');
    expect(url?.details.value).toBe('https://kettle-invoices.top/upd/kettle.dll');
    expect(url?.compromised).toBe(true);
  });

  it('promotes confidence and time from a sighting', () => {
    const ip = result().nodes.find((n) => n.label === '203.0.113.44');
    expect(ip?.confidence).toBe('confirmed');
    expect(ip?.t).toBe('2024-03-12T08:03:00.000Z');
    expect(ip?.details.sighting_count).toBe('47');
  });

  it('prefers the CVE id as the label for a vulnerability', () => {
    expect(result().nodes.find((n) => n.category === 'vulnerability')?.label).toBe('CVE-2024-00000');
  });

  it('keeps the original verb when a relationship type has no mapping', () => {
    const exploits = result().edges.find((e) => e.relation === 'exploits');
    expect(exploits).toBeDefined();
  });

  it('rejects JSON that holds no STIX objects', () => {
    expect(() => parseStix({ hello: 'world' })).toThrow(/No STIX objects/);
  });
});

describe('parseStixPattern', () => {
  it('reads a single comparison', () => {
    expect(parseStixPattern("[ipv4-addr:value = '203.0.113.9']")).toEqual([{ type: 'ipv4-addr', value: '203.0.113.9' }]);
  });

  it('reads compound patterns', () => {
    const parts = parseStixPattern("[file:name = 'a.dll' AND file:hashes.'SHA-256' = 'abc']");
    expect(parts.map((p) => p.value)).toEqual(['a.dll', 'abc']);
  });
});

// ---------------------------------------------------------------------------

describe('parseMisp', () => {
  const event = {
    Event: {
      info: 'Kettle phishing wave',
      date: '2024-03-12',
      Attribute: [
        { type: 'ip-dst', value: '203.0.113.44', category: 'Network activity', to_ids: true, timestamp: '1710230580' },
        { type: 'domain', value: 'kettle-invoices.top', category: 'Network activity', to_ids: true },
        { type: 'filename|sha256', value: 'kettle.dll|9f2c4a1b', category: 'Payload delivery', to_ids: true },
        { type: 'comment', value: 'analyst note', category: 'Other' },
      ],
      Object: [
        {
          name: 'file',
          uuid: 'obj-1',
          Attribute: [
            { type: 'filename', value: 'Invoice_Q1_2024.xlsm', category: 'Payload delivery' },
            { type: 'md5', value: 'd41d8cd98f00b204e9800998ecf8427e', category: 'Payload delivery' },
          ],
          ObjectReference: [{ referenced_uuid: 'obj-2', relationship_type: 'drops' }],
        },
        {
          name: 'file',
          uuid: 'obj-2',
          Attribute: [{ type: 'filename', value: 'kettle.dll', category: 'Payload installation' }],
        },
      ],
      Galaxy: [{ type: 'threat-actor', name: 'Threat Actor', GalaxyCluster: [{ value: 'TIN KETTLE' }] }],
    },
  };

  it('maps attribute types onto categories', () => {
    const { nodes } = parseMisp(event);
    expect(nodes.find((n) => n.label === '203.0.113.44')?.category).toBe('ip-address');
    expect(nodes.find((n) => n.label === 'kettle-invoices.top')?.category).toBe('domain');
  });

  it('splits composite types, keeping the extra half as a detail', () => {
    const node = parseMisp(event).nodes.find((n) => n.label === 'kettle.dll' && n.details.sha256);
    expect(node?.details.sha256).toBe('9f2c4a1b');
    expect(node?.category).toBe('executable');
  });

  it('treats to_ids as the signal for attacker-controlled', () => {
    const { nodes } = parseMisp(event);
    expect(nodes.find((n) => n.label === '203.0.113.44')?.compromised).toBe(true);
    expect(nodes.find((n) => n.label === 'analyst note')?.compromised).toBe(false);
  });

  it('maps the MISP category onto a tactic', () => {
    const ip = parseMisp(event).nodes.find((n) => n.label === '203.0.113.44');
    expect(ip?.tactic).toBe('command-and-control');
  });

  it('anchors an attribute without its own timestamp on the event date', () => {
    const domain = parseMisp(event).nodes.find((n) => n.label === 'kettle-invoices.top');
    expect(domain?.t).toBe('2024-03-12T00:00:00.000Z');
    expect(domain?.timeBasis).toBe('inferred');
  });

  it('links object members to their anchor and resolves object references', () => {
    const { nodes, edges } = parseMisp(event);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const drop = edges.find((e) => e.relation === 'writes');
    expect(byId.get(drop!.from)?.label).toBe('Invoice_Q1_2024.xlsm');
    expect(byId.get(drop!.to)?.label).toBe('kettle.dll');
  });

  it('reads galaxy clusters as actors', () => {
    const actor = parseMisp(event).nodes.find((n) => n.label === 'TIN KETTLE');
    expect(actor?.category).toBe('threat-actor');
    expect(actor?.plane).toBe('adversary');
  });

  it('unwraps the response envelope', () => {
    expect(parseMisp({ response: [event] }).nodes.length).toBeGreaterThan(0);
  });

  it('rejects JSON that is not a MISP event', () => {
    expect(() => parseMisp({ nope: true })).toThrow(/No MISP event/);
  });
});

// ---------------------------------------------------------------------------

describe('CSV plumbing', () => {
  it('handles quoted delimiters, escaped quotes and embedded newlines', () => {
    const rows = parseDelimited('a,b\n"x,1","say ""hi""\nagain"', ',');
    expect(rows[1]).toEqual(['x,1', 'say "hi"\nagain']);
  });

  it('sniffs tabs and semicolons', () => {
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';');
  });

  it('strips a UTF-8 BOM so the first header still matches', () => {
    const result = parseCsv('﻿artifact,category\nexample.com,domain');
    expect(result.nodes[0].category).toBe('domain');
  });
});

describe('parseCsv', () => {
  const result = () => parseCsv(sample('csv').content, { name: 'artifacts.csv' });

  it('reads planes, tactics, techniques and confidence from the row', () => {
    const plc = result().nodes.find((n) => n.label === 'PLC-LINE-2');
    expect(plc?.plane).toBe('ot');
    expect(plc?.tactic).toBe('impact');
    expect(plc?.techniques).toEqual(['T0836']);
    expect(plc?.confidence).toBe('probable');
  });

  it('builds edges from the from/relation columns', () => {
    const { nodes, edges } = result();
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const exec = edges.find((e) => e.relation === 'executes');
    expect(byId.get(exec!.from)?.label).toBe('FIN-WS-014');
    expect(byId.get(exec!.to)?.label).toBe('powershell.exe');
  });

  it('keeps unrecognised columns as artifact details', () => {
    expect(result().nodes[0].details.value).toBe('kettle-invoices.top');
  });

  it('reads yes/no into the compromised flag', () => {
    const nodes = result().nodes;
    expect(nodes.find((n) => n.label === '203.0.113.44')?.compromised).toBe(true);
    expect(nodes.find((n) => n.label === 'FIN-WS-014')?.compromised).toBe(false);
  });

  it('accepts numeric and worded confidence scales', () => {
    const csv = 'artifact,confidence\na.example.com,92\nb.example.com,0.4\nc.example.com,low';
    const nodes = parseCsv(csv).nodes;
    expect(nodes[0].confidence).toBe('confirmed');
    expect(nodes[1].confidence).toBe('possible');
    expect(nodes[2].confidence).toBe('possible');
  });

  it('infers a category from the value when the column is absent', () => {
    const nodes = parseCsv('indicator\n203.0.113.9\nhttps://a.example.com/x\nCVE-2024-9999').nodes;
    expect(nodes.map((n) => n.category)).toEqual(['ip-address', 'url', 'vulnerability']);
  });

  it('creates a placeholder for a parent that never got its own row', () => {
    const result = parseCsv('artifact,from,relation\nreal.example.com,ghost.example.com,connects-to');
    const ghost = result.nodes.find((n) => n.label === 'ghost.example.com');
    expect(ghost).toBeDefined();
    expect(ghost?.commentary).toMatch(/never defined/i);
    expect(result.edges).toHaveLength(1);
  });

  it('reads a pure relationship sheet with no artifact column', () => {
    const result = parseCsv('source,target,relation\na.example.com,203.0.113.5,resolves-to');
    expect(result.nodes.map((n) => n.label).sort()).toEqual(['203.0.113.5', 'a.example.com']);
    expect(result.edges[0].relation).toBe('resolves-to');
  });

  it('reads an end column into a span', () => {
    const lure = result().nodes.find((n) => n.label === 'Invoice_Q1_2024.xlsm');
    expect(lure?.t).toBe('2024-03-12T07:41:00.000Z');
    expect(lure?.tEnd).toBe('2024-03-12T07:58:00.000Z');
  });

  it('reads the aggregate and count columns into a triangle', () => {
    const sweep = result().nodes.find((n) => n.label === 'internal SMB sweep');
    expect(sweep?.aggregate).toEqual({ kind: 'fan-out', count: 412 });

    const beacons = result().nodes.find((n) => n.label === 'beacon sessions');
    expect(beacons?.aggregate).toEqual({ kind: 'converge', count: 1184 });
  });

  it('treats a bare count as many, fanning out by default', () => {
    const nodes = parseCsv('artifact,count\nsubnet sweep,254').nodes;
    expect(nodes[0].aggregate).toEqual({ kind: 'fan-out', count: 254 });
  });

  it('leaves a single artifact alone', () => {
    expect(parseCsv('artifact,aggregate\na.example.com,no').nodes[0].aggregate).toBeNull();
  });

  it('rejects a sheet with no usable column', () => {
    expect(() => parseCsv('alpha,beta\n1,2')).toThrow(/usable column/);
  });

  it('rejects a sheet with no data rows', () => {
    expect(() => parseCsv('artifact,category')).toThrow(/at least one data row/);
  });
});

// ---------------------------------------------------------------------------

describe('ingest dispatch', () => {
  it('routes each sample to the right parser', () => {
    for (const s of SAMPLES) {
      const outcome = ingest(s.content, s.filename);
      expect(outcome.kind).toBe('ingest');
      if (outcome.kind === 'ingest') expect(outcome.result.nodes.length).toBeGreaterThan(3);
    }
  });

  it('returns a whole incident for a saved .gibsen.json', () => {
    const saved = JSON.stringify({
      gibsen: 1,
      id: 'i-1',
      name: 'Saved',
      nodes: [{ id: 'n1', label: 'a.example.com', category: 'domain' }],
      edges: [],
    });
    const outcome = ingest(saved, 'saved.gibsen.json');
    expect(outcome.kind).toBe('incident');
    if (outcome.kind === 'incident') expect(outcome.incident.name).toBe('Saved');
  });
});

// ---------------------------------------------------------------------------

describe('malware-path vocabulary', () => {
  const malwarePath = () => parseCsv(sample('malware-path').content, { name: 'malware-path.csv' });

  it('classifies every artifact in the sample', () => {
    const result = malwarePath();
    expect(result.warnings).toEqual([]);
    expect(result.nodes.filter((n) => n.category === 'unknown')).toEqual([]);
  });

  it('names what the malware actually does, rather than "related to"', () => {
    const { edges } = malwarePath();
    const vague = edges.filter((e) => e.relation === 'related-to');
    expect(vague).toEqual([]);

    const verbs = new Set(edges.map((e) => e.relation));
    for (const verb of ['contains', 'decrypts', 'injects-into', 'creates', 'spawns-thread', 'inhibits-recovery']) {
      expect(verbs, `expected the path to use "${verb}"`).toContain(verb);
    }
  });

  it('covers delivery through to encryption and exfil', () => {
    const tactics = new Set(malwarePath().nodes.map((n) => n.tactic));
    for (const tactic of ['initial-access', 'execution', 'defense-evasion', 'discovery', 'collection', 'command-and-control', 'exfiltration', 'impact']) {
      expect(tactics, `expected the path to reach ${tactic}`).toContain(tactic);
    }
  });

  it('separates what is in memory from what is on disk', () => {
    const nodes = malwarePath().nodes;
    // The decrypted stage never touches disk; the loader that unpacked it does.
    expect(nodes.find((n) => n.label === 'decrypted payload')?.category).toBe('shellcode');
    expect(nodes.find((n) => n.label === 'tickler.dll')?.category).toBe('executable');
    expect(nodes.filter((n) => n.category === 'thread')).toHaveLength(2);
  });

  it('accepts the wording an analyst actually types', () => {
    const csv = [
      'artifact,from,relation',
      'loader.dll,powershell.exe,drops',
      'share sweep,loader.dll,enumerates',
      'shadow copies,loader.dll,deletes-shadow-copies',
      'payload,loader.dll,unpacks-to',
      'svchost.exe,payload,hollows',
    ].join('\n');
    const relations = parseCsv(csv).edges.map((e) => e.relation);
    expect(relations).toEqual(['writes', 'discovers', 'inhibits-recovery', 'decrypts', 'injects-into']);
  });

  it('warns rather than silently flattening a verb it does not know', () => {
    const result = parseCsv('artifact,from,relation\nb,a,flumboozles');
    expect(result.edges[0].relation).toBe('related-to');
    expect(result.warnings.join(' ')).toMatch(/flumboozles.*not in the vocabulary/i);
  });

  it('files a Windows shortcut as a file, not as a URL', () => {
    const node = parseCsv('artifact,category\nInvoice.lnk,link-file').nodes[0];
    expect(node.category).toBe('link-file');
    expect(node.plane).toBe('host');
  });

  it('keeps a ransom note distinct from the ransomware', () => {
    const nodes = parseCsv('artifact,category\nREADME.txt,ransom-note\nlocker.exe,ransomware').nodes;
    expect(nodes[0].category).toBe('ransom-note');
    expect(nodes[1].category).toBe('ransomware');
  });
});
