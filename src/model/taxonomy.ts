/**
 * The vocabulary: artifact planes, categories, relations and tactics.
 *
 * This file is the single place to correct or extend the visual language.
 * Adding a category here makes it available to every parser, the layout, the
 * renderer and the inspector — no other file needs to change, except
 * `icons.ts` if the new category wants its own glyph.
 */

import type { CategoryId, PlaneId, PlaneSetId, RelationId, Tactic } from './types';

export interface PlaneDef {
  id: PlaneId;
  label: string;
  /** One-line description shown in the plane gutter. */
  blurb: string;
  accent: string;
  /**
   * True for planes that are this tool's addition rather than the methodology's.
   * The adversary rail is drawn muted and dashed so it reads as annotation
   * rather than as a peer of the artifact planes.
   */
  extension?: boolean;
  /**
   * Drawn as a divider between its neighbours rather than as a band of its own.
   * The registry sits on the line between memory and disk because it is
   * genuinely sometimes one and sometimes the other.
   */
  boundary?: boolean;
}

const PLANE_DEFS: PlaneDef[] = [
  { id: 'adversary', label: 'Adversary', blurb: 'Actors, tooling, weaknesses', accent: '#a78bfa', extension: true },
  { id: 'cloud', label: 'Cloud', blurb: 'Tenants, identity and SaaS', accent: '#38bdf8' },
  { id: 'network', label: 'Network', blurb: 'Transit, perimeter and C2', accent: '#2dd4bf' },
  { id: 'host', label: 'Hosts', blurb: 'Endpoints, processes, accounts', accent: '#fbbf24' },
  { id: 'ot', label: 'Operational Technology', blurb: 'Control systems and safety', accent: '#fb7185' },
  { id: 'external-network', label: 'External network', blurb: 'Domains, addresses, mail, C2', accent: '#2dd4bf' },
  { id: 'internal-network', label: 'Internal network', blurb: 'Hosts, shares, perimeter kit', accent: '#22d3ee' },
  { id: 'host-memory', label: 'Host memory', blurb: 'Processes, services, credentials', accent: '#fbbf24' },
  { id: 'host-registry', label: 'Registry', blurb: 'Sometimes memory, sometimes disk', accent: '#f59e0b', boundary: true },
  { id: 'host-filesystem', label: 'Host file system', blurb: 'Files on disk, tasks, logs', accent: '#fcd34d' },
];

export const PLANE_BY_ID: Record<PlaneId, PlaneDef> = Object.fromEntries(
  PLANE_DEFS.map((p) => [p.id, p]),
) as Record<PlaneId, PlaneDef>;

export interface PlaneSet {
  id: PlaneSetId;
  label: string;
  blurb: string;
  /** Ordered top to bottom, the way the diagram is drawn. */
  planes: PlaneId[];
}

/**
 * Two ways to slice the Y axis, both of them Pete Hay's.
 *
 * `talk` is the one taught in "The Importance of Arts and Crafts in ThreatOps":
 * cluster artifacts by where you go looking for them, which means splitting the
 * network into what is inside and what is outside, and splitting the host into
 * memory and disk with the registry straddling the two.
 *
 * `domain` is the coarser slice the Arbitr platform later shipped, which suits
 * intelligence that crosses cloud and OT.
 *
 * Neither is canon. The talk is explicit that there are no artifact plane
 * police and that you should subdivide these to taste — adding a set here is
 * a few lines.
 */
export const PLANE_SETS: PlaneSet[] = [
  {
    id: 'talk',
    label: 'Artifact planes',
    blurb: 'Where you go looking: outside, inside, memory, disk',
    planes: [
      'adversary',
      'cloud',
      'external-network',
      'internal-network',
      'host-memory',
      'host-registry',
      'host-filesystem',
      'ot',
    ],
  },
  {
    id: 'domain',
    label: 'Technical domains',
    blurb: 'Cloud, network, hosts and operational technology',
    planes: ['adversary', 'cloud', 'network', 'host', 'ot'],
  },
];

export const PLANE_SET_BY_ID: Record<PlaneSetId, PlaneSet> = Object.fromEntries(
  PLANE_SETS.map((s) => [s.id, s]),
) as Record<PlaneSetId, PlaneSet>;

