// What the world save remembers about each area: quests and their state, zones and how much
// of them was explored, chests opened, loot left on the ground and objects broken or opened.
//
// save_N.sav keeps one "container" per map (Main, each quest, each zone tile), each a blob:
//   [u32 2][u32 package version][u32 actor table offset][u32 loose actor list offset]
//   actor table:  u32 count, then [u64 actor id][u32 offset][u32 size]; each actor is a small
//                 save (read with js/gvas.js) holding its properties: Open, Health, QuestState…
//   loose actors: u32 count, then [u64 actor id][10 floats transform][FString class] — things
//                 spawned at runtime: dropped loot, chests of generated tiles, quests, zones.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./data.js'), require('./gvas.js'), require('./character.js'));
  else root.RWA_WORLDSTATE = factory(root.RWA_DATA, root.RWA_GVAS, root.RWA_CHARACTER);
})(this, function (DATA, GVAS, CHAR) {
  'use strict';

  function splitWords(s) { return String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/\s+/g, ' ').trim(); }
  function className(path) { return String(path || '').split('/').pop().split('.').pop().replace(/_C$/, ''); }

  function readContainer(bytes, view, blob) {
    var at = blob.blobAt, u32 = function (o) { return view.getUint32(o, true); };
    var tableOff = u32(at + 8), looseOff = u32(at + 12);
    var loose = {}, n = u32(at + looseOff), p = at + looseOff + 4, i;
    for (i = 0; i < n; i++) {
      var id = u32(p); p += 8 + 40;
      var len = view.getInt32(p, true), cls = '';
      for (var k = 0; k < len - 1; k++) cls += String.fromCharCode(bytes[p + 4 + k]);
      p += 4 + len;
      loose[id] = className(cls);
    }
    var actors = [], count = u32(at + tableOff);
    for (i = 0; i < count; i++) {
      var e = at + tableOff + 4 + i * 16, aid = u32(e), off = u32(e + 8);
      var save = GVAS.readBlob(bytes, { blobAt: at + off }), rootObj = save.objects[0] || {};
      actors.push({ id: aid, cls: loose[aid] || null, props: rootObj.props || {}, comps: rootObj.comps || {} });
    }
    return actors;
  }

  var QUEST_TYPE = { Boss: 'Boss', MiniBoss: 'Miniboss', SmallD: 'Dungeon', Siege: 'Siege', Event: 'Item drop', OverworldPOI: 'Point of interest' };
  var LOOT_NAMES = {
    Resource_Scraps: 'Scrap', Resource_Rare_Iron: 'Simple Iron', Resource_Rare_ForgedIron: 'Forged Iron', Resource_Rare_GalvanizedIron: 'Galvanized Iron',
    Resource_Rare_HardenedIron: 'Hardened Iron', Resource_Special_LumeniteCrystal: 'Lumenite Crystal', Resource_TraitBook: 'Trait Book',
    Ammo_HandGun: 'Hand gun ammo', Ammo_LongGun: 'Long gun ammo', Ammo_Special: 'Special ammo',
  };
  var WORLD_OF = { City: 'Earth', Rural: 'Earth', Wasteland: 'Rhom', Swamp: 'Corsus', Jungle: 'Yaesha', Snow: 'Reisum' };
  var STATE = /EQuestState::(\w+)/;

  function questState(a) {
    var s = (STATE.exec(a.props.QuestState || '') || [])[1];
    if (!s) Object.keys(a.comps).forEach(function (k) { var m = STATE.exec(a.comps[k].State || ''); if (m && !s) s = m[1]; });
    if (a.props.Complete === true) s = 'Complete';
    return s || null;
  }

  // Ticks of 100 ns -> seconds.
  function ticks(v) { return v ? v / 1e7 : 0; }

  function read(buffer) {
    var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var file = GVAS.readFile(bytes);
    var containers = (file.root.props.Containers || []).filter(function (c) { return c && c.props && c.props.Blob; });

    var zones = {}, quests = [], loot = [], chests = [], objects = { broken: 0, opened: 0, unlocked: 0, switchedOn: 0 }, flags = {};
    var modes = [];

    containers.forEach(function (c) {
      var key = String(c.props.Key), m = /Zone_(\d+)_/.exec(key), tileZone = m ? +m[1] : null;
      var actors;
      try { actors = readContainer(bytes, view, c.props.Blob); } catch (e) { return; }
      actors.forEach(function (a) {
        var cls = a.cls || '', p = a.props;
        if (cls === 'ZoneActor') {
          var fow = p.FowVisitedCoordinates && p.FowVisitedCoordinates.Coordinates;
          zones[p.ID] = {
            id: p.ID, label: p.Label || '', level: p.ZoneLevel || p.Level || 0, parent: p.ParentZoneID != null ? p.ParentZoneID : null,
            questId: p.QuestID, explored: fow ? fow.length : 0, template: className(p.MapTemplate),
            chests: 0, chestsOpen: 0, loot: 0,
          };
        } else if (/^Quest_/.test(cls)) {
          quests.push({ id: p.ID, parent: p.ParentQuestID != null ? p.ParentQuestID : null, cls: cls, zoneId: a.comps.Zone ? a.comps.Zone.ZoneID : p.ZoneID, inZone: p.ZoneID, state: questState(a), props: p, comps: a.comps });
          if (/^Quest_(Campaign|AdventureMode)/.test(cls) && p.PlayTime) modes.push({ cls: cls, playTime: ticks(p.PlayTime), difficulty: p.Difficulty });
          Object.keys(p).forEach(function (k) { if (p[k] === true && !/^(Created|Generated|bCanBeDamaged|StartsActive)$/.test(k)) flags[splitWords(k)] = true; });
        } else if (/LootContainer/.test(cls)) {
          chests.push({ zone: tileZone, open: !!p.Open, cls: cls });
        } else if (cls && /^(Resource_|Ammo_|Consumable_|Trinket_|Weapon_|Armor_|Mod_|Item_)/.test(cls)) {
          var info = CHAR.itemFromPath('/' + cls + '.' + cls + '_C');
          var qty = 1;
          // The quantity lives on the item's InstanceData object inside the actor's save.
          if (p.InstanceData && p.InstanceData.props && p.InstanceData.props.Quantity) qty = p.InstanceData.props.Quantity;
          loot.push({ cls: cls, name: LOOT_NAMES[cls] || info.name, item: info.item, quantity: qty, zone: tileZone });
        } else if (!cls) {
          if (p.Health === 0) objects.broken++;
          if (p.Open === true) objects.opened++;
          if (p.Locked === false) objects.unlocked++;
          if (p['Turned On'] === true || p.On === true || p.PowerOn === true) objects.switchedOn++;
        }
      });
    });

    // Which top-level quest (campaign or adventure) each quest belongs to.
    var byId = {}; quests.forEach(function (q) { byId[q.id] = q; });
    // Unlabelled zones are the overworld of a campaign or adventure: name them after its world.
    Object.keys(zones).forEach(function (k) {
      var z = zones[k], q = byId[z.questId], r = q, seen = 0;
      while (r && r.parent != null && byId[r.parent] && seen++ < 20) r = byId[r.parent];
      var w = r && /_(City|Rural|Wasteland|Swamp|Jungle|Snow)(_|$)/.exec(r.cls + '_');
      if (!z.label && w) z.label = WORLD_OF[w[1]] + (/AdventureMode/.test(r.cls) ? ' (adventure)' : '');
    });

    // Tiles belong to a zone; tally chests and loot per zone.
    chests.forEach(function (ch) { var z = zones[ch.zone]; if (z) { z.chests++; if (ch.open) z.chestsOpen++; } });
    loot.forEach(function (l) { var z = zones[l.zone]; if (z) z.loot++; l.zoneLabel = z ? zoneName(zones, z) : ''; });
    function rootOf(q) { var seen = 0; while (q && q.parent != null && byId[q.parent] && seen++ < 20) q = byId[q.parent]; return q; }
    var events = quests.map(function (q) {
      var parts = q.cls.split('_'), type = QUEST_TYPE[parts[1]];
      if (!type) return null;
      var key = parts.slice(2).join('_'), ev = DATA.events[key];
      var z = zones[q.zoneId] || zones[q.inZone];
      var r = rootOf(q), mode = r && /AdventureMode/.test(r.cls) ? 'Adventure' : r && /Campaign/.test(r.cls) ? 'Campaign' : '';
      return {
        name: /^TraitBook/.test(key) ? 'Trait Book' : ev && ev.altName ? splitWords(ev.altName.trim()) : splitWords(key), type: type, key: key,
        area: z && z.label ? z.label : (zones[q.inZone] ? zoneName(zones, zones[q.inZone]) : ''),
        state: q.state, done: q.state === 'Complete', mode: mode,
        items: ev ? ev.items.map(function (p) { return CHAR.itemFromPath(p); }) : [],
      };
    }).filter(Boolean);

    var zoneList = Object.keys(zones).map(function (k) { return zones[k]; }).map(function (z) { z.name = zoneName(zones, z); return z; })
      .sort(function (a, b) { return a.id - b.id; });
    return {
      zones: zoneList, events: events, loot: loot, objects: objects,
      chests: { total: chests.length, open: chests.filter(function (c) { return c.open; }).length },
      modes: modes, flags: Object.keys(flags).sort(),
    };
  }

  // Generated overworld zones have no label; name them after the area they open into or their template.
  function zoneName(zones, z) {
    if (z.label) return z.label;
    var t = z.template.replace(/^(Template|Quest)_/, '').replace(/_Template.*$|_\d+$/, '');
    return splitWords(t.replace(/AdventureMode_(\w+?)(_Template)?$/, 'Adventure $1').replace(/^(\w+)_Overworld/, '$1 overworld'));
  }

  return { read: read };
});
