// Generates js/stats.js from the Fextralife wiki pages cached in tools/source/wiki/
// (tools/update.ps1 downloads them and runs this script).
//
//   weapons  base damage, RPS, magazine, range, crit chance, weak spot bonus (from the
//            Hand Guns / Long Guns / Melee Weapons tables)
//   traits   effect and value per level
//   rings, amulets, mods   effect text (numbers are interpreted by js/dps.js)
//   sets     armor set bonus text and the 1/2/3-piece values
//
// Usage: node tools/build-stats.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'tools/source/wiki');
const require = createRequire(import.meta.url);
const DATA = require(path.join(ROOT, 'js/data.js'));
const WIKI = require(path.join(ROOT, 'js/wiki.js'));

const decode = (s) => s.replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const fileFor = (slug) => path.join(SRC, slug.replace(/[^A-Za-z0-9_\-]/g, '_') + '.html');
const read = (slug) => (fs.existsSync(fileFor(slug)) ? fs.readFileSync(fileFor(slug), 'utf8') : null);

// Page text as tokens (one per HTML text node), starting at the infobox.
function tokens(html) {
  const body = html.slice(html.indexOf('This page was last edited'));
  return decode(body.replace(/<[^>]+>/g, '\u0001')).split('\u0001').map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// Joins tokens into a sentence; "1", "0%" split by markup becomes "10%".
function sentence(list) {
  let s = '';
  for (const t of list) {
    if (!s) s = t;
    else if (/\d$/.test(s) && /^[\d%.]/.test(t)) s += t;
    else if (/^[.,%)]/.test(t)) s += t;
    else s += ' ' + t;
  }
  return s.replace(/\s+/g, ' ').trim();
}

const num = (s) => { const m = String(s).replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; };