/** The ordered plane definitions of one set. */
export function planesFor(set: PlaneSetId): PlaneDef[] {
  return (PLANE_SET_BY_ID[set] ?? PLANE_SET_BY_ID.talk).planes.map((id) => PLANE_BY_ID[id]);
}

/** Every plane, for controls that must accept a value from either set. */
export const ALL_PLANES: PlaneDef[] = PLANE_DEFS;

export interface CategoryDef {
  id: CategoryId;
  label: string;
  plane: PlaneId;
  /**
   * Lower-case keywords used to classify free-text and to map foreign
   * vocabularies (STIX types, MISP attribute types, CSV `category` columns).
   * Matching is substring-based against a normalised string.
   */
  aliases: string[];
}

export const CATEGORIES: CategoryDef[] = [
  // ---- adversary -------------------------------------------------------
  { id: 'threat-actor', label: 'Threat actor', plane: 'adversary', aliases: ['threat-actor', 'intrusion-set', 'actor', 'adversary', 'apt', 'group'] },
  { id: 'campaign', label: 'Campaign', plane: 'adversary', aliases: ['campaign', 'operation'] },
  { id: 'tool', label: 'Tool', plane: 'adversary', aliases: ['tool', 'utility', 'framework', 'cobalt strike', 'mimikatz', 'psexec'] },
  { id: 'vulnerability', label: 'Vulnerability', plane: 'adversary', aliases: ['vulnerability', 'cve', 'weakness'] },
  { id: 'exploit', label: 'Exploit', plane: 'adversary', aliases: ['exploit', 'poc', 'proof-of-concept'] },

  // ---- cloud -----------------------------------------------------------
  { id: 'cloud-tenant', label: 'Cloud tenant', plane: 'cloud', aliases: ['tenant', 'subscription', 'aws account', 'cloud-account', 'project'] },
  { id: 'identity-provider', label: 'Identity provider', plane: 'cloud', aliases: ['identity-provider', 'idp', 'entra', 'azure ad', 'azuread', 'okta', 'sso', 'federation'] },
  { id: 'saas-app', label: 'SaaS application', plane: 'cloud', aliases: ['saas', 'application', 'app-registration', 'service-principal', 'sharepoint', 'salesforce', 'workspace'] },
  { id: 'cloud-storage', label: 'Cloud storage', plane: 'cloud', aliases: ['bucket', 's3', 'blob', 'cloud-storage', 'object-storage', 'onedrive', 'gdrive'] },
  { id: 'cloud-vm', label: 'Cloud instance', plane: 'cloud', aliases: ['ec2', 'instance', 'cloud-vm', 'compute-engine', 'virtual machine'] },
  { id: 'cloud-function', label: 'Serverless function', plane: 'cloud', aliases: ['lambda', 'function', 'serverless', 'cloud-function'] },
  { id: 'api-endpoint', label: 'API endpoint', plane: 'cloud', aliases: ['api', 'endpoint', 'graph api', 'rest'] },
  { id: 'oauth-grant', label: 'OAuth grant', plane: 'cloud', aliases: ['oauth', 'consent', 'refresh-token', 'access-token', 'grant'] },
  { id: 'cloud-role', label: 'Cloud role', plane: 'cloud', aliases: ['iam', 'role', 'policy', 'permission-set', 'assume-role'] },

  // ---- network ---------------------------------------------------------
  { id: 'domain', label: 'Domain', plane: 'network', aliases: ['domain', 'domain-name', 'hostname', 'fqdn'] },
  { id: 'ip-address', label: 'IP address', plane: 'network', aliases: ['ip', 'ipv4-addr', 'ipv6-addr', 'ip-dst', 'ip-src', 'address'] },
  { id: 'url', label: 'URL', plane: 'network', aliases: ['url', 'uri', 'hyperlink'] },
  { id: 'c2-server', label: 'C2 server', plane: 'network', aliases: ['c2', 'c&c', 'command-and-control', 'beacon', 'teamserver'] },
  { id: 'dns-record', label: 'DNS record', plane: 'network', aliases: ['dns', 'ns-record', 'txt-record', 'resolution'] },
  { id: 'email', label: 'Email message', plane: 'network', aliases: ['email', 'email-addr', 'message', 'phish', 'lure', 'attachment'] },
  { id: 'email-gateway', label: 'Email gateway', plane: 'network', aliases: ['mail-gateway', 'email-gateway', 'smtp', 'exchange', 'mta'] },
  { id: 'firewall', label: 'Firewall', plane: 'network', aliases: ['firewall', 'edge', 'ngfw', 'acl'] },
  { id: 'proxy', label: 'Proxy', plane: 'network', aliases: ['proxy', 'web-gateway', 'squid'] },
  { id: 'vpn', label: 'VPN', plane: 'network', aliases: ['vpn', 'remote-access', 'ssl-vpn', 'globalprotect', 'anyconnect'] },
  { id: 'router', label: 'Router / switch', plane: 'network', aliases: ['router', 'switch', 'gateway-device'] },
  { id: 'network-share', label: 'Network share', plane: 'network', aliases: ['share', 'smb', 'unc', 'nfs', 'admin$'] },
  { id: 'certificate', label: 'Certificate', plane: 'network', aliases: ['certificate', 'x509', 'tls-cert', 'ja3'] },
  { id: 'network-traffic', label: 'Network traffic', plane: 'network', aliases: ['network-traffic', 'flow', 'session', 'connection'] },

  // ---- hosts -----------------------------------------------------------
  { id: 'workstation', label: 'Workstation', plane: 'host', aliases: ['workstation', 'endpoint', 'laptop', 'desktop', 'client'] },
  { id: 'server', label: 'Server', plane: 'host', aliases: ['server', 'host', 'domain-controller', 'dc', 'hypervisor'] },
  { id: 'process', label: 'Process', plane: 'host', aliases: ['process', 'pid', 'command-line', 'cmdline'] },
  { id: 'file', label: 'File', plane: 'host', aliases: ['file', 'artifact', 'sha256', 'sha1', 'md5', 'hash', 'document'] },
  { id: 'script', label: 'Script', plane: 'host', aliases: ['script', 'powershell', 'vbs', 'bash', 'macro', 'jscript', 'python'] },
  { id: 'executable', label: 'Executable', plane: 'host', aliases: ['executable', 'binary', 'pe', 'elf', 'exe', 'dll'] },
  { id: 'registry-key', label: 'Registry key', plane: 'host', aliases: ['registry', 'regkey', 'hklm', 'hkcu', 'run-key'] },
  { id: 'scheduled-task', label: 'Scheduled task', plane: 'host', aliases: ['scheduled-task', 'schtask', 'cron', 'at-job', 'timer'] },
  { id: 'service', label: 'Service', plane: 'host', aliases: ['service', 'daemon', 'systemd', 'svc'] },
  { id: 'driver', label: 'Driver', plane: 'host', aliases: ['driver', 'sys-file', 'kernel-module', 'byovd'] },
  { id: 'credential', label: 'Credential', plane: 'host', aliases: ['credential', 'password', 'hash-dump', 'ntlm', 'kerberos', 'ticket', 'secret'] },
  { id: 'user-account', label: 'User account', plane: 'host', aliases: ['user', 'user-account', 'account', 'principal', 'sid', 'upn'] },
  { id: 'malware', label: 'Malware', plane: 'host', aliases: ['malware', 'implant', 'payload', 'loader', 'dropper', 'stealer', 'trojan'] },
  { id: 'ransomware', label: 'Ransomware', plane: 'host', aliases: ['ransomware', 'locker', 'encryptor'] },
  { id: 'backdoor', label: 'Backdoor', plane: 'host', aliases: ['backdoor', 'rat', 'remote-access-trojan', 'reverse-shell'] },
  { id: 'webshell', label: 'Web shell', plane: 'host', aliases: ['webshell', 'aspx-shell', 'jsp-shell', 'china chopper'] },
  { id: 'archive', label: 'Staged archive', plane: 'host', aliases: ['archive', 'zip', 'rar', '7z', 'staging', 'staged'] },
  { id: 'browser', label: 'Browser', plane: 'host', aliases: ['browser', 'chrome', 'firefox', 'edge-browser', 'cookie'] },
  { id: 'log-source', label: 'Log source', plane: 'host', aliases: ['log', 'sysmon', 'event-log', 'edr', 'siem', 'telemetry'] },

  // ---- malware internals ----------------------------------------------
  { id: 'thread', label: 'Thread', plane: 'host', aliases: ['thread', 'worker', 'worker-thread'] },
  { id: 'shellcode', label: 'Shellcode', plane: 'host', aliases: ['shellcode', 'payload-blob', 'stage', 'in-memory-payload', 'blob'] },
  { id: 'mutex', label: 'Mutex', plane: 'host', aliases: ['mutex', 'mutant', 'semaphore', 'single-instance'] },
  { id: 'shadow-copy', label: 'Shadow copy', plane: 'host', aliases: ['shadow-copy', 'shadow-copies', 'vss', 'restore-point', 'backup'] },
  { id: 'ransom-note', label: 'Ransom note', plane: 'host', aliases: ['ransom-note', 'ransom-notes', 'readme-note', 'extortion-note'] },
  { id: 'link-file', label: 'Shortcut file', plane: 'host', aliases: ['link-file', 'lnk', 'shortcut', 'lnk-file'] },

  // ---- operational technology -----------------------------------------
  { id: 'plc', label: 'PLC', plane: 'ot', aliases: ['plc', 'programmable logic', 'controller', 'rtu'] },
  { id: 'hmi', label: 'HMI', plane: 'ot', aliases: ['hmi', 'human-machine', 'operator-panel'] },
  { id: 'scada', label: 'SCADA', plane: 'ot', aliases: ['scada', 'dcs', 'control-server'] },
  { id: 'historian', label: 'Historian', plane: 'ot', aliases: ['historian', 'pi-server', 'process-data'] },
  { id: 'engineering-workstation', label: 'Engineering workstation', plane: 'ot', aliases: ['engineering-workstation', 'ews', 'tia portal', 'studio 5000'] },
  { id: 'sensor', label: 'Sensor', plane: 'ot', aliases: ['sensor', 'transmitter', 'field-device'] },
  { id: 'actuator', label: 'Actuator', plane: 'ot', aliases: ['actuator', 'valve', 'motor', 'relay', 'breaker'] },
  { id: 'safety-system', label: 'Safety system', plane: 'ot', aliases: ['safety', 'sis', 'triconex', 'esd'] },
  { id: 'protocol-gateway', label: 'Protocol gateway', plane: 'ot', aliases: ['modbus', 'dnp3', 'opc', 'protocol-gateway', 'profinet', 'ethernet/ip'] },

  // ---- fallback --------------------------------------------------------
  { id: 'unknown', label: 'Unclassified', plane: 'host', aliases: [] },
];

