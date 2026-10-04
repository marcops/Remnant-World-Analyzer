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

test('cada item da planilha tem um caminho de jogo único', () => {
  const seen = {};
  for (const it of DATA.items) {
    if (!it.key) continue;
    assert.ok(!seen[it.key], `${it.name} e ${seen[it.key]} usam ${it.key}`);
    seen[it.key] = it.name;
  }
});

test('todo item de evento do GameInfo está na planilha', () => {
  const keys = new Set(DATA.items.map((i) => i.key));
  const missing = [];
  for (const [name, ev] of Object.entries(DATA.events)) {
    for (const p of ev.items) if (!keys.has(p) && /\/Items\/(Weapons|Armor|Trinkets|Mods|Traits)|Emotes/.test(p)) missing.push(`${name}: ${p}`);
  }
  // Starting-gear helmet that the sheet doesn't list.
  assert.deepEqual(missing.filter((m) => !m.endsWith('Armor_Head_Hunter')), []);
});

test('mods fixos apontam para a arma certa', () => {
  const byName = Object.fromEntries(DATA.items.map((i) => [i.name, i]));
  assert.equal(DATA.items[byName['Skewer'].comesWith].name, 'Devastator');
  assert.equal(DATA.items[byName['Banish'].comesWith].name, 'Repulsor');
});

test('profile: inventário, arquétipo e posse', () => {
  const marker = '/Game/Characters/Player/Base/Character_Master_Player.Character_Master_Player_C';
  const text = 'x/Game/_Core/Archetypes/Archetype_Cultist\0' + marker +
    '\0/Items/Weapons/Boss/Devastator/Weapon_Swamp_Devastator\0/Items/Mods/HotShot\0/Items/Armor/Akari/Armor_Head_Akari\0Character_Master_Player_C';
  const [c] = P.parseProfile(Buffer.from(text, 'latin1'));
  assert.equal(c.archetype, 'Ex-Cultist');
  const owns = P.ownership(c);
  const byName = Object.fromEntries(DATA.items.map((i) => [i.name, i]));
  assert.equal(owns(byName['Devastator']), true);
  assert.equal(owns(byName['Skewer']), true, 'mod fixo do Devastator');
  assert.equal(owns(byName['Hot Shot']), true, 'reconhecido pelo nome');
  assert.equal(owns(byName['Akari Mask']), true);
  assert.equal(owns(byName['Akari Garb']), false);
  assert.equal(owns(byName['Vigor']), true, 'item inicial');
});

const savePath = process.env.RWA_SAVE;
test('save real: campanha e aventura são lidas', { skip: !savePath && 'defina RWA_SAVE' }, () => {
  const r = P.parseSave(fs.readFileSync(savePath));
  assert.ok(r.campaign, 'campanha não encontrada');
  assert.ok(r.campaign.events.length > 10, 'campanha com poucos eventos');
  for (const ev of [...r.campaign.events, ...(r.adventure ? r.adventure.events : [])]) {
    assert.ok(P.ZONES.includes(ev.zone), `zona inválida em ${ev.name}`);
    assert.ok(ev.name && ev.location, 'evento sem nome/local');
  }
  if (process.env.RWA_EXPECT_ADVENTURE) assert.equal(r.adventure && r.adventure.world, process.env.RWA_EXPECT_ADVENTURE);
  if (process.env.RWA_PROFILE) assert.ok(P.parseProfile(fs.readFileSync(process.env.RWA_PROFILE)).length > 0, 'nenhum personagem no profile');
});
