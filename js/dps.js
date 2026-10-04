// Damage-per-second estimate for a character's build.
//
// Weapon numbers come from js/stats.js (Fextralife wiki tables); levels, traits, rings,
// amulet, armor and mods come from the character read by js/character.js.
//
//   damage per shot = base × upgrade × (1 + damage bonuses)
//                     upgrade: +10% of base per level for normal weapons (max +20),
//                              +20% per level for boss weapons (max +10) — both reach 3× base
//   critical hits   ×1.5, plus critical damage bonuses (Kingslayer +25% at max)
//   weak spot       × (1 + weapon weak spot bonus + weak spot damage bonuses)
//   fire rate       RPS × (1 + fire rate bonuses)
// Bonuses of the same kind add up. The wiki has no reload times, so DPS is "while firing".
//
// Effects are written out by hand below from the wiki texts (in js/stats.js), because the
// texts mix damage dealt with damage taken, penalties and conditions. Anything with a
// condition is returned with `when` so the page can let the player switch it on.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./data.js'), require('./stats.js'));
  else root.RWA_DPS = factory(root.RWA_DATA, root.RWA_STATS);
})(this, function (DATA, STATS) {
  'use strict';

  var BASE_CRIT_DAMAGE = 0.5;
  var STAT_LABEL = {
    allDamage: 'All damage', rangedDamage: 'Ranged damage', meleeDamage: 'Melee damage', critChance: 'Crit chance',
    critDamage: 'Crit damage', weakspot: 'Weak spot damage', fireRate: 'Fire rate', modDamage: 'Mod damage', summonDamage: 'Summon damage',
  };
  var STAT_ORDER = Object.keys(STAT_LABEL);

  // [stat, value, condition]. Value per level for traits.
  var TRAITS = {
    'Executioner': [['critChance', 0.0125]],
    'Kingslayer': [['critDamage', 0.0125]],
    'Exploiter': [['weakspot', 0.01]],
    "Mind's Eye": [['rangedDamage', 0.0075]],
    'Trigger Happy': [['fireRate', 0.01]],
    'Warrior': [['meleeDamage', 0.01]],
    'Last Resort': [['allDamage', 0.01, 'below 15% health']],
    'Cold As Ice': [['allDamage', 0.005, 'hitting enemies from behind']],
    'Armor Piercer': [['allDamage', 0.01, 'hitting armored parts']],
    'Evocation': [['modDamage', 0.0075]],
    'Invoker': [['summonDamage', 0.01]],
  };

  var ACCESSORIES = {
    "Akari War Band": [['critChance', 0.15, '20s after a perfect dodge'], ['critDamage', 0.15, '20s after a perfect dodge']],
    'Backbreaker Ring': [['meleeDamage', 0.30, 'melee backstabs']],
    'Band of Castor': [['fireRate', -0.15], ['meleeDamage', 0.10, 'with Band of Pollux']],
    'Band of Pollux': [['meleeDamage', 0.15], ['rangedDamage', -0.15], ['meleeDamage', 0.10, 'with Band of Castor']],
    'Band of Strength': [['meleeDamage', 0.20, 'after 4 melee charge attacks (10s)']],
    'Braided Thorns': [['critChance', 0.10], ['critChance', 0.10, '10s after a kill']],
    'Burden of the Follower': [['fireRate', -0.35]],
    'Burden of the Gambler': [['critChance', 0.15], ['critDamage', 0.25], ['noWeakspot', 1]],
    'Burden of the Warlord': [['allDamage', 0.15]],
    'Compulsion Loop': [['fireRate', 0.15, '7s after a kill']],
    'Devouring Loop': [['critFactor', 0.15]], // 5% of crits deal 4× damage
    'Empowering Loop': [['rangedDamage', 0.25], ['fireRate', -0.10]],
    'Five Fingered Ring': [['critChance', 0.20], ['critDamage', 0.25]],
    'Gravity Stone': [['allDamage', 0.20, '2+ enemies within 10m']],
    'Grim Coil': [['allDamage', 0.21, 'after reloading a well-used magazine, 3 stacks']],
    "Gunslinger's Ring": [['fireRate', 0.10]],
    'Heartseeker': [['critDamage', 0.20], ['critChance', 1, 'against non-aggressive enemies']],
    "Hunter's Band": [['rangedDamage', 0.10], ['weakspot', 0.20]],
    'Jewel of the Black Sun': [['rangedDamage', 0.21, '20s after ranged kills, 3 stacks']],
    'Ring of Flawless Beauty': [['weakspot', 0.40], ['rangedDamage', -0.20, 'when missing a weak spot']],
    'Ring of Shadows': [['allDamage', 0.15, 'against non-aggressive enemies']],
    'Ring of Supremacy': [['allDamage', 0.20, 'after 10s at full health']],
    'Ring of the Admiral': [['allDamage', 0.15]],
    'Ring of the Mantis': [['fireRate', 0.15, 'after standing still 1s'], ['critDamage', 0.20, 'after standing still 1s']],
    "Scavenger's Ring": [['rangedDamage', 0.10, '30s after a pickup'], ['meleeDamage', 0.10, '30s after a pickup']],
    'Spirit Stone': [['modDamage', 0.10]],
    'Stone of Balance': [['rangedDamage', 0.12], ['meleeDamage', 0.12]],
    'Brutal Mark': [['allDamage', 0.25, 'enemies below 50% health']],
    "Butcher's Fetish": [['critChance', 0.15, '10s after a charged melee hit'], ['critDamage', 0.25, '10s after a charged melee hit']],
    "Daredevil's Charm": [['allDamage', 0.30, 'per unequipped armor piece']],
    "Gunslinger's Charm": [['fireRate', 0.15]],
    "Hangman's Memento": [['weakspot', 0.50, '10s after a kill']],
    'Heart of Darkness': [['rangedDamage', 0.20], ['meleeDamage', 0.20]],
    'Onyx Pendulum': [['rangedDamage', 0.25, 'stowed gun, after 10 stacks']],
    'Shattered Vertebrae': [['rangedDamage', 0.10], ['critChance', 0.02, 'per non-critical hit, resets on crit']],
    'Soul Anchor': [['rangedDamage', 0.0625, 'per active summon (max 4)'], ['meleeDamage', 0.0625, 'per active summon (max 4)']],
    'Talisman of Animosity': [['weakspot', 0.30], ['allDamage', 0.10, '10s after a weak spot kill']],
    'Terror Margin': [['meleeDamage', 0.20, 'at full health']],
    'Vengeance Idol': [['allDamage', 0.30, 'below 50% health']],
    'White Rose': [['allDamage', 0.25, 'per unequipped firearm']],
  };

  // Values for 1/2/3 pieces; `stacks` multiplies a per-stack value.
  var SETS = {
    'Akari Set': { stats: ['fireRate'], values: [0.075, 0.15, 0.30], when: '20s after a perfect dodge' },
    'Carapace Set': { stats: ['allDamage'], values: [0.05, 0.10, 0.15] },
    'Drifter Set': { stats: ['rangedDamage', 'meleeDamage'], values: [0.015, 0.03, 0.05], stacks: 5, when: 'after sprinting/evading, 5 stacks' },
    'Elder Set': { stats: ['allDamage'], values: [0.075, 0.15, 0.30], when: '30s after a Dragon Heart' },
    'Hunter Set': { stats: ['rangedDamage', 'weakspot'], values: [0.05, 0.10, 0.20] },
    'Labyrinth Set': { stats: ['modDamage'], values: [0.15, 0.30, 0.50] },
    'Osseus Set': { stats: ['allDamage'], values: [0.10, 0.20, 0.35], when: 'repeated hits on the same enemy, at max' },
    'Radiant Set': { stats: ['critChance', 'critDamage'], values: [0.0075, 0.015, 0.03], stacks: 10, when: 'after critical hits, 10 stacks' },
    'Scavenger Set': { stats: ['rangedDamage', 'meleeDamage'], values: [0.005, 0.01, 0.02], stacks: 10, when: 'after pickups, 10 stacks' },
    'Scrapper Set': { stats: ['allDamage'], values: [0.075, 0.15, 0.30], when: 'enemies within 5m' },
    'Slayer Set': { stats: ['allDamage'], values: [0.075, 0.15, 0.30], when: 'first hit after reloading' },
    'Twisted Set': { stats: ['meleeDamage', 'modDamage'], values: [0.0075, 0.015, 0.03], stacks: 10, when: 'at full health, 10 stacks' },
    'Void Set': { stats: ['allDamage'], values: [0.075, 0.15, 0.25], when: 'after 5s without taking damage' },
    "Warlord's Set": { stats: ['rangedDamage', 'meleeDamage'], values: [0.10, 0.25, 0.40], when: '30s after a Dragon Heart' },
  };
  var SET_FIXED = { 'Osseus Set': [['fireRate', 0.05]] }; // always on, whatever the piece count

  // Buffs from mods while they're active.
  var MOD_BUFFS = {
    'Song of Swords': [['allDamage', 0.10]],
    "Hunter's Mark": [['critChance', 0.10]],
    'Hot Shot': [['rangedDamage', 0.15]],
  };

  function sheetItem(name) { return DATA.items.filter(function (i) { return i.name === name; })[0]; }
  function isBossWeapon(name) { var it = sheetItem(name); return !!(it && it.key && /\/Weapons\/Boss\//.test(it.key)); }

  function add(list, entries, source, scale, forceWhen) {
    (entries || []).forEach(function (e) {
      list.push({ stat: e[0], value: e[1] * (scale || 1), when: forceWhen || e[2] || null, source: source });
    });
  }

  // Every bonus the build gives, from traits, rings, amulet, armor sets and mods.
  function bonuses(ch) {
    var list = [];
    ch.traits.forEach(function (t) { if (t.level) add(list, TRAITS[t.name], t.name + ' ' + t.level, t.level); });

    var pieces = {};
    ch.loadout.forEach(function (l) {
      var it = l.entry.item;
      if ((l.label === 'Ring' || l.label === 'Amulet') && it) add(list, ACCESSORIES[it.name], it.name);
      if (/^(Head|Body|Legs)$/.test(l.label) && it && it.group) pieces[it.group] = (pieces[it.group] || 0) + 1;
    });
    Object.keys(pieces).forEach(function (set) {
      var s = SETS[set], n = Math.min(pieces[set], 3), label = set.replace(/ Set$/, '') + ' set, ' + n + (n > 1 ? ' pieces' : ' piece');
      add(list, SET_FIXED[set], label);
      if (!s) return;
      s.stats.forEach(function (stat) { list.push({ stat: stat, value: s.values[n - 1] * (s.stacks || 1), when: s.when || null, source: label }); });
    });

    mods(ch).forEach(function (m) { add(list, MOD_BUFFS[m.name], m.name, 1, 'while ' + m.name + ' is active'); });
    return list;
  }

  // Mods on the equipped guns: what they summon and how hard it hits.
  function mods(ch) {
    var out = [];
    ch.loadout.forEach(function (l) {
      if (l.label !== 'Hand gun' && l.label !== 'Long gun') return;
      var fixed = STATS.weapons[l.entry.name] && STATS.weapons[l.entry.name].mod;
      var names = l.entry.mods.map(function (m) { return m.name; });
      if (!names.length && fixed) names = [fixed];
      names.forEach(function (n) {
        var info = STATS.mods[n] || null, text = info ? info.effect : '';
        var max = /\(max (\d+)\)/i.exec(text);
        var summons = /summons? an? |summon an? |summons a/i.test(text) || /^summon/i.test(info && info.type || '') ? (max ? +max[1] : 1) : 0;
        var perHit = /(\d+(\.\d+)?)\s+(?:[A-Z]+\s+)?damage per (?:hit|bite)/i.exec(text) || /deals?\s+(\d+(\.\d+)?)\s+(?:[A-Z]+\s+)?damage/.exec(text) || /dealing\s+(?:up to\s+)?(\d+(\.\d+)?)/i.exec(text);
        var rate = /(\d+(\.\d+)?) rounds per second/i.exec(text);
        var lasts = /lasts?(?: for)? (\d+(\.\d+)?) seconds/i.exec(text);
        out.push({
          name: n, weapon: l.entry.name, slot: l.label, type: info ? info.type : '', effect: text,
          summons: summons, damagePerHit: perHit ? +perHit[1] : null, hitsPerSecond: rate ? +rate[1] : null,
          duration: lasts ? +lasts[1] : null,
        });
      });
    });
    return out;
  }

  function sum(list, stat, on) {
    return list.filter(function (b) { return b.stat === stat && (!b.when || on(b)); }).reduce(function (a, b) { return a + b.value; }, 0);
  }

  // DPS of one weapon at a level. `on(bonus)` says which conditional bonuses count.
  function weaponDps(name, level, list, on) {
    var w = STATS.weapons[name]; if (!w) return null;
    on = on || function () { return false; };
    var boss = isBossWeapon(name), maxLevel = boss ? 10 : 20, lvl = Math.min(level || 0, maxLevel);
    var upgrade = 1 + lvl * (boss ? 0.2 : 0.1), melee = w.type === 'Melee';
    var bonus = sum(list, 'allDamage', on) + sum(list, melee ? 'meleeDamage' : 'rangedDamage', on);
    var hit = w.damage * upgrade * (1 + bonus);
    var critChance = Math.max(0, Math.min(1, w.crit / 100 + sum(list, 'critChance', on)));
    var critMult = (1 + BASE_CRIT_DAMAGE + sum(list, 'critDamage', on)) * (1 + sum(list, 'critFactor', on));
    var expected = hit * (1 + critChance * (critMult - 1));
    var weakMult = sum(list, 'noWeakspot', on) ? 1 : 1 + w.weakspot / 100 + sum(list, 'weakspot', on);
    var rps = w.rps ? w.rps * Math.max(0.1, 1 + (melee ? 0 : sum(list, 'fireRate', on))) : null;
    return {
      name: name, type: w.type, level: lvl, maxLevel: maxLevel, boss: boss, stats: w, upgrade: upgrade,
      hit: hit, critChance: critChance, critMult: critMult, weakMult: weakMult, rps: rps, bonus: bonus,
      expectedHit: expected, expectedWeakHit: expected * weakMult,
      dps: rps ? expected * rps : null, weakDps: rps ? expected * weakMult * rps : null,
      perMagazine: w.magazine ? expected * w.magazine : null,
      secondsPerMagazine: rps && w.magazine ? w.magazine / rps : null,
      reloadBound: !!(w.magazine && w.magazine <= 3),
    };
  }

  // Summons from both mods together: how many at once, damage per hit and DPS when known.
  function summonsOf(modList, list, on) {
    var bonus = sum(list, 'summonDamage', on) + sum(list, 'modDamage', on) + sum(list, 'allDamage', on);
    return modList.filter(function (m) { return m.summons; }).map(function (m) {
      var hit = m.damagePerHit != null ? m.damagePerHit * (1 + bonus) : null;
      return { name: m.name, count: m.summons, hit: hit, dps: hit != null && m.hitsPerSecond ? hit * m.hitsPerSecond * m.summons : null, duration: m.duration };
    });
  }

  function analyze(ch, on) {
    on = on || function () { return false; };
    var list = bonuses(ch);
    var equipped = ch.loadout.filter(function (l) { return /^(Hand gun|Long gun|Melee)$/.test(l.label); }).map(function (l) {
      var r = weaponDps(l.entry.name, l.entry.level, list, on);
      if (r) r.slot = l.label;
      return r || { name: l.entry.name, slot: l.label, missing: true };
    });
    var owned = ch.arsenal.filter(function (a) { return a.category === 'Weapon'; }).map(function (a) { return weaponDps(a.name, a.level, list, on); })
      .filter(Boolean).sort(function (a, b) { return (b.dps || 0) - (a.dps || 0) || b.expectedHit - a.expectedHit; });
    var modList = mods(ch), summons = summonsOf(modList, list, on);
    var modBonus = sum(list, 'modDamage', on) + sum(list, 'allDamage', on);
    modList.forEach(function (m) { m.hit = m.damagePerHit != null ? m.damagePerHit * (1 + modBonus) : null; });
    return {
      bonuses: list, equipped: equipped, owned: owned, mods: modList, summons: summons,
      summonCount: summons.reduce(function (a, s) { return a + s.count; }, 0),
      summonDps: summons.reduce(function (a, s) { return a + (s.dps || 0); }, 0),
      totals: STAT_ORDER.map(function (s) { return { stat: s, label: STAT_LABEL[s], always: sum(list, s, function () { return false; }), active: sum(list, s, on) }; }),
    };
  }

  return { analyze: analyze, weaponDps: weaponDps, STAT_LABEL: STAT_LABEL, ACCESSORIES: ACCESSORIES, SETS: SETS };
});
