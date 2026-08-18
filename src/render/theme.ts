/** Palettes for the diagram surface. Kept apart from the app chrome CSS so an
 * exported SVG carries its own colours and renders identically outside the app. */

export interface Theme {
  name: 'dark' | 'light';
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  grid: string;
  bandTint: string;
  bandTintAlt: string;
  extensionTint: string;
  danger: string;
  pivot: string;
  /** Marks an artifact the rest of the chain hangs on. */
  congruence: string;
}

export const DARK: Theme = {
  name: 'dark',
  bg: '#0b1120',
  surface: '#111c33',
  surfaceAlt: '#16233d',
  border: '#2a3a5c',
  text: '#e8eefc',
  textMuted: '#8ea2c6',
  grid: '#1d2b47',
  bandTint: '#0e1729',
  bandTintAlt: '#101c31',
  extensionTint: '#0d1424',
  danger: '#f43f5e',
  pivot: '#facc15',
  congruence: '#a3e635',
};

export const LIGHT: Theme = {
  name: 'light',
  bg: '#f7f9fc',
  surface: '#ffffff',
  surfaceAlt: '#eef2f9',
  border: '#c7d2e4',
  text: '#101a2e',
  textMuted: '#5b6b87',
  grid: '#dde4f0',
  bandTint: '#f1f5fb',
  bandTintAlt: '#e9eff8',
  extensionTint: '#f4f1fb',
  danger: '#dc2626',
  pivot: '#b45309',
  congruence: '#4d7c0f',
};

export function themeByName(name: string): Theme {
  return name === 'light' ? LIGHT : DARK;
}
