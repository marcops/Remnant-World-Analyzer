// What the world save remembers about each area: quests and their state, zones with their map
// (tiles, links, explored cells), chests, loot left on the ground, map objects, NPC conversations,
// key items, checkpoints and how often each quest was generated.
//
// save_N.sav keeps one "container" per map (Main, each quest, each zone tile), each a blob:
//   [u32 2][u32 package version][u32 actor table offset][u32 loose actor list offset]
//   actor table:  u32 count, then [u64 actor id][u32 offset][u32 size]; each actor is a small
//                 save (read with js/gvas.js) holding its properties: Open, Health, QuestState…
//   loose actors: u32 count, then [u64 actor id][10 floats: rotation, location, scale][FString class]
//                 — things spawned at runtime: dropped loot, chests of generated tiles, quests, zones.
// Zone tile containers are named Zone_<zone id>_<tile id>, which places their chests and loot on the map.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./data.js'), require('./gvas.js'), require('./character.js'));
  else root.RWA_WORLDSTATE = factory(root.RWA_DATA, root.RWA_GVAS, root.RWA_CHARACTER);
})(this, function (DATA, GVAS, CHAR) {
  'use strict';

  function splitWords(s) { return String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/\s+/g, ' ').trim(); }
  function className(path) { return String(path || '').split('/').pop().split('.').pop().replace(/_C$/, ''); }

  var QUEST_TYPE = { Boss: 'Boss', MiniBoss: 'Miniboss', SmallD: 'Dungeon', Siege: 'Siege', Event: 'Item drop', OverworldPOI: 'Point of interest' };
  var LOOT_NAMES = {
    Resource_Scraps: 'Scrap', Resource_Rare_Iron: 'Simple Iron', Resource_Rare_ForgedIron: 'Forged Iron', Resource_Rare_GalvanizedIron: 'Galvanized Iron',
    Resource_Rare_HardenedIron: 'Hardened Iron', Resource_Special_LumeniteCrystal: 'Lumenite Crystal', Resource_TraitBook: 'Trait Book',
    Ammo_HandGun: 'Hand gun ammo', Ammo_LongGun: 'Long gun ammo', Ammo_Special: 'Special ammo',
  };
  var WORLD_OF = { City: 'Earth', Rural: 'Earth', Wasteland: 'Rhom', Swamp: 'Corsus', Jungle: 'Yaesha', Snow: 'Reisum' };
  var STATE = /EQuestState::(\w+)/;
  // Tile connections: bit -> [dx, dy].
  var EDGES = [[1, 1, 0], [2, 0, 1], [4, -1, 0], [8, 0, -1]];

  function readContainer(bytes, view, blob) {
    var at = blob.blobAt, u32 = function (o) { return view.getUint32(o, true); };
    var tableOff = u32(at + 8), looseOff = u32(at + 12);
    var loose = {}, n = u32(at + looseOff), p = at + looseOff + 4, i, k;
    for (i = 0; i < n; i++) {
      var id = u32(p), f = [];
      for (k = 0; k < 10; k++) f.push(view.getFloat32(p + 8 + k * 4, true));
      p += 8 + 40;
      var len = view.getInt32(p, true), cls = '';
      for (k = 0; k < len - 1; k++) cls += String.fromCharCode(bytes[p + 4 + k]);
      p += 4 + len;
      loose[id] = { cls: cls, location: [f[4], f[5], f[6]] };
    }
    var actors = [], count = u32(at + tableOff);
    for (i = 0; i < count; i++) {
      var e = at + tableOff + 4 + i * 16, aid = u32(e), off = u32(e + 8), size = u32(e + 12);
      var save = GVAS.readBlob(bytes, { blobAt: at + off }), rootObj = save.objects[0] || {};
      var l = loose[aid];
      actors.push({
        id: aid, cls: l ? className(l.cls) : null, classPath: l ? l.cls : null, location: l ? l.location : null, size: size,
        props: rootObj.props || {}, comps: rootObj.comps || {}, objects: save.objects,
      });
    }
    return actors;
  }

  function questState(a) {
    var s = (STATE.exec(a.props.QuestState || '') || [])[1];
    if (!s) Object.keys(a.comps).forEach(function (k) { var m = STATE.exec((a.comps[k] || {}).State || ''); if (m && !s) s = m[1]; });
    if (a.props.Complete === true) s = 'Complete';
    return s || null;
  }

  // Ticks of 100 ns -> seconds.
  function ticks(v) { return v ? v / 1e7 : 0; }

  // Tile type from its level name: Farmland_STR_03 -> Straight, Snow_Forest_CRN_01 -> Corner…
  function tileKind(t) {
    var n = className(t.TileLevelName), id = t.ID;
    // Event areas keep a placeholder tile at (-1000, -1000): not part of the map.
    if (/^Tile_Blank/.test(n) || t.Tag === 'Blank' || Math.abs(t.Coord.X) >= 1000) return 'blank';
    if (/VistaNear|Vista/.test(n)) return 'vista';
    if (id === 'Start') return 'start';
    if (id === 'End' || /End_Transition|Transition_End|_End_/.test(n)) return 'exit';
    if (/POI/.test(id) || /^Quest_/.test(n)) return 'poi';
    if (/_CRN_|_CNR_/.test(n)) return 'corner';
    if (/_TJ_/.test(n)) return 'junction';
    if (/_STR_/.test(n)) return 'straight';
    return 'other';
  }

  function read(buffer) {
    var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var file = GVAS.readFile(bytes);
    var containers = (file.root.props.Containers || []).filter(function (c) { return c && c.props && c.props.Blob; });

    var zones = {}, quests = [], loot = [], chests = [], objects = { broken: 0, opened: 0, unlocked: 0, switchedOn: 0, other: 0 }, flags = {};
    var modes = [], conversations = [], keyItems = [], npcs = [], raw = [], sockets = [], fuses = [];

    containers.forEach(function (c) {
      var key = String(c.props.Key), m = /Zone_(\d+)_(\d+)/.exec(key);
      var tileZone = m ? +m[1] : null, tileId = m ? +m[2] : null;
      var actors;
      try { actors = readContainer(bytes, view, c.props.Blob); } catch (e) { raw.push({ key: key, error: String(e), actors: [] }); return; }
      raw.push({ key: key, actors: actors });
      actors.forEach(function (a) {
        var cls = a.cls || '', p = a.props;
        if (cls === 'ZoneActor') {
          var fow = (p.FowVisitedCoordinates && p.FowVisitedCoordinates.Coordinates) || [];
          var gen = a.comps.MapGen || {};
          zones[p.ID] = {
            id: p.ID, label: p.Label || '', level: p.ZoneLevel || p.Level || 0, itemLevel: p.ItemLevel || 0,
            parent: p.ParentZoneID != null ? p.ParentZoneID : null, questId: p.QuestID, template: className(p.MapTemplate),
            tileSet: className(p.TileSet && p.TileSet.path), colors: p.ColorScheme || '',
            explored: fow.length, fow: fow.map(function (q) { return [q.X, q.Y]; }),
            tiles: (gen.TilesBase || []).map(function (t) {
              return { id: t._ID, role: t.ID, kind: tileKind(t), x: t.Coord.X, y: t.Coord.Y, edges: t.Edges, tag: t.Tag, level: className(t.TileLevelName), rotation: t.TileRotation, chests: 0, chestsOpen: 0, loot: [], events: [], links: [] };
            }),
            links: (p.ZoneLinks || []).map(function (l) {
              return { label: (l.Label || '').replace(/\0/g, ''), type: String(l.Type || '').replace('EZoneLinkType::', ''), category: l.Category, tileId: l.TileID, active: !!l.IsActive, used: !!l.Used, name: l.NameID, to: l.DestinationZone };
            }),
            spawns: (p.DynamicResources || []).map(className),
            chests: 0, chestsOpen: 0, loot: 0,
          };
        } else if (/^Quest_/.test(cls)) {
          var placed = null;
          Object.keys(a.comps).forEach(function (k) { var v = a.comps[k]; if (!placed && v && v.TileID != null && /^(Tile|POI)$/.test(k)) placed = v.TileID; });
          quests.push({ id: p.ID, parent: p.ParentQuestID != null ? p.ParentQuestID : null, cls: cls, zoneId: a.comps.Zone ? a.comps.Zone.ZoneID : p.ZoneID, inZone: p.ZoneID, tileId: placed, state: questState(a), props: p, comps: a.comps });
          if (/^Quest_(Campaign|AdventureMode)/.test(cls) && (p.PlayTime || p.LastCheckpointNameID)) {
            modes.push({
              cls: cls, name: splitWords(cls.replace(/^Quest_/, '').replace('AdventureMode', 'Adventure')), playTime: ticks(p.PlayTime), difficulty: p.Difficulty,
              checkpoint: p.LastCheckpointNameID || '', checkpointZone: p.LastCheckpointZoneID,
              generated: (p.UsageCount || []).map(function (u) { return { template: splitWords(className(u[0]).replace(/^(Quest|Template)_/, '')), count: u[1] }; }),
            });
          }
          if (p.PlayTime && !/^Quest_(Campaign|AdventureMode)/.test(cls)) modes.push({ cls: cls, name: splitWords(cls.replace(/^Quest_/, '')), playTime: ticks(p.PlayTime), generated: [] });
          Object.keys(p).forEach(function (k) { if (p[k] === true && !/^(Created|Generated|bCanBeDamaged|StartsActive)$/.test(k)) flags[splitWords(k)] = true; });
          var keys = a.comps.PersistenceKeys && a.comps.PersistenceKeys.KeyValues;
          (keys || []).forEach(function (kv) { conversations.push({ key: kv[0], text: splitWords(kv[0]), quest: splitWords(cls.replace(/^Quest_/, '')) }); });
          var inv = a.comps.RemnantPlayerInventory && a.comps.RemnantPlayerInventory.Items;
          (inv || []).forEach(function (it) { if (it.ItemBP) keyItems.push({ name: splitWords(className(it.ItemBP.path).replace(/^Quest_(Item_)?/, '')), quest: splitWords(cls.replace(/^Quest_/, '')) }); });
        } else if (/LootContainer/.test(cls)) {
          chests.push({ zone: tileZone, tile: tileId, open: !!p.Open, cls: cls, location: a.location });
        } else if (cls && /^(Resource_|Ammo_|Consumable_|Trinket_|Weapon_|Armor_|Mod_|Item_)/.test(cls)) {
          var info = CHAR.itemFromPath('/' + cls + '.' + cls + '_C');
          var qty = 1;
          // The quantity lives on the item's InstanceData object inside the actor's save.
          if (p.InstanceData && p.InstanceData.props && p.InstanceData.props.Quantity) qty = p.InstanceData.props.Quantity;
          loot.push({ cls: cls, name: LOOT_NAMES[cls] || info.name, item: info.item, quantity: qty, zone: tileZone, tile: tileId, location: a.location });
        } else if (/^Character_/.test(cls)) {
          var items = ((a.comps.Inventory || {}).Items || []).filter(function (it) { return it.ItemBP; }).map(function (it) { return LOOT_NAMES[className(it.ItemBP.path)] || CHAR.itemFromPath(it.ItemBP.path).name; });
          npcs.push({ name: splitWords(cls.replace(/^Character_/, '')), items: items, where: key.split('/').pop().split(':')[0] });
        } else if (!cls) {
          // Key items placed in the world: sockets (D.A.T.L.A. Key, Founder's Key) and fuse boxes.
          var socket = a.comps.ItemSocket && a.comps.ItemSocket.Slot;
          if (socket && socket.SlottedType) sockets.push({ cls: className(socket.SlottedType.path), full: !!socket.bFull, where: key });
          if (p.HasFuse === true) fuses.push({ where: key });
          var counted = false;
          if (p.Health === 0) { objects.broken++; counted = true; }
          if (p.Open === true) { objects.opened++; counted = true; }
          if (p.Locked === false) { objects.unlocked++; counted = true; }
          if (p['Turned On'] === true || p.On === true || p.PowerOn === true) { objects.switchedOn++; counted = true; }
          if (!counted) objects.other++;
        }
      });
    });

    var byId = {}; quests.forEach(function (q) { byId[q.id] = q; });
    function rootOf(q) { var seen = 0; while (q && q.parent != null && byId[q.parent] && seen++ < 20) q = byId[q.parent]; return q; }
    // Unlabelled zones are the overworld of a campaign or adventure: name them after its world.
    Object.keys(zones).forEach(function (k) {
      var z = zones[k], r = rootOf(byId[z.questId]);
      // Which part of the save the area belongs to: the campaign, the adventure, or Ward 13 (the hub).
      z.mode = !r ? '' : /AdventureMode/.test(r.cls) ? 'Adventure' : /Campaign/.test(r.cls) ? 'Campaign' : /Ward13/.test(r.cls) ? 'Ward 13' : '';
      var w = r && /_(City|Rural|Wasteland|Swamp|Jungle|Snow)(_|$)/.exec(r.cls + '_');
      // Unlabelled inner areas take their quest's name (Quest_Cryptolith_Labyrinth -> "Cryptolith Labyrinth").
      var own = byId[z.questId];
      if (!z.label && z.parent != null && own) z.label = splitWords(own.cls.replace(/^Quest_(OverworldPOI_|Event_|SmallD_|MiniBoss_|Boss_|Siege_)?/, ''));
      if (!z.label && w && z.parent == null) z.label = WORLD_OF[w[1]] + (/AdventureMode/.test(r.cls) ? ' (adventure)' : '');
      z.name = zoneName(z);
    });

    function tileOf(zone, tile) {
      var z = zones[zone]; if (!z) return null;
      return z.tiles.filter(function (t) { return t.id === tile; })[0] || null;
    }
    chests.forEach(function (ch) {
      var z = zones[ch.zone]; if (!z) return;
      z.chests++; if (ch.open) z.chestsOpen++;
      var t = tileOf(ch.zone, ch.tile); if (t) { t.chests++; if (ch.open) t.chestsOpen++; }
    });
    loot.forEach(function (l) {
      var z = zones[l.zone]; l.zoneLabel = z ? z.name : '';
      if (z) z.loot++;
      var t = tileOf(l.zone, l.tile); if (t) t.loot.push(l);
    });
    Object.keys(zones).forEach(function (k) {
      zones[k].links.forEach(function (l) { var t = tileOf(+k, l.tileId); if (t) t.links.push(l); });
    });

    var events = quests.map(function (q) {
      var parts = q.cls.split('_'), type = QUEST_TYPE[parts[1]];
      if (!type) return null;
      var key = parts.slice(2).join('_'), ev = DATA.events[key];
      // The Cryptolith tower has one quest per world (Cryptolith_City, _Swamp, _Wasteland) but one reward list.
      if (/^Cryptolith_/.test(key)) { ev = DATA.events.Cryptolith; key = 'Cryptolith'; }
      var z = zones[q.zoneId] || zones[q.inZone];
      var r = rootOf(q), mode = r && /AdventureMode/.test(r.cls) ? 'Adventure' : r && /Campaign/.test(r.cls) ? 'Campaign' : '';
      var e = {
        name: /^TraitBook/.test(key) ? 'Trait Book' : key === 'Cryptolith' ? 'Cryptolith Tower' : ev && ev.altName ? splitWords(ev.altName.trim()) : splitWords(key), type: type, key: key,
        area: z ? z.name : '', zoneId: q.inZone, ownZone: q.zoneId !== q.inZone ? q.zoneId : null, tileId: q.tileId,
        state: q.state, done: q.state === 'Complete', mode: mode,
        items: ev ? ev.items.map(function (p) { return CHAR.itemFromPath(p); }) : [],
      };
      var t = tileOf(q.inZone, q.tileId); if (t) t.events.push(e);
      return e;
    }).filter(Boolean);

    // Child zones (dungeons, boss arenas) open from a tile of their parent: mark it.
    Object.keys(zones).forEach(function (k) {
      var z = zones[k]; if (z.parent == null || !zones[z.parent]) return;
      var parent = zones[z.parent], entrance = parent.tiles.filter(function (t) { return t.kind === 'exit' && t.tag && z.template.indexOf(t.tag.replace(/^To/, '')) >= 0; })[0];
      z.entranceTile = entrance ? entrance.id : null;
    });

    // Cryptolith towers in this world: where, and whether their teleporter to the Labyrinth room was used.
    var cryptolith = quests.filter(function (q) { return /^Quest_OverworldPOI_Cryptolith_/.test(q.cls); }).map(function (q) {
      var z = zones[q.inZone], world = /_Cryptolith_(\w+)$/.exec(q.cls)[1];
      var link = z ? z.links.filter(function (l) { return /CryptolithTeleporter/.test(l.name || ''); })[0] : null;
      var r = rootOf(q);
      return {
        world: WORLD_OF[world] || world, area: z ? z.name : '', zoneId: q.inZone, tileId: q.tileId, done: q.state === 'Complete',
        mode: r && /AdventureMode/.test(r.cls) ? 'Adventure' : 'Campaign',
        teleporterActive: link ? link.active : null, teleporterUsed: link ? link.used : null,
        labyrinth: quests.some(function (x) { return x.cls === 'Quest_Cryptolith_Labyrinth' && x.parent === q.parent; }),
      };
    });

    var zoneList = Object.keys(zones).map(function (k) { return zones[k]; }).sort(function (a, b) { return a.id - b.id; });
    var top = file.root.props;
    return {
      zones: zoneList, events: events, loot: loot, objects: objects,
      chests: { total: chests.length, open: chests.filter(function (c) { return c.open; }).length },
      modes: modes, flags: Object.keys(flags).sort(), conversations: conversations, keyItems: keyItems, npcs: npcs, cryptolith: cryptolith,
      sockets: sockets, fuses: fuses,
      header: {
        newGame: !!top.NewGame, hasCampaign: !!top.HasMainCampaign, requiresFullGame: !!top.RequiresFullGame, lastRootSlot: top.LastActiveRootSlot,
        location: splitWords(className(top.LocationImage).replace(/^T_UI_Waypoint_|_A$/g, '')), uniqueIds: top.UniqueIDGenerator,
      },
      raw: raw,
    };
  }

  function zoneName(z) {
    if (z.label) return z.label;
    var t = z.template.replace(/^(Template|Quest)_/, '').replace(/_Template.*$|_\d+$/, '');
    return splitWords(t);
  }

  return { read: read, EDGES: EDGES };
});
