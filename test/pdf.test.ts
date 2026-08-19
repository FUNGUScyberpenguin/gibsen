import { describe, expect, it } from 'vitest';
import { isPdf, joinPages, linesFromItems, type TextItem } from '../src/ingest/pdf';

const item = (str: string, x: number, y: number, width?: number): TextItem => ({
  str,
  transform: [10, 0, 0, 10, x, y],
  width: width ?? str.length * 5,
  height: 10,
});

describe('isPdf', () => {
  it('reads the magic number, not the extension', () => {
    expect(isPdf(new TextEncoder().encode('%PDF-1.7'))).toBe(true);
    expect(isPdf(new TextEncoder().encode('artifact,category'))).toBe(false);
    expect(isPdf(new Uint8Array([0x25, 0x50]))).toBe(false);
  });
});

describe('linesFromItems', () => {
  it('groups runs sharing a baseline and orders the page top to bottom', () => {
    const lines = linesFromItems([
      item('second line', 72, 700),
      item('first line', 72, 720),
      item('third line', 72, 680),
    ]);
    expect(lines).toEqual(['first line', 'second line', 'third line']);
  });

  it('puts back the space a PDF dropped between two runs', () => {
    // Two runs a word apart horizontally, with no whitespace of their own.
    const lines = linesFromItems([item('The loader', 72, 700, 50), item('was written', 130, 700, 55)]);
    expect(lines).toEqual(['The loader was written']);
  });

  it('does not weld a hyphenated or slashed token that really is adjacent', () => {
    const lines = linesFromItems([item('tickler', 72, 700, 35), item('.dll', 107, 700, 20)]);
    expect(lines).toEqual(['tickler.dll']);
  });

  it('tolerates a baseline wobble within a line', () => {
    const lines = linesFromItems([item('CVE-2024', 72, 700, 40), item('-1234', 112, 701.4, 25)]);
    expect(lines).toEqual(['CVE-2024-1234']);
  });
});

describe('joinPages', () => {
  const body = (n: number) => [`Body sentence ${n} of the report.`, `Continuing sentence ${n}.`];

  it('drops the running head and foot that repeat across pages', () => {
    const pages = [
      ['ACME THREAT REPORT', ...body(1), 'TLP:CLEAR'],
      ['ACME THREAT REPORT', ...body(2), 'TLP:CLEAR'],
      ['ACME THREAT REPORT', ...body(3), 'TLP:CLEAR'],
      ['ACME THREAT REPORT', ...body(4), 'TLP:CLEAR'],
    ];
    const { text, furnitureDropped } = joinPages(pages);

    expect(text).not.toContain('ACME THREAT REPORT');
    expect(text).not.toContain('TLP:CLEAR');
    expect(text).toContain('Body sentence 3 of the report.');
    expect(furnitureDropped).toBe(8);
  });

  it('drops bare page numbers', () => {
    const pages = [
      [...body(1), '1'],
      [...body(2), '2'],
      [...body(3), 'Page 3 of 3'],
    ];
    const { text } = joinPages(pages);
    expect(text.split('\n').filter((l) => /^(?:page\s*)?\d/i.test(l))).toEqual([]);
  });

  it('keeps a repeated line that lives in the body of the page', () => {
    // The same heading four times, but in the body of each page rather than in
    // its top or bottom margin: a real repetition, not a running head.
    const pages = [1, 2, 3, 4].map((n) => [
      'ACME THREAT REPORT',
      `Section ${n}`,
      `Opening prose for section ${n}.`,
      'Indicators of compromise',
      `example-${n}.test`,
      `More prose for section ${n}.`,
      `${n}`,
    ]);
    const { text } = joinPages(pages);

    expect(text).not.toContain('ACME THREAT REPORT');
    expect(text.match(/Indicators of compromise/g)?.length).toBe(4);
  });

  it('leaves the pages as paragraphs the narrative parser can read', () => {
    const { text } = joinPages([['A first sentence.'], ['A second sentence.']]);
    expect(text).toBe('A first sentence.\n\nA second sentence.');
  });

  it('does not break a sentence that runs across a page turn', () => {
    const { text } = joinPages([['The loader was written to disk and then'], ['injected into svchost.exe.']]);
    expect(text).toBe('The loader was written to disk and then\ninjected into svchost.exe.');
  });

  it('leaves fewer than three pages alone rather than guessing at furniture', () => {
    const pages = [['Acme', 'Body one.'], ['Acme', 'Body two.']];
    const { text, furnitureDropped } = joinPages(pages);
    expect(furnitureDropped).toBe(0);
    expect(text).toContain('Acme');
  });
});
