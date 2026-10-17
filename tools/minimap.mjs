// Turns the game's minimap textures (Remnant: From the Ashes, extracted with tools/pak.mjs) into PNGs.
// A minimap texture (T_<level>.uasset/.uexp/.ubulk) is BC7, 1024x1024, its first mips in the .ubulk.
//   node tools/minimap.mjs <texture .ubulk or .uexp> <out.png> [size]
import fs from 'node:fs';
import zlib from 'node:zlib';
import { decode } from './bc7.mjs';

// The top mip of a texture: in the .ubulk when there is one (1024² BC7 = 1 byte a pixel), else at the end of
// the .uexp's inline mips (smaller textures).
export function topMip(file) {
  const base = file.replace(/\.(uasset|uexp|ubulk)$/, '');
  if (fs.existsSync(base + '.ubulk')) {
    const b = fs.readFileSync(base + '.ubulk');
    let size = 4; while ((size * 2) * (size * 2) <= b.length) size *= 2;   // biggest square mip that fits
    return { size, data: b.subarray(0, size * size) };
  }
  throw new Error('no .ubulk next to ' + file + ' (inline-only textures are not handled)');
}

// RGBA -> PNG bytes.
export function png(rgba, w, h) {
  const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (buf) => { let c = -1; for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Halves an RGBA image (box filter) until it is `size` wide.
export function shrink(rgba, w, size) {
  while (w > size) {
    const h = w / 2, out = new Uint8Array(h * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < h; x++) for (let c = 0; c < 4; c++) {
      const i = ((y * 2) * w + x * 2) * 4 + c;
      out[(y * h + x) * 4 + c] = (rgba[i] + rgba[i + 4] + rgba[i + w * 4] + rgba[i + w * 4 + 4] + 2) >> 2;
    }
    rgba = out; w = h;
  }
  return { rgba, w };
}

if (process.argv[1] && process.argv[1].endsWith('minimap.mjs')) {
  const [src, out, size] = process.argv.slice(2);
  const m = topMip(src);
  let rgba = decode(m.data, m.size, m.size), w = m.size;
  if (size) ({ rgba, w } = shrink(rgba, w, +size));
  fs.writeFileSync(out, png(rgba, w, w));
  console.log(out, w + 'x' + w);
}
