// Character details read with js/gvas.js: level, loadout, traits, resources, stats
// (profile.sav) and time played, difficulty, deaths per quest (save_N.sav).
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./data.js'), require('./gvas.js'));
  else root.RWA_CHARACTER = factory(root.RWA_DATA, root.RWA_GVAS);
})(this, function (DATA, GVAS) {
  'use strict';

  // EquipmentSlotIndex in the inventory.
  var SLOTS = { 0: 'Hand gun', 1: 'Long gun', 2: 'Melee', 4: 'Head', 5: 'Body', 11: 'Legs', 13: 'Amulet', 8: 'Ring', 9: 'Ring', 6: 'Dragon Heart', 12: 'Quick use' };
  var SLOT_ORDER = [0, 1, 2, 4, 5, 11, 13, 8, 9, 6, 12];

  function norm(s) { return String(s).toLowerCase().replace(/^the /, '').replace(/[^a-z0-9]/g, ''); }
  function splitWords(s) { return s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/_/g, ' ').trim(); }

  // "/Game/.../Weapon_Pan_VoiceOfTheTempest.Weapon_Pan_VoiceOfTheTempest_C" -> "Weapon_Pan_VoiceOfTheTempest"
  function className(path) { return String(path || '').split('/').pop().split('.')[0]; }

  var byKeyName = {}, byName = {};
  DATA.items.forEach(function (it) {
    if (it.key) byKeyName[it.key.split('/').pop().toLowerCase()] = byKeyName[it.key.split('/').pop().toLowerCase()] || it;
    var n = norm(it.name.replace(/ Emote$/, ''));
    (byName[n] = byName[n] || []).push(it);
  });
  var PREFIX_CATEGORY = { Weapon: 'Weapon', Trait: 'Trait', Mod: 'Mod', Emote: 'Emote', Consumable: 'Consumable', Resource: 'Resource', Armor: 'Armor', Trinket: '' };

  // Sheet item for a game class, or a readable name when the sheet has none (resources, consumables, …).
  var itemCache = {};
  function itemFromPath(path) {
    var cls = className(path);
    if (itemCache[cls]) return itemCache[cls];
    // Armor skins (Armor_Head_Carapace_Skin) only change the look: name them after the piece, never count them as it.
    if (/_Skin$/.test(cls) && !/_PreOrder/.test(cls)) {
      var base = itemFromPath(path.replace(/_Skin(?=\.|_C$|$)/g, ''));
      return (itemCache[cls] = { name: (base.item ? base.name : splitWords(cls.replace(/_Skin$/, '').replace(/^Armor_/, ''))) + ' (skin)', category: 'Skin', cls: cls, item: null });
    }
    var parts = cls.split('_'), found = byKeyName[cls.toLowerCase()];
    if (!found && parts[0] === 'Armor' && parts.length >= 3) {
      var set = norm(parts.slice(2).join('')), slot = parts[1];
      found = DATA.items.filter(function (it) {
        // Sets are "Radiant Set"; single pieces have their own group ("Bomber Hat").
        var group = norm((it.group || '').replace(/ Set$/, '').replace(/'s$/, ''));
        if (it.category !== 'Armor' || (group !== set && group.indexOf(set) !== 0)) return false;
        var s = /legging|trousers|greaves|pants|boots|kilt|britches|tassets/i.test(it.name) ? 'Legs'
          : /mask|hood|helm|goggles|visage|headdress|hat|skull|shroud|crown/i.test(it.name) ? 'Head' : 'Body';
        return s === slot;
      })[0];
    }
    if (!found) {
      var stripped = cls.replace(/^(Weapon|Trinket|Trait|Mod|Emote|Quest|Consumable|Resource|Item)_/, '').replace(/^(Root|Wasteland|Swamp|Pan|Atoll|Rural|Snow|Jungle|City|Rare|Special)_/, '');
      // Boss weapon mods are named after their shot in the game files (GravityCoreShot is "Gravity Core").
      var cands = byName[norm(stripped)] || byName[norm(parts[parts.length - 1])] || byName[norm(stripped.replace(/Shot$/, ''))] || [];
      var want = PREFIX_CATEGORY[parts[0]];
      found = cands.filter(function (it) { return !want || it.category === want; })[0] || cands[0];
      if (!found) {
        var pretty = splitWords(stripped.replace(/^Special_|^Rare_/, ''));
        return (itemCache[cls] = { name: pretty, category: PREFIX_CATEGORY[parts[0]] || '', cls: cls, item: null });
      }
    }
    return (itemCache[cls] = { name: found.name, category: found.category, cls: cls, item: found });
  }

  // Readable names for resources the sheet doesn't list.
  var RESOURCE_NAMES = {
    Resource_Scraps: 'Scrap', Resource_Rare_Iron: 'Simple Iron', Resource_Rare_ForgedIron: 'Forged Iron',
    Resource_Rare_GalvanizedIron: 'Galvanized Iron', Resource_Rare_HardenedIron: 'Hardened Iron',
    Resource_Special_LumeniteCrystal: 'Lumenite Crystal', Resource_Special_GlowingFragment: 'Glowing Fragment',
    Resource_Special_Simulacrum: 'Simulacrum', Resource_Simulacrum: 'Simulacrum',
    Item_DragonHeartUpgrade: 'Dragon Heart upgrades',
  };
  // Always listed, with 0 when the character has none.
  var RESOURCE_ORDER = ['Scrap', 'Simple Iron', 'Forged Iron', 'Galvanized Iron', 'Hardened Iron', 'Lumenite Crystal', 'Simulacrum', 'Glowing Fragment', 'Dragon Heart upgrades'];

  function levelOf(entry) {
    var data = entry.InstanceData && entry.InstanceData.props;
    return data && data.Level != null ? data.Level : (data ? 0 : null); // default values are not written
  }

  function modsOf(entry) {
    var data = entry.InstanceData && entry.InstanceData.props;
    var mods = data && data.Mods && data.Mods.Mods;
    return (mods || []).filter(function (m) { return m && m.Mod; }).map(function (m) {
      return { name: itemFromPath(m.Mod.path).name, item: itemFromPath(m.Mod.path).item, level: m.ModLevel || 0 };
    });
  }

  function characterDetails(file, saved) {
    var p = saved.props || {};
    var inner = GVAS.readBlob(file.bytes, p.CharacterData);
    var root = inner.root, comps = root.comps || {}, stats = root.props || {};
    var items = (comps.Inventory && comps.Inventory.Items) || [];

    var loadout = [], arsenal = [], resources = [], consumables = [];
    items.forEach(function (e) {
      if (!e.ItemBP) return;
      var info = itemFromPath(e.ItemBP.path), cls = info.cls, data = e.InstanceData && e.InstanceData.props;
      var row = { name: RESOURCE_NAMES[cls] || info.name, category: info.category, item: info.item, level: levelOf(e), mods: modsOf(e), quantity: data && data.Quantity };
      if (e.EquipmentSlotIndex != null && e.EquipmentSlotIndex >= 0) loadout.push({ slot: e.EquipmentSlotIndex, label: SLOTS[e.EquipmentSlotIndex] || 'Slot ' + e.EquipmentSlotIndex, entry: row });
      if (/^(Resource|Item_DragonHeartUpgrade)/.test(cls)) resources.push(row);
      else if (/^Consumable_/.test(cls) && cls !== 'Consumable_DragonHeart') consumables.push(row);
      else if ((info.category === 'Weapon' || info.category === 'Armor') && row.level != null && !/_PreOrder$|_Nude$|Weapon_Fist/.test(cls)) arsenal.push(row);
    });
    loadout.sort(function (a, b) { return SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot); });
    // Every upgrade material, 0 when missing (the save only keeps what you have); anything unexpected goes last.
    var have = {}; resources.forEach(function (r) { have[r.name] = r; });
    resources = RESOURCE_ORDER.map(function (n) { return have[n] || { name: n, category: 'Resource', item: null, level: null, mods: [], quantity: 0 }; })
      .concat(resources.filter(function (r) { return RESOURCE_ORDER.indexOf(r.name) < 0; }));

    var traitComp = comps.Traits || {};
    var traits = (traitComp.Traits || []).filter(function (t) { return t && t.TraitBP; }).map(function (t) {
      var info = itemFromPath(t.TraitBP.path);
      return { name: info.name, item: info.item, level: t.Level || 0 };
    }).sort(function (a, b) { return b.level - a.level || a.name.localeCompare(b.name); });

    var kills = (stats.WeaponKillRecords || []).map(function (path, i) {
      var info = itemFromPath(path);
      return { name: info.name, item: info.item, kills: (stats.WeaponKillCounts || [])[i] || 0 };
    }).sort(function (a, b) { return b.kills - a.kills; });

    // Everything else the save keeps, shown as-is in "More from your save".
    var ammo = items.filter(function (e) { return e.ItemBP && e.InstanceData && e.InstanceData.props && e.InstanceData.props.Ammo != null; }).map(function (e) {
      var d = e.InstanceData.props, info = itemFromPath(e.ItemBP.path);
      return { name: info.name, item: info.item, reserve: d.Ammo, clip: d.AmmoInClip === 10000 ? null : d.AmmoInClip };
    });
    var shortcuts = ((comps.RadialShortcuts && comps.RadialShortcuts.Items) || []).filter(function (s) { return s.ItemBP; }).map(function (s) {
      return { radial: s.Radial, slot: s.Slot, name: RESOURCE_NAMES[className(s.ItemBP.path)] || itemFromPath(s.ItemBP.path).name };
    });
    var visuals = (p.Visuals || []).map(function (v) { return { slot: v.NameID, value: v.VisualID != null ? v.VisualID : v.DefaultVisualID }; }).filter(function (v) { return v.slot; });
    var extra = {
      powerLevel: p.PowerLevel,
      tutorials: (p.Keys || []).map(function (k) { return splitWords(String(k).replace(/^Tutorial[._]/, '').replace(/\./g, ' › ')); }),
      counters: (p.Counters || []).map(function (kv) { return { name: splitWords(String(kv[0]).replace(/^(Counter|Tutorial)\./, '')), value: kv[1] }; }),
      emotes: ((comps.Emotes && comps.Emotes.UnlockedEmotes) || []).filter(Boolean).map(function (e) { return itemFromPath(e.path).name; }),
      shortcuts: shortcuts, ammo: ammo, visuals: visuals,
      stamina: comps.Stamina && comps.Stamina.Value,
      recorders: (stats.StoredRecorders || []).length,
      cryptolithPhase: stats.CryptolithPhase || 0,
      usedHarsgaardRootGun: !!stats.HasEquippedHarsgaardRootGun,
      finishedIntro: !!p.bFinishedIntro,
      inHand: (function () {
        var h = comps.Inventory && comps.Inventory.EquipmentInHand;
        var e = items.filter(function (i) { return i.ID === h; })[0];
        return e && e.ItemBP ? itemFromPath(e.ItemBP.path).name : (h != null ? 'item #' + h : null);
      })(),
      // Quest items you carry (Cryptolith Sigil, keys, story items…).
      questItems: items.filter(function (e) { return e.ItemBP && /\/Quest|Quest_/.test(e.ItemBP.path); }).map(function (e) {
        var info = itemFromPath(e.ItemBP.path), cls = className(e.ItemBP.path);
        return { cls: cls, name: info.item ? info.name : splitWords(cls.replace(/^Quest_(Item_)?/, '')), item: info.item };
      }),
      newItems: items.filter(function (e) { return e.New && !e.Hidden && e.ItemBP; }).map(function (e) { return RESOURCE_NAMES[className(e.ItemBP.path)] || itemFromPath(e.ItemBP.path).name; }),
      hiddenItems: items.filter(function (e) { return e.Hidden; }).length,
      ammoPools: { handGun: comps.HandGunAmmo && comps.HandGunAmmo.Value, longGun: comps.LongGunAmmo && comps.LongGunAmmo.Value, special: comps.SpecialAmmo && comps.SpecialAmmo.Value },
      skins: (p.EquipmentVisuals || []).map(function (v) {
        return { item: itemFromPath(v.EquipmentPath).name, skin: v.SkinEquipmentPath ? itemFromPath(v.SkinEquipmentPath).name : '', level: v.EquipmentLevel };
      }),
      hostType: String(p.HostType || '').replace(/^.*::/, ''),
      characterName: p.Name,
      skipIntro: !!p.bSkipIntro,
      visualSeed: comps.VisualComp && comps.VisualComp.Seed,
      traitRank: p.TraitRank,
      // Pre-order skins, emotes and other account rewards handed to this character.
      awards: (p.ReceivedAwards || []).filter(function (a) { return a && a.AccountAward && a.bHasBeenAwarded; })
        .map(function (a) { return splitWords(className(a.AccountAward.path).replace(/^Award_/, '').replace(/_Skin_PreOrder$|_PreOrder$/, ' (pre-order)')); }),
    };

    var progression = comps.Progression || {};
    var milestones = ((comps.PersistenceKeys && comps.PersistenceKeys.KeyValues) || []).map(function (kv) { return splitWords(kv[0]); });
    var counters = {};
    (p.Counters || []).forEach(function (kv) { counters[kv[0]] = kv[1]; });

    return {
      archetype: splitWords(className(p.Archetype).replace(/^Archetype_|_UI$/g, '')).replace(/^Cultist$/, 'Ex-Cultist'),
      level: progression.Level != null ? progression.Level : p.Level,
      experience: progression.Experience || 0,
      powerLevel: p.PowerLevel,
      traitPoints: traitComp.TraitPoints || 0,
      traitPointsSpent: traitComp.TraitPointsSpent || 0,
      traits: traits,
      loadout: loadout,
      arsenal: arsenal.sort(function (a, b) { return (b.level || 0) - (a.level || 0) || a.name.localeCompare(b.name); }),
      resources: resources,
      consumables: consumables.sort(function (a, b) { return a.name.localeCompare(b.name); }),
      kills: kills,
      dragonHeartUses: counters['Counter.DragonHeart'] || 0,
      stats: {
        weakspotKills: stats.WeakspotKills || 0,
        explosiveKills: stats.ExplosiveDamageKills || 0,
        revives: stats.NumRevives || 0,
        timesRevived: stats.NumTimesRevived || 0,
        downedByTeammates: stats.NumTimesDownedByTeammates || 0,
        scrapPickedUp: stats.ScrapPickedUp || 0,
        armoredDamage: Math.round(stats.ArmoredDamageDealt || 0),
        fallDamage: Math.round(stats.NonLethalFallDamageTaken || 0),
        vaults: stats.VaultCount || 0,
        statusEffects: stats.StatusEffectsApplied || 0,
        cleansed: stats.ConsumableCleansedStatusEffects || 0,
        modsAcquired: stats.BasicRangedWeaponModsAcquired || 0,
        dogPets: stats.DogPetCounter || 0,
      },
      milestones: milestones,
      extra: extra,
    };
  }

  // One entry per save slot (index = save_N.sav); null where there is no character.
  function readProfile(buffer) {
    var file = GVAS.readFile(buffer);
    file.bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var rootProps = file.root.props;
    var achievements = (rootProps.AchievementProgress || []).map(function (a) {
      // The target is the number in the id: Acquire_10_Traits, Level_Trait_20, Craft_Boss_Weapon_5.
      var id = String(a.AchievementId || ''), m = /_(\d+)(?:_|$)/.exec(id);
      var name = splitWords(id).replace(/\d{4,}/g, function (d) { return (+d).toLocaleString('en-US'); });
      return { id: id, name: name, value: a.Value || 0, target: m ? +m[1] : 1 };
    });
    var characters = (rootProps.Characters || []).map(function (c) {
      if (!c || !c.props) return null;
      try { return characterDetails(file, c); } catch (e) { return { error: String(e) }; }
    });
    return {
      characters: characters, achievements: achievements, activeCharacter: rootProps.ActiveCharacterIndex || 0,
      settings: { loadscreenTip: rootProps.LoadscreenTipIndex, autoVisibility: !!rootProps.RunAutoVisSetting },
      accountAwards: (rootProps.AccountAwards || []).filter(Boolean).map(function (a) { return splitWords(className(a.path).replace(/^Award_/, '')); }),
      accountCurrencies: (rootProps.AccountCurrencies || []).map(function (c) { return { name: c.CurrencyType ? splitWords(className(c.CurrencyType.path).replace(/^Resource_Special_/, '')) : '?', quantity: c.Quantity || 0 }; }),
    };
  }

  var QUEST_TYPES = { Boss: 'Boss', MiniBoss: 'Miniboss', SmallD: 'Dungeon', Siege: 'Siege', Event: 'Item drop', OverworldPOI: 'Point of interest', AdventureMode: 'Adventure' };

  // World save extras: time played, difficulty, current objective and deaths per quest.
  function readWorld(buffer) {
    var p = GVAS.readFile(buffer).root.props;
    var deaths = (p.QuestFailCount || []).map(function (kv) {
      var q = className(kv[0]), parts = q.split('_'), key = parts.slice(2).join('_') || parts[1] || q;
      var ev = DATA.events[key];
      return { name: splitWords((ev && ev.altName) || key), type: QUEST_TYPES[parts[1]] || '', count: kv[1] };
    }).filter(function (d) { return d.count > 0; }).sort(function (a, b) { return b.count - a.count; });
    return {
      timePlayed: p.TimePlayed || 0, difficulty: p.Difficulty || '', objective: p.QuestLabel || '', deaths: deaths,
      hasCampaign: !!p.HasMainCampaign, questsGenerated: p.QuestIDGen || 0, zonesGenerated: p.ZoneIDGen || 0,
    };
  }

  return { readProfile: readProfile, readWorld: readWorld, itemFromPath: itemFromPath };
});
