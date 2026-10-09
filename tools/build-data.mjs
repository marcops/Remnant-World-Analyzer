// Generates js/data.js from:
//   - tools/source/sheet-*.csv  "Remnant: From the Ashes - Completionist's Checklist" by Amythyst34
//     https://docs.google.com/spreadsheets/d/1rmmwn-kaVS44qWgub7ubXqL26fAgM7TBIi-dNc7VGdI
//   - tools/source/GameInfo.xml  from RemnantSaveManager by Razzmatazzz (GPL-3.0)
//     https://github.com/Razzmatazzz/RemnantSaveManager
//
// Usage:
//   node tools/build-data.mjs              rebuild js/data.js from the cached sources
//   node tools/build-data.mjs --download   refresh the sheet CSVs first (tools/update.ps1 does this and everything else)
//   node tools/build-data.mjs --report     also print items that could not be linked to a game path

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANUAL_KEYS, EXTRA_EVENT_ITEMS, WEAPON_ALIASES, MODE_FIX } from './overrides.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'tools/source');
const SHEET_ID = '1rmmwn-kaVS44qWgub7ubXqL26fAgM7TBIi-dNc7VGdI';

const TABS = [
  { tab: 'Armor', category: 'Armor' },
  { tab: 'Weapons', category: 'Weapon' },
  { tab: 'Amulets', category: 'Amulet' },
  { tab: 'Rings', category: 'Ring' },
  { tab: 'Weapon Mods', category: 'Mod' },
  { tab: 'Traits', category: 'Trait' },
  { tab: 'Emotes', category: 'Emote' },
  { tab: 'Skins', category: 'Skin' },
  { tab: 'Consumables', category: 'Consumable' },
];

const csvFile = (tab) => path.join(SRC, `sheet-${tab.toLowerCase().replace(/ /g, '-')}.csv`);

async function download() {
  for (const { tab } of TABS) {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${tab}: HTTP ${res.status}`);
    fs.writeFileSync(csvFile(tab), await res.text());
    console.log('downloaded', tab);
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const WORLD_FIX = { Crosus: 'Corsus' };
const dash = (v) => (!v || v.trim() === '-' ? '' : v.trim());

function readSheet() {
  const items = [];
  for (const { tab, category } of TABS) {
    const [header, ...rows] = parseCsv(fs.readFileSync(csvFile(tab), 'utf8'));
    const col = (re) => header.findIndex((h) => re.test(h));
    const iSet = col(/^Set Name$|^Weapon Type$/);
    const iName = col(/Name$/) === iSet ? header.findIndex((h, i) => i !== iSet && /Name$/.test(h)) : col(/Name$/);
    const iWorld = col(/^World$/), iMode = col(/^Mode$/), iDlc = col(/^DLC$/), iHow = col(/^How to/);
    for (const r of rows) {
      const name = (r[iName] || '').trim();
      if (!name) continue;
      const world = dash(r[iWorld]);
      items.push({
        name,
        category,
        group: iSet >= 0 ? dash(r[iSet]) : '',
        world: WORLD_FIX[world] || world,
        mode: dash(r[iMode]),
        dlc: dash(r[iDlc]),
        how: dash(r[iHow]),
      });
    }
  }
  return items;
}

function readGameInfo() {
  const xml = fs.readFileSync(path.join(SRC, 'GameInfo.xml'), 'utf8');
  const attr = (s, a) => (s.match(new RegExp(`${a}="([^"]*)"`)) || [])[1];
  const subLocations = {}, mainLocations = {}, events = {}, itemAltNames = {};
  for (const m of xml.matchAll(/<SubLocation [^>]*\/>/g)) subLocations[attr(m[0], 'eventName')] = attr(m[0], 'location');
  for (const m of xml.matchAll(/<MainLocation [^>]*\/>/g)) mainLocations[attr(m[0], 'key')] = attr(m[0], 'name');
  for (const m of xml.matchAll(/<Event ([^>]*)>([\s\S]*?)<\/Event>/g)) {
    const name = attr(m[1], 'name');
    const items = [];
    for (const x of m[2].matchAll(/<Item([^>]*)>([^<]+)<\/Item>/g)) {
      const p = x[2].trim();
      items.push(p);
      if (attr(x[1], 'altname')) itemAltNames[p] = attr(x[1], 'altname');
    }
    events[name] = { altName: attr(m[1], 'altname') || null, items };
  }
  return { subLocations, mainLocations, events, itemAltNames };
}

