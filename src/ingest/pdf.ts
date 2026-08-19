/**
 * PDF text extraction.
 *
 * Threat intelligence arrives as a PDF far more often than as anything a
 * machine wants to read, so the alternative to this module is an analyst
 * copy-pasting a vendor report a page at a time.
 *
 * A PDF has no paragraphs — it has glyphs at coordinates. Everything here is
 * about putting the structure back, because the narrative parser downstream
 * reads paragraphs for the clock and sentences for the verbs, and a report
 * flattened into one long line tells it nothing.
 *
 * pdf.js itself is loaded on demand: it is by far the largest thing in the
 * project, and someone dropping a CSV should never pay for it.
 */

/** One positioned run of text, as pdf.js hands it over. */
export interface TextItem {
  str: string;
  /** [a, b, c, d, x, y] — only the translation matters here. */
  transform: number[];
  width?: number;
  height?: number;
}

export interface PdfText {
  text: string;
  pages: number;
  /** Lines dropped as running heads, feet or page numbers. */
  furnitureDropped: number;
}

/** `%PDF-` at the head of the file. Extensions lie; the magic number does not. */
export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

/**
 * Rebuild lines from positioned runs.
 *
 * Items sharing a baseline are one line; a horizontal gap wider than a space
 * is a space, because PDFs frequently emit "Kettle" and "Update" as separate
 * runs with no whitespace between them and a naive join welds them together.
 */
export function linesFromItems(items: TextItem[], tolerance = 2.5): string[] {
  const rows: { y: number; items: TextItem[] }[] = [];

  for (const item of items) {
    if (!item.str) continue;
    const y = item.transform[5];
    const row = rows.find((r) => Math.abs(r.y - y) <= tolerance);
    if (row) row.items.push(item);
    else rows.push({ y, items: [item] });
  }

  // Top of the page downwards, then left to right within each line.
  rows.sort((a, b) => b.y - a.y);

  return rows
    .map((row) => {
      const sorted = [...row.items].sort((a, b) => a.transform[4] - b.transform[4]);
      let line = '';
      let cursor = Number.NEGATIVE_INFINITY;

      for (const item of sorted) {
        const x = item.transform[4];
        const gap = x - cursor;
        // A gap of roughly a character means a space the encoding left out.
        const space = (item.height ?? 10) * 0.22;
        if (line && gap > space && !line.endsWith(' ') && !item.str.startsWith(' ')) line += ' ';
        line += item.str;
        cursor = x + (item.width ?? item.str.length * (item.height ?? 10) * 0.5);
      }
      return line.replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean);
}

/** Lines that repeat across most pages are furniture, not content. */
function furniture(pages: string[][]): Set<string> {
  const marks = new Set<string>();
  if (pages.length < 3) return marks;

  const counts = new Map<string, number>();
  for (const page of pages) {
    // Only the top and bottom of a page hold running heads and feet; a line
    // repeated in the body is a real repetition and has to survive.
    const edges = [...page.slice(0, 2), ...page.slice(-2)];
    for (const line of new Set(edges)) counts.set(line, (counts.get(line) ?? 0) + 1);
  }

  const threshold = Math.max(2, Math.ceil(pages.length * 0.6));
  for (const [line, count] of counts) {
    if (count >= threshold) marks.add(line);
  }
  return marks;
}

/** A bare page number, with or without decoration. */
function isPageNumber(line: string): boolean {
  return /^(?:page\s*)?\d{1,4}(?:\s*(?:\/|of)\s*\d{1,4})?$/i.test(line.trim());
}

/**
 * Stitch pages into prose.
 *
 * A line that ends mid-sentence is a wrapped line and stays a line; a blank
 * line marks a paragraph. The narrative parser rejoins wrapped lines itself,
 * so the only thing that must be right here is where the paragraphs break.
 */
export function joinPages(pages: string[][]): { text: string; furnitureDropped: number } {
  const marks = furniture(pages);
  let dropped = 0;
  const out: string[] = [];

  pages.forEach((page, index) => {
    const kept = page.filter((line) => {
      if (marks.has(line) || isPageNumber(line)) {
        dropped += 1;
        return false;
      }
      return true;
    });
    if (!kept.length) return;

    // A page break is a paragraph break unless the previous page ended
    // mid-sentence, in which case the sentence continues across it and the
    // two halves have to stay on adjacent lines.
    if (index > 0 && out.length) {
      const previous = out[out.length - 1];
      if (previous !== '' && /[.!?:;]$/.test(previous)) out.push('');
    }

    for (const line of kept) {
      // A heading, a bullet or a short line ending a paragraph gets air around
      // it so the parser does not glue it to the next sentence.
      const last = out.length ? out[out.length - 1] : '';
      const startsBlock = /^(?:[•\-–*]\s|\d+[.)]\s|[A-Z][A-Za-z0-9 ]{0,60}$)/.test(line);
      if (startsBlock && last && last !== '' && /[.!?]$/.test(last)) out.push('');
      out.push(line);
    }
  });

  const text = out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, furnitureDropped: dropped };
}

/**
 * Read a PDF into text. Loads pdf.js lazily, so the parser bundle only lands
 * in the browser when somebody actually drops a PDF.
 */
export async function extractPdfText(data: ArrayBuffer): Promise<PdfText> {
  const pdfjs = await import('pdfjs-dist');
  // The worker ships beside the library; resolving it through `import.meta.url`
  // keeps the whole thing self-hosted with no CDN in the picture.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

  const task = pdfjs.getDocument({ data, useSystemFonts: true });
  const doc = await task.promise;
  const pageCount = doc.numPages;
  const pages: string[][] = [];

  for (let n = 1; n <= pageCount; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    pages.push(linesFromItems(content.items as unknown as TextItem[]));
    page.cleanup();
  }

  const { text, furnitureDropped } = joinPages(pages);
  await task.destroy();
  return { text, pages: pageCount, furnitureDropped };
}
