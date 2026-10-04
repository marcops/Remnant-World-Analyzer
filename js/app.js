/* global RWA_DATA, RWA_PARSER, RWA_WIKI */
(function () {
  'use strict';

  var DATA = RWA_DATA, P = RWA_PARSER;
  var $ = function (id) { return document.getElementById(id); };

  var WORLD_LABEL = { Earth: 'Earth', 'Subject 2923': 'Subject 2923', Rhom: 'Rhom', Corsus: 'Corsus', Yaesha: 'Yaesha', Reisum: 'Reisum',
    'Ward 13': 'Ward 13', 'Ward 17': 'Ward 17', 'Ward Prime': 'Ward Prime', 'The Labyrinth': 'The Labyrinth', '': 'General / achievements' };
  var WORLD_ORDER = ['Earth', 'Rhom', 'Corsus', 'Yaesha', 'Reisum', 'Ward 13', 'Ward 17', 'Ward Prime', 'The Labyrinth', ''];
  var TYPE_LABEL = { 'World Boss': 'Boss', 'Miniboss': 'Miniboss', 'Side Dungeon': 'Dungeon', 'Siege': 'Siege',
    'Point of Interest': 'Point of interest', 'Item Drop': 'Item', 'Loot Beetle': 'Beetle', 'Home': 'Home', 'Quest Event': 'Event' };
  var CATEGORIES = ['Weapon', 'Armor', 'Amulet', 'Ring', 'Mod', 'Trait', 'Emote', 'Skin', 'Consumable'];
  // Skins and consumables are not stored as unlocks in the profile, so we can't tell if you have them.
  var UNTRACKED = { 'Skin': true, 'Consumable': true };

  var state = {
    auto: false, dir: '', listing: null,
    files: {},          // name -> ArrayBuffer
    characters: [],     // from profile.sav
    charIndex: null,
    tab: 'world', mode: 'campaign',
    worldZones: {}, worldTypes: {}, worldCats: {}, missingWorld: null, missingType: null, missingMode: null,
  };
  P.ZONES.forEach(function (z) { state.worldZones[z] = true; });
  Object.keys(TYPE_LABEL).forEach(function (t) { state.worldTypes[t] = true; });
  CATEGORIES.forEach(function (c) { state.worldCats[c] = true; });
  function store(k, v) { try { localStorage.setItem('rwa.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function recall(k, d) { try { var v = localStorage.getItem('rwa.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  state.tab = recall('tab', 'world');
  state.mode = recall('mode', 'campaign');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- item lookup -------------------------------------------------------
  var itemsByKey = {};
  DATA.items.forEach(function (it) { if (it.key && !itemsByKey[it.key]) itemsByKey[it.key] = it; });

  function prettyPath(p) {
    var last = p.split('/').pop().replace(/^(Weapon|Trinket|Trait|Mod|Emote|Quest|Armor)_/, '');
    return last.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  }
  function itemForPath(p) { return itemsByKey[p] || { name: prettyPath(p), category: '', how: '', key: p, world: '' }; }
  function itemKeyForAvailability(it) { return it.comesWith != null ? DATA.items[it.comesWith].key : it.key; }

  // ---- loading -----------------------------------------------------------
  function saveIndexOf(name) { var m = /save_(\d+)\.(sav|bak)$/i.exec(name); return m ? +m[1] : null; }

  function rebuild() {
    state.characters = state.files['profile.sav'] ? P.parseProfile(state.files['profile.sav']) : [];
    state.parsed = {};
    Object.keys(state.files).forEach(function (name) {
      var i = saveIndexOf(name);
      if (i == null) return;
      // Prefer the live .sav over a .bak with the same number.
      if (state.parsed[i] && /\.bak$/i.test(name)) return;
      try { state.parsed[i] = P.parseSave(state.files[name]); state.parsed[i].file = name; }
      catch (e) { console.error(e); state.parsed[i] = { error: String(e), file: name }; }
    });
    var indexes = Object.keys(state.parsed).map(Number);
    if (state.charIndex == null || !state.parsed[state.charIndex]) {
      var remembered = recall('char', null);
      state.charIndex = remembered != null && state.parsed[remembered] ? remembered : (newestSaveIndex() ?? indexes.sort()[0] ?? null);
    }
  }

  function newestSaveIndex() {
    if (!state.listing) return null;
    var best = null;
    state.listing.forEach(function (f) {
      var i = saveIndexOf(f.name);
      if (i != null && /\.sav$/i.test(f.name) && (!best || f.modified > best.modified)) best = { i: i, modified: f.modified };
    });
    return best && best.i;
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsArrayBuffer(file);
    });
  }

  function handleFiles(list) {
    var files = Array.prototype.slice.call(list).filter(function (f) { return /\.(sav|bak)$/i.test(f.name); });
    if (!files.length) return showLoadError('No .sav file found. Pick save_N.sav and profile.sav.');
    Promise.all(files.map(function (f) {
      return readFile(f).then(function (buf) {
        var name = f.name.toLowerCase();
        if (/profile/.test(name)) name = 'profile.sav';
        else if (saveIndexOf(name) == null) name = 'save_' + nextFreeIndex() + '.sav'; // renamed copy
        state.files[name] = buf;
      });
    })).then(function () {
      rebuild();
      if (state.charIndex == null && !state.characters.length) return showLoadError('No world save (save_N.sav) found in the selected files.');
      showApp();
    }).catch(function (e) { showLoadError('Error reading the files: ' + e); });
  }
  function nextFreeIndex() { var i = 0; while (state.files['save_' + i + '.sav']) i++; return i; }

  function showLoadError(msg) { var el = $('load-error'); el.textContent = msg; el.hidden = !msg; }

  // Automatic mode: the page is served by server.ps1 (Start.bat), which can read the save folder.
  function api(path) { return fetch(path, { cache: 'no-store' }); }
  function tryAuto() {
    if (location.protocol === 'file:') return;
    api('api/saves').then(function (r) { return r.ok ? r.json() : null; }).then(function (info) {
      if (!info) return;
      state.auto = true;
      state.dir = info.dir;
      if (!info.found) {
        setStatus('Save folder not found: ' + info.dir, false);
        showLoadError('The server could not find the save folder at ' + info.dir + '. Drag the files in manually or run Start.bat with the right path.');
        return;
      }
      return syncFromServer(info.files).then(function () { setInterval(poll, 3000); });
    }).catch(function () { /* not served by server.ps1 */ });
  }

  function syncFromServer(listing) {
    var old = {};
    (state.listing || []).forEach(function (f) { old[f.name] = f.modified; });
    var wanted = listing.filter(function (f) { return /^(profile\.sav|save_\d+\.sav)$/i.test(f.name) && old[f.name] !== f.modified; });
    state.listing = listing;
    var stillThere = {};
    listing.forEach(function (f) { stillThere[f.name.toLowerCase()] = true; });
    Object.keys(state.files).forEach(function (n) { if (!stillThere[n]) delete state.files[n]; });
    if (!wanted.length && Object.keys(old).length) return Promise.resolve(false);
    return Promise.all(wanted.map(function (f) {
      return api('api/file?name=' + encodeURIComponent(f.name)).then(function (r) {
        if (!r.ok) throw new Error(f.name + ': HTTP ' + r.status);
        return r.arrayBuffer();
      }).then(function (buf) { state.files[f.name.toLowerCase()] = buf; });
    })).then(function () {
      rebuild();
      setStatus('Automatic · ' + state.dir + ' · updated at ' + new Date().toLocaleTimeString(), true);
      if (state.charIndex != null || state.characters.length) showApp();
      return true;
    });
  }

  function poll() {
    api('api/saves').then(function (r) { return r.json(); }).then(function (info) {
      if (info.found) return syncFromServer(info.files);
    }).catch(function () { setStatus('Server stopped — close and reopen Start.bat', false); });
  }

  function setStatus(text, live) {
    var el = $('status');
    el.hidden = false;
    el.className = 'status' + (live ? '' : ' manual');
    el.innerHTML = '<span class="dot"></span>' + esc(text);
  }

  // ---- rendering ---------------------------------------------------------
  function current() { return state.parsed && state.parsed[state.charIndex]; }
  function character() { return state.characters[state.charIndex] || null; }

  function showApp() {
    showLoadError('');
    $('loader').hidden = true;
    $('app').hidden = false;
    if (!state.auto) setStatus('Manual · files loaded at ' + new Date().toLocaleTimeString(), false);
    render();
  }

  function render() {
    renderCharacters();
    state.owns = P.ownership(character());
    state.available = availability();
    $('profile-note').hidden = !!character();
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === state.tab); });
    $('tab-world').hidden = state.tab !== 'world';
    $('tab-missing').hidden = state.tab !== 'missing';
    renderWorld();
    renderMissing();
  }

  function renderCharacters() {
    var sel = $('character');
    var indexes = {};
    state.characters.forEach(function (c) { indexes[c.index] = true; });
    Object.keys(state.parsed || {}).forEach(function (i) { indexes[i] = true; });
    sel.innerHTML = Object.keys(indexes).map(Number).sort(function (a, b) { return a - b; }).map(function (i) {
      var c = state.characters[i];
      var hasSave = !!(state.parsed && state.parsed[i]);
      var label = 'Character ' + (i + 1) + (c ? ' — ' + c.archetype : '') + ' (save_' + i + '.sav' + (hasSave ? '' : ', not loaded') + ')';
      return '<option value="' + i + '"' + (i === state.charIndex ? ' selected' : '') + (hasSave ? '' : ' disabled') + '>' + esc(label) + '</option>';
    }).join('');
  }

  // key -> where it can drop in the currently loaded world
  function availability() {
    var map = {}, save = current();
    if (!save) return map;
    [['campaign', save.campaign], ['adventure', save.adventure]].forEach(function (pair) {
      var block = pair[1];
      if (!block) return;
      block.events.forEach(function (ev) {
        ev.items.forEach(function (p) {
          (map[p] = map[p] || []).push({ block: block.label + (block.world ? ' (' + block.world + ')' : ''), event: ev.name, location: ev.location });
        });
      });
    });
    return map;
  }

  function statusIcon(owned) {
    if (owned === true) return '<span class="st ok" title="Owned">✔</span>';
    if (owned === false) return '<span class="st miss" title="Missing">✘</span>';
    return '<span class="st unk" title="Unknown">?</span>';
  }

  function itemOwned(it) { return UNTRACKED[it.category] ? null : state.owns(it); }

  function itemDetails(it, extra) {
    var meta = [it.category, it.world && WORLD_LABEL[it.world] !== undefined ? WORLD_LABEL[it.world] : it.world, it.mode && 'Mode: ' + it.mode, it.dlc && 'DLC: ' + it.dlc]
      .filter(Boolean).join(' · ');
    return '<details class="item"><summary>' + statusIcon(itemOwned(it)) + ' ' + esc(it.name) + itemWikiLink(it) +
      (it.category ? '<span class="cat">' + esc(it.category) + '</span>' : '') + (extra || '') + '</summary>' +
      '<div class="how">' + (it.how ? esc(it.how) : '<i>No description in the sheet.</i>') +
      (meta ? '<div class="meta">' + esc(meta) + '</div>' : '') + '</div></details>';
  }

  // Fextralife wiki pages for the areas our locations name, keyed by lowercase alphanumerics.
  // Every slug was checked to exist; areas without a page (Fairview, Reisum's areas, …) get no link.
  var WIKI = {
    earth: 'Earth', rhom: 'Rhom', corsus: 'Corsus', yaesha: 'Yaesha', reisum: 'Reisum',
    ward13: 'Ward_13', ward17: 'Ward_17', wardprime: 'Ward_Prime',
    // Earth
    westcourt: 'Westcourt', chapelstation: 'Chapel_Station', churchoftheharbinger: 'Church_of_the_Harbinger',
    hiddengrotto: 'Hidden_Grotto', junktown: 'Junk_Town', marrowpass: 'Marrow_Pass',
    researchstationalpha: "Leto's_Lab_(Research_Station_Alpha)", sorrowsfield: "Sorrow's_Field", sunkenpassage: 'Sunken_Passage',
    theashyard: 'The_Ash_Yard', thechokinghollow: 'The_Choking_Hallow', thegallows: 'The_Gallows',
    thehiddensanctum: 'The_Hidden_Sanctum', thetangledpass: 'The_Tangled_Pass', thewarren: 'The_Warren', cutthroatchannel: 'Cutthroat_Channel',
    // Rhom
    theeasternwind: 'The_Eastern_Wind', thescouringwaste: 'The_Scouring_Wastes', theironrift: 'The_Iron_Rift', theburrows: 'The_Burrows',
    shackledcanyon: 'Shackled_Canyon', theardenttemple: 'The_Ardent_Temple', loomoftheblacksun: 'Loom_of_the_Black_Sun',
    thebunker: 'The_Bunker', concourseofthesun: 'Concourse_of_the_Sun', vaultoftheheralds: 'Vault_of_Heralds',
    thepurgehall: 'The_Purge_Hall', undyingthrone: 'Undying_Throne',
    // Corsus
    thefetidglade: 'The_Fetid_Glade', themistfen: 'The_Mist_Fen', thedrownedtrench: 'The_Drowned_Trench', thecapillary: 'The_Capillary',
    hallofwhispers: 'Hall_of_Whispers', thegrotto: 'The_Grotto', circlethatchery: 'Circlet_Hatchery', strangepass: 'The_Strange_Pass',
    // Yaesha
    theverdantstrand: 'The_Verdant_Strand', thescaldingglade: 'Scalding_Glade', forgottenundercroft: 'Forgotten_Undercroft',
    templeoftheravager: 'Temple_of_Ravager', theravagershaunt: "The_Ravager's_Haunt", thetempestcourt: 'The_Tempest_Court',
    widowspass: "Widow's_Pass", hereticsnest: "Heretic's_Nest", witheringvillage: 'Withering_Village',
    shrineoftheimmortals: 'Shrine_of_The_Immortals', widowsvestry: "Widow's_Vestry", merchantdungeon: 'Stuck_Merchant',
  };

  function globe(slug, label) {
    if (!slug) return '';
    var url = 'https://remnantfromtheashes.wiki.fextralife.com/' + encodeURI(slug).replace(/'/g, '%27');
    return ' <a class="wiki" href="' + esc(url) + '" target="_blank" rel="noopener" title="' + esc(label) + ' — Fextralife wiki">🌐</a>';
  }

  // Globe icon linking to the wiki page of the most specific part of "Earth: Fairview: The Tangled Pass".
  function wikiLink(location) {
    var page = location.split(': ').pop();
    return globe(WIKI[page.toLowerCase().replace(/[^a-z0-9]/g, '')], page);
  }

  // Item pages come from js/wiki.js (tools/build-wiki.ps1), which only lists pages that exist.
  function itemWikiLink(it) { return globe(RWA_WIKI.items[it.name], it.name); }

  function chip(label, on, attrs) { return '<span class="chip' + (on ? ' on' : '') + '" ' + attrs + '>' + esc(label) + '</span>'; }

  function renderWorld() {
    var save = current();
    var seg = $('mode-switch');
    if (!save) { seg.innerHTML = ''; $('world-body').innerHTML = ''; return showEmpty('Pick a character with a loaded save.'); }
    if (save.error) { $('world-body').innerHTML = ''; return showEmpty('Could not read ' + save.file + ': ' + save.error); }
    if (state.mode === 'adventure' && !save.adventure) state.mode = 'campaign';
    if (state.mode === 'campaign' && !save.campaign && save.adventure) state.mode = 'adventure';
    seg.innerHTML = [['campaign', save.campaign], ['adventure', save.adventure]].map(function (p) {
      if (!p[1]) return '';
      var label = p[1].label + (p[1].world ? ' — ' + p[1].world : '');
      return '<button data-mode="' + p[0] + '" class="' + (state.mode === p[0] ? 'active' : '') + '">' + esc(label) + '</button>';
    }).join('');

    $('world-zones').innerHTML = P.ZONES.map(function (z) { return chip(WORLD_LABEL[z], state.worldZones[z], 'data-zone="' + z + '"'); }).join('');
    $('world-types').innerHTML = Object.keys(TYPE_LABEL).map(function (t) { return chip(TYPE_LABEL[t], state.worldTypes[t], 'data-type="' + esc(t) + '"'); }).join('');
    $('world-cats').innerHTML = CATEGORIES.map(function (c) { return chip(c, state.worldCats[c], 'data-cat="' + esc(c) + '"'); }).join('');
    // With every category on, nothing is filtered (events without items stay visible).
    var allCats = CATEGORIES.every(function (c) { return state.worldCats[c]; });

    var block = save[state.mode];
    if (!block) {
      $('world-body').innerHTML = '';
      return showEmpty('No campaign or adventure found in this save. If you just created the character, finish the tutorial and travel using the crystal before analyzing.');
    }
    var q = $('world-search').value.trim().toLowerCase();
    var onlyMissing = $('world-only-missing').checked;
    // Without profile.sav nothing is known to be missing, so this would hide every item.
    var hideOwned = $('world-hide-owned').checked && !!character();
    var rows = [], lastZone = null, shown = 0;
    block.events.forEach(function (ev) {
      if (!state.worldZones[ev.zone] || !state.worldTypes[ev.type]) return;
      var items = ev.items.map(itemForPath);
      if (!allCats) {
        items = items.filter(function (it) { return state.worldCats[it.category]; });
        if (!items.length) return;
      }
      if (hideOwned) {
        items = items.filter(function (it) { return itemOwned(it) === false; });
        if (!items.length) return;
      }
      if (onlyMissing && !items.some(function (it) { return itemOwned(it) === false; })) return;
      if (q && (ev.name + ' ' + ev.location + ' ' + items.map(function (i) { return i.name; }).join(' ')).toLowerCase().indexOf(q) === -1) return;
      if (ev.zone !== lastZone) { rows.push('<tr class="zone-row"><td colspan="4">' + esc(WORLD_LABEL[ev.zone]) + '</td></tr>'); lastZone = ev.zone; }
      shown++;
      rows.push('<tr><td class="loc">' + esc(ev.location) + wikiLink(ev.location) + '</td><td class="type"><span class="type-badge">' + esc(TYPE_LABEL[ev.type] || ev.type) +
        '</span></td><td class="name">' + esc(ev.name) + '</td><td>' +
        (items.length ? items.map(function (it) { return itemDetails(it); }).join('') : '<span class="cat">—</span>') + '</td></tr>');
    });
    $('world-body').innerHTML = rows.join('');
    if (shown) $('world-empty').hidden = true; else showEmpty('Nothing matches these filters.');
  }

  function showEmpty(msg) { var el = $('world-empty'); el.textContent = msg; el.hidden = false; }

  // "Collected x of y" per kind of item. Weapons are split by the sheet's weapon type.
  var COLLECTION = [
    ['Hand guns', function (it) { return it.category === 'Weapon' && it.group === 'Hand Gun'; }],
    ['Long guns', function (it) { return it.category === 'Weapon' && it.group === 'Long Gun'; }],
    ['Melee', function (it) { return it.category === 'Weapon' && it.group === 'Melee'; }],
    ['Armor', function (it) { return it.category === 'Armor'; }],
    ['Amulets', function (it) { return it.category === 'Amulet'; }],
    ['Rings', function (it) { return it.category === 'Ring'; }],
    ['Mods', function (it) { return it.category === 'Mod'; }],
    ['Traits', function (it) { return it.category === 'Trait'; }],
    ['Emotes', function (it) { return it.category === 'Emote'; }],
  ];
  // The tutorial blade is taken away when the tutorial ends, so it can never be collected.
  function collectible(it) { return !UNTRACKED[it.category] && !(/^New characters begin/.test(it.how) && /removed/.test(it.how)); }

  // Items that only drop in a given game mode (the sheet's "Mode" column); Normal is everything else.
  var MODE_COLLECTION = [['Normal', function (it) { return it.mode !== 'Survival' && it.mode !== 'Hardcore'; }]].concat(
    ['Survival', 'Hardcore'].map(function (m) { return [m, function (it) { return it.mode === m; }]; }));

  function testFor(list, label) {
    var c = list.filter(function (x) { return x[0] === label; })[0];
    return c ? c[1] : null;
  }
  function worldOf(it) { return WORLD_LABEL[it.world] !== undefined ? it.world : ''; }

  // World, type and mode selections filter each other: each group's numbers apply the other two.
  function passes(it, skip) {
    if (skip !== 'world' && state.missingWorld != null && worldOf(it) !== state.missingWorld) return false;
    var t = skip !== 'type' && state.missingType != null && testFor(COLLECTION, state.missingType);
    if (t && !t(it)) return false;
    var m = skip !== 'mode' && state.missingMode != null && testFor(MODE_COLLECTION, state.missingMode);
    if (m && !m(it)) return false;
    return true;
  }

  // Type and mode tiles: always shown, a click filters by it; an empty tile (0 of 0) reads "complete".
  function tile(r, value, on, hasProfile) {
    var pct = r.total ? Math.round(100 * r.have / r.total) : 100;
    var done = r.have === r.total;
    var status = !hasProfile ? 'load profile.sav' : done ? 'complete' : (r.total - r.have) + ' missing · ' + pct + '%';
    return '<button type="button" class="coll' + (r.isTotal ? ' total' : '') + (hasProfile && done ? ' done' : '') + (on ? ' on' : '') +
      '" data-value="' + esc(value) + '">' +
      '<div class="w">' + esc(r.label) + '</div>' +
      '<div class="n">' + (hasProfile ? r.have + ' <small>of ' + r.total + '</small>' : r.total + ' <small>items</small>') + '</div>' +
      '<div class="of">' + status + '</div>' +
      '<div class="now">' + (hasProfile && r.now ? r.now + ' obtainable now' : '&nbsp;') + '</div>' +
      '<div class="bar"><i style="width:' + (hasProfile ? pct : 0) + '%"></i></div></button>';
  }

  function renderTiles(hasProfile) {
    var row = function (label, test) { return { label: label, test: test, have: 0, total: 0, now: 0 }; };
    var all = row('Total'); all.isTotal = true;
    var types = COLLECTION.map(function (c) { return row(c[0], c[1]); });
    var modes = MODE_COLLECTION.map(function (c) { return row(c[0], c[1]); });
    var worlds = WORLD_ORDER.map(function (w) { return row(WORLD_LABEL[w], function (it) { return worldOf(it) === w; }); });
    DATA.items.forEach(function (it) {
      if (!collectible(it)) return;
      var have = itemOwned(it) === true ? 1 : 0;
      var key = itemKeyForAvailability(it);
      var now = !have && key && state.available[key] ? 1 : 0;
      var add = function (r) { if (!r.test || r.test(it)) { r.total++; r.have += have; r.now += now; } };
      if (passes(it, 'type')) [all].concat(types).forEach(add);
      if (passes(it, 'mode')) modes.forEach(add);
      if (passes(it, 'world')) worlds.forEach(add);
    });
    $('collection').innerHTML = tile(all, '', false, hasProfile) +
      types.map(function (r) { return tile(r, r.label, state.missingType === r.label, hasProfile); }).join('');
    $('modes').innerHTML = modes.map(function (r) { return tile(r, r.label, state.missingMode === r.label, hasProfile); }).join('');
    $('summary').innerHTML = worlds.map(function (r, i) { return worldCard(r, WORLD_ORDER[i], state.missingWorld === WORLD_ORDER[i], hasProfile); }).join('');
  }

  // World cards keep their original look: "N missing" up top, "x of y items · %" below.
  function worldCard(r, value, on, hasProfile) {
    var missing = r.total - r.have, pct = r.total ? Math.round(100 * r.have / r.total) : 100;
    var big = hasProfile ? (missing ? missing + ' missing' : 'complete') : r.total + ' items';
    return '<button type="button" class="card' + (on ? ' on' : '') + '" data-value="' + esc(value) + '">' +
      '<div class="w">' + esc(r.label) + '</div>' +
      '<div class="n' + (!hasProfile ? ' neutral' : !missing ? ' done' : '') + '">' + esc(big) + '</div>' +
      (hasProfile ? '<div class="of">' + r.have + ' of ' + r.total + ' items · ' + pct + '%</div>' : '<div class="of">load profile.sav</div>') +
      (hasProfile && r.now ? '<div class="now">' + r.now + ' obtainable now</div>' : '') +
      (hasProfile ? '<div class="bar"><i style="width:' + pct + '%"></i></div>' : '') + '</button>';
  }

  function renderMissing() {
    var hasProfile = !!character();
    renderTiles(hasProfile);
    var q = $('missing-search').value.trim().toLowerCase();
    var onlyNow = $('missing-only-now').checked;
    var showOwned = $('missing-show-owned').checked || !hasProfile;

    var groups = {};
    DATA.items.forEach(function (it) {
      // Same items as the tiles above.
      if (!collectible(it) || !passes(it)) return;
      var w = worldOf(it);
      var owned = itemOwned(it);
      var key = itemKeyForAvailability(it);
      var where = key && state.available[key];
      if (owned === true && !showOwned) return;
      if (onlyNow && !where) return;
      if (q && (it.name + ' ' + it.how + ' ' + it.group).toLowerCase().indexOf(q) === -1) return;
      (groups[w] = groups[w] || []).push({ it: it, owned: owned, where: where });
    });

    var html = WORLD_ORDER.filter(function (w) { return groups[w]; }).map(function (w) {
      var list = groups[w].sort(function (a, b) { return (a.where ? 0 : 1) - (b.where ? 0 : 1) || a.it.category.localeCompare(b.it.category) || a.it.name.localeCompare(b.it.name); });
      return '<div class="group"><h3>' + esc(WORLD_LABEL[w]) + ' <small>' + list.length + ' items</small></h3>' + list.map(function (row) {
        var it = row.it;
        var tags = (row.where ? '<span class="tag now">available now</span>' : '') +
          (it.mode ? '<span class="tag mode">' + esc(it.mode) + '</span>' : '') + (it.dlc ? '<span class="tag">' + esc(it.dlc) + '</span>' : '');
        var where = row.where ? '<div class="where">In your world: ' + row.where.map(function (x) {
          return esc(x.block + ' → ' + x.location + ' (' + x.event + ')') + wikiLink(x.location);
        }).join(' · ') + '</div>' : '';
        return '<div class="mrow">' + itemDetails(it, tags) + where + '</div>';
      }).join('') + '</div>';
    }).join('');
    $('missing-list').innerHTML = html || '<div class="empty">' + (hasProfile ? 'Nothing missing with these filters. 🎉' : 'Nothing matches these filters.') + '</div>';
  }

  // ---- events ------------------------------------------------------------
  function wire() {
    var drop = $('drop');
    ['dragenter', 'dragover'].forEach(function (t) { document.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('hover'); }); });
    ['dragleave', 'drop'].forEach(function (t) { document.addEventListener(t, function (e) { e.preventDefault(); if (t === 'drop' || e.target === drop) drop.classList.remove('hover'); }); });
    document.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });
    $('file').addEventListener('change', function (e) { handleFiles(e.target.files); e.target.value = ''; });
    $('copy-path').addEventListener('click', function () {
      var text = $('save-path').textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { $('copy-path').textContent = 'Copied!'; }, function () {});
    });
    $('reload').addEventListener('click', function () { $('loader').hidden = false; $('drop').scrollIntoView({ behavior: 'smooth' }); });
    $('character').addEventListener('change', function (e) { state.charIndex = +e.target.value; store('char', state.charIndex); render(); });
    document.querySelector('.tabs').addEventListener('click', function (e) {
      var b = e.target.closest('.tab'); if (!b) return;
      state.tab = b.dataset.tab; store('tab', state.tab); render();
    });
    $('mode-switch').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      state.mode = b.dataset.mode; store('mode', state.mode); renderWorld();
    });
    $('world-zones').addEventListener('click', function (e) { var c = e.target.closest('.chip'); if (c) { state.worldZones[c.dataset.zone] = !state.worldZones[c.dataset.zone]; renderWorld(); } });
    $('world-types').addEventListener('click', function (e) { var c = e.target.closest('.chip'); if (c) { state.worldTypes[c.dataset.type] = !state.worldTypes[c.dataset.type]; renderWorld(); } });
    // With every category on, a click shows only that one; turning off the last one shows all again.
    $('world-cats').addEventListener('click', function (e) {
      var c = e.target.closest('.chip'); if (!c) return;
      var cat = c.dataset.cat, on = CATEGORIES.filter(function (x) { return state.worldCats[x]; });
      if (on.length === CATEGORIES.length) CATEGORIES.forEach(function (x) { state.worldCats[x] = x === cat; });
      else if (on.length === 1 && on[0] === cat) CATEGORIES.forEach(function (x) { state.worldCats[x] = true; });
      else state.worldCats[cat] = !state.worldCats[cat];
      renderWorld();
    });
    // Same behaviour for every group: click selects, clicking the selected tile again clears it.
    // Total has an empty value and clears the type; '' is a real world ("General / achievements").
    [['collection', 'missingType'], ['modes', 'missingMode'], ['summary', 'missingWorld']].forEach(function (p) {
      $(p[0]).addEventListener('click', function (e) {
        var c = e.target.closest('.coll, .card'); if (!c) return;
        var v = c.dataset.value;
        if (p[1] === 'missingType' && !v) v = null;
        state[p[1]] = state[p[1]] === v ? null : v; renderMissing();
      });
    });
    ['world-search', 'world-only-missing', 'world-hide-owned'].forEach(function (id) { $(id).addEventListener('input', renderWorld); });
    ['missing-search', 'missing-only-now', 'missing-show-owned'].forEach(function (id) { $(id).addEventListener('input', renderMissing); });
  }

  wire();
  tryAuto();
})();
