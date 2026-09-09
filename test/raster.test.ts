import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { Raster, parseColor } from '../server/raster';
import { sliceWindow, actSlices, sliceCaption, SLICE_MIN_W } from '../src/export/slices';
import type { Act } from '../src/layout/layout';

/** Pull the pixels back out of a PNG this module wrote. */
function decode(png: Buffer): { width: number; height: number; pixels: Buffer } {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);

  let offset = 8;
  const idat: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('latin1');
    if (type === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    expect(raw[y * (stride + 1)], 'filter byte').toBe(0);
    raw.copy(pixels, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  }
  return { width, height, pixels };
}

function pixelAt(image: { width: number; pixels: Buffer }, x: number, y: number): number[] {
  const at = (y * image.width + x) * 4;
  return [...image.pixels.subarray(at, at + 4)];
}

describe('parseColor', () => {
  it('reads both hex lengths and falls back to black', () => {
    expect(parseColor('#0b1120')).toEqual([11, 17, 32, 255]);
    expect(parseColor('#abc')).toEqual([170, 187, 204, 255]);
    expect(parseColor('rebeccapurple')).toEqual([0, 0, 0, 255]);
  });
});

describe('Raster', () => {
  it('refuses a buffer that is the wrong size for the dimensions', () => {
    expect(() => new Raster(4, 4, Buffer.alloc(10))).toThrow(/needs 64 bytes/);
  });

  it('round-trips through PNG', () => {
    const raster = new Raster(6, 4);
    raster.fill('#0b1120');
    const image = decode(raster.toPng());
    expect([image.width, image.height]).toEqual([6, 4]);
    expect(pixelAt(image, 0, 0)).toEqual([11, 17, 32, 255]);
    expect(pixelAt(image, 5, 3)).toEqual([11, 17, 32, 255]);
  });

  it('copies a rectangle to the position asked for', () => {
    const source = new Raster(4, 2);
    source.fill('#ff0000');
    const target = new Raster(8, 2);
    target.fill('#000000');

    target.blit(source, 1, 0, 2, 2, 5, 0);

    const image = decode(target.toPng());
    expect(pixelAt(image, 4, 0)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(image, 5, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(image, 6, 1)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(image, 7, 0)).toEqual([0, 0, 0, 255]);
  });

  it('trims a copy that runs past either edge instead of throwing', () => {
    const source = new Raster(4, 4);
    source.fill('#00ff00');
    const target = new Raster(4, 4);
    target.fill('#000000');

    // Asks for more than either image holds, from a negative offset.
    expect(() => target.blit(source, -2, -2, 99, 99, 0, 0)).not.toThrow();
    const image = decode(target.toPng());
    expect(pixelAt(image, 3, 3)).toEqual([0, 255, 0, 255]);
  });
});

describe('sliceWindow', () => {
  const slice = (x: number, width: number) => ({ name: 'Act', x, width });

  it('widens a sliver so the act is not a single column', () => {
    const { span } = sliceWindow(slice(3000, 120), 9000, 212);
    expect(span).toBe(SLICE_MIN_W);
  });

  it('stays inside the diagram at either end', () => {
    const left = sliceWindow(slice(212, 100), 9000, 212);
    expect(left.from).toBeGreaterThanOrEqual(212);

    const right = sliceWindow(slice(8900, 100), 9000, 212);
    expect(right.from + right.span).toBeLessThanOrEqual(9000);
  });

  it('never runs the gutter twice', () => {
    // `from` starting before the gutter would repeat the plane names inside
    // the timeline half of the page.
    for (const x of [0, 100, 211, 250, 5000]) {
      expect(sliceWindow(slice(x, 240), 9000, 212).from).toBeGreaterThanOrEqual(212);
    }
  });
});

describe('actSlices', () => {
  const act = (label: string, x: number): Act => ({
    tactic: 'execution',
    label,
    startCol: 0,
    endCol: 1,
    x,
    width: 400,
    from: '2026-01-04T09:00:00.000Z',
    to: '2026-01-04T09:10:00.000Z',
    duration: '10 minutes',
  });

  it('carries the act name and its window into the caption', () => {
    const slices = actSlices([act('Execution', 500), act('Impact', 1200)]);
    expect(slices).toHaveLength(2);
    expect(sliceCaption(0, 2, slices[0])).toContain('1 of 2');
    expect(sliceCaption(0, 2, slices[0])).toContain('Execution');
    expect(sliceCaption(0, 2, slices[0])).toContain('10 minutes');
    // The trailing `.000` on a stored instant is noise on a slide.
    expect(sliceCaption(0, 2, slices[0])).not.toContain('.000Z');
  });
});
