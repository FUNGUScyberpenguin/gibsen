/**
 * GIBSEN iconology.
 *
 * Every artifact category gets a glyph drawn on a 24x24 grid as stroked
 * geometry using `currentColor`, so a node can recolour the icon by setting
 * `color` and nothing else. Keeping the glyphs stroke-only (no fills, no
 * external assets) is what lets an exported SVG stay self-contained and a
 * rasterised PNG stay crisp.
 *
 * To correct a glyph, edit only the string below — nothing else reads it.
 */

import type { CategoryId } from './types';

/** Shapes shared by several glyphs, kept here so they stay identical. */
const SHIELD = 'M12 3.2 19.4 6v5.9c0 4.2-3 7.2-7.4 8.8-4.4-1.6-7.4-4.6-7.4-8.8V6Z';
const PAGE = 'M6.5 3.4h6.6l4.4 4.4v12.8H6.5Z';
const PAGE_FOLD = 'M13.1 3.4v4.4h4.4';
const MONITOR = 'M3.4 5.2h17.2v10.4H3.4Z';
const MONITOR_STAND = 'M9.2 19.6h5.6M12 15.6v4';
const WINDOW = 'M3.4 5.2h17.2v13.6H3.4Z';
const WINDOW_BAR = 'M3.4 9.1h17.2';
const CLOUD = 'M7 18.2h9.8a3.4 3.4 0 0 0 .4-6.8A5 5 0 0 0 7.6 9.9 3.6 3.6 0 0 0 7 18.2Z';
const BOX_3D = 'M12 3.6 20 8v8l-8 4.4L4 16V8Z';

/**
 * Category glyphs. Anything missing falls back to `unknown`.
 */
