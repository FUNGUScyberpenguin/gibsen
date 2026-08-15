/**
 * Core GIBSEN data model.
 *
 * GIBSEN (Graphical Information Base for Security Event Notation) is a visual
 * language for incident narrative, devised by Pete Hay of Arbitr Security. A
 * diagram is a time-driven map of the artifacts, processes and behaviours seen
 * in one incident, laid out across technical planes.
 *
 * The shapes below are the on-disk format too: `Incident` serialises directly
 * to a `.gibsen.json` file and reads back without a migration step.
 */

/** Technical planes a diagram is divided into, top to bottom. */
export type PlaneId = 'adversary' | 'cloud' | 'network' | 'host' | 'ot';

/** How much an analyst is willing to stand behind an artifact or link. */
export type Confidence = 'confirmed' | 'probable' | 'possible' | 'suspected';

/** Where a node's timestamp came from. */
export type TimeBasis = 'observed' | 'inferred' | 'unknown';

/** ATT&CK tactic, used as the phase axis of the incident narrative. */
export type Tactic =
  | 'reconnaissance'
  | 'resource-development'
  | 'initial-access'
  | 'execution'
  | 'persistence'
  | 'privilege-escalation'
  | 'defense-evasion'
  | 'credential-access'
  | 'discovery'
  | 'lateral-movement'
  | 'collection'
  | 'command-and-control'
  | 'exfiltration'
  | 'impact';

/**
 * Artifact category. Drives the icon, the default plane and the colour family.
 * Categories are deliberately concrete — an analyst should be able to point at
 * a glyph and say what it is without a legend.
 */
export type CategoryId =
  // adversary / context
  | 'threat-actor'
  | 'campaign'
  | 'tool'
  | 'vulnerability'
  | 'exploit'
  // cloud
  | 'cloud-tenant'
  | 'identity-provider'
  | 'saas-app'
  | 'cloud-storage'
  | 'cloud-vm'
  | 'cloud-function'
  | 'api-endpoint'
  | 'oauth-grant'
  | 'cloud-role'
  // network
  | 'domain'
  | 'ip-address'
  | 'url'
  | 'c2-server'
  | 'dns-record'
  | 'email'
  | 'email-gateway'
  | 'firewall'
  | 'proxy'
  | 'vpn'
  | 'router'
  | 'network-share'
  | 'certificate'
  | 'network-traffic'
  // hosts
  | 'workstation'
  | 'server'
  | 'process'
  | 'file'
  | 'script'
  | 'executable'
  | 'registry-key'
  | 'scheduled-task'
  | 'service'
  | 'driver'
  | 'credential'
  | 'user-account'
  | 'malware'
  | 'ransomware'
  | 'backdoor'
  | 'webshell'
  | 'archive'
  | 'browser'
  | 'log-source'
  // operational technology
  | 'plc'
  | 'hmi'
  | 'scada'
  | 'historian'
  | 'engineering-workstation'
  | 'sensor'
  | 'actuator'
  | 'safety-system'
  | 'protocol-gateway'
  // fallback
  | 'unknown';

/** Verb on an edge — what one artifact did to or with another. */
export type RelationId =
  | 'delivers'
  | 'executes'
  | 'spawns'
  | 'writes'
  | 'reads'
  | 'modifies'
  | 'deletes'
  | 'connects-to'
  | 'resolves-to'
  | 'hosts'
  | 'beacons-to'
  | 'downloads-from'
  | 'uploads-to'
  | 'exfiltrates-to'
  | 'authenticates-to'
  | 'escalates-to'
  | 'moves-laterally-to'
  | 'pivots-to'
  | 'exploits'
  | 'encrypts'
  | 'impersonates'
  | 'persists-via'
  | 'discovers'
  | 'collects-from'
  | 'related-to';

/** A pointer back to the evidence behind an artifact. */
export interface LogRef {
  /** Where the line came from, e.g. "EDR", "Zeek conn.log", "AzureAD SignInLogs". */
  source: string;
  /** ISO 8601 timestamp of the log line, when known. */
  timestamp?: string | null;
  /** The raw line, query or excerpt. */
  excerpt: string;
}

/**
 * One artifact in the incident: a node in the diagram and a record in the
 * incident database. The `details`, `logs` and `commentary` fields are what
 * turn a picture into a report.
 */
export interface GibsenNode {
  id: string;
  /** Short human label rendered on the node, e.g. `svchost.exe` or `10.4.2.7`. */
  label: string;
  category: CategoryId;
  plane: PlaneId;
  /** ISO 8601 timestamp; `null` means the artifact is not yet sequenced. */
  t: string | null;
  timeBasis: TimeBasis;
  confidence: Confidence;
  tactic?: Tactic | null;
  /** ATT&CK technique IDs, e.g. `["T1059.001"]`. */
  techniques: string[];
  /** Free-form technical attributes: hashes, ports, users, command lines. */
  details: Record<string, string>;
  logs: LogRef[];
  /** Analyst narrative — why this artifact matters to the story. */
  commentary: string;
  /** True when this artifact is known to be attacker-controlled or compromised. */
  compromised: boolean;
  /** True for the artifact the investigation started from. */
  pivot: boolean;
  /** IDs of `SourceRef`s this node was derived from. */
  sources: string[];
}

/** A behaviour linking two artifacts. */
export interface GibsenEdge {
  id: string;
  from: string;
  to: string;
  relation: RelationId;
  /** Optional override label; falls back to the relation's display name. */
  label?: string;
  /** ISO 8601 timestamp of the behaviour, when it differs from the endpoints. */
  t?: string | null;
  confidence: Confidence;
  commentary?: string;
  sources: string[];
}

/** A file or paste that was ingested, kept for provenance. */
export interface SourceRef {
  id: string;
  name: string;
  /** Which parser claimed it. */
  format: 'stix' | 'misp' | 'csv' | 'text' | 'gibsen';
  ingestedAt: string;
  /** Node count contributed, for the source list in the UI. */
  nodeCount: number;
}

export interface Incident {
  /** Format marker so `.gibsen.json` files are self-identifying. */
  gibsen: 1;
  id: string;
  name: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  nodes: GibsenNode[];
  edges: GibsenEdge[];
  sources: SourceRef[];
}

/** Everything a parser hands back before it is merged into an incident. */
export interface IngestResult {
  nodes: GibsenNode[];
  edges: GibsenEdge[];
  source: SourceRef;
  /** Non-fatal problems worth showing the analyst. */
  warnings: string[];
}