export const CATEGORY_BY_ID: Record<CategoryId, CategoryDef> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, CategoryDef>;

/** Categories grouped by their default plane, for the inspector's dropdown. */
export function categoriesByPlane(): { plane: PlaneDef; categories: CategoryDef[] }[] {
  return ALL_PLANES.map((plane) => ({
    plane,
    categories: CATEGORIES.filter((c) => c.plane === plane.id),
  }));
}

export interface RelationDef {
  id: RelationId;
  label: string;
  /** Behaviour family, used to colour the edge. */
  family: 'delivery' | 'execution' | 'network' | 'identity' | 'movement' | 'impact' | 'generic';
}

export const RELATIONS: RelationDef[] = [
  { id: 'delivers', label: 'delivers', family: 'delivery' },
  { id: 'downloads-from', label: 'downloads from', family: 'delivery' },
  { id: 'exploits', label: 'exploits', family: 'delivery' },
  { id: 'executes', label: 'executes', family: 'execution' },
  { id: 'spawns', label: 'spawns', family: 'execution' },
  { id: 'writes', label: 'writes', family: 'execution' },
  { id: 'reads', label: 'reads', family: 'execution' },
  { id: 'modifies', label: 'modifies', family: 'execution' },
  { id: 'deletes', label: 'deletes', family: 'impact' },
  { id: 'persists-via', label: 'persists via', family: 'execution' },
  { id: 'connects-to', label: 'connects to', family: 'network' },
  { id: 'resolves-to', label: 'resolves to', family: 'network' },
  { id: 'hosts', label: 'hosts', family: 'network' },
  { id: 'beacons-to', label: 'beacons to', family: 'network' },
  { id: 'uploads-to', label: 'uploads to', family: 'impact' },
  { id: 'exfiltrates-to', label: 'exfiltrates to', family: 'impact' },
  { id: 'authenticates-to', label: 'authenticates to', family: 'identity' },
  { id: 'escalates-to', label: 'escalates to', family: 'identity' },
  { id: 'impersonates', label: 'impersonates', family: 'identity' },
  { id: 'moves-laterally-to', label: 'moves laterally to', family: 'movement' },
  { id: 'pivots-to', label: 'pivots to', family: 'movement' },
  { id: 'discovers', label: 'discovers', family: 'movement' },
  { id: 'collects-from', label: 'collects from', family: 'impact' },
  { id: 'encrypts', label: 'encrypts', family: 'impact' },
  { id: 'contains', label: 'contains', family: 'generic' },
  { id: 'creates', label: 'creates', family: 'execution' },
  { id: 'decrypts', label: 'decrypts', family: 'execution' },
  { id: 'injects-into', label: 'injects into', family: 'execution' },
  { id: 'spawns-thread', label: 'spawns thread', family: 'execution' },
  { id: 'inhibits-recovery', label: 'inhibits recovery', family: 'impact' },
  { id: 'related-to', label: 'related to', family: 'generic' },
];

