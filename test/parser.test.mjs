// node --test test/
// Data checks always run. Save checks need a real save:
//   RWA_SAVE=C:\...\save_0.sav  [RWA_PROFILE=C:\...\profile.sav]  node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DATA = require('../js/data.js');
const P = require('../js/parser.js');

test('every sheet item has a unique game path', () => {
  const seen = {};
  for (const it of DATA.items) {
    if (!it.key) continue;
    assert.ok(!seen[it.key], `${it.name} and ${seen[it.key]} both use ${it.key}`);
    seen[it.key] = it.name;
  }
});

test('every GameInfo event item is in the sheet', () => {
  const keys = new Set(DATA.items.map((i) => i.key));
  const missing = [];
  for (const [name, ev] of Object.entries(DATA.events)) {
    for (const p of ev.items) if (!keys.has(p) && /\/Items\/(Weapons|Armor|Trinkets|Mods|Traits)|Emotes/.test(p)) missing.push(`${name}: ${p}`);
  }
  // Starting-gear helmet that the sheet doesn't list.
  assert.deepEqual(missing.filter((m) => !m.endsWith('Armor_Head_Hunter')), []);
});

test('built-in mods point to the right weapon', () => {
  const byName = Object.fromEntries(DATA.items.map((i) => [i.name, i]));
  assert.equal(DATA.items[byName['Skewer'].comesWith].name, 'Devastator');
  assert.equal(DATA.items[byName['Banish'].comesWith].name, 'Repulsor');
});

test('profile: inventory, archetype and ownership', () => {
  const marker = '/Game/Characters/Player/Base/Character_Master_Player.Character_Master_Player_C';
  const text = 'x/Game/_Core/Archetypes/Archetype_Cultist\0' + marker +
    '\0/Items/Weapons/Boss/Devastator/Weapon_Swamp_Devastator\0/Items/Mods/HotShot\0/Items/Armor/Akari/Armor_Head_Akari\0Character_Master_Player_C';
  const [c] = P.parseProfile(Buffer.from(text, 'latin1'));
  assert.equal(c.archetype, 'Ex-Cultist');
  const owns = P.ownership(c);
  const byName = Object.fromEntries(DATA.items.map((i) => [i.name, i]));
  assert.equal(owns(byName['Devastator']), true);
  assert.equal(owns(byName['Skewer']), true, 'Devastator built-in mod');
  assert.equal(owns(byName['Hot Shot']), true, 'matched by name');
  assert.equal(owns(byName['Akari Mask']), true);
  assert.equal(owns(byName['Akari Garb']), false);
  assert.equal(owns(byName['Vigor']), true, 'starting item');
});

const savePath = process.env.RWA_SAVE;
test('real save: campaign and adventure are read', { skip: !savePath && 'set RWA_SAVE' }, () => {
  const r = P.parseSave(fs.readFileSync(savePath));
  assert.ok(r.campaign, 'campaign not found');
  assert.ok(r.campaign.events.length > 10, 'campaign has too few events');
  for (const ev of [...r.campaign.events, ...(r.adventure ? r.adventure.events : [])]) {
    assert.ok(P.ZONES.includes(ev.zone), `invalid zone in ${ev.name}`);
    assert.ok(ev.name && ev.location, 'event without name/location');
  }
  if (process.env.RWA_EXPECT_ADVENTURE) assert.equal(r.adventure && r.adventure.world, process.env.RWA_EXPECT_ADVENTURE);
  if (process.env.RWA_PROFILE) assert.ok(P.parseProfile(fs.readFileSync(process.env.RWA_PROFILE)).length > 0, 'no characters in profile');
});

const DPS = require('../js/dps.js');
test('dps: upgrade, crit and weak spot math', () => {
  // SMG: 7 damage, 16 RPS, 5% crit, +100% weak spot. +20 = 3× base; average crit adds 5% × 50%.
  const smg = DPS.weaponDps('Submachine Gun', 20, []);
  assert.equal(smg.hit, 21);
  assert.ok(Math.abs(smg.dps - 21 * 1.025 * 16) < 1e-9);
  assert.equal(smg.weakMult, 2);
  // Boss weapons cap at +10 and also reach 3× base there.
  const boss = DPS.weaponDps('Devastator', 10, []);
  assert.equal(boss.maxLevel, 10);
  assert.equal(boss.upgrade, 3);
  // Kingslayer 20 + Exploiter 20, and a conditional bonus that only counts when switched on.
  const list = [
    { stat: 'critDamage', value: 0.25 }, { stat: 'weakspot', value: 0.2 },
    { stat: 'allDamage', value: 0.1, when: 'while Song of Swords is active', source: 'Song of Swords' },
  ];
  const off = DPS.weaponDps('Submachine Gun', 20, list), on = DPS.weaponDps('Submachine Gun', 20, list, () => true);
  assert.equal(off.critMult, 1.75);
  assert.ok(Math.abs(off.weakMult - 2.2) < 1e-9);
  assert.ok(Math.abs(on.hit - 21 * 1.1) < 1e-9);
});

const WS = require('../js/worldstate.js');
test('real save: world state (quests, zones, chests, loot) is read', { skip: !savePath && 'set RWA_SAVE' }, () => {
  const s = WS.read(fs.readFileSync(savePath));
  assert.ok(s.zones.length > 0, 'no zones');
  assert.ok(s.zones.every((z) => z.name), 'zone without a name');
  assert.ok(s.events.length > 0, 'no quests');
  assert.ok(s.chests.open <= s.chests.total);
  assert.ok(s.loot.every((l) => l.name && l.quantity > 0), 'loot without name or quantity');
});

const CHAR = require('../js/character.js');
test('real save: character details and world stats are read', { skip: !savePath && 'set RWA_SAVE' }, () => {
  const w = CHAR.readWorld(fs.readFileSync(savePath));
  assert.ok(w.timePlayed > 0, 'no time played');
  assert.ok(w.difficulty, 'no difficulty');
  if (!process.env.RWA_PROFILE) return;
  const p = CHAR.readProfile(fs.readFileSync(process.env.RWA_PROFILE));
  const ch = p.characters.find(Boolean);
  assert.ok(ch && !ch.error, ch && ch.error);
  assert.ok(ch.level > 0, 'no level');
  assert.ok(ch.loadout.length > 0, 'nothing equipped');
  assert.ok(ch.traits.length > 0, 'no traits');
  assert.ok(p.achievements.every((a) => a.id), 'achievement without id');
  const unnamed = ch.loadout.concat(ch.arsenal).filter((r) => (r.entry || r).category !== 'Consumable' && !(r.entry || r).item && !/Dragon Heart/.test((r.entry || r).name));
  assert.deepEqual(unnamed.map((r) => (r.entry || r).name), [], 'equipment not matched to a sheet item');
});