// ---- weapons ---------------------------------------------------------------
function cellText(html) { return decode(html.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').trim(); }

// "5x35" = 5 pellets of 35; "11+22" = two hits per shot.
function damage(s) {
  s = String(s).replace(/\s/g, '');
  let m = /^(\d+)x([\d.]+)$/i.exec(s); if (m) return { perShot: m[1] * m[2], note: m[1] + ' pellets of ' + m[2] };
  m = /^([\d.]+)\+([\d.]+)$/.exec(s); if (m) return { perShot: +m[1] + +m[2], note: m[1] + ' + ' + m[2] };
  return { perShot: num(s), note: '' };
}

function weaponTable(page, type) {
  const html = read(page); if (!html) return [];
  const table = html.slice(html.indexOf('<table class="wikitable'), html.indexOf('</table>', html.indexOf('<table class="wikitable')));
  const rows = table.split(/<tr>/).slice(1).map((r) => r.split(/<td[^>]*>/).slice(1).map(cellText));
  const head = rows.shift().map((h) => h.toLowerCase());
  const col = (re) => head.findIndex((h) => re.test(h));
  const c = {
    base: col(/^base damage/), rps: col(/^rps/), mag: col(/^magazine/), range: col(/ideal range/), ammo: col(/^max ammo/),
    crit: col(/crit/), weak: col(/weakspot/), special: col(/special/),
  };
  return rows.filter((r) => r.length >= 4).map((r) => {
    const [name, mod] = r[0].split('\n').map((x) => x.trim()).filter(Boolean);
    const d = damage(r[c.base]);
    return {
      name, type, mod: mod && !/^none$/i.test(mod) ? mod.replace(/^\(|\)$/g, '') : '',
      damage: d.perShot, damageNote: d.note,
      rps: c.rps >= 0 ? num(r[c.rps]) : null, magazine: c.mag >= 0 ? num(r[c.mag]) : null,
      range: c.range >= 0 ? num(r[c.range]) : null, maxAmmo: c.ammo >= 0 ? num(r[c.ammo]) : null,
      crit: num(r[c.crit]) || 0, weakspot: num(r[c.weak]) || 0,
      special: c.special >= 0 ? r[c.special].replace(/\n/g, ' ') : '',
    };
  }).filter((w) => w.name && w.damage != null);
}

// ---- infobox pages -----------------------------------------------------------
function infobox(name, slug) {
  const html = read(slug); if (!html) return null;
  const t = tokens(html);
  // First mention, whatever the case ("Song Of Swords" in the infobox title).
  const start = t.findIndex((x) => x.toLowerCase() === name.toLowerCase());
  let end = t.findIndex((x, i) => i > start && /^is an?$/.test(x));
  if (end < 0) end = Math.min(t.length, start + 80);
  return t.slice(start + 1, end - 1);
}

function trait(name, slug) {
  const t = infobox(name, slug); if (!t) return null;
  const at = (label) => { const i = t.indexOf(label); return i >= 0 ? t[i + 1] : ''; };
  return { name, type: at('Type'), effect: at('Effect'), perLevel: at('Base Value'), max: at('Max Value') };
}

function accessory(name, slug) {
  const t = infobox(name, slug); if (!t) return null;
  const i = t.indexOf('Status Effect'), j = t.findIndex((x) => /^(Buy For|Sell For|Craftable)$/.test(x));
  return { name, effect: sentence(t.slice(i + 1, j > i ? j : undefined)) };
}

function mod(name, slug) {
  const t = infobox(name, slug); if (!t) return null;
  const type = t[t.indexOf('Type') + 1] || '';
  let rest = t.slice(t.indexOf('Type') + 2);
  if (rest[0] === 'Weapon' || rest[0] === 'Boss Weapon') rest = rest.slice(1);
  // The description is printed twice in a row.
  const full = sentence(rest), half = full.slice(0, Math.ceil(full.length / 2)).trim();
  const desc = full.length > 20 && full.indexOf(half.slice(0, 30), 10) > 0 ? full.slice(0, full.indexOf(half.slice(0, 30), 10)).trim() : full;
  return { name, type, effect: desc };
}

function armorSet(group, slug) {
  const html = read(slug); if (!html) return null;
  const t = tokens(html);
  const i = t.indexOf('Armor Set Bonus'); if (i < 0) return null;
  const one = t.indexOf('One Piece', i), two = t.indexOf('Two Pieces', i), three = t.indexOf('Three Pieces', i);
  return {
    set: group, bonus: t[i + 1], effect: sentence(t.slice(i + 2, one > 0 ? one : i + 30)),
    pieces: [one, two, three].map((k) => (k > 0 ? t[k + 1] : '')),
  };
}

// ---- build -------------------------------------------------------------------
const weapons = [...weaponTable('Hand_Guns', 'Hand Gun'), ...weaponTable('Long_Guns', 'Long Gun'), ...weaponTable('Melee_Weapons', 'Melee')];
const out = { generated: new Date().toISOString().slice(0, 10), weapons: {}, traits: {}, rings: {}, amulets: {}, mods: {}, sets: {} };
// Keyed by the sheet's item name; the tables spell some differently ("Voice of The Tempest", "Butchers Flail").
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const sheetName = Object.fromEntries(DATA.items.filter((i) => i.category === 'Weapon').map((i) => [norm(i.name), i.name]));
for (const w of weapons) { w.name = sheetName[norm(w.name)] || w.name; out.weapons[w.name] = w; }

const missing = [];
const seen = new Set();
for (const it of DATA.items) {
  const slug = WIKI.items[it.name];
  const put = (bucket, key, v) => { if (v) out[bucket][key] = v; else missing.push(it.category + '|' + it.name); };
  if (it.category === 'Trait') put('traits', it.name, slug && trait(it.name, slug));
  else if (it.category === 'Ring') put('rings', it.name, slug && accessory(it.name, slug));
  else if (it.category === 'Amulet') put('amulets', it.name, slug && accessory(it.name, slug));
  else if (it.category === 'Mod') put('mods', it.name, slug && mod(it.name, slug));
  else if (it.category === 'Armor' && it.group && !seen.has(it.group) && slug && fs.existsSync(fileFor(slug))) {
    seen.add(it.group);
    const s = armorSet(it.group, slug); if (s) out.sets[it.group] = s;
  } else if (it.category === 'Weapon' && !out.weapons[it.name]) missing.push('Weapon|' + it.name);
}

fs.writeFileSync(path.join(ROOT, 'js/stats.js'),
  '// Generated by tools/build-stats.mjs from the Fextralife wiki - do not edit by hand.\n' +
  'var RWA_STATS = ' + JSON.stringify(out, null, 1) + ';\n' +
  "if (typeof module !== 'undefined') module.exports = RWA_STATS;\n");
const count = (k) => Object.keys(out[k]).length;
console.log(`js/stats.js: ${count('weapons')} weapons, ${count('traits')} traits, ${count('rings')} rings, ${count('amulets')} amulets, ${count('mods')} mods, ${count('sets')} armor sets`);
if (missing.length) console.log('-- No wiki data for:\n  ' + missing.join('\n  '));
