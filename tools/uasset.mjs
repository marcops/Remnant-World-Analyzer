// Minimal reader for Unreal 4.22 cooked packages (.uasset/.umap + .uexp) of Remnant: From the Ashes: the name,
// import and export tables, and an export's tagged properties. Used to find how the minimap textures sit in the
// world (the level's tile info / minimap actors).
//   node tools/uasset.mjs <file.umap> [export-class-regex]
import fs from 'node:fs';

export function readPackage(file) {
  const a = Buffer.isBuffer(file) ? file : fs.readFileSync(file);
  let p = 0;
  const i32 = () => { const v = a.readInt32LE(p); p += 4; return v; };
  const i64 = () => { const v = Number(a.readBigInt64LE(p)); p += 8; return v; };
  const str = () => { const n = i32(); if (!n) return ''; if (n < 0) { const s = a.toString('utf16le', p, p - n * 2 - 2); p += -n * 2; return s; } const s = a.toString('latin1', p, p + n - 1); p += n; return s; };
  if (a.readUInt32LE(0) !== 0x9E2A83C1) throw new Error('not a package');
  p = 4; const legacy = i32();
  if (legacy !== -4) i32();               // legacy UE3 version
  // Cooked files are unversioned (0): Remnant is Unreal 4.22 (package version 517).
  const ue4 = i32() || 517, licensee = i32();
  const customCount = i32(); p += customCount * 20;
  const totalHeader = i32(); str(); const flags = i32();
  const nameCount = i32(), nameOff = i32();
  if (ue4 >= 516) { i32(); i32(); }      // gatherable text data
  const exportCount = i32(), exportOff = i32(), importCount = i32(), importOff = i32();
  // Names.
  p = nameOff; const names = [];
  for (let i = 0; i < nameCount; i++) { names.push(str()); p += 4; }   // + hash
  const fname = () => { const i = i32(), n = i32(); return (names[i] || '?') + (n ? '_' + (n - 1) : ''); };
  // Imports.
  p = importOff; const imports = [];
  for (let i = 0; i < importCount; i++) { const classPackage = fname(), cls = fname(), outer = i32(), name = fname(); imports.push({ classPackage, cls, outer, name }); }
  // Exports.
  p = exportOff; const exports = [];
  for (let i = 0; i < exportCount; i++) {
    const e = { classIndex: i32(), superIndex: i32() };
    if (ue4 >= 508) e.templateIndex = i32();
    e.outer = i32(); e.name = fname(); e.flags = i32(); e.size = i64(); e.offset = i64();
    p += 4 * 3; p += 16; p += 4;          // forced export, not for client, not for server; package guid; package flags
    p += 4; p += 4;                        // not always loaded for editor game, is asset
    if (ue4 >= 507) p += 4 * 5;            // first export dependency + 4 dependency counts
    exports.push(e);
  }
  const ref = (i) => (i < 0 ? imports[-i - 1] && imports[-i - 1].name : i > 0 ? exports[i - 1] && exports[i - 1].name : null);
  exports.forEach((e) => { e.cls = ref(e.classIndex); e.outerName = ref(e.outer); });
  const uexp = typeof file === 'string' && fs.existsSync(file.replace(/\.(uasset|umap)$/, '.uexp')) ? file.replace(/\.(uasset|umap)$/, '.uexp') : null;
  return { file, uexp, ue4, totalHeader, names, imports, exports, ref };
}

// Tagged properties of one export (from the .uexp), as { name: value } with simple values decoded.
// `fd` is the .uexp's file descriptor, or a function (offset, length) -> Buffer (a file inside a .pak).
export function readProps(pkg, e, fd) {
  const len = Math.min(e.size, 1 << 20);
  let b;
  if (typeof fd === 'function') b = fd(e.offset - pkg.totalHeader, len);
  else { b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, e.offset - pkg.totalHeader); }
  let p = 0;
  const i32 = () => { const v = b.readInt32LE(p); p += 4; return v; };
  const fname = () => { const i = i32(), n = i32(); return (pkg.names[i] || '?') + (n ? '_' + (n - 1) : ''); };
  const out = {};
  for (let guard = 0; guard < 400 && p < len - 8; guard++) {
    const name = fname(); if (name === 'None') break;
    const type = fname(), size = i32(), index = i32();
    let v, struct = null;
    if (type === 'StructProperty') { struct = fname(); p += 16; }
    else if (type === 'BoolProperty') { v = !!b[p]; p += 1; }
    else if (type === 'ByteProperty' || type === 'EnumProperty') { fname(); }
    else if (type === 'ArrayProperty' || type === 'SetProperty') { fname(); }
    else if (type === 'MapProperty') { fname(); fname(); }
    p += 1;                                // has property guid
    const start = p;
    if (type === 'FloatProperty') v = b.readFloatLE(p);
    else if (type === 'IntProperty') v = b.readInt32LE(p);
    else if (type === 'ObjectProperty') v = pkg.ref(b.readInt32LE(p));
    else if (type === 'NameProperty') { const q = p; v = fname(); p = q; }
    else if (type === 'StructProperty' && /^(Vector|Rotator)$/.test(struct)) v = [b.readFloatLE(p), b.readFloatLE(p + 4), b.readFloatLE(p + 8)];
    else if (type === 'StructProperty' && struct === 'Vector2D') v = [b.readFloatLE(p), b.readFloatLE(p + 4)];
    else if (type === 'StructProperty' && struct === 'IntPoint') v = [b.readInt32LE(p), b.readInt32LE(p + 4)];
    else if (type === 'StructProperty' && struct === 'Box') v = { min: [b.readFloatLE(p), b.readFloatLE(p + 4), b.readFloatLE(p + 8)], max: [b.readFloatLE(p + 12), b.readFloatLE(p + 16), b.readFloatLE(p + 20)] };
    else if (type !== 'BoolProperty') v = (struct ? struct + ' ' : type + ' ') + size + ' bytes';
    out[name + (index ? '[' + index + ']' : '')] = v;
    p = start + size;
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('uasset.mjs')) {
  const [file, re] = process.argv.slice(2);
  const pkg = readPackage(file), rx = re ? new RegExp(re, 'i') : null;
  console.log('UE4 version', pkg.ue4, '·', pkg.names.length, 'names ·', pkg.exports.length, 'exports');
  const fd = pkg.uexp ? fs.openSync(pkg.uexp, 'r') : null;
  for (const e of pkg.exports) {
    if (rx && !rx.test(e.cls + ' ' + e.name)) continue;
    let props = null;
    try { props = fd ? readProps(pkg, e, fd) : null; } catch (err) { props = { error: err.message }; }
    console.log(e.cls, e.name, 'in', e.outerName, JSON.stringify(props));
  }
}