// Same normalisation as js/parser.js (itemKeyFromPath) so that profile inventory
// paths that are not in GameInfo.xml can still be matched at runtime.
export const norm = (s) => s.toLowerCase().replace(/^the /, '').replace(/[^a-z0-9]/g, '');

const ARMOR_SLOT_WORDS = {
  Head: /mask|hood|helm|goggles|visage|headdress|crown|cowl|hat|headpiece|faceguard|skull|cap|horns|scarf|shroud/i,
  Body: /garb|tunic|jacket|raiment|carapace|coat|vestments|armor|chest|plate|mantle|protector|robe|cuirass|hauberk|vest|cloak|wrappings|duster|gown|body|regalia|shirt|bodyplate|attire|husk|shell|cage/i,
  Legs: /legging|trousers|greaves|pants|boots|leg|footwraps|breeches|treads|sabatons|kilt|britches|skirt|tassets/i,
};

const SET_ALIASES = { osseus: 'osseous' };

function pathCategories(p) {
  if (/\/Mods\/|\/Mod_/.test(p)) return ['Mod'];
  if (p.includes('/Weapons/')) return ['Weapon'];
  if (p.includes('/Trinkets/')) return ['Amulet', 'Ring'];
  if (p.includes('/Traits/')) return ['Trait'];
  if (p.includes('/Emotes/')) return ['Emote'];
  if (p.includes('/Armor/')) return ['Armor'];
  return ['Amulet', 'Ring', 'Weapon', 'Armor', 'Mod', 'Trait', 'Emote'];
}

function candidateNames(p) {
  const last = p.split('/').pop();
  const parts = last.split('_');
  if (p.includes('/Armor/') && parts[0] === 'Armor') return [{ armorSlot: parts[1], armorSet: parts.slice(2).join('') }];
  const stripped = last.replace(/^(Weapon|Trinket|Trait|Mod|Emote|Quest)_/, '')
    .replace(/^(Root|Wasteland|Swamp|Pan|Atoll|Rural|Snow|Jungle|City)_/, '');
  return [{ name: stripped }, { name: parts[parts.length - 1] }];
}

