/**
 * How a label is cut down to fit a box.
 *
 * The diagram is a map, not a database dump: the box says which artifact this
 * is, and the record modal behind it carries the full value, the technical
 * detail, the logs and the commentary. So the rules here are allowed to
 * shorten — but only in ways that keep an artifact identifiable, and the page
 * always has to offer the rest somewhere.
 */

const WRAP_AT = ['\\', '/', '.', '-', '_'];

/** The path separator this label is actually built out of, if any. */
function separatorOf(text: string): string | null {
  const backslashes = (text.match(/\\/g) ?? []).length;
  const slashes = (text.match(/\//g) ?? []).length;
  if (backslashes === 0 && slashes === 0) return null;
  return backslashes >= slashes ? '\\' : '/';
}

/**
 * Shorten a long path-like label by dropping segments out of its middle rather
 * than chopping off its tail. A registry key elided at the end reads as an
 * unfamiliar hive; elided in the middle it still reads as the Run key it is.
 *
 * Splitting and rejoining on a single separator keeps the result a faithful
 * subsequence of the original — never a path that was never there.
 */
export function condenseLabel(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const sep = separatorOf(text);
  if (sep) {
    const segments = text.split(sep);
    // `https://host/a/b` splits to an empty second segment; keep the whole
    // authority as the head rather than stranding a lone `https:`.
    const headCount = segments[1] === '' ? 3 : 1;

    if (segments.length > headCount + 1) {
      const head = segments.slice(0, headCount).join(sep);
      for (let keep = segments.length - headCount - 1; keep >= 1; keep -= 1) {
        const candidate = `${head}${sep}…${sep}${segments.slice(-keep).join(sep)}`;
        if (candidate.length <= maxChars) return candidate;
      }
      const tailOnly = `…${sep}${segments[segments.length - 1]}`;
      if (tailOnly.length <= maxChars) return tailOnly;
    }
  }

  return `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

/** Greedy fill, breaking at the separators the label already has. */
function fill(text: string, maxChars: number, maxLines: number): string[] {
  if (text.length <= maxChars) return [text];

  const lines: string[] = [];
  let rest = text;

  while (rest.length > maxChars && lines.length < maxLines - 1) {
    // Only separators inside the line itself are candidates: breaking after
    // one at position `maxChars` would push the line a character over.
    const window = rest.slice(0, maxChars);
    const at = Math.max(...WRAP_AT.map((s) => window.lastIndexOf(s)));
    const cut = at > maxChars * 0.4 ? at + 1 : maxChars;
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }

  lines.push(rest.length > maxChars ? `${rest.slice(0, maxChars - 1)}…` : rest);
  return lines;
}

/**
 * Break a label across the lines a box has, condensing first if it will not
 * fit. Breaking at a separator leaves ragged ends, so the whole-label budget
 * is walked down until the wrap comes out lossless — one ellipsis in the
 * middle, where it is honest, rather than a second one at the end where it
 * looks like the value simply stops.
 */
export function wrapLabel(text: string, maxChars: number, maxLines: number): string[] {
  for (let budget = maxChars * maxLines; budget >= maxChars; budget -= 1) {
    const fitted = condenseLabel(text, budget);
    const lines = fill(fitted, maxChars, maxLines);
    if (lines.join('') === fitted) return lines;
  }
  return fill(condenseLabel(text, maxChars), maxChars, maxLines);
}

/** Was anything dropped to make the label fit? */
export function isCondensed(text: string, maxChars: number, maxLines: number): boolean {
  return wrapLabel(text, maxChars, maxLines).join('') !== text;
}
