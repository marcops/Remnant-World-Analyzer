// Save-file parsing for Remnant: From the Ashes.
//
// The campaign/adventure detection and event walk are a port of RemnantSaveManager
// (Razzmatazzz, GPL-3.0), which itself started from hzla's original javascript.
// Works in the browser (global RWA_PARSER) and in Node (require) so it can be tested
// against real saves without a browser.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./data.js'));
  else root.RWA_PARSER = factory(root.RWA_DATA);
})(this, function (DATA) {
  'use strict';

  // 'Subject 2923' is the DLC's rural Earth (World_Rural, Ward Prime), kept apart from the city.
  // 'Ward 17' holds the final bosses, reached after the other worlds.
  var ZONES = ['Earth', 'Subject 2923', 'Rhom', 'Corsus', 'Yaesha', 'Reisum', 'Ward 17'];
  var ADVENTURE_ZONES = { City: 'Earth', Wasteland: 'Rhom', Swamp: 'Corsus', Jungle: 'Yaesha', Snow: 'Reisum' };

  // Saves are binary with ASCII asset paths inside; latin1 keeps every byte as one char.
  function decode(buffer) {
    if (typeof buffer === 'string') return buffer;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(buffer)) return buffer.toString('latin1');
    return new TextDecoder('latin1').decode(buffer);
  }

  function splitWords(s) {
    return s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/'s([A-Z])/g, "'s $1").trim();
  }

  function getZone(line) {
    if (/World_City|Quest_Church/.test(line)) return 'Earth';
    if (line.indexOf('World_Rural') !== -1) return 'Subject 2923';
    if (line.indexOf('World_Wasteland') !== -1) return 'Rhom';
    if (line.indexOf('World_Jungle') !== -1) return 'Yaesha';
    if (line.indexOf('World_Swamp') !== -1) return 'Corsus';
    if (/World_Snow|Campaign_Clementine/.test(line)) return 'Reisum';
    return null;
  }

  function getEventType(line) {
    if (line.indexOf('SmallD') !== -1) return 'Side Dungeon';
    if (line.indexOf('Quest_Boss') !== -1) return 'World Boss';
    if (line.indexOf('Siege') !== -1 || line.indexOf('Quest_Church') !== -1) return 'Siege';
    if (line.indexOf('Mini') !== -1) return 'Miniboss';
    if (line.indexOf('Quest_Event') !== -1) {
      if (line.indexOf('Nexus') !== -1) return 'Siege';
      if (line.indexOf('Sketterling') !== -1) return 'Loot Beetle';
      return 'Item Drop';
    }
    if (/OverworldPOI|OverWorldPOI|OverworlPOI/.test(line)) return 'Point of Interest';
    return null;
  }

  function makeEvent(key, name, type, location, zone) {
    var ev = DATA.events[key];
    return {
      key: key,
      name: name || splitWords((ev && ev.altName) || key),
      type: type,
      zone: zone,
      location: location,
      items: ev ? ev.items.slice() : [],
    };
  }

  // Walks one campaign/adventure block and returns its events in map order.
  function processEvents(text, mode) {
    var zoneEvents = {}, seen = {};
    ZONES.forEach(function (z) { zoneEvents[z] = []; seen[z] = {}; });
    var churchEvents = [];
    var currentMain = 'Fairview', currentSub = null, eventName = null;
    var re = /(?:\/[a-zA-Z0-9_]+){3}\/(([a-zA-Z0-9]+_[a-zA-Z0-9]+_[a-zA-Z0-9_]+)|Quest_Church)/g;
    var m;
    while ((m = re.exec(text))) {
      var line = m[0];
      var lastEventName = eventName;
      eventName = null;
      try {
        // Some world bosses have no preceding dungeon; items after them are in the overworld.
        if (currentSub === "TheRavager'sHaunt" || currentSub === 'TheTempestCourt') currentSub = null;
        var zone = getZone(line);
        var type = getEventType(line);
        var seg = line.split('/')[4] || '';

        if (line.indexOf('Overworld_Zone') !== -1 || line.indexOf('_Overworld_') !== -1) {
          var p = seg.split('_');
          currentMain = DATA.mainLocations[p[1] + ' ' + p[2] + ' ' + p[3]] || null;
          continue;
        } else if (line.indexOf('Quest_Church') !== -1) {
          currentMain = 'Chapel Station';
          eventName = 'RootMother';
          currentSub = 'Church of the Harbinger';
        } else if (type) {
          eventName = seg.split('_')[2];
          if (line.indexOf('OverworldPOI') !== -1) currentSub = null;
          else if (line.indexOf('Quest_Event') === -1) currentSub = DATA.subLocations[eventName] || null;
          if (currentMain === 'Chapel Station') {
            if (line.indexOf('Quest_Boss') !== -1) currentMain = 'Westcourt';
            else currentSub = null;
          }
        }
        if (mode === 'Adventure') currentMain = null;

        if (!eventName || eventName === lastEventName || !zone || !type) continue;
        if (seen[zone][type + '|' + eventName]) continue;
        seen[zone][type + '|' + eventName] = true;

        var loc = [zone];
        if (currentMain) loc.push(splitWords(currentMain));
        if (currentSub && splitWords(currentSub) !== loc[loc.length - 1]) loc.push(splitWords(currentSub));
        var ev = makeEvent(eventName, null, type, loc.join(': '), zone);
        if (currentMain === 'Chapel Station') churchEvents.unshift(ev);
        else zoneEvents[zone].push(ev);

        // Extra events that are implied by others (from RemnantSaveManager).
        if (eventName === 'Cryptolith' && zone === 'Rhom') {
          zoneEvents[zone].push(makeEvent('SoulLink', 'Soul Link', 'Item Drop', zone, zone));
        } else if (eventName === 'BrainBug') {
          zoneEvents[zone].push(makeEvent('Sketterling', 'Sketterling', 'Loot Beetle', ev.location, zone));
        } else if (eventName === 'BarnSiege' || eventName === 'Homestead') {
          zoneEvents[zone].push(makeEvent('WardPrime', 'Ward Prime', 'Quest Event', 'Subject 2923: Ward Prime', 'Subject 2923'));
        }
      } catch (e) {
        if (typeof console !== 'undefined') console.warn('Error reading event', line, e);
      }
    }

    // Events the save doesn't list, placed with the ones it does, zone by zone.
    // Only events the data knows (Whispers exists when the page has set up the skins).
    var fixed = FIXED_EVENTS.filter(function (f) { return f.modes.indexOf(mode) !== -1 && (f.church || DATA.events[f.key]); });
    var placed = [];
    var out = [];
    ZONES.forEach(function (zone) {
      var mine = fixed.filter(function (f) { return f.zone === zone; });
      var put = function (f, location) {
        if (placed.indexOf(f) !== -1) return;
        placed.push(f);
        if (f.church) out.push.apply(out, churchEvents);
        else out.push(makeEvent(f.key, f.name, f.type, f.location || location, zone));
      };
      mine.forEach(function (f) { if (f.at === 'start') put(f); });
      zoneEvents[zone].forEach(function (ev) {
        mine.forEach(function (f) { if (f.before && (ev.key === f.before || ev.location.indexOf(f.before) !== -1)) put(f, ev.location); });
        out.push(ev);
      });
      mine.forEach(function (f) { if (f.at === 'end') put(f); });
    });
    return out;
  }

  // Everything the world has that the save doesn't write as an event: Ward 13, fixed bosses and NPCs.
  // modes: where it exists (Campaign, Subject2923, Adventure).
  // at 'start' / 'end' of its zone, or `before` the first event with that key or location part
  // (not added when that event isn't in the world); no `location` = the location of that event.
  var FIXED_EVENTS = [
    { key: 'Ward13', name: 'Ward 13', type: 'Home', location: 'Earth: Ward 13', zone: 'Earth', modes: ['Campaign'], at: 'start' },
    // Armor skins sold in Ward 13, reachable from every campaign and adventure (the page fills DATA.events.Whispers).
    { key: 'Whispers', name: 'Whispers', type: 'Merchant', location: 'Ward 13', zone: 'Earth', modes: ['Campaign', 'Subject2923', 'Adventure'], at: 'start' },
    { key: 'FoundersHideout', name: "Founder's Hideout", type: 'Point of Interest', location: 'Earth: Fairview', zone: 'Earth', modes: ['Campaign'], at: 'start' },
    { church: true, zone: 'Earth', modes: ['Campaign'], before: 'Westcourt' },
    { key: 'UndyingKing', name: 'Undying King', type: 'World Boss', location: 'Rhom: Undying Throne', zone: 'Rhom', modes: ['Campaign'], at: 'end' },
    { key: 'IskalQueen', name: 'Iskal Queen', type: 'Point of Interest', location: 'Corsus: The Mist Fen', zone: 'Corsus', modes: ['Campaign'], before: 'The Mist Fen' },
    // In adventure the Queen lives in her temple (Swamps of Corsus): her shop and Guardian's Heart rewards.
    { key: 'IskalQueen', name: 'Iskal Queen', type: 'Point of Interest', zone: 'Corsus', modes: ['Adventure'], before: 'QueensTemple' },
    { key: 'SlaveRevolt', name: 'Fight With The Rebels', type: 'Siege', location: 'Yaesha: Shrine of the Immortals', zone: 'Yaesha', modes: ['Campaign'], before: 'The Scalding Glade' },
    { key: 'Ward17', name: 'The Dreamer', type: 'World Boss', location: 'Ward 17', zone: 'Ward 17', modes: ['Campaign'], at: 'end' },
    { key: 'Ward17Root', name: 'Harsgaard', type: 'World Boss', location: 'Ward 17: Root Dimension', zone: 'Ward 17', modes: ['Subject2923'], at: 'end' },
  ];

  function between(text, startMarker, endMarker) {
    var end = text.indexOf(endMarker);
    if (end === -1) return null;
    var start = text.lastIndexOf(startMarker, end);
    if (start === -1) return null;
    return text.slice(start, end);
  }

  // The active adventure is the one whose closing marker comes first in the file;
  // older adventures in other zones can leave markers further down.
  function findAdventure(text) {
    var best = null;
    Object.keys(ADVENTURE_ZONES).forEach(function (z) {
      var endMarker = '/Game/World_' + z + '/Quests/Quest_AdventureMode/Quest_AdventureMode_' + z + '.Quest_AdventureMode_' + z + '_C';
      var pos = text.indexOf(endMarker);
      if (pos !== -1 && (!best || pos < best.pos)) best = { zone: z, pos: pos, endMarker: endMarker };
    });
    if (!best) return null;
    var startMarker = '/Game/World_' + best.zone + '/Quests/Quest_AdventureMode/Quest_AdventureMode_' + best.zone + '_0';
    var end = best.pos + best.endMarker.length;
    var start = text.lastIndexOf(startMarker, end);
    if (start === -1) return null;
    return { world: ADVENTURE_ZONES[best.zone], text: text.slice(start + startMarker.length, end) };
  }

  function parseSave(buffer) {
    var text = decode(buffer);
    var result = { campaign: null, adventure: null };

    var main = between(text, '/Game/Campaign_Main/Quest_Campaign_City.Quest_Campaign_City',
      '/Game/Campaign_Main/Quest_Campaign_Main.Quest_Campaign_Main_C');
    if (main) {
      result.campaign = { mode: 'Campaign', label: 'Campaign', events: processEvents(main, 'Campaign') };
    } else {
      var s2923 = between(text, '/Game/World_Rural/Templates/Template_Rural_Overworld_0',
        '/Game/Campaign_Clementine/Quest_Campaign_Clementine.Quest_Campaign_Clementine_C');
      if (s2923) result.campaign = { mode: 'Subject2923', label: 'Subject 2923 Campaign', events: processEvents(s2923, 'Subject2923') };
    }

    var adv = findAdventure(text);
    if (adv) result.adventure = { mode: 'Adventure', label: 'Adventure', world: adv.world, events: processEvents(adv.text, 'Adventure') };
    return result;
  }

  // profile.sav holds every character; the n-th one belongs to save_n.sav.
  function parseProfile(buffer) {
    var text = decode(buffer);
    var marker = '/Game/Characters/Player/Base/Character_Master_Player.Character_Master_Player_C';
    var parts = text.split(marker);
    var patterns = [
      /\/Items\/Weapons(\/[a-zA-Z0-9_]+)+\/[a-zA-Z0-9_]+/g,
      /\/Items\/Armor\/([a-zA-Z0-9_]+\/)?[a-zA-Z0-9_]+/g,
      /\/Items\/Trinkets\/(BandsOfCastorAndPollux\/)?[a-zA-Z0-9_]+/g,
      /\/Items\/Mods\/[a-zA-Z0-9_]+/g,
      /\/Items\/Traits\/[a-zA-Z0-9_]+/g,
      /\/Items\/QuestItems(\/[a-zA-Z0-9_]+)+\/[a-zA-Z0-9_]+/g,
      /\/Quests\/[a-zA-Z0-9_]+\/[a-zA-Z0-9_]+/g,
      /\/Player\/Emotes\/Emote_[a-zA-Z0-9]+/g,
    ];
    var characters = [];
    for (var i = 1; i < parts.length; i++) {
      var archetype = 'Unknown';
      var am = parts[i - 1].match(/\/Game\/_Core\/Archetypes\/[a-zA-Z_]+/g);
      if (am) {
        var a = am[am.length - 1].replace('/Game/_Core/Archetypes/', '').split('_')[1];
        archetype = { Scrapper: 'Scrapper', Cultist: 'Ex-Cultist', Hunter: 'Hunter' }[a] || a;
      }
      var endIdx = parts[i].indexOf('Character_Master_Player_C');
      var inv = endIdx === -1 ? parts[i] : parts[i].slice(0, endIdx);
      var items = {};
      patterns.forEach(function (re) { (inv.match(re) || []).forEach(function (p) { items[p] = true; }); });
      characters.push({ index: i - 1, archetype: archetype, inventory: Object.keys(items) });
    }
    return characters;
  }

  // Loose name used to recognise items that have no fixed path in the data
  // (starting gear, Ward 13 mods, typos in the game's own asset names).
  function norm(s) { return s.toLowerCase().replace(/^the /, '').replace(/[^a-z0-9]/g, ''); }
  function inventoryNames(inventory) {
    var names = {};
    inventory.forEach(function (p) {
      var last = p.split('/').pop();
      var parts = last.split('_');
      if (p.indexOf('/Armor/') !== -1 && parts[0] === 'Armor') { names['armor|' + norm(parts.slice(2).join('')) + '|' + parts[1]] = true; return; }
      var stripped = last.replace(/^(Weapon|Trinket|Trait|Mod|Emote|Quest)_/, '').replace(/^(Root|Wasteland|Swamp|Pan|Atoll|Rural|Snow|Jungle|City)_/, '');
      names[norm(stripped)] = true;
      names[norm(parts[parts.length - 1])] = true;
    });
    return names;
  }

  // Returns a function item -> true/false/null (null = unknown, no profile loaded).
  function ownership(character) {
    if (!character) return function () { return null; };
    var have = {};
    character.inventory.forEach(function (p) { have[p] = true; });
    var names = inventoryNames(character.inventory);
    function owns(item) {
      if (item.starter) return true;
      if (item.comesWith != null) return owns(DATA.items[item.comesWith]);
      if (item.key && have[item.key]) return true;
      if (item.category === 'Consumable' || item.category === 'Skin') return null;
      // Armor can also be matched by set and slot, except pieces that are quest items of their own (the
      // Twisted Mask is not the Twisted Hood, though both are the set's head).
      if (item.category === 'Armor' && (item.key || '').indexOf('/QuestItems/') < 0) {
        var set = norm((item.group || '').replace(/ Set$/, '').replace(/'s$/, ''));
        var slot = /legging|trousers|greaves|pants|boots|kilt|britches|tassets/i.test(item.name) ? 'Legs'
          : /mask|hood|helm|goggles|visage|headdress|hat|skull|shroud/i.test(item.name) ? 'Head' : 'Body';
        if (names['armor|' + set + '|' + slot]) return true;
        // Single pieces have their own group ("Bomber Hat" is Armor_Head_Bomber in the game).
        return Object.keys(names).some(function (k) {
          var p = k.split('|');
          return p[0] === 'armor' && p[2] === slot && p[1] && set.indexOf(p[1]) === 0;
        });
      }
      return !!names[norm(item.name.replace(/ Emote$/, ''))];
    }
    return owns;
  }

  return { parseSave: parseSave, parseProfile: parseProfile, ownership: ownership, ZONES: ZONES, decode: decode };
});
