// Builds the floor plans of Remnant: From the Ashes' fixed maps (Ward 13, Ward 17, Ward Prime, the Labyrinth,
// bosses, dungeons, sieges, points of interest) from the game's own minimap pictures:
//   node tools/minimaps.mjs "<Remnant folder>"   -> img/maps/<level>_<floor>.png + js/maps.js
//
// Each level (.umap) has MiniMap_Tile_Support_Actor actors: per floor (TextureID: 0 ground, -1 below, 2 above…)
// the minimap texture (Thumbnail) and the square of the world it covers (TileSize, centred at TileOffset), and
// MiniMapLevelRegion boxes telling which floor a point of the world is on. The textures are 1024x1024 BC7
// (tools/bc7.mjs); a world point (x, y) sits at pixel 512 + (x - offset.x) / size * 1024 (same for y), and the
// save's explored cells are world / 50 + 256 — checked on Ward Prime: 99% of a walked path lands on the floors.
import fs from 'node:fs';
import path from 'node:path';
import { readIndex, readFile, readRange } from './pak.mjs';
import { readPackage, readProps } from './uasset.mjs';
import { decode } from './bc7.mjs';
import { png } from './minimap.mjs';

const gameDir = process.argv[2];
if (!gameDir) { console.error('usage: node tools/minimaps.mjs "<Remnant folder>"'); process.exit(1); }
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const outDir = path.join(here, '..', 'img', 'maps');
fs.mkdirSync(outDir, { recursive: true });
const paksDir = path.join(gameDir, 'Remnant', 'Content', 'Paks');
const paks = fs.readdirSync(paksDir).filter((f) => /\.pak$/.test(f)).map((f) => { const file = path.join(paksDir, f); return { file, ix: readIndex(file) }; });
const find = (re) => { const out = []; for (const p of paks) for (const e of p.ix.files) if (re.test(e.path)) out.push({ pak: p.file, e }); return out; };
const short = (p) => p.replace(/^(\.\.\/)+Remnant\/Content\//, '/Game/');

// Fixed maps: every level with a minimap that isn't a piece of a generated area.
const TILE = /_(STR|Str|CRN|CNR|TJ|END|End|DE|BACK|Cross|Pocket)(_|$)|_Z_|Transition|DeadEnd|Overlay|Plains_/;
const textures = find(/\/Minimap\/T_[^/]+\.uasset$/i);
// A texture is T_<level> or T_<level>_<floor>; a level's own name can end in a number too (Quest_FoundersPrison_1).
const umapNames = new Set(); for (const p of paks) for (const e of p.ix.files) if (/\.umap$/.test(e.path)) umapNames.add(path.basename(e.path, '.umap'));
const levelOf = (t) => { const n = path.basename(t.e.path, '.uasset').replace(/^T_/, ''); return umapNames.has(n) ? n : n.replace(/_-?\d+$/, ''); };
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const levels = new Set(textures.map(levelOf).filter((l) => !ONLY || ONLY.test(l)).filter((l) => umapNames.has(l) && (process.env.TILES || !TILE.test(l) || /^Quest_/.test(l))));
// ONLY=<regex> rebuilds just those levels, keeping the others already in js/maps.js (TILES=1 lets in pieces of generated areas).
const mapsFile = path.join(here, '..', 'js', 'maps.js');
const kept = () => { const t = fs.readFileSync(mapsFile, 'utf8'), a = t.indexOf('var RWA_MAPS = ') + 'var RWA_MAPS = '.length, b = t.lastIndexOf(';\nif (typeof module'); return JSON.parse(t.slice(a, b)); };
const out = ONLY && fs.existsSync(mapsFile) ? kept() : {};
let n = 0;
for (const level of [...levels].sort()) {
  const umap = find(new RegExp('/' + level.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.umap$'))[0];
  if (!umap) { console.warn('no level file for', level); continue; }
  const uexp = find(new RegExp(umap.e.path.replace(/\.umap$/, '.uexp').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'))[0];
  let pkg;
  try { pkg = readPackage(readFile(umap.pak, umap.e)); } catch (err) { console.warn(level, err.message); continue; }
  const read = (off, len) => readRange(uexp.pak, uexp.e, off, len);
  const props = (e) => { try { return readProps(pkg, e, read); } catch (err) { return {}; } };
  const byName = {}; pkg.exports.forEach((e) => { byName[e.name] = e; });
  const floors = [];
  for (const e of pkg.exports.filter((x) => /^MiniMap_Tile_Support_Actor/.test(x.cls || ''))) {
    const p = props(e);
    if (!p.Thumbnail) { if (process.env.DEBUG) console.warn(level, 'support actor without Thumbnail', JSON.stringify(p).slice(0, 300)); continue; }
    floors.push({ floor: p.TextureID || 0, texture: p.Thumbnail, size: (p.TileSize || [32000])[0], offset: (p.TileOffset || [0, 0]).slice(0, 2) });
  }
  if (!floors.length) { if (process.env.DEBUG) console.warn(level, 'no floors'); continue; }
  // Floor regions: the box (RegionSize, around the actor's root location) that belongs to a floor.
  const regions = [];
  for (const e of pkg.exports.filter((x) => /^(Remnant)?MiniMapLevelRegion$/.test(x.cls || ''))) {
    const p = props(e), rootName = p.RootComponent, root = rootName && pkg.exports.find((x) => x.name === rootName && x.outerName === e.name);
    const r = root ? props(root) : {};
    if (!r.RelativeLocation) continue;
    regions.push({ floor: p.MiniMapLevel || 0, at: r.RelativeLocation.map(Math.round), size: (p.RegionSize || [0, 0, 0]).map(Math.round), yaw: r.RelativeRotation ? Math.round(r.RelativeRotation[1]) : 0, scale: r.RelativeScale3D || [1, 1, 1] });
  }
  // The pictures: decoded, cropped to what is drawn (kept: the crop's place in the 1024 square).
  for (const f of floors) {
    const tex = textures.find((t) => path.basename(t.e.path, '.uasset') === f.texture);
    const sibling = (ext) => tex && find(new RegExp(tex.e.path.replace(/\.uasset$/, ext).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'))[0];
    const bulk = sibling('.ubulk'), inline = sibling('.uexp');
    let top = null;
    if (bulk) {
      // The first mips live in the .ubulk, biggest first.
      const raw = readFile(bulk.pak, bulk.e);
      let side = 4; while ((side * 2) * (side * 2) <= raw.length) side *= 2;
      top = { side, data: raw.subarray(0, side * side) };
    } else if (inline) {
      // Smaller textures keep every mip inline in the .uexp: [u32 flags][i32 count][i32 size on disk][i64 offset][data];
      // the top mip is the first whose count and size are both side² (BC7: a byte a pixel).
      const raw = readFile(inline.pak, inline.e);
      for (let side = 2048; side >= 64 && !top; side /= 2) {
        const sq = side * side;
        for (let i = 0; i + 16 + sq <= raw.length; i++) if (raw.readInt32LE(i) === sq && raw.readInt32LE(i + 4) === sq) { top = { side, data: raw.subarray(i + 16, i + 16 + sq) }; break; }
      }
    }
    if (!top) { f.missing = true; if (process.env.DEBUG) console.warn(level, 'no pixels for', f.texture, tex ? 'texture found' : 'texture NOT found'); continue; }
    const side = top.side, rgba = decode(top.data, side, side);
    let x0 = side, y0 = side, x1 = -1, y1 = -1;
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) if (rgba[(y * side + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) { f.empty = true; continue; }
    x0 = Math.max(0, x0 - 4); y0 = Math.max(0, y0 - 4); x1 = Math.min(side - 1, x1 + 4); y1 = Math.min(side - 1, y1 + 4);
    const w = x1 - x0 + 1, h = y1 - y0 + 1, crop = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) crop.set(rgba.subarray(((y0 + y) * side + x0) * 4, ((y0 + y) * side + x1 + 1) * 4), y * w * 4);
    // Two pictures for one floor (two parts of a level): a letter tells them apart.
    let name = level + '_' + f.floor + '.png';
    for (let k = 0; floors.some((o) => o !== f && o.image === name); k++) name = level + '_' + f.floor + String.fromCharCode(98 + k) + '.png';
    fs.writeFileSync(path.join(outDir, name), png(crop, w, h));
    // Where this floor has ground, in 8-pixel squares over the crop (bits, row by row, base64):
    // the Map tab opens on the floor you walked most.
    const mw = Math.ceil(w / 8), mh = Math.ceil(h / 8), bits = new Uint8Array(Math.ceil(mw * mh / 8));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (crop[(y * w + x) * 4 + 3] > 8) { const i = (y >> 3) * mw + (x >> 3); bits[i >> 3] |= 1 << (i & 7); }
    Object.assign(f, { image: name, side, crop: [x0, y0, w, h], mask: Buffer.from(bits).toString('base64') });
  }
  const good = floors.filter((f) => f.image).sort((a, b) => b.floor - a.floor);
  if (!good.length) continue;
  out[level] = { file: short(umap.e.path).replace(/\.umap$/, ''), floors: good.map((f) => ({ floor: f.floor, image: f.image, size: f.size, offset: f.offset, side: f.side, crop: f.crop, mask: f.mask })), regions };
  n++;
  console.log(level, good.map((f) => f.floor).join(','), regions.length + ' regions');
}
fs.writeFileSync(path.join(here, '..', 'js', 'maps.js'), '// Generated by tools/minimaps.mjs from the game\'s minimap textures — do not edit by hand.\n' +
  '// Per level: its floors (picture, the world square it covers) and the boxes telling which floor a point is on.\n' +
  'var RWA_MAPS = ' + JSON.stringify(out) + ';\nif (typeof module !== \'undefined\') module.exports = RWA_MAPS;\n');
console.log(n, 'maps');