export const ICONS: Record<CategoryId, string> = {
  // ---- adversary -------------------------------------------------------
  'threat-actor':
    '<circle cx="12" cy="8.6" r="3.4"/><path d="M5.4 20.2a6.6 6.6 0 0 1 13.2 0"/><path d="M9.4 7.6h5.2"/>',
  campaign: '<path d="M6 21V4"/><path d="M6 4.6h11.4l-2.6 3.8 2.6 3.8H6Z"/>',
  tool:
    '<path d="M15.2 3.6a5 5 0 0 0-5.9 6.6L3.6 15.9a2 2 0 0 0 2.8 2.8l5.7-5.7a5 5 0 0 0 6.6-5.9l-3 3-2.5-2.5Z"/>',
  vulnerability: `<path d="${SHIELD}"/><path d="M12.8 7.6 10 12.4h3.6L11.2 17"/>`,
  exploit: '<path d="M13.6 2.6 5.4 13.4h5.4L9.8 21.4 18.4 10h-5.6Z"/>',

  // ---- cloud -----------------------------------------------------------
  'cloud-tenant': `<path d="${CLOUD}"/><path d="M9.6 14.6h5.2"/>`,
  'identity-provider':
    '<circle cx="9.4" cy="11" r="3"/><path d="M12.4 11h8.2M18.2 11v3M20.6 11v2.4"/><path d="M4.4 19.4a5.4 5.4 0 0 1 10 0"/>',
  'saas-app': `<path d="${WINDOW}"/><path d="${WINDOW_BAR}"/><circle cx="6.4" cy="7.1" r=".8"/><path d="M9.4 12.6h6.4M9.4 15.6h4"/>`,
  'cloud-storage': '<path d="M4.4 6.4h15.2l-2 12.4H6.4Z"/><path d="M4.9 10.2h14.2"/>',
  'cloud-vm': `<path d="M3.6 8.4h16.8v10.2H3.6Z"/><path d="M7.4 8.4V6a2.6 2.6 0 0 1 5.2 0"/><path d="M7.6 12.4h8.8M7.6 15.4h5.4"/>`,
  'cloud-function': '<circle cx="12" cy="12" r="8.6"/><path d="M8.4 16.8 13 7.6a1.8 1.8 0 0 1 3.2 0"/><path d="M10.2 11.4 15.8 16.8"/>',
  'api-endpoint':
    '<path d="M9 4.4c-2.4 0-2.4 6-4.6 7.6 2.2 1.6 2.2 7.6 4.6 7.6"/><path d="M15 4.4c2.4 0 2.4 6 4.6 7.6-2.2 1.6-2.2 7.6-4.6 7.6"/>',
  'oauth-grant':
    '<circle cx="8.4" cy="12" r="3.4"/><path d="M11.8 12H20M17.4 12v3M20 12v2.6"/><path d="M8.4 10.6v2.8"/>',
  'cloud-role': `<path d="${SHIELD}"/><circle cx="12" cy="10.4" r="2.2"/><path d="M8.4 16.6a3.8 3.8 0 0 1 7.2 0"/>`,

  // ---- network ---------------------------------------------------------
  domain:
    '<circle cx="12" cy="12" r="8.6"/><path d="M3.4 12h17.2"/><path d="M12 3.4c2.6 2.6 2.6 14.6 0 17.2M12 3.4c-2.6 2.6-2.6 14.6 0 17.2"/>',
  'ip-address': '<path d="M3.4 6.6h17.2v10.8H3.4Z"/><path d="M7 10.4v3.2M10.6 10.4v3.2M14.2 10.4v3.2M17.8 10.4v3.2"/>',
  url:
    '<path d="M10.4 13.6a3.6 3.6 0 0 0 5.2 0l2.6-2.6a3.6 3.6 0 1 0-5.2-5.2l-1.3 1.3"/><path d="M13.6 10.4a3.6 3.6 0 0 0-5.2 0l-2.6 2.6a3.6 3.6 0 1 0 5.2 5.2l1.3-1.3"/>',
  'c2-server':
    '<path d="M12 21V11.6"/><circle cx="12" cy="9" r="2"/><path d="M7.8 13.2a6 6 0 0 1 0-8.4M16.2 4.8a6 6 0 0 1 0 8.4"/><path d="M9.6 21h4.8"/>',
  'dns-record':
    '<circle cx="12" cy="12" r="8.6"/><path d="M3.6 10.4h16.8M3.6 14.4h16.8"/><path d="M14.4 8.4 17.6 12l-3.2 3.6"/>',
  email: '<path d="M3.4 6.2h17.2v11.6H3.4Z"/><path d="m3.9 6.8 8.1 6 8.1-6"/>',
  'email-gateway': '<path d="M3.4 6.2h12.4v9.4H3.4Z"/><path d="m3.9 6.8 5.9 4.4 5.9-4.4"/><path d="M18.4 4.4v15.2M21 4.4v15.2"/>',
  firewall:
    '<path d="M3.4 5.6h17.2v12.8H3.4Z"/><path d="M3.4 9.9h17.2M3.4 14.1h17.2"/><path d="M9 5.6v4.3M15 5.6v4.3M6 9.9v4.2M12 9.9v4.2M18 9.9v4.2M9 14.1v4.3M15 14.1v4.3"/>',
  proxy: '<path d="M6.6 8.4h10.8v7.2H6.6Z"/><path d="M2.6 12h4M17.4 12h4"/><path d="M4.6 10v4M19.4 10v4"/>',
  vpn:
    '<path d="M4.4 18.6a7.6 7.6 0 0 1 15.2 0"/><path d="M9 18.6v-3.2a3 3 0 0 1 6 0v3.2"/><path d="M8.2 18.6h7.6v2.4H8.2Z"/>',
  router:
    '<path d="M3.4 12.8h17.2v5.8H3.4Z"/><path d="M6.4 15.7h1.6M10.2 15.7h1.6"/><path d="M8 10.4 12 6.4l4 4"/><path d="M12 6.4v4.4"/>',
  'network-share':
    '<path d="M3.4 7.4h6.2l1.8 2.2h9.2v9.4H3.4Z"/><circle cx="8" cy="14.6" r="1.4"/><circle cx="16" cy="14.6" r="1.4"/><path d="M9.4 14.6h5.2"/>',
  certificate:
    '<path d="M4.4 4.4h15.2v11.2H4.4Z"/><path d="M8 8h8M8 11.4h5"/><path d="m10 15.6-1 5 3-1.8 3 1.8-1-5"/>',
  'network-traffic': '<path d="M4 8.6h13.2l-3-3M20 15.4H6.8l3 3"/>',

  // ---- hosts -----------------------------------------------------------
  workstation: `<path d="${MONITOR}"/><path d="${MONITOR_STAND}"/><path d="M7 8.6h6"/>`,
  server:
    '<path d="M3.6 4.4h16.8v6H3.6Z"/><path d="M3.6 13.6h16.8v6H3.6Z"/><circle cx="7" cy="7.4" r=".9"/><circle cx="7" cy="16.6" r=".9"/><path d="M10.4 7.4h6.6M10.4 16.6h6.6"/>',
  process:
    '<circle cx="12" cy="12" r="3.3"/><path d="M12 3.4v2.7M12 17.9v2.7M20.6 12h-2.7M6.1 12H3.4M18.1 5.9l-1.9 1.9M7.8 16.2l-1.9 1.9M18.1 18.1l-1.9-1.9M7.8 7.8 5.9 5.9"/>',
  file: `<path d="${PAGE}"/><path d="${PAGE_FOLD}"/>`,
  script: `<path d="${PAGE}"/><path d="${PAGE_FOLD}"/><path d="m11 12.4-1.8 2 1.8 2M14 12.4l1.8 2-1.8 2"/>`,
  executable: `<path d="${PAGE}"/><path d="${PAGE_FOLD}"/><path d="m9.6 12.6 2.6 1.8-2.6 1.8Z"/><path d="M13.4 16.2h2.6"/>`,
  'registry-key':
    '<path d="M4.4 5.4h15.2v13.2H4.4Z"/><path d="M4.4 9h15.2"/><circle cx="12" cy="13" r="1.8"/><path d="M12 14.8v2.4"/>',
  'scheduled-task': '<circle cx="12" cy="12" r="8.6"/><path d="M12 6.8V12l3.6 2.2"/>',
  service:
    '<path d="M4.4 4.6h15.2v14.8H4.4Z"/><circle cx="12" cy="12" r="2.6"/><path d="M12 6.6v2M12 15.4v2M17.4 12h-2M8.6 12h-2"/>',
  driver:
    '<path d="M7.4 7.4h9.2v9.2H7.4Z"/><path d="M10.4 3.6v3.8M13.6 3.6v3.8M10.4 16.6v3.8M13.6 16.6v3.8M3.6 10.4h3.8M3.6 13.6h3.8M16.6 10.4h3.8M16.6 13.6h3.8"/>',
  credential:
    '<circle cx="8.2" cy="12" r="3.6"/><path d="M11.8 12h8.6M17.6 12v3.2M20.4 12v2.6"/>',
  'user-account': '<circle cx="12" cy="9" r="3.4"/><path d="M5.4 20.4a6.6 6.6 0 0 1 13.2 0"/>',
  malware:
    '<path d="M8 11.4a4 4 0 0 1 8 0v2.8a4 4 0 0 1-8 0Z"/><path d="M8 11.6H4.4M16 11.6h3.6M8 15.4H5M16 15.4h3M9.6 8 8 5.8M14.4 8 16 5.8"/>',
  ransomware:
    '<path d="M5.4 10.6h13.2v9H5.4Z"/><path d="M8.6 10.6V8a3.4 3.4 0 0 1 6.8 0v2.6"/><circle cx="12" cy="14.4" r="1.3"/><path d="M12 15.7v1.8"/>',
  backdoor:
    '<path d="M5.4 3.6h9.2v16.8H5.4Z"/><path d="M14.6 6.6 18.6 5v14l-4 1.4"/><circle cx="12.4" cy="12.4" r=".9"/>',
  webshell: `<path d="${WINDOW}"/><path d="${WINDOW_BAR}"/><path d="m8 12.2 2 2-2 2M11.8 16.2h4.4"/>`,
  archive:
    '<path d="M3.6 4.6h16.8v4H3.6Z"/><path d="M5.2 8.6h13.6v10.8H5.2Z"/><path d="M10.4 4.6v14.8M13.6 4.6v14.8"/>',
  browser: `<path d="${WINDOW}"/><path d="${WINDOW_BAR}"/><path d="M8.4 5.2v3.9M13.4 5.2v3.9"/>`,
  'log-source': `<path d="${PAGE}"/><path d="${PAGE_FOLD}"/><path d="M9 11.6h6M9 14.2h6M9 16.8h3.6"/>`,

  // ---- malware internals ----------------------------------------------
  thread:
    '<circle cx="12" cy="3.8" r="1.5"/><path d="M12 5.3v3.6"/>' +
    '<path d="M12 8.9c0 3.5-4.5 3.5-4.5 6.9v3.4"/><path d="M12 8.9c0 3.5 4.5 3.5 4.5 6.9v3.4"/>' +
    '<circle cx="7.5" cy="20.2" r="1.5"/><circle cx="16.5" cy="20.2" r="1.5"/>',
  shellcode:
    '<path d="M4.4 6.4h15.2v11.2H4.4Z"/>' +
    '<path d="M7.2 9.9h2.1M11 9.9h2.1M14.8 9.9h2.1M7.2 14.1h2.1M11 14.1h2.1M14.8 14.1h2.1"/>',
  mutex:
    '<path d="M5.2 5.2h13.6v13.6H5.2Z"/><circle cx="12" cy="12" r="2.7"/>' +
    '<path d="M12 5.2v2.6M12 16.2v2.6"/>',
  'shadow-copy':
    '<path d="M4.6 4.6h7l3.4 3.4v9.4H4.6Z" stroke-dasharray="3 2" stroke-opacity="0.6"/>' +
    `<path d="M9 8.6h7l3.4 3.4v9.4H9Z"/><path d="M16 8.6v3.4h3.4"/>`,
  'ransom-note': `<path d="${PAGE}"/><path d="${PAGE_FOLD}"/><path d="M12 11v3.8"/><circle cx="12" cy="17.2" r=".9"/>`,
  'link-file':
    `<path d="${PAGE}"/><path d="${PAGE_FOLD}"/>` +
    '<path d="M9.2 17.6c0-2.7 1.9-4.4 4.6-4.4"/><path d="m11.5 10.9 2.5 2.3-2.5 2.3"/>',

  // ---- operational technology -----------------------------------------
  plc:
    '<path d="M5.4 6.4h13.2v11.2H5.4Z"/><path d="M8.4 6.4V3.6M12 6.4V3.6M15.6 6.4V3.6M8.4 17.6v2.8M12 17.6v2.8M15.6 17.6v2.8"/><path d="M8.6 10h6.8M8.6 13.4h4"/>',
  hmi: `<path d="${MONITOR}"/><path d="${MONITOR_STAND}"/><path d="M12 13a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z"/><path d="M12 10.4 13.8 8.6"/>`,
  scada:
    '<path d="M3.4 4.4h8.2v6.4H3.4Z"/><path d="M12.4 4.4h8.2v6.4h-8.2Z"/><path d="M7.6 10.8v3.4h8.8v-3.4"/><path d="M12 14.2v5.4"/><path d="M8.4 19.6h7.2"/>',
  historian:
    '<path d="M12 3.8c4.2 0 7 1 7 2.2s-2.8 2.2-7 2.2-7-1-7-2.2 2.8-2.2 7-2.2Z"/><path d="M5 6v12c0 1.2 2.8 2.2 7 2.2s7-1 7-2.2V6"/><path d="M5 12.2c0 1.2 2.8 2.2 7 2.2s7-1 7-2.2"/>',
  'engineering-workstation': `<path d="${MONITOR}"/><path d="${MONITOR_STAND}"/><path d="M14.4 7.2a2.6 2.6 0 0 0-3.1 3.4l-2.9 2.9 1.5 1.5 2.9-2.9a2.6 2.6 0 0 0 3.4-3.1l-1.6 1.6-1.3-1.3Z"/>`,
  sensor:
    '<circle cx="12" cy="12" r="2.4"/><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 15.8a5.4 5.4 0 0 0 0-7.6"/><path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 18.4a9 9 0 0 0 0-12.8"/>',
  actuator:
    '<circle cx="12" cy="12" r="3.4"/><path d="M12 8.6V4.4M12 15.4v4.2M8.6 12H4.4M15.4 12h4.2"/><path d="M9.4 4.4h5.2M9.4 19.6h5.2"/>',
  'safety-system': `<path d="${SHIELD}"/><path d="M12 8v4.4"/><circle cx="12" cy="15.6" r=".9"/>`,
  'protocol-gateway':
    '<path d="M2.6 8.4h6.4v7.2H2.6Z"/><path d="M15 8.4h6.4v7.2H15Z"/><path d="M9.4 10.6h5.2l-1.6-1.6M14.6 13.4H9.4l1.6 1.6"/>',

  // ---- fallback --------------------------------------------------------
  unknown: `<path d="${BOX_3D}"/><path d="M10.4 10.2a1.7 1.7 0 1 1 2.4 1.6c-.5.3-.8.8-.8 1.4v.4"/><circle cx="12" cy="16" r=".8"/>`,
};

/** Inner SVG markup for a category, falling back to the `unknown` glyph. */
export function iconFor(category: CategoryId): string {
  return ICONS[category] ?? ICONS.unknown;
}
