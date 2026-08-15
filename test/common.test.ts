import { describe, expect, it } from 'vitest';
import {
  extractIocs,
  findTimestamps,
  guessRelation,
  guessTactic,
  looksMalicious,
  parseTimestamp,
  paragraphs,
  refang,
  refineFileCategory,
  sentences,
  truncateLabel,
} from '../src/ingest/common';

describe('refang', () => {
  it('restores bracketed dots, colons and schemes', () => {
    expect(refang('hxxps://evil[.]example[.]com')).toBe('https://evil.example.com');
    expect(refang('hxxp://10[.]0[.]0[.]1')).toBe('http://10.0.0.1');
    expect(refang('mail[at]evil(.)com')).toBe('mail@evil.com');
    expect(refang('192.168.1.1[:]8080')).toBe('192.168.1.1:8080');
  });

  it('leaves already-clean text alone', () => {
    expect(refang('https://example.com/path')).toBe('https://example.com/path');
  });
});

describe('extractIocs', () => {
  it('finds indicators of each supported kind', () => {
    const text =
      'Contact a.user@corp.example.com about https://bad.example.top/x.dll on 203.0.113.9 ' +
      'hash 9f2c4a1b8e7d6035f4a2b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8 CVE-2024-1234 T1059.001';
    const found = extractIocs(text);
    const byType = (t: string) => found.filter((f) => f.type === t).map((f) => f.value);

    expect(byType('email')).toEqual(['a.user@corp.example.com']);
    expect(byType('url')).toEqual(['https://bad.example.top/x.dll']);
    expect(byType('ipv4')).toEqual(['203.0.113.9']);
    expect(byType('sha256')).toHaveLength(1);
    expect(byType('cve')).toEqual(['CVE-2024-1234']);
    expect(byType('technique')).toEqual(['T1059.001']);
  });

  it('does not emit the domain inside a URL or an email a second time', () => {
    const found = extractIocs('see https://bad.example.top/a and mail@good.example.com');
    expect(found.filter((f) => f.type === 'domain')).toHaveLength(0);
  });

  it('strips trailing sentence punctuation', () => {
    const found = extractIocs('The host was 198.51.100.4, then it moved.');
    expect(found.find((f) => f.type === 'ipv4')?.value).toBe('198.51.100.4');
  });

  it('finds registry keys and Windows paths', () => {
    const found = extractIocs('Persistence at HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\Evil');
    expect(found.find((f) => f.type === 'registry')?.value).toContain('CurrentVersion');
  });

  it('returns matches in order of appearance', () => {
    const found = extractIocs('second 203.0.113.9 then https://a.example.com/');
    expect(found.map((f) => f.type)).toEqual(['ipv4', 'url']);
  });
});

describe('parseTimestamp', () => {
  it('anchors bare dates at midnight UTC', () => {
    expect(parseTimestamp('2024-03-14')).toBe('2024-03-14T00:00:00.000Z');
  });

  it('treats naive date-times as UTC rather than local', () => {
    expect(parseTimestamp('2024-03-14 08:12:03')).toBe('2024-03-14T08:12:03.000Z');
    expect(parseTimestamp('2024-03-14T08:12')).toBe('2024-03-14T08:12:00.000Z');
  });

  it('respects an explicit offset', () => {
    expect(parseTimestamp('2024-03-14T08:12:00+02:00')).toBe('2024-03-14T06:12:00.000Z');
  });

  it('handles unix seconds and milliseconds', () => {
    expect(parseTimestamp(1710403923)).toBe('2024-03-14T08:12:03.000Z');
    expect(parseTimestamp('1710403923')).toBe('2024-03-14T08:12:03.000Z');
    expect(parseTimestamp(1710403923000)).toBe('2024-03-14T08:12:03.000Z');
  });

  it('rejects values that are not dates', () => {
    expect(parseTimestamp('not a date')).toBeNull();
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp(null)).toBeNull();
  });
});

