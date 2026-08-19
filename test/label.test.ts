import { describe, expect, it } from 'vitest';
import { condenseLabel, isCondensed, wrapLabel } from '../src/render/label';
import { hasDeeperRecord, detailEntries } from '../src/model/record';
import { makeNode, resetIds } from '../src/model/incident';

describe('condenseLabel', () => {
  it('leaves a label that already fits alone', () => {
    expect(condenseLabel('mshta.exe', 40)).toBe('mshta.exe');
  });

  it('drops the middle of a registry path, not its tail', () => {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\KettleUpdate';
    const short = condenseLabel(key, 40);

    expect(short.length).toBeLessThanOrEqual(40);
    // The part that identifies the artifact survives at both ends.
    expect(short.startsWith('HKCU\\')).toBe(true);
    expect(short.endsWith('Run\\KettleUpdate')).toBe(true);
    expect(short).toContain('…');
  });

  it('keeps as many trailing segments as the budget allows', () => {
    const path = 'C:\\Users\\jdoe\\AppData\\Local\\Temp\\stage\\tickler.dll';
    expect(condenseLabel(path, 30)).toBe('C:\\…\\Temp\\stage\\tickler.dll');
    expect(condenseLabel(path, 18)).toBe('C:\\…\\tickler.dll');
  });

  it('keeps a URL authority together rather than stranding the scheme', () => {
    const url = 'https://cdn.kettle-invoices.top/a/b/c/d/invoice-4417.zip';
    const short = condenseLabel(url, 55);

    expect(short.startsWith('https://cdn.kettle-invoices.top/')).toBe(true);
    expect(short.length).toBeLessThanOrEqual(55);
    expect(short.endsWith('invoice-4417.zip')).toBe(true);
  });

  it('falls back to a trailing ellipsis when there is no path to cut', () => {
    const hash = 'a'.repeat(64);
    expect(condenseLabel(hash, 12)).toBe(`${'a'.repeat(11)}…`);
  });

  it('never invents a separator that was not in the original', () => {
    const path = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    expect(condenseLabel(path, 30)).not.toContain('/');
  });
});

describe('wrapLabel', () => {
  it('breaks at the separators the label already has', () => {
    const lines = wrapLabel('C:\\Users\\jdoe\\AppData\\Local\\Temp\\tickler.dll', 24, 2);
    expect(lines.length).toBe(2);
    expect(lines.join('')).toBe('C:\\Users\\jdoe\\AppData\\Local\\Temp\\tickler.dll');
    expect(lines[0].endsWith('\\')).toBe(true);
  });

  it('condenses first when the whole value cannot fit the lines available', () => {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\KettleUpdate';
    const lines = wrapLabel(key, 20, 2);

    expect(lines.length).toBeLessThanOrEqual(2);
    lines.forEach((line) => expect(line.length).toBeLessThanOrEqual(20));
    expect(lines.join('')).toContain('…');
    expect(isCondensed(key, 20, 2)).toBe(true);
  });

  it('reports nothing lost when the label fits', () => {
    expect(isCondensed('svchost.exe', 24, 2)).toBe(false);
  });
});

describe('hasDeeperRecord', () => {
  it('is true when the box had to shorten the label', () => {
    resetIds();
    const node = makeNode({ label: 'C:\\Users\\jdoe\\AppData\\Local\\Temp\\tickler.dll', category: 'file' });
    expect(hasDeeperRecord(node, 'C:\\…\\tickler.dll')).toBe(true);
    expect(hasDeeperRecord(node, node.label)).toBe(false);
  });

  it('ignores a detail that only repeats the label', () => {
    resetIds();
    const node = makeNode({ label: '203.0.113.44', category: 'ip-address', details: { value: '203.0.113.44' } });
    expect(hasDeeperRecord(node, node.label)).toBe(false);
    expect(detailEntries(node)).toEqual([]);
  });

  it('is true for commentary, logs, techniques or real detail', () => {
    resetIds();
    expect(hasDeeperRecord(makeNode({ label: 'a', category: 'file', commentary: 'why' }), 'a')).toBe(true);
    expect(hasDeeperRecord(makeNode({ label: 'a', category: 'file', techniques: ['T1059'] }), 'a')).toBe(true);
    expect(hasDeeperRecord(makeNode({ label: 'a', category: 'file', details: { sha256: 'abc' } }), 'a')).toBe(true);
    expect(
      hasDeeperRecord(makeNode({ label: 'a', category: 'file', logs: [{ source: 'EDR', timestamp: null, excerpt: 'x' }] }), 'a'),
    ).toBe(true);
  });
});

describe('wrapLabel and the box it has to fit', () => {
  it('never leaves a trailing ellipsis when a middle cut would do', () => {
    // 29 characters is the real budget of a 240px box at 12px monospace.
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\KettleUpdate';
    const lines = wrapLabel(key, 29, 2);

    expect(lines.length).toBe(2);
    lines.forEach((line) => expect(line.length).toBeLessThanOrEqual(29));
    expect(lines[lines.length - 1].endsWith('KettleUpdate')).toBe(true);
    // One ellipsis, in the middle where it says "a path was cut" rather than
    // at the end where it says "the value stops here".
    expect(lines.join('').split('…').length - 1).toBe(1);
  });
});