function link(items, gameInfo) {
  const allPaths = new Set();
  for (const ev of Object.values(gameInfo.events)) ev.items.forEach((p) => allPaths.add(p));
  // Keyed by "category|normalised name": "Beckon" is both a mod and an emote.
  const byName = new Map();
  const armor = new Map();
  const add = (p, name) => {
    for (const cat of pathCategories(p)) {
      const k = cat + '|' + norm(name);
      if (!byName.has(k)) byName.set(k, p);
    }
  };
  for (const p of allPaths) if (gameInfo.itemAltNames[p]) add(p, gameInfo.itemAltNames[p]);
  for (const p of allPaths) {
    for (const c of candidateNames(p)) {
      if (c.armorSet) armor.set(norm(c.armorSet) + '|' + c.armorSlot, p);
      else add(p, c.name);
    }
  }
  const used = new Set();
  for (const it of items) {
    const manual = MANUAL_KEYS[`${it.category}|${it.name}`];
    if (manual !== undefined) { it.key = manual; if (manual) used.add(manual); continue; }
    if (it.category === 'Armor') {
      // The sheet writes some set names differently from the game ("Osseus", "Leto's", "Warlord's").
      const set = norm(it.group.replace(/ Set$/, '').replace(/'s$/, ''));
      const sets = [set, SET_ALIASES[set]].filter(Boolean);
      const slot = Object.keys(ARMOR_SLOT_WORDS).find((s) => ARMOR_SLOT_WORDS[s].test(it.name.split(' ').slice(1).join(' ') || it.name));
      const p = slot && sets.map((x) => armor.get(x + '|' + slot)).find(Boolean);
      it.key = p || null;
      if (p) used.add(p);
      continue;
    }
    if (it.category === 'Consumable') { it.key = null; continue; }
    const n = norm(it.name.replace(/ Emote$/, ''));
    const p = byName.get(it.category + '|' + n);
    if (p) { it.key = p; used.add(p); }
    else it.key = null;
  }
  const unusedPaths = [...allPaths].filter((p) => !used.has(p) && /\/Items\/(Weapons|Armor|Trinkets|Mods|Traits)|Emotes/.test(p));
  return { unusedPaths };
}

function build({ report }) {
  const items = readSheet();
  const gameInfo = readGameInfo();
  for (const [ev, paths] of Object.entries(EXTRA_EVENT_ITEMS)) {
    gameInfo.events[ev] = gameInfo.events[ev] || { altName: null, items: [] };
    for (const p of paths) if (!gameInfo.events[ev].items.includes(p)) gameInfo.events[ev].items.push(p);
  }
  const { unusedPaths } = link(items, gameInfo);

  // Campaign-only / adventure-only items the sheet doesn't tag (tools/overrides.mjs).
  for (const it of items) {
    const fix = MODE_FIX[it.category + '|' + it.name];
    if (!fix) continue;
    it.mode = fix[0];
    if (fix[1] && !it.how.includes(fix[1].trim())) it.how += fix[1];
  }
  const unknown = Object.keys(MODE_FIX).filter((k) => !items.some((it) => it.category + '|' + it.name === k));
  if (unknown.length) console.warn('MODE_FIX names not in the sheet:', unknown.join(', '));

  items.forEach((it, i) => { it.id = i; });
  // "Comes equipped in the Repulsor": the mod is owned/available exactly when the weapon is.
  const weapons = new Map(items.filter((i) => i.category === 'Weapon').map((i) => [norm(i.name), i]));
  for (const it of items) {
    const m = it.category === 'Mod' && it.how.match(/Comes equipped in (?:the )?(.+?)(?:,| when|\.)/);
    if (!m) continue;
    const n = norm(m[1]);
    const w = weapons.get(WEAPON_ALIASES[n] || n);
    if (!w) { console.warn('weapon not found for mod', it.name, '->', m[1]); continue; }
    it.comesWith = w.id;
    if (!it.world) it.world = w.world;
  }
  // Every new character starts with these; the tutorial blade is taken away again.
  for (const it of items) if (/^New characters begin/.test(it.how) && !/removed/.test(it.how)) it.starter = true;
  const data = {
    generated: new Date().toISOString().slice(0, 10),
    items,
    events: gameInfo.events,
    subLocations: gameInfo.subLocations,
    mainLocations: gameInfo.mainLocations,
  };
  const out = '// Generated by tools/build-data.mjs - do not edit by hand.\n' +
    'var RWA_DATA = ' + JSON.stringify(data, null, 1) + ';\n' +
    "if (typeof module !== 'undefined') module.exports = RWA_DATA;\n";
  fs.writeFileSync(path.join(ROOT, 'js/data.js'), out);

  const linked = items.filter((i) => i.key).length;
  console.log(`js/data.js: ${items.length} items (${linked} with a game path), ${Object.keys(gameInfo.events).length} events`);
  if (report) {
    console.log('\n-- Items without a path (except consumables):');
    for (const it of items) if (!it.key && it.category !== 'Consumable') console.log(`  ${it.category}|${it.name}  [${it.world}]`);
    console.log('\n-- Different items sharing the same path (check that this is intended):');
    const byKey = {};
    for (const it of items) if (it.key) (byKey[it.key] = byKey[it.key] || []).push(it.name);
    for (const [k, names] of Object.entries(byKey)) if (names.length > 1) console.log(`  ${k}: ${names.join(' / ')}`);
    console.log('\n-- GameInfo paths not used by any sheet item:');
    unusedPaths.forEach((p) => console.log('  ' + p));
  }
}

const args = process.argv.slice(2);
if (args.includes('--download')) await download();
build({ report: args.includes('--report') });