/**
 * Wording an analyst is likely to type that means an existing relation. Without
 * these an unrecognised verb quietly becomes "related to", which loses the one
 * thing the edge was carrying.
 */
export const RELATION_ALIASES: Record<string, RelationId> = {
  drops: 'writes',
  dropped: 'writes',
  'writes-to-disk': 'writes',
  enumerates: 'discovers',
  scans: 'discovers',
  sweeps: 'discovers',
  'spawns-worker': 'spawns-thread',
  'starts-thread': 'spawns-thread',
  'deletes-shadow-copies': 'inhibits-recovery',
  'destroys-backups': 'inhibits-recovery',
  'disables-recovery': 'inhibits-recovery',
  'unpacks-to': 'decrypts',
  deobfuscates: 'decrypts',
  'hollows': 'injects-into',
  'runs-in': 'injects-into',
  launches: 'executes',
  invokes: 'executes',
  'reaches-out-to': 'connects-to',
  'calls-back-to': 'beacons-to',
  'staged-to': 'uploads-to',
  'included-in': 'contains',
  'packed-in': 'contains',
};

/** Resolve a written verb to a relation, accepting the aliases above. */
export function matchRelation(raw: string | null | undefined): RelationId | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (!v) return null;
  const direct = RELATIONS.find((r) => r.id === v || r.label.replace(/\s+/g, '-') === v);
  if (direct) return direct.id;
  return RELATION_ALIASES[v] ?? null;
}

