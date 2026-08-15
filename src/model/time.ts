/**
 * Timestamp normalisation.
 *
 * Lives in the model layer because both the parsers and the incident builders
 * depend on it: every `t` in an incident is a normalised ISO 8601 string, so
 * that plain string comparison is a valid chronological sort.
 */

/**
 * Parse a timestamp into an ISO 8601 string, or null if it is not a date.
 *
 * Two conventions matter here. A date with no time component is anchored at
 * midnight UTC, and a date-time with no zone is read as UTC rather than local —
 * otherwise the same report would lay out differently depending on where the
 * analyst happened to be sitting.
 */
export function parseTimestamp(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') return null;

  if (typeof raw === 'number' || /^\d{9,13}$/.test(String(raw).trim())) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    // 10-digit values are seconds, 13-digit are milliseconds.
    const ms = String(Math.trunc(n)).length <= 10 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  const s = String(raw).trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(s)) {
    const d = new Date(`${s.replace(' ', 'T')}Z`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