describe('findTimestamps', () => {
  it('locates several formats in one block', () => {
    const found = findTimestamps('At 2024-03-14T08:12:00Z and again on 15 Mar 2024 09:00 and Mar 16, 2024');
    expect(found).toHaveLength(3);
    expect(found[0].iso).toBe('2024-03-14T08:12:00.000Z');
  });

  it('does not double-count overlapping patterns', () => {
    expect(findTimestamps('2024-03-14T08:12:00Z')).toHaveLength(1);
  });
});

describe('keyword heuristics', () => {
  it('maps verbs to relations, preferring the specific reading', () => {
    expect(guessRelation('the loader beaconed to the C2')).toBe('beacons-to');
    expect(guessRelation('data was exfiltrated to the bucket')).toBe('exfiltrates-to');
    expect(guessRelation('the actor moved laterally to the DC')).toBe('moves-laterally-to');
    expect(guessRelation('nothing happened here')).toBe('related-to');
  });

  it('maps narrative to ATT&CK tactics', () => {
    expect(guessTactic('credentials were dumped from lsass')).toBe('credential-access');
    expect(guessTactic('files were encrypted and a ransom note dropped')).toBe('impact');
    expect(guessTactic('a quiet sentence')).toBeNull();
  });

  it('spots attacker-controlled language', () => {
    expect(looksMalicious('this is attacker-controlled infrastructure')).toBe(true);
    expect(looksMalicious('a normal finance workstation')).toBe(false);
  });
});

describe('paragraphs', () => {
  it('rejoins hard-wrapped lines into one paragraph', () => {
    const wrapped = 'The actor moved laterally to the domain\ncontroller CORP-DC-01 over SMB.';
    expect(paragraphs(wrapped)).toEqual(['The actor moved laterally to the domain controller CORP-DC-01 over SMB.']);
  });

  it('separates paragraphs at blank lines', () => {
    expect(paragraphs('first para\nwrapped\n\nsecond para')).toEqual(['first para wrapped', 'second para']);
  });

  it('gives list items and headings blocks of their own', () => {
    expect(paragraphs('# Heading\n- one\n- two\n1. three')).toEqual(['# Heading', '- one', '- two', '1. three']);
  });

  it('keeps a wrapped continuation attached to its list item', () => {
    expect(paragraphs('- the item runs\n  onto a second line\n- next')).toEqual([
      '- the item runs onto a second line',
      '- next',
    ]);
  });

  it('ignores trailing whitespace and empty input', () => {
    expect(paragraphs('   \n\n  ')).toEqual([]);
  });
});

describe('sentences', () => {
  it('splits a paragraph at sentence boundaries', () => {
    expect(sentences('First thing happened. Then 203.0.113.9 appeared.')).toEqual([
      'First thing happened.',
      'Then 203.0.113.9 appeared.',
    ]);
  });

  it('does not split on a decimal or a version number', () => {
    expect(sentences('The file was 1.5 MB in size.')).toHaveLength(1);
  });

  it('returns a single sentence unchanged', () => {
    expect(sentences('One clause only')).toEqual(['One clause only']);
  });
});

describe('label helpers', () => {
  it('keeps the distinguishing tail of paths', () => {
    const label = truncateLabel('C:\\Users\\someone\\AppData\\Roaming\\evil.dll', 20);
    expect(label.startsWith('…')).toBe(true);
    expect(label.endsWith('evil.dll')).toBe(true);
  });

  it('refines files by extension', () => {
    expect(refineFileCategory('run.ps1')).toBe('script');
    expect(refineFileCategory('loader.exe')).toBe('executable');
    expect(refineFileCategory('driver.sys')).toBe('driver');
    expect(refineFileCategory('stage.zip')).toBe('archive');
    expect(refineFileCategory('shell.aspx')).toBe('webshell');
    expect(refineFileCategory('notes.txt')).toBe('file');
  });
});
