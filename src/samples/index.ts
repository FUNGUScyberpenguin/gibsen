/** Sample documents, inlined at build time so the studio works offline. */

import report from '../../samples/incident-report.md?raw';
import stix from '../../samples/stix-bundle.json?raw';
import csv from '../../samples/artifacts.csv?raw';
import malwarePath from '../../samples/malware-path.csv?raw';

export interface Sample {
  id: string;
  label: string;
  filename: string;
  description: string;
  content: string;
}

export const SAMPLES: Sample[] = [
  {
    id: 'report',
    label: 'Narrative report',
    filename: 'incident-report.md',
    description: 'Prose incident summary — exercises timestamp tracking and IOC extraction.',
    content: report,
  },
  {
    id: 'csv',
    label: 'Analyst spreadsheet',
    filename: 'artifacts.csv',
    description: 'Hand-built artifact table with explicit planes, tactics and relationships.',
    content: csv,
  },
  {
    id: 'malware-path',
    label: 'Malware path',
    filename: 'malware-path.csv',
    description: 'One binary end to end: delivery, in memory, across the wire, through to exfil and encryption.',
    content: malwarePath,
  },
  {
    id: 'stix',
    label: 'STIX 2.1 bundle',
    filename: 'stix-bundle.json',
    description: 'Observables, relationships, an indicator pattern and a sighting.',
    content: stix,
  },
];