export const RELATION_BY_ID: Record<RelationId, RelationDef> = Object.fromEntries(
  RELATIONS.map((r) => [r.id, r]),
) as Record<RelationId, RelationDef>;

/**
 * A colour per tactic, running cool to warm along the ATT&CK order. The acts
 * band reads as a progression rather than as fourteen unrelated labels, which
 * is the point of naming the phases at all.
 */
export const TACTIC_COLOR: Record<Tactic, string> = {
  reconnaissance: '#38bdf8',
  'resource-development': '#22d3ee',
  'initial-access': '#2dd4bf',
  execution: '#4ade80',
  persistence: '#a3e635',
  'privilege-escalation': '#bef264',
  'defense-evasion': '#facc15',
  'credential-access': '#fbbf24',
  discovery: '#fb923c',
  'lateral-movement': '#f97316',
  collection: '#f87171',
  'command-and-control': '#f472b6',
  exfiltration: '#fb7185',
  impact: '#f43f5e',
};

export const RELATION_FAMILY_COLOR: Record<RelationDef['family'], string> = {
  delivery: '#c084fc',
  execution: '#fbbf24',
  network: '#2dd4bf',
  identity: '#38bdf8',
  movement: '#f97316',
  impact: '#f43f5e',
  generic: '#94a3b8',
};

