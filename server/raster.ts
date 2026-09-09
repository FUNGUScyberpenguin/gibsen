/**
 * Pixel work: cropping a rendered diagram and writing PNGs.
 *
 * Why this exists rather than a clipped SVG per page. resvg 2.6.2 aborts the
 * process — a Rust panic, not a catchable error — when a path carrying a marker
 * falls outside the canvas, and every arrowhead in the diagram is a marker. Any
 * page narrower than the whole incident puts most of them outside. So the
 * diagram is rasterised once at full size, where nothing is out of bounds, and
 * the pages are cut out of those pixels afterwards.
 *
 * That is also what the browser slide export does with `drawImage`, which is a
 * point in its favour: the two now work the same way.
 */

import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** `#rrggbb`, or `#rgb`, to four bytes. Anything else comes back opaque black. */
export function parseColor(color: string): [number, number, number, number] {
  const hex = color.trim().replace(/^#/, '');
  if (hex.length === 3) {
    const [r, g, b] = [...hex].map((c) => parseInt(c + c, 16));
    return [r, g, b, 255];
  }
  if (hex.length === 6) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      255,
    ];
  }
  return [0, 0, 0, 255];
}

/** An 8-bit RGBA image, the shape resvg hands back. */
export class Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;

  constructor(width: number, height: number, data?: Buffer) {
    this.width = width;
    this.height = height;
    this.data = data ?? Buffer.alloc(width * height * 4);
    if (this.data.length !== width * height * 4) {
      throw new Error(`Raster of ${width}x${height} needs ${width * height * 4} bytes, got ${this.data.length}`);
    }
  }

  fill(color: string): void {
    this.data.fill(Buffer.from(parseColor(color)));
  }

  /**
   * Copy a rectangle out of `src` and paste it here. Opaque copy, not a blend:
   * both the diagram and the pages it is cut into are drawn on a solid
   * background, so there is nothing to see through.
   *
   * Anything asked for outside either image is trimmed rather than refused —
   * a slice at the very end of a diagram runs a pixel or two past the edge on
   * rounding alone, and losing that column is not worth an exception.
   */
  blit(src: Raster, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number): void {
    const left = Math.max(0, sx, sx - dx);
    const top = Math.max(0, sy, sy - dy);
    const right = Math.min(src.width, sx + sw, sx + (this.width - dx));
    const bottom = Math.min(src.height, sy + sh, sy + (this.height - dy));

    for (let y = top; y < bottom; y += 1) {
      const targetY = dy + (y - sy);
      if (targetY < 0 || targetY >= this.height) continue;
      const srcStart = (y * src.width + left) * 4;
      const srcEnd = (y * src.width + right) * 4;
      const dstStart = (targetY * this.width + dx + (left - sx)) * 4;
      src.data.copy(this.data, dstStart, srcStart, srcEnd);
    }
  }

  toPng(): Buffer {
    // One filter byte per scanline. Filter 0 (none) keeps this simple, and the
    // diagram is mostly flat colour, which deflate handles well regardless.
    const stride = this.width * 4;
    const raw = Buffer.alloc((stride + 1) * this.height);
    for (let y = 0; y < this.height; y += 1) {
      raw[y * (stride + 1)] = 0;
      this.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // colour type: RGBA
    ihdr[10] = 0; // deflate
    ihdr[11] = 0; // adaptive filtering
    ihdr[12] = 0; // no interlace

    return Buffer.concat([
      PNG_SIGNATURE,
      chunk('IHDR', ihdr),
      // Level 6 rather than 9. These are flat-colour images tens of millions
      // of pixels across; the last three levels cost seconds each and save
      // low single-digit percentages.
      chunk('IDAT', deflateSync(raw, { level: 6 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}
