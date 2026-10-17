// Lists (and extracts) files from Remnant: From the Ashes' .pak files (Unreal 4 pak version 8, zlib, index not
// encrypted). Used to find the in-game map pictures of the fixed maps (Ward 13, Ward Prime…).
//   node tools/pak.mjs <file.pak> [regex]                 -> the paths that match
//   node tools/pak.mjs <file.pak> <regex> --extract <dir>   -> also writes those files
//
// Footer (last 221 bytes in v8): [16 encryption key guid][u8 index encrypted][u32 magic 0x5A6F12E1][i32 version]
// [i64 index offset][i64 index size][20 sha1][5 × 32-byte compression names]. Index: FString mount point,
// i32 count, then per file: FString path + entry {i64 offset, i64 size, i64 uncompressed size, u32 compression
// (0 = none, else 1-based into the names), 20 sha1, [if compressed: i32 blocks, blocks × {i64 start, i64 end}],
// u8 encrypted, u32 block size}. In the file each entry repeats its header, then the (compressed) blocks.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export function readIndex(file) {
  const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size;
  // The footer is found by its magic (189 bytes here: 4 compression names).
  const tail = Buffer.alloc(400); fs.readSync(fd, tail, 0, 400, size - 400);
  let m = -1; for (let i = 17; i < 396; i++) if (tail.readUInt32LE(i) === 0x5A6F12E1) { m = i; break; }
  if (m < 0) throw new Error('not a pak (no magic)');
  const foot = tail.subarray(m - 17);
  const version = foot.readInt32LE(21), indexOff = Number(foot.readBigInt64LE(25)), indexSize = Number(foot.readBigInt64LE(33));
  if (foot[16]) throw new Error('the index is encrypted');
  const names = []; for (let i = 0; 93 + i * 32 <= foot.length; i++) { const s = foot.toString('latin1', 61 + i * 32, 93 + i * 32).replace(/\0.*$/, ''); if (s) names.push(s); }
  const idx = Buffer.alloc(indexSize); fs.readSync(fd, idx, 0, indexSize, indexOff);
  let p = 0;
  const str = () => { const n = idx.readInt32LE(p); p += 4; let s; if (n < 0) { s = idx.toString('utf16le', p, p - n * 2 - 2); p += -n * 2; } else { s = idx.toString('latin1', p, p + n - 1); p += n; } return s; };
  const mount = str(), count = idx.readInt32LE(p); p += 4;
  const files = [];
  for (let i = 0; i < count; i++) {
    const name = str();
    // Unreal 4.22 (4 compression names) stores the compression index as a u8; 4.23+ as a u32.
    const wide = names.length > 4 ? 4 : 1;
    const e = { path: mount + name, offset: Number(idx.readBigInt64LE(p)), size: Number(idx.readBigInt64LE(p + 8)), raw: Number(idx.readBigInt64LE(p + 16)), comp: wide === 4 ? idx.readUInt32LE(p + 24) : idx[p + 24] };
    p += 24 + wide + 20;
    if (e.comp) { const n = idx.readInt32LE(p); p += 4; e.blocks = []; for (let b = 0; b < n; b++) { e.blocks.push([Number(idx.readBigInt64LE(p)), Number(idx.readBigInt64LE(p + 8))]); p += 16; } }
    e.encrypted = idx[p]; e.blockSize = idx.readUInt32LE(p + 1); p += 5;
    files.push(e);
  }
  fs.closeSync(fd);
  return { version, names, mount, files };
}

// An uncompressed entry repeats its header before the data: 3 × i64, u8 compression, 20 sha1, u8 encrypted, u32 block size.
const HEADER = 8 * 3 + 1 + 20 + 1 + 4;

// The file's bytes (blocks are relative to the entry's offset in v8 when below it, else absolute).
export function readFile(file, e) {
  const fd = fs.openSync(file, 'r');
  try {
    if (!e.comp) { const head = HEADER; const b = Buffer.alloc(e.size); fs.readSync(fd, b, 0, e.size, e.offset + head); return b; }
    const parts = e.blocks.map(([s, t]) => { const start = s < e.offset ? e.offset + s : s; const b = Buffer.alloc(t - s); fs.readSync(fd, b, 0, t - s, start); return zlib.inflateSync(b); });
    return Buffer.concat(parts);
  } finally { fs.closeSync(fd); }
}

// Part of a file: `length` bytes from `start`, inflating only the blocks that hold them.
export function readRange(file, e, start, length) {
  if (!e.comp) {
    const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(length);
    try { fs.readSync(fd, b, 0, length, e.offset + HEADER + start); } finally { fs.closeSync(fd); }
    return b;
  }
  const bs = e.blockSize, first = Math.floor(start / bs), last = Math.floor((start + length - 1) / bs);
  const fd = fs.openSync(file, 'r'), parts = [];
  try {
    for (let i = first; i <= last && i < e.blocks.length; i++) {
      const [s, t] = e.blocks[i], at = s < e.offset ? e.offset + s : s, b = Buffer.alloc(t - s);
      fs.readSync(fd, b, 0, t - s, at); parts.push(zlib.inflateSync(b));
    }
  } finally { fs.closeSync(fd); }
  const all = Buffer.concat(parts), from = start - first * bs;
  return all.subarray(from, from + length);
}

if (process.argv[1] && process.argv[1].endsWith('pak.mjs')) {
  const [file, re] = process.argv.slice(2), out = process.argv.includes('--extract') ? process.argv[process.argv.indexOf('--extract') + 1] : null;
  const ix = readIndex(file), rx = re ? new RegExp(re, 'i') : null;
  const hits = ix.files.filter((f) => !rx || rx.test(f.path));
  console.error('pak v' + ix.version + ', ' + ix.files.length + ' files, compression ' + ix.names.join(',') + ', ' + hits.length + ' match');
  for (const f of hits) {
    console.log(f.raw, f.path);
    if (out) { const dst = path.join(out, f.path.replace(/^(\.\.\/)+/, '')); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, readFile(file, f)); }
  }
}