export const TACTICS: { id: Tactic; label: string }[] = [
  { id: 'reconnaissance', label: 'Reconnaissance' },
  { id: 'resource-development', label: 'Resource Development' },
  { id: 'initial-access', label: 'Initial Access' },
  { id: 'execution', label: 'Execution' },
  { id: 'persistence', label: 'Persistence' },
  { id: 'privilege-escalation', label: 'Privilege Escalation' },
  { id: 'defense-evasion', label: 'Defense Evasion' },
  { id: 'credential-access', label: 'Credential Access' },
  { id: 'discovery', label: 'Discovery' },
  { id: 'lateral-movement', label: 'Lateral Movement' },
  { id: 'collection', label: 'Collection' },
  { id: 'command-and-control', label: 'Command and Control' },
  { id: 'exfiltration', label: 'Exfiltration' },
  { id: 'impact', label: 'Impact' },
];

export const CONFIDENCE_ORDER = ['confirmed', 'probable', 'possible', 'suspected'] as const;

/** Opacity applied to a node's border so lower confidence reads as fainter. */
export const CONFIDENCE_OPACITY: Record<string, number> = {
  confirmed: 1,
  probable: 0.8,
  possible: 0.6,
  suspected: 0.42,
};

/**
 * Best-effort mapping of an arbitrary type string onto a GIBSEN category.
 * Used by every parser, so a STIX `ipv4-addr`, a MISP `ip-dst` and a CSV cell
 * reading "IP Address" all land on the same category.
 */
export function matchCategory(raw: string | null | undefined): CategoryId | null {
  if (!raw) return null;
  const needle = raw.toLowerCase().trim().replace(/[_\s]+/g, '-');
  if (!needle) return null;

  // Exact category id wins outright.
  const exact = CATEGORIES.find((c) => c.id === needle);
  if (exact) return exact.id;

  // Then an exact alias hit.
  for (const c of CATEGORIES) {
    if (c.aliases.some((a) => a === needle)) return c.id;
  }

  // Finally a substring hit, longest alias first so `email-gateway` beats `email`.
  let best: { id: CategoryId; len: number } | null = null;
  for (const c of CATEGORIES) {
    for (const a of c.aliases) {
      if (a.length > 2 && needle.includes(a) && (!best || a.length > best.len)) {
        best = { id: c.id, len: a.length };
      }
    }
  }
  return best?.id ?? null;
}

/**
 * Where a category lands in the talk's finer-grained planes, for the cases the
 * coarse plane cannot imply. Everything else falls through to the defaults
 * below: network artifacts are external unless listed, host artifacts are on
 * disk unless listed.
 *
 * Hosts themselves sit in the internal network rather than in a host plane —
 * the talk lists "host, end point, file servers" among the network artifacts,
 * and reserves the host planes for what is found *on* a box: processes, user
 * context, registry, files.
 */
const TALK_PLANE: Partial<Record<CategoryId, PlaneId>> = {
  // Network kit you own, as opposed to infrastructure out on the internet.
  'network-share': 'internal-network',
  router: 'internal-network',
  firewall: 'internal-network',
  proxy: 'internal-network',
  vpn: 'internal-network',
  workstation: 'internal-network',
  server: 'internal-network',

  // Live on the box.
  process: 'host-memory',
  service: 'host-memory',
  driver: 'host-memory',
  credential: 'host-memory',
  'user-account': 'host-memory',
  malware: 'host-memory',
  backdoor: 'host-memory',

  // Genuinely both, so it is drawn on the line between them.
  'registry-key': 'host-registry',
};

/** The plane a category belongs to in a given set, unless the analyst moves it. */
export function planeFor(category: CategoryId, set: PlaneSetId = 'domain'): PlaneId {
  const base = CATEGORY_BY_ID[category]?.plane ?? 'host';
  if (set === 'domain') return base;

  const override = TALK_PLANE[category];
  if (override) return override;
  if (base === 'network') return 'external-network';
  if (base === 'host') return 'host-filesystem';
  return base;
}

/**
 * The plane a node is drawn in. A node keeps whichever plane it was given, so
 * an analyst's correction survives; when that plane is not part of the active
 * set, the category decides instead.
 */
export function resolvePlane(node: { category: CategoryId; plane: PlaneId }, set: PlaneSetId): PlaneId {
  const inSet = PLANE_SET_BY_ID[set]?.planes.includes(node.plane);
  return inSet ? node.plane : planeFor(node.category, set);
}

/** The plane an artifact is stored against. Canonical, and coarse. */
export function defaultPlaneFor(category: CategoryId): PlaneId {
  return CATEGORY_BY_ID[category]?.plane ?? 'host';
}
