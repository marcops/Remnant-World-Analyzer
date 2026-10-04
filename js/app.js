/* global RWA_DATA, RWA_PARSER, RWA_WIKI, RWA_CHARACTER, RWA_DPS, RWA_WORLDSTATE, RWA_GVAS */
(function () {
  'use strict';

  var DATA = RWA_DATA, P = RWA_PARSER, CHAR = RWA_CHARACTER, DPS = RWA_DPS, WS = RWA_WORLDSTATE;
  var $ = function (id) { return document.getElementById(id); };

  var WORLD_LABEL = { Earth: 'Earth', 'Subject 2923': 'Subject 2923', Rhom: 'Rhom', Corsus: 'Corsus', Yaesha: 'Yaesha', Reisum: 'Reisum',
    'Ward 13': 'Ward 13', 'Ward 17': 'Ward 17', 'Ward Prime': 'Ward Prime', 'The Labyrinth': 'The Labyrinth', '': 'General / achievements' };
  var WORLD_ORDER = ['Earth', 'Subject 2923', 'Rhom', 'Corsus', 'Yaesha', 'Reisum', 'Ward 13', 'Ward 17', 'Ward Prime', 'The Labyrinth', ''];
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
    // Full character details (loadout, traits, stats…) for the "My character" tab.
    state.profile = null;
    if (state.files['profile.sav']) {
      try { state.profile = CHAR.readProfile(state.files['profile.sav']); } catch (e) { console.error(e); state.profile = { error: String(e) }; }
    }
    state.parsed = {};
    state.worlds = {};
    state.worldStates = {};
    Object.keys(state.files).forEach(function (name) {
      var i = saveIndexOf(name);
      if (i == null) return;
      // Prefer the live .sav over a .bak with the same number.
      if (state.parsed[i] && /\.bak$/i.test(name)) return;
      try { state.parsed[i] = P.parseSave(state.files[name]); state.parsed[i].file = name; }
      catch (e) { console.error(e); state.parsed[i] = { error: String(e), file: name }; }
      try { state.worlds[i] = CHAR.readWorld(state.files[name]); } catch (e) { console.error(e); state.worlds[i] = null; }
      try { state.worldStates[i] = WS.read(state.files[name]); } catch (e) { console.error(e); state.worldStates[i] = { error: String(e) }; }
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
    $('tab-character').hidden = state.tab !== 'character';
    $('tab-build').hidden = state.tab !== 'build';
    $('tab-state').hidden = state.tab !== 'state';
    $('tab-map').hidden = state.tab !== 'map';
    $('tab-tips').hidden = state.tab !== 'tips';
    $('tab-raw').hidden = state.tab !== 'raw';
    renderWorld();
    renderMissing();
    renderStateTab();
    renderMapTab();
    renderTipsTab();
    renderRawTab();
    renderCharacterTab();
    renderBuildTab();
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

  // ---- Cryptolith -----------------------------------------------------------
  // What you get in Corsus is the Cryptolith Sigil (from the Iskal Queen), not the rewards: those come from
  // using the Sigil on a Cryptolith tower (Earth, Rhom or Corsus), once per world — 1st Concentration,
  // 2nd Blood Bond, 3rd the Labyrinth set. The Sigil is shown in their place.
  var CRYPTOLITH_REWARDS = ((DATA.events.Cryptolith || {}).items || []).map(function (p) { return itemsByKey[p]; }).filter(Boolean);
  var SIGIL_KEY = '__cryptolith_sigil';
  var SIGIL = {
    name: 'Cryptolith Sigil', category: 'Quest item', sigil: true, key: SIGIL_KEY, world: 'Corsus', dlc: 'Swamps of Corsus', mode: '', group: '',
    how: 'Drops from the Iskal Queen (Corsus, The Mist Fen). Use it on a Cryptolith tower — it can be in Earth, Rhom or Corsus — once per world, rerolling in between: ' +
      '1st use gives the Concentration trait, 2nd the Blood Bond trait, 3rd opens the Labyrinth room with the Labyrinth armor set (Labyrinth Helm, Armor and Greaves).',
  };
  // Everything the Missing items tab counts: the sheet's items plus the Sigil (a "Quest item").
  var TRACKED_ITEMS = DATA.items.concat([SIGIL]);
  function isCryptolithReward(it) { return CRYPTOLITH_REWARDS.indexOf(it) >= 0; }
  function hasSigil() {
    var ch = state.profile && state.profile.characters && state.profile.characters[state.charIndex];
    return !!(ch && ch.extra && (ch.extra.questItems || []).some(function (q) { return /Sigil|Cryptolith/i.test(q.cls); }));
  }

  // Events that only hand out some items in exchange for another one: Brabus gives the Bandit set
  // for the Pocket Watch you get from Mudtooth.
  var EXCHANGES = {
    Brabus: { needs: 'Pocket Watch', items: /\/Armor\/Bandit\//, note: 'The Bandit set needs the Pocket Watch from Mudtooth.' },
  };
  function exchangeReady(ev) {
    var x = EXCHANGES[ev.key]; if (!x) return true;
    var need = DATA.items.filter(function (i) { return i.name === x.needs; })[0];
    return !!(need && state.owns && state.owns(need) === true);
  }

  // key -> where it can drop in the currently loaded world
  function availability() {
    var map = {}, save = current(), sigil = hasSigil();
    if (!save) return map;
    [['campaign', save.campaign], ['adventure', save.adventure]].forEach(function (pair) {
      var block = pair[1];
      if (!block) return;
      block.events.forEach(function (ev) {
        var at = { block: block.label + (block.world ? ' (' + block.world + ')' : ''), event: ev.name, location: ev.location };
        // The tower's rewards only count as available when you carry a Sigil.
        if (ev.key === 'Cryptolith' && !sigil) return;
        if (ev.key === 'IskalQueen') (map[SIGIL_KEY] = map[SIGIL_KEY] || []).push(at);
        var x = EXCHANGES[ev.key], ready = exchangeReady(ev);
        ev.items.forEach(function (p) {
          if (x && !ready && x.items.test(p)) return;
          (map[p] = map[p] || []).push(at);
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

  // The Sigil counts as done when you carry one or already have every tower reward.
  function itemOwned(it) {
    if (it.sigil) {
      if (!character()) return null;
      return hasSigil() || CRYPTOLITH_REWARDS.every(function (r) { return state.owns(r) === true; });
    }
    return UNTRACKED[it.category] ? null : state.owns(it);
  }

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
      // The Iskal Queen also gives the Cryptolith Sigil; it matters while a tower reward is still missing.
      var sigilWanted = ev.key === 'IskalQueen' && CRYPTOLITH_REWARDS.some(function (it) { return itemOwned(it) !== true; });
      if (sigilWanted) items.push(SIGIL);
      var wanted = function (it) { return itemOwned(it) === false || (it.sigil && sigilWanted); };
      if (!allCats) {
        items = items.filter(function (it) { return it.sigil || state.worldCats[it.category]; });
        if (!items.length) return;
      }
      if (hideOwned) {
        items = items.filter(wanted);
        if (!items.length) return;
      }
      if (onlyMissing && !items.some(wanted)) return;
      if (q && (ev.name + ' ' + ev.location + ' ' + items.map(function (i) { return i.name; }).join(' ')).toLowerCase().indexOf(q) === -1) return;
      if (ev.zone !== lastZone) { rows.push('<tr class="zone-row"><td colspan="4">' + esc(WORLD_LABEL[ev.zone]) + '</td></tr>'); lastZone = ev.zone; }
      shown++;
      rows.push('<tr><td class="loc">' + esc(ev.location) + wikiLink(ev.location) + '</td><td class="type"><span class="type-badge">' + esc(TYPE_LABEL[ev.type] || ev.type) +
        '</span></td><td class="name">' + esc(ev.name) +
        (ev.key === 'Cryptolith' ? '<div class="cat">' + (hasSigil() ? 'You carry a Cryptolith Sigil — use it here.' : 'Needs a Cryptolith Sigil (Iskal Queen, Corsus).') + '</div>' : '') +
        (EXCHANGES[ev.key] ? '<div class="cat">' + esc(EXCHANGES[ev.key].note) + (exchangeReady(ev) ? ' You have it.' : '') + '</div>' : '') + '</td><td>' +
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
    ['Quest items', function (it) { return it.category === 'Quest item'; }],
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
  // The Subject 2923 DLC's rural Earth gets its own group, apart from the base game's Earth.
  function worldOf(it) {
    if (it.world === 'Earth' && it.dlc === 'Subject 2923') return 'Subject 2923';
    return WORLD_LABEL[it.world] !== undefined ? it.world : '';
  }

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
    TRACKED_ITEMS.forEach(function (it) {
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
    TRACKED_ITEMS.forEach(function (it) {
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

    // In Corsus you get the Cryptolith Sigil, not the tower rewards: the list shows the Sigil (counted
    // as a Quest item) and leaves the rewards out; they still count in their own types above.
    Object.keys(groups).forEach(function (w) {
      groups[w] = groups[w].filter(function (r) { return !isCryptolithReward(r.it); });
      if (!groups[w].length) delete groups[w];
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

  // ---- my character --------------------------------------------------------
  function num(n) { return Math.round(n).toLocaleString('en-US'); }
  function duration(sec) { var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60); return h + 'h ' + (m < 10 ? '0' : '') + m + 'm'; }
  function rowGlobe(row) { return row.item ? itemWikiLink(row.item) : globe(RWA_WIKI.items[row.name], row.name); }
  function levelTag(row) { return row.level != null && (row.category === 'Weapon' || row.category === 'Armor') ? ' <span class="lvl">+' + row.level + '</span>' : ''; }
  function panel(title, body, wide) { return '<section class="panel' + (wide ? ' wide' : '') + '"><h3>' + esc(title) + '</h3>' + body + '</section>'; }
  // A labelled bar: label is HTML, shown is the text on the right, ratio is 0..1.
  function meter(label, shown, ratio, done) {
    var pct = Math.max(0, Math.min(100, Math.round(100 * (ratio || 0))));
    return '<div class="meter' + (done ? ' done' : '') + '"><span class="ml">' + label + '</span><span class="mv">' + esc(String(shown)) + '</span><div class="bar"><i style="width:' + pct + '%"></i></div></div>';
  }

  function renderCharacterTab() {
    var el = $('character-view');
    var prof = state.profile, ch = prof && prof.characters && prof.characters[state.charIndex];
    var world = state.worlds && state.worlds[state.charIndex];
    if (!prof) { el.innerHTML = '<div class="empty">Load <b>profile.sav</b> too to see your character.</div>'; return; }
    if (prof.error || !ch || ch.error) { el.innerHTML = '<div class="empty">Could not read this character from profile.sav' + (prof.error || (ch && ch.error) ? ': ' + esc(prof.error || ch.error) : '.') + '</div>'; return; }

    var maxed = ch.traits.filter(function (t) { return t.level >= 20; }).length;
    var leveled = ch.traits.filter(function (t) { return t.level > 0; });
    var res = {}; ch.resources.forEach(function (r) { res[r.name] = r.quantity || 0; });
    var heart = ch.loadout.filter(function (l) { return l.slot === 6; })[0];

    var cards = [
      ['Character', 'Level ' + ch.level, ch.archetype + ' · ' + num(ch.experience) + ' XP'],
      ['Traits', num(ch.traitPointsSpent) + ' points', leveled.length + ' traits leveled · ' + maxed + ' at max'],
      world ? ['Time played', duration(world.timePlayed), world.difficulty ? world.difficulty + ' difficulty' : ''] : null,
      world && world.objective ? ['Current objective', world.objective, ''] : null,
      ['Dragon Heart', (heart && heart.entry.quantity != null ? heart.entry.quantity : '?') + ' charges', (res['Dragon Heart upgrades'] || 0) + ' upgrades · used ' + num(ch.dragonHeartUses) + ' times'],
      ['Scrap', num(res.Scrap || 0), num(ch.stats.scrapPickedUp) + ' picked up in total'],
    ].filter(Boolean).map(function (c) {
      return '<div class="card static"><div class="w">' + esc(c[0]) + '</div><div class="n neutral">' + esc(c[1]) + '</div><div class="of">' + esc(c[2]) + '</div></div>';
    }).join('');

    var loadout = '<table class="kv">' + ch.loadout.map(function (l) {
      var e = l.entry;
      var mods = e.mods.map(function (m) { return '<span class="tag mode">' + esc(m.name) + (m.level ? ' +' + m.level : '') + '</span>'; }).join('');
      var qty = e.quantity != null && l.slot !== 6 ? ' <span class="cat">×' + e.quantity + '</span>' : '';
      return '<tr><th>' + esc(l.label) + '</th><td>' + esc(e.name) + rowGlobe(e) + levelTag(e) + qty + mods + '</td></tr>';
    }).join('') + '</table>';

    var traits = leveled.length ? leveled.map(function (t) { return meter(esc(t.name) + rowGlobe(t), t.level, t.level / 20, t.level >= 20); }).join('') : '<p class="cat">No trait points spent yet.</p>';

    var tiles = function (rows) {
      return '<div class="tiles">' + rows.map(function (r) {
        var q = r.quantity != null ? r.quantity : 1;
        return '<div class="tile' + (q ? '' : ' zero') + '"><span class="tq">' + num(q) + '</span><span class="tn">' + esc(r.name) + rowGlobe(r) + '</span></div>';
      }).join('') + '</div>';
    };
    var resources = ch.resources.filter(function (r) { return r.name !== 'Dragon Heart upgrades'; });

    // Only what has been upgraded; the rest is summed up in one line.
    var arsenalList = function (cat) {
      var rows = ch.arsenal.filter(function (a) { return a.category === cat; });
      var up = rows.filter(function (a) { return a.level > 0; }), rest = rows.length - up.length;
      return (up.length ? up.map(function (a) { return meter(esc(a.name) + rowGlobe(a), '+' + a.level, a.level / 20, a.level >= 20); }).join('') : '<p class="cat">None upgraded yet.</p>') +
        (rest ? '<p class="cat">' + rest + ' more owned at +0.</p>' : '');
    };

    var topKills = ch.kills.length ? ch.kills[0].kills : 0;
    var kills = ch.kills.map(function (k) { return meter(esc(k.name) + rowGlobe(k), num(k.kills), topKills ? k.kills / topKills : 0); }).join('');
    var s = ch.stats;
    var statRows = [
      ['Weak spot kills', s.weakspotKills], ['Allies revived', s.revives], ['Times revived', s.timesRevived],
      ['Downed by teammates', s.downedByTeammates], ['Damage to armored enemies', s.armoredDamage], ['Status effects applied', s.statusEffects],
      ['Status effects cleansed', s.cleansed], ['Fall damage taken', s.fallDamage], ['Obstacles vaulted', s.vaults],
      ['Weapon mods acquired', s.modsAcquired], ['Times the dog was petted', s.dogPets],
    ];
    var stats = '<table class="kv">' + statRows.map(function (r) { return '<tr><th>' + esc(r[0]) + '</th><td>' + num(r[1]) + '</td></tr>'; }).join('') + '</table>';

    var deaths = world && world.deaths.length ? '<table class="kv">' + world.deaths.slice(0, 15).map(function (d) {
      return '<tr><th>' + esc(d.name) + (d.type ? ' <span class="cat">' + esc(d.type) + '</span>' : '') + '</th><td>' + d.count + '</td></tr>';
    }).join('') + '</table><p class="cat">The game counts a fail for every quest that was active when you died.</p>' : '<p class="cat">No deaths recorded in this world.</p>';

    var achievements = prof.achievements.slice().sort(function (a, b) {
      return (a.value >= a.target) - (b.value >= b.target) || b.value / b.target - a.value / a.target;
    }).map(function (a) {
      var done = a.value >= a.target;
      var shown = a.target > 1 ? num(Math.min(a.value, a.target)) + ' / ' + num(a.target) : done ? 'done' : '—';
      return meter((done ? '✔ ' : '') + esc(a.name), shown, a.value / a.target, done);
    }).join('');
    var achDone = prof.achievements.filter(function (a) { return a.value >= a.target; }).length;

    var milestones = ch.milestones.map(function (m) { return '<span class="chip on">' + esc(m) + '</span>'; }).join('');

    el.innerHTML =
      '<div class="summary">' + cards + '</div>' +
      '<div class="panels">' +
      panel('Loadout', loadout) +
      panel('Traits (' + num(ch.traitPointsSpent) + ' / ' + num(ch.traitPoints) + ' points spent)', traits) +
      panel('Resources', tiles(resources)) +
      panel('Consumables', ch.consumables.length ? tiles(ch.consumables) : '<p class="cat">None.</p>') +
      panel('Weapon upgrades', arsenalList('Weapon')) +
      panel('Armor upgrades', arsenalList('Armor')) +
      panel('Kills by weapon', kills || '<p class="cat">No kills recorded.</p>') +
      panel('Combat stats', stats) +
      panel('Deaths by quest', deaths) +
      panel('Achievement progress (' + achDone + ' / ' + prof.achievements.length + ')', achievements) +
      (milestones ? panel('Story milestones', '<div class="chips">' + milestones + '</div>', true) : '') +
      '</div>' + moreFromSave(ch, world);
  }

  // Everything else the save records, shown as-is.
  function moreFromSave(ch, world) {
    var x = ch.extra || {};
    var kv = function (rows) {
      return '<table class="kv">' + rows.filter(function (r) { return r[1] !== undefined && r[1] !== null && r[1] !== ''; }).map(function (r) {
        return '<tr><th>' + esc(r[0]) + '</th><td>' + esc(String(r[1])) + '</td></tr>';
      }).join('') + '</table>';
    };
    var chips = function (list) { return list && list.length ? '<div class="chips">' + list.map(function (t) { return '<span class="chip on">' + esc(t) + '</span>'; }).join('') + '</div>' : '<p class="cat">None.</p>'; };
    var prof = state.profile || {};
    var general = kv([
      ['Name stored in the save', x.characterName], ['Archetype', ch.archetype], ['Trait rank', x.traitRank],
      ['Power level', x.powerLevel], ['Stamina', x.stamina], ['Character level', ch.level], ['Experience', num(ch.experience)],
      ['Weapon in hand', x.inHand || '—'], ['Hidden inventory entries', x.hiddenItems],
      ['Hand gun ammo pool', x.ammoPools && x.ammoPools.handGun != null ? fmt(x.ammoPools.handGun, 2) : null],
      ['Long gun ammo pool', x.ammoPools && x.ammoPools.longGun != null ? fmt(x.ammoPools.longGun, 2) : null],
      ['Special ammo pool', x.ammoPools && x.ammoPools.special != null ? fmt(x.ammoPools.special, 2) : null],
      ['Last host type', x.hostType], ['Skipped the intro', x.skipIntro ? 'yes' : 'no'], ['Appearance seed', x.visualSeed],
      ['Loading screen tip', prof.settings && prof.settings.loadscreenTip], ['Auto visibility setting', prof.settings ? (prof.settings.autoVisibility ? 'on' : 'off') : null],
      ['Audio logs (recorders) stored', x.recorders], ['Cryptolith phase', x.cryptolithPhase],
      ['Equipped the Harsgaard root gun', x.usedHarsgaardRootGun ? 'yes' : 'no'], ['Finished the intro', x.finishedIntro ? 'yes' : 'no'],
      world ? ['World has a campaign', world.hasCampaign ? 'yes' : 'no'] : null,
      world ? ['Quests generated in this world', world.questsGenerated] : null,
      world ? ['Zones generated in this world', world.zonesGenerated] : null,
    ].filter(Boolean));
    var ammo = (x.ammo || []).length ? '<table class="kv">' + x.ammo.map(function (a) {
      return '<tr><th>' + esc(a.name) + '</th><td>' + (a.clip != null ? a.clip + ' in clip · ' : '') + num(Math.max(0, a.reserve)) + ' in reserve</td></tr>';
    }).join('') + '</table>' : '<p class="cat">None.</p>';
    var shortcuts = (x.shortcuts || []).slice().sort(function (a, b) { return a.slot - b.slot; }).map(function (s) { return s.radial + ' ' + (s.slot + 1) + ': ' + s.name; });
    var counters = kv((x.counters || []).map(function (c) { return [c.name, c.value]; }));
    var visuals = kv((x.visuals || []).map(function (v) { return [v.slot, String(v.value).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')]; }));
    return '<h3 class="section-title more">More from your save</h3><div class="panels">' +
      panel('General', general) +
      panel('Ammo', ammo) +
      panel('Quick-use shortcuts', chips(shortcuts)) +
      panel('Emotes unlocked (' + (x.emotes || []).length + ')', chips(x.emotes)) +
      panel('Account rewards received', chips(x.awards)) +
      panel('Account rewards available', chips(prof.accountAwards)) +
      panel('Account currencies', kv((prof.accountCurrencies || []).map(function (c) { return [c.name, c.quantity]; }))) +
      panel('Items marked new', chips(x.newItems)) +
      panel('Equipped look (weapon and armor skins)', kv((x.skins || []).map(function (s) { return [s.item + ' +' + s.level, s.skin || 'default look']; }))) +
      panel('Counters', counters) +
      panel('Tutorials seen (' + (x.tutorials || []).length + ')', chips(x.tutorials)) +
      panel('Appearance', visuals) +
      '</div>';
  }

  // ---- world state -----------------------------------------------------------
  function renderStateTab() {
    var el = $('state-view'), ws = state.worldStates && state.worldStates[state.charIndex];
    var world = state.worlds && state.worlds[state.charIndex];
    if (!ws) { el.innerHTML = '<div class="empty">Load a world save (save_N.sav) to see what you did in it.</div>'; return; }
    if (ws.error) { el.innerHTML = '<div class="empty">Could not read the world state: ' + esc(ws.error) + '</div>'; return; }

    // Boss/dungeon/siege quests record completion; item drops don't, so for those we check whether you own the item.
    var status = function (e) {
      if (e.done) return { cls: 'ok', text: 'Completed' };
      if (e.type === 'Item drop') {
        var items = e.items.filter(function (i) { return i.item; });
        if (!items.length) return { cls: 'unk', text: e.name === 'Trait Book' ? 'Not recorded' : 'Not recorded' };
        var owned = items.every(function (i) { return itemOwned(i.item) === true; });
        if (!character()) return { cls: 'unk', text: 'Load profile.sav' };
        return owned ? { cls: 'ok', text: 'Item owned' } : { cls: 'miss', text: 'Item not picked up' };
      }
      return { cls: 'miss', text: 'Not completed' };
    };
    var tracked = ws.events.filter(function (e) { return e.type !== 'Item drop'; });
    var doneCount = tracked.filter(function (e) { return e.done; }).length;
    var lootByName = {};
    ws.loot.forEach(function (l) {
      var g = lootByName[l.name] = lootByName[l.name] || { name: l.name, item: l.item, quantity: 0, piles: 0, areas: {} };
      g.quantity += l.quantity; g.piles++; if (l.zoneLabel) g.areas[l.zoneLabel] = true;
    });
    var lootList = Object.keys(lootByName).map(function (k) { return lootByName[k]; });
    // Gear and trait books first: those are worth going back for.
    var precious = lootList.filter(function (g) { return g.item && /Ring|Amulet|Weapon|Armor|Mod|Trait/.test(g.item.category) || g.name === 'Trait Book'; });
    var scrap = lootByName.Scrap ? lootByName.Scrap.quantity : 0;

    var modeTime = ws.modes.map(function (m) { return (/Adventure/.test(m.cls) ? 'Adventure' : 'Campaign') + ' ' + duration(m.playTime); }).join(' · ');
    var cards = [
      ['Events completed', doneCount + ' of ' + tracked.length, 'bosses, dungeons, sieges, points of interest'],
      ['Chests opened', ws.chests.open + ' of ' + ws.chests.total, ws.chests.total - ws.chests.open + ' still closed'],
      ['Left on the ground', ws.loot.length + ' piles', num(scrap) + ' scrap' + (precious.length ? ' · ' + precious.length + ' gear / trait book' : '')],
      ['Map interactions', num(ws.objects.broken) + ' broken', ws.objects.opened + ' opened · ' + ws.objects.unlocked + ' unlocked · ' + ws.objects.switchedOn + ' switched on'],
      modeTime ? ['Time per mode', modeTime.split(' · ')[0], modeTime.split(' · ').slice(1).join(' · ') + (world ? ' · ' + duration(world.timePlayed) + ' in total' : '')] : null,
    ].filter(Boolean).map(function (c) {
      return '<div class="card static"><div class="w">' + esc(c[0]) + '</div><div class="n neutral">' + esc(c[1]) + '</div><div class="of">' + esc(c[2]) + '</div></div>';
    }).join('');

    var eventTable = function (mode) {
      var list = ws.events.filter(function (e) { return e.mode === mode; });
      if (!list.length) return '';
      return panel(mode + ' events', '<table class="kv">' + list.map(function (e) {
        var st = status(e);
        var items = e.items.map(function (i) { return '<span class="evitem">' + (i.item ? statusIcon(itemOwned(i.item)) : '') + esc(i.name) + (i.item ? itemWikiLink(i.item) : '') + '</span>'; }).join('');
        return '<tr><th><span class="st ' + st.cls + '">' + (st.cls === 'ok' ? '✔' : st.cls === 'miss' ? '✘' : '?') + '</span> ' + esc(e.name) +
          ' <span class="cat">' + esc(e.type) + (e.area ? ' · ' + esc(e.area) : '') + '</span>' + (e.area ? wikiLink(e.area) : '') + '</th><td>' +
          '<div class="cat">' + esc(st.text) + '</div>' + items + '</td></tr>';
      }).join('') + '</table>', true);
    };

    var areas = '<table class="kv"><tr><th>Area</th><td><b>Level</b></td><td><b>Explored</b></td><td><b>Chests</b></td><td><b>Loot left</b></td></tr>' + ws.zones.map(function (z) {
      var depth = 0, p = z; while (p && p.parent != null && depth < 4) { p = ws.zones.filter(function (x) { return x.id === p.parent; })[0]; depth++; }
      return '<tr><th style="padding-left:' + depth * 14 + 'px">' + esc(z.name) + wikiLink(z.name) + '</th><td>' + (z.level || '—') + '</td><td>' + (z.explored ? num(z.explored) : '—') +
        '</td><td>' + (z.chests ? z.chestsOpen + ' / ' + z.chests : '—') + '</td><td>' + (z.loot || '—') + '</td></tr>';
    }).join('') + '</table><p class="cat">Explored = map cells revealed in that area. Chests are counted where the save keeps them (generated tiles).</p>';

    var lootTable = lootList.length ? '<table class="kv">' + lootList.sort(function (a, b) {
      return (precious.indexOf(b) >= 0) - (precious.indexOf(a) >= 0) || b.quantity - a.quantity;
    }).map(function (g) {
      var where = Object.keys(g.areas);
      return '<tr><th>' + (precious.indexOf(g) >= 0 ? '★ ' : '') + esc(g.name) + (g.item ? itemWikiLink(g.item) : '') + '</th><td>' + num(g.quantity) +
        (g.piles > 1 ? ' <span class="cat">in ' + g.piles + ' piles</span>' : '') + (where.length ? '<div class="cat">' + esc(where.slice(0, 4).join(', ') + (where.length > 4 ? '…' : '')) + '</div>' : '') + '</td></tr>';
    }).join('') + '</table>' + (precious.length ? '<p class="cat">★ Gear or trait books you dropped or never picked up — still in your world.</p>' : '')
      : '<p class="cat">Nothing left behind.</p>';

    el.innerHTML = '<div class="summary">' + cards + '</div><div class="panels">' +
      eventTable('Campaign') + eventTable('Adventure') +
      panel('Areas', areas, true) +
      panel('Left on the ground', lootTable) +
      panel('Story progress flags', ws.flags.length ? '<div class="chips">' + ws.flags.map(function (f) { return '<span class="chip on">' + esc(f) + '</span>'; }).join('') + '</div>' : '<p class="cat">None.</p>') +
      panel('Merchants and NPCs in this world', ws.npcs.length ? '<table class="kv">' + ws.npcs.map(function (n) {
        return '<tr><th>' + esc(n.name) + '<div class="cat">' + esc(n.where.replace(/^Zone_\d+_\d+\./, '').replace(/_POI$/, '').replace(/_/g, ' ')) + '</div></th><td>' +
          (n.items.length ? n.items.map(function (i) { return '<span class="evitem">' + esc(i) + globe(RWA_WIKI.items[i], i) + '</span>'; }).join('') : '<span class="cat">nothing</span>') + '</td></tr>';
      }).join('') + '</table><p class="cat">What each NPC carries — for merchants, what they sell.</p>' : '<p class="cat">None recorded.</p>') +
      panel('Key items', ws.keyItems.length ? '<table class="kv">' + ws.keyItems.map(function (k) { return '<tr><th>' + esc(k.name) + '</th><td class="cat">' + esc(k.quest) + '</td></tr>'; }).join('') + '</table>' : '<p class="cat">None.</p>') +
      panel('Checkpoints and generated quests', ws.modes.map(function (m) {
        return '<p><b>' + esc(m.name) + '</b>' + (m.playTime ? ' <span class="cat">' + duration(m.playTime) + ' played</span>' : '') + (m.checkpoint ? '<br><span class="cat">Last checkpoint: ' + esc(m.checkpoint.replace(/_/g, ' ')) + '</span>' : '') + '</p>' +
          (m.generated.length ? '<details><summary class="cat">' + m.generated.length + ' quests generated</summary><table class="kv">' + m.generated.map(function (g) { return '<tr><th>' + esc(g.template) + '</th><td>×' + g.count + '</td></tr>'; }).join('') + '</table></details>' : '');
      }).join('') || '<p class="cat">None.</p>') +
      panel('NPC conversations (' + ws.conversations.length + ')', ws.conversations.length ? '<div class="chips">' + ws.conversations.map(function (c) { return '<span class="chip on" title="' + esc(c.quest) + '">' + esc(c.text) + '</span>'; }).join('') + '</div>' : '<p class="cat">None.</p>', true) +
      panel('World save', '<table class="kv">' + [
        ['Shown location', ws.header.location], ['New game', ws.header.newGame ? 'yes' : 'no'], ['Has a campaign', ws.header.hasCampaign ? 'yes' : 'no'],
        ['Requires the full game', ws.header.requiresFullGame ? 'yes' : 'no'], ['Last active slot', ws.header.lastRootSlot], ['Unique ID counter', ws.header.uniqueIds],
        ['Map objects remembered without a known effect', num(ws.objects.other)],
      ].map(function (r) { return '<tr><th>' + esc(r[0]) + '</th><td>' + esc(String(r[1])) + '</td></tr>'; }).join('') + '</table>') +
      '</div>';
  }

  // ---- tips ------------------------------------------------------------------
  // Next steps worked out from your saves: each tip comes from something the files record.
  function sheetItem(name) { return DATA.items.filter(function (i) { return i.name === name; })[0]; }
  function tipList(list, empty) {
    return list.length ? '<ul class="tips">' + list.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>' : '<p class="cat">' + (empty || 'Nothing here.') + '</p>';
  }
  function ownedMark(it) { return it ? statusIcon(itemOwned(it)) : ''; }
  function mapLink(zoneId, label) { return zoneId != null ? '<a class="link" href="#zone-' + zoneId + '" data-goto-map="' + zoneId + '">' + esc(label) + '</a>' : esc(label); }

  function cryptolithPanel(ch, ws) {
    var x = ch.extra || {}, phase = x.cryptolithPhase || 0;
    var sigil = (x.questItems || []).filter(function (q) { return /Sigil|Cryptolith/i.test(q.cls); })[0];
    var rewards = [['1st use', ['Concentration']], ['2nd use', ['Blood Bond']], ['3rd use', ['Labyrinth Helm', 'Labyrinth Armor', 'Labyrinth Greaves']]];
    var towers = (ws && ws.cryptolith) || [];
    var queen = ws ? ws.events.filter(function (e) { return e.key === 'IskalQueen'; })[0] : null;
    var soul = sheetItem('Soul Link');

    var next;
    if (phase >= 3) next = 'All three Cryptolith rewards unlocked.';
    else if (sigil) next = towers.length ? 'Use the Sigil on the Cryptolith tower in ' + towers[0].area + ' (tile ' + towers[0].tileId + ').' : 'Use the Sigil on a Cryptolith tower — this world has none; reroll an adventure until one shows up.';
    else next = queen ? (queen.done ? 'You defeated the Iskal Queen in this world — if you didn\'t get the Sigil, it drops from her.' : 'Defeat the Iskal Queen in ' + queen.area + ' to get the Cryptolith Sigil.')
      : 'Get the Cryptolith Sigil from the Iskal Queen (Corsus, The Mist Fen) — she is not in this world.';

    var rows = [
      ['Next step', '<b>' + esc(next) + '</b>'],
      ['Sigil in your inventory', sigil ? '<span class="st ok">✔</span> yes' : '<span class="st miss">✘</span> no'],
      ['Times used on a tower', phase + ' of 3' + (phase < 3 ? ' — reroll the world between uses' : '')],
      ['Rewards', rewards.map(function (r, i) {
        return '<div>' + (phase > i ? '✔ ' : '') + '<span class="cat">' + r[0] + ':</span> ' + r[1].map(function (n) { var it = sheetItem(n); return ownedMark(it) + esc(n) + (it ? itemWikiLink(it) : ''); }).join(', ') + '</div>';
      }).join('')],
      ['Tower in this world', towers.length ? towers.map(function (t) {
        return mapLink(t.zoneId, t.area) + ' <span class="cat">' + t.mode + ', tile ' + t.tileId + ' · teleporter to the Labyrinth ' + (t.teleporterUsed ? 'used' : t.teleporterActive ? 'active, never used' : 'inactive') + '</span>';
      }).join('<br>') : 'none — the tower appears in Earth, Rhom or Corsus adventures/campaigns'],
      ['Iskal Queen in this world', queen ? (queen.done ? '✔ defeated' : 'yes, not defeated') + ' <span class="cat">' + esc(queen.area) + '</span>' : 'no'],
      ['Soul Link ring', ownedMark(soul) + 'looted from the cave below the Cryptolith tower on Rhom' + (soul ? itemWikiLink(soul) : '')],
    ];
    return panel('Cryptolith', '<table class="kv">' + rows.map(function (r) { return '<tr><th>' + esc(r[0]) + '</th><td>' + r[1] + '</td></tr>'; }).join('') + '</table>' +
      '<p class="cat">The tower progress is per character (CryptolithPhase in profile.sav); the Sigil is a quest item in your inventory.</p>', true);
  }

  function renderTipsTab() {
    var el = $('tips-view');
    if (state.tab !== 'tips') return;
    var prof = state.profile, ch = prof && prof.characters && prof.characters[state.charIndex];
    var ws = state.worldStates && state.worldStates[state.charIndex];
    if (ws && ws.error) ws = null;
    if (!ch || ch.error) { el.innerHTML = '<div class="empty">Load <b>profile.sav</b> (and your save_N.sav) to get tips.</div>'; return; }
    var missing = function (it) { return it && itemOwned(it) === false; };

    // In this world, right now.
    var world = [];
    if (ws) {
      ws.loot.filter(function (l) { return (l.item && /Ring|Amulet|Weapon|Armor|Mod|Trait/.test(l.item.category) && missing(l.item)) || l.name === 'Trait Book'; }).forEach(function (l) {
        world.push('★ <b>Pick up ' + esc(l.name) + '</b> lying on the ground in ' + mapLink(l.zone, l.zoneLabel) + (l.item ? itemWikiLink(l.item) : ''));
      });
      // Skip the Cryptolith (it has its own panel) and item drops already listed as lying on the ground.
      var onGround = {}; ws.loot.forEach(function (l) { if (l.item) onGround[l.item.name] = true; });
      ws.events.filter(function (e) {
        return !e.done && e.key !== 'Cryptolith' && e.items.some(function (i) { return missing(i.item) && !onGround[i.name]; });
      }).forEach(function (e) {
        var need = e.items.filter(function (i) { return missing(i.item); });
        var verb = { Boss: 'Defeat', Miniboss: 'Defeat', Dungeon: 'Clear', Siege: 'Survive', 'Item drop': 'Find', 'Point of interest': 'Visit' }[e.type] || 'Do';
        world.push(verb + ' <b>' + esc(e.name) + '</b> <span class="cat">' + esc(e.type) + '</span> in ' + mapLink(e.zoneId, e.area) + ' → ' +
          need.map(function (i) { return esc(i.name) + itemWikiLink(i.item); }).join(', '));
      });
      ws.npcs.forEach(function (n) {
        var sells = n.items.map(sheetItem).filter(missing);
        if (sells.length) world.push('<b>' + esc(n.name.replace(/^Merchant /, '')) + '</b> sells ' + sells.map(function (i) { return esc(i.name) + itemWikiLink(i); }).join(', ') + ' — you don\'t have ' + (sells.length > 1 ? 'them' : 'it'));
      });
      var closed = ws.zones.filter(function (z) { return z.chests > z.chestsOpen; });
      if (closed.length) world.push((ws.chests.total - ws.chests.open) + ' chests still closed: ' + closed.map(function (z) { return mapLink(z.id, z.name) + ' ' + (z.chests - z.chestsOpen); }).join(', '));
      var undone = ws.events.filter(function (e) { return !e.done && e.type !== 'Item drop' && !e.items.some(function (i) { return missing(i.item); }); });
      if (undone.length) world.push('Not done yet (nothing new for you, but XP and scrap): ' + undone.map(function (e) { return esc(e.name); }).join(', '));
    }

    // Your character.
    var me = [], x = ch.extra || {};
    var spare = (ch.traitPoints || 0) - (ch.traitPointsSpent || 0);
    if (spare > 0) me.push('<b>' + spare + ' trait point' + (spare > 1 ? 's' : '') + ' to spend.</b>');
    var lvl = ch.traits.filter(function (t) { return t.level > 0 && t.level < 20; });
    if (lvl.length) me.push('Traits not maxed: ' + lvl.map(function (t) { return esc(t.name) + ' ' + t.level + '/20'; }).join(', '));
    ch.loadout.forEach(function (l) {
      var e = l.entry; if (!(e.category === 'Weapon' || e.category === 'Armor') || e.level == null) return;
      var max = e.item && e.item.key && /\/Weapons\/Boss\//.test(e.item.key) ? 10 : 20;
      if (e.level < max) me.push('Upgrade your ' + esc(l.label.toLowerCase()) + ' <b>' + esc(e.name) + '</b> +' + e.level + ' → +' + max);
    });
    // Quest items that aren't regular gear (the Pocket Watch is also an amulet in the sheet).
    (x.questItems || []).filter(function (q) { return !q.item; }).forEach(function (q) { me.push('You carry <b>' + esc(q.name) + '</b>' + (q.item ? itemWikiLink(q.item) : '') + (/Sigil|Cryptolith/i.test(q.cls) ? ' — use it on a Cryptolith tower' : '')); });
    if ((x.newItems || []).length) me.push('New items you haven\'t looked at: ' + x.newItems.map(esc).join(', '));
    prof.achievements.filter(function (a) { return a.target > 1 && a.value < a.target && a.value / a.target >= 0.5; }).forEach(function (a) {
      me.push('Almost there: <b>' + esc(a.name) + '</b> ' + num(a.value) + ' / ' + num(a.target));
    });

    // Collection.
    var coll = [], gaps = {}, modeOnly = { Survival: [], Hardcore: [] };
    DATA.items.forEach(function (it) {
      if (!collectible(it) || itemOwned(it) !== false) return;
      if (modeOnly[it.mode]) { modeOnly[it.mode].push(it); return; }
      if (/^(Earth|Rhom|Corsus|Yaesha|Reisum)$/.test(it.world)) (gaps[it.world] = gaps[it.world] || []).push(it);
    });
    var ranked = Object.keys(gaps).sort(function (a, b) { return gaps[b].length - gaps[a].length; });
    if (ranked.length) coll.push('<b>Best world to roll next:</b> ' + ranked.map(function (w) { return esc(WORLD_LABEL[w] || w) + ' (' + gaps[w].length + ' missing)'; }).join(' · '));
    Object.keys(modeOnly).forEach(function (m) { if (modeOnly[m].length) coll.push('<b>' + m + ' mode</b> only: ' + modeOnly[m].length + ' items missing — ' + modeOnly[m].map(function (i) { return esc(i.name) + itemWikiLink(i); }).join(', ')); });
    if (state.available) {
      var now = DATA.items.filter(function (it) { var k = itemKeyForAvailability(it); return collectible(it) && itemOwned(it) === false && k && state.available[k]; });
      if (now.length) coll.push(now.length + ' missing items drop in the world you have loaded — see <b>Missing items</b> › "Only what I can get in my world right now".');
    }

    el.innerHTML = '<div class="panels">' + cryptolithPanel(ch, ws) +
      panel('In this world', ws ? tipList(world, 'Nothing left to do here for your collection — time to reroll.') : '<p class="cat">Load your save_N.sav to get tips for your world.</p>', true) +
      panel('Your character', tipList(me, 'Nothing pending.')) +
      panel('Collection', tipList(coll, 'You have everything trackable.')) + '</div>';
  }

  // ---- map -------------------------------------------------------------------
  var TILE_CELL = 80;
  function short(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  // Tile layout of one zone as SVG: rooms, corridors (edge bits), events, chests, loot and waypoints.
  function zoneLayoutSvg(z) {
    var core = z.tiles.filter(function (t) { return t.kind !== 'blank' && t.kind !== 'vista'; });
    if (!core.length) return '<p class="cat">No tile layout stored for this area (fixed map).</p>';
    var xs = core.map(function (t) { return t.x; }), ys = core.map(function (t) { return t.y; });
    var minX = Math.min.apply(null, xs), minY = Math.min.apply(null, ys), maxX = Math.max.apply(null, xs), maxY = Math.max.apply(null, ys);
    var C = TILE_CELL, w = (maxX - minX + 1) * C, h = (maxY - minY + 1) * C;
    var px = function (t) { return (t.x - minX) * C; }, py = function (t) { return (t.y - minY) * C; };
    var out = [];
    z.tiles.forEach(function (t) {
      if (t.kind !== 'vista' || t.x < minX || t.x > maxX || t.y < minY || t.y > maxY) return;
      out.push('<rect class="t-vista" x="' + (px(t) + 6) + '" y="' + (py(t) + 6) + '" width="' + (C - 12) + '" height="' + (C - 12) + '" rx="6"/>');
    });
    // Corridors first so rooms sit on top of them.
    core.forEach(function (t) {
      var cx = px(t) + C / 2, cy = py(t) + C / 2;
      WS.EDGES.forEach(function (e) { if (t.edges & e[0]) out.push('<line class="t-path" x1="' + cx + '" y1="' + cy + '" x2="' + (cx + e[1] * C / 2) + '" y2="' + (cy + e[2] * C / 2) + '"/>'); });
    });
    core.forEach(function (t) {
      var x = px(t), y = py(t);
      var precious = t.loot.some(function (l) { return l.item && /Ring|Amulet|Weapon|Armor|Mod|Trait/.test(l.item.category) || l.name === 'Trait Book'; });
      var tip = [z.name + ' — tile ' + t.id + ' (' + t.level + ')', t.role !== 'None' ? 'Role: ' + t.role : '', t.tag && t.tag !== 'None' ? 'Tag: ' + t.tag : '']
        .concat(t.events.map(function (e) { return e.type + ': ' + e.name + (e.done ? ' (completed)' : ''); }))
        .concat(t.links.map(function (l) { return ({ Waypoint: 'Waypoint', Checkpoint: 'Respawn checkpoint', Link: 'Passage' }[l.type] || l.type) + (l.label ? ': ' + l.label : '') + (l.used ? ' (used)' : '') + (l.active ? '' : ' (inactive)'); }))
        .concat(t.chests ? ['Chests: ' + t.chestsOpen + ' of ' + t.chests + ' opened'] : [])
        .concat(t.loot.map(function (l) { return 'On the ground: ' + l.name + (l.quantity > 1 ? ' ×' + l.quantity : ''); }))
        .filter(Boolean).join('\n');
      out.push('<g class="tile t-' + t.kind + '"><title>' + esc(tip) + '</title><rect x="' + (x + 8) + '" y="' + (y + 8) + '" width="' + (C - 16) + '" height="' + (C - 16) + '" rx="7"/>');
      var lines = [];
      if (t.kind === 'start') lines.push(['Start', '']);
      if (t.kind === 'exit') lines.push([short(t.tag && t.tag !== 'None' ? t.tag.replace(/^To/, '→ ') : 'Exit', 12), '']);
      t.events.forEach(function (e) { lines.push([(e.done ? '✔ ' : '') + short(e.name, 13), e.done ? 'ok' : e.type === 'Item drop' ? 'acc' : 'miss']); });
      if (t.links.some(function (l) { return l.type === 'Waypoint'; })) lines.push(['⚑ waypoint', 'now']);
      if (t.links.some(function (l) { return l.type === 'Checkpoint'; })) lines.push(['✚ checkpoint', 'now']);
      var icons = (t.chests ? '▣' + t.chestsOpen + '/' + t.chests + ' ' : '') + (t.loot.length ? (precious ? '★' : '•') + t.loot.length : '');
      if (icons) lines.push([icons, precious ? 'acc' : '']);
      lines.slice(0, 5).forEach(function (l, i) { out.push('<text class="tl ' + l[1] + '" x="' + (x + 12) + '" y="' + (y + 22 + i * 11) + '">' + esc(l[0]) + '</text>'); });
      out.push('</g>');
    });
    return '<svg class="zmap" viewBox="-2 -2 ' + (w + 4) + ' ' + (h + 4) + '" width="' + (w + 4) + '" height="' + (h + 4) + '" role="img" aria-label="Map of ' + esc(z.name) + '">' + out.join('') + '</svg>';
  }

  // Map cells you walked through (the trail the in-game map reveals).
  function zoneFogSvg(z) {
    if (!z.fow.length) return '<p class="cat">You have not walked here yet.</p>';
    var xs = z.fow.map(function (c) { return c[0]; }), ys = z.fow.map(function (c) { return c[1]; });
    var minX = Math.min.apply(null, xs), minY = Math.min.apply(null, ys), w = Math.max.apply(null, xs) - minX + 1, h = Math.max.apply(null, ys) - minY + 1;
    var d = z.fow.map(function (c) { return 'M' + (c[0] - minX) + ' ' + (c[1] - minY) + 'h1v1h-1z'; }).join('');
    var scale = Math.min(3, 300 / Math.max(w, h));
    return '<svg class="zfog" viewBox="0 0 ' + w + ' ' + h + '" width="' + Math.round(w * scale) + '" height="' + Math.round(h * scale) + '" shape-rendering="crispEdges" role="img" aria-label="Explored part of ' + esc(z.name) + '"><path d="' + d + '"/></svg>';
  }

  // Re-render the expensive tabs only when they're shown.
  function renderMapTab() {
    var el = $('map-view');
    if (state.tab !== 'map') return;
    var ws = state.worldStates && state.worldStates[state.charIndex];
    if (!ws) { el.innerHTML = '<div class="empty">Load a world save (save_N.sav) to see the map.</div>'; return; }
    if (ws.error) { el.innerHTML = '<div class="empty">Could not read the world: ' + esc(ws.error) + '</div>'; return; }
    var depthOf = function (z) { var d = 0, p = z; while (p && p.parent != null && d < 5) { p = ws.zones.filter(function (x) { return x.id === p.parent; })[0]; d++; } return d; };
    var index = ws.zones.map(function (z) { return '<a class="chip on" href="#zone-' + z.id + '">' + '·'.repeat(depthOf(z)) + esc(z.name) + '</a>'; }).join('');
    var legend = '<div class="legend"><span class="lg t-start">Start</span><span class="lg t-exit">Exit / way to another area</span><span class="lg t-poi">Event / point of interest</span>' +
      '<span class="lg t-straight">Path</span><span class="lg t-vista">Scenery</span> <span class="cat">✔ completed · ⚑ waypoint · ✚ respawn checkpoint · ▣ chests opened/total · • loot on the ground · ★ gear or trait book on the ground · hover a tile for everything in it</span></div>';
    el.innerHTML = '<div class="chips map-index">' + index + '</div>' + legend + ws.zones.map(function (z) {
      var parent = z.parent != null ? ws.zones.filter(function (x) { return x.id === z.parent; })[0] : null;
      // Travel points (waypoints) by name; respawn checkpoints and passages to other areas as counts.
      var waypoints = z.links.filter(function (l) { return l.type === 'Waypoint'; }), checkpoints = z.links.filter(function (l) { return l.type === 'Checkpoint'; });
      var passages = z.links.filter(function (l) { return l.type === 'Link'; });
      var links = waypoints.map(function (l) {
        return '<span class="chip' + (l.active ? ' on' : '') + '">⚑ ' + esc(l.label || l.name) + (l.active ? '' : ' (inactive)') + '</span>';
      }).join('') +
        (checkpoints.length ? '<span class="chip">✚ ' + checkpoints.length + ' respawn checkpoint' + (checkpoints.length > 1 ? 's' : '') + '</span>' : '') +
        (passages.length ? '<span class="chip">↔ ' + passages.length + ' passage' + (passages.length > 1 ? 's' : '') + ' to other areas · ' + passages.filter(function (l) { return l.used; }).length + ' used</span>' : '');
      var facts = [
        'Level ' + (z.level || '—') + (z.itemLevel ? ' · item level ' + z.itemLevel : ''),
        parent ? 'inside ' + parent.name : '',
        z.chests ? z.chestsOpen + '/' + z.chests + ' chests opened' : '',
        z.loot ? z.loot + ' piles on the ground' : '',
        z.explored ? num(z.explored) + ' map cells walked' : '',
        z.tileSet ? 'tile set ' + z.tileSet.replace(/^TileSet_/, '') : '',
      ].filter(Boolean).join(' · ');
      return '<section class="panel zone" id="zone-' + z.id + '"><h3>' + esc(z.name) + wikiLink(z.name) + '</h3><p class="cat">' + esc(facts) + '</p>' +
        (links ? '<div class="chips">' + links + '</div>' : '') +
        '<div class="zviews"><div><div class="section-title">Layout</div>' + zoneLayoutSvg(z) + '</div><div><div class="section-title">Your path</div>' + zoneFogSvg(z) + '</div></div>' +
        (z.spawns.length ? '<details class="spawns"><summary class="cat">Spawn tables (' + z.spawns.length + ')</summary><p class="cat">' + esc(z.spawns.join(', ')) + '</p></details>' : '') +
        '</section>';
    }).join('');
  }

  // ---- raw data --------------------------------------------------------------
  var rawNodes = [];
  // Objects read by js/gvas.js reference each other; show those links as "→ path" instead of expanding them.
  function isRef(v) { return v && typeof v === 'object' && !Array.isArray(v) && 'path' in v && 'props' in v && 'comps' in v; }
  function rawLabel(v) { return Array.isArray(v) ? '[' + v.length + ']' : '{' + Object.keys(v).length + '}'; }
  function rawNode(label, value) {
    var id = rawNodes.push(value) - 1;
    return '<details class="raw" data-raw="' + id + '"><summary>' + label + '</summary></details>';
  }
  function rawValue(v) {
    if (v === null || v === undefined) return '<span class="rv">null</span>';
    if (isRef(v)) return '<span class="rv ref">→ ' + esc(String(v.path).split('/').pop()) + '</span>';
    if (typeof v !== 'object') return '<span class="rv">' + esc(JSON.stringify(v)) + '</span>';
    if (Array.isArray(v) && !v.length) return '<span class="rv">[]</span>';
    if (!Array.isArray(v) && !Object.keys(v).length) return '<span class="rv">{}</span>';
    return rawNode('<span class="cat">' + rawLabel(v) + '</span>', v);
  }
  function rawChildren(v) {
    var keys = Array.isArray(v) ? v.map(function (_, i) { return i; }) : Object.keys(v);
    return keys.map(function (k) { return '<div class="rrow"><span class="rk">' + esc(String(k)) + '</span> ' + rawValue(v[k]) + '</div>'; }).join('');
  }
  // A gvas object as a plain, expandable node.
  function objNode(o, i) { return { index: i, path: o.path, properties: o.props, components: o.comps }; }

  function renderRawTab() {
    var el = $('raw-view');
    if (state.tab !== 'raw') return;
    rawNodes = [];
    var parts = [];
    var pf = state.files['profile.sav'];
    if (pf) {
      try {
        var prof = RWA_GVAS.readFile(pf);
        var root = prof.root.props, chars = (root.Characters || []);
        var top = {}; Object.keys(root).forEach(function (k) { if (k !== 'Characters') top[k] = root[k]; });
        var charNodes = chars.map(function (c, i) {
          if (!c || !c.props) return '<div class="rrow"><span class="rk">Slot ' + i + '</span> <span class="rv">empty</span></div>';
          var inner = RWA_GVAS.readBlob(pf, c.props.CharacterData);
          var props = {}; Object.keys(c.props).forEach(function (k) { props[k] = c.props[k]; });
          return '<div class="rrow"><span class="rk">Character ' + (i + 1) + '</span> ' + rawNode('<span class="cat">character properties</span>', props) +
            rawNode('<span class="cat">character data: ' + inner.objects.length + ' objects</span>', inner.objects.map(objNode)) + '</div>';
        }).join('');
        parts.push('<section class="panel"><h3>profile.sav</h3>' + rawNode('<b>Account</b> <span class="cat">' + Object.keys(top).length + ' properties</span>', top) +
          '<div class="rrow"><span class="rk">Objects</span> ' + rawNode('<span class="cat">' + prof.objects.length + ' objects</span>', prof.objects.map(objNode)) + '</div>' + charNodes + '</section>');
      } catch (e) { parts.push('<p class="error">profile.sav: ' + esc(String(e)) + '</p>'); }
    }
    var saveName = Object.keys(state.files).filter(function (n) { return saveIndexOf(n) === state.charIndex && /\.sav$/i.test(n); })[0];
    var ws = state.worldStates && state.worldStates[state.charIndex];
    if (saveName) {
      try {
        var save = RWA_GVAS.readFile(state.files[saveName]);
        var wtop = {}; Object.keys(save.root.props).forEach(function (k) { if (k !== 'Containers') wtop[k] = save.root.props[k]; });
        var conts = ws && ws.raw ? ws.raw.map(function (c) {
          return rawNode(esc(c.key.split('/').pop().split(':')[0]) + ' <span class="cat">' + c.actors.length + ' actors</span>', c.actors.map(function (a) {
            return { id: a.id, class: a.classPath || '(placed in the level)', location: a.location, properties: a.props, components: a.comps, objects: a.objects.map(objNode) };
          }));
        }).join('') : '';
        parts.push('<section class="panel"><h3>' + esc(saveName) + '</h3>' + rawNode('<b>World</b> <span class="cat">' + Object.keys(wtop).length + ' properties</span>', wtop) +
          '<div class="rrow"><span class="rk">Containers</span> <span class="cat">' + (ws && ws.raw ? ws.raw.length : 0) + ' maps — each holds the actors whose state the game remembers</span></div>' + conts + '</section>');
      } catch (e) { parts.push('<p class="error">' + esc(saveName) + ': ' + esc(String(e)) + '</p>'); }
    }
    el.innerHTML = parts.length ? '<p class="cat">Everything stored in your save files, as read. Click to expand. "→" points to another object.</p>' + parts.join('')
      : '<div class="empty">Load your save files to browse them.</div>';
  }

  // ---- build & DPS -----------------------------------------------------------
  var dpsOn = {};
  function bonusKey(b) { return b.source + '|' + b.when + '|' + b.stat; }
  function pct(v) { return (v >= 0 ? '+' : '') + (+(v * 100).toFixed(2)) + '%'; }
  function fmt(v, d) { return v == null ? '—' : (+v).toLocaleString('en-US', { maximumFractionDigits: d == null ? 1 : d }); }

  function renderBuildTab() {
    var el = $('build-view');
    var prof = state.profile, ch = prof && prof.characters && prof.characters[state.charIndex];
    if (!prof || prof.error || !ch || ch.error) { el.innerHTML = '<div class="empty">Load <b>profile.sav</b> too to see your build and DPS.</div>'; return; }
    var on = function (b) { return !!dpsOn[bonusKey(b)]; };
    var a = DPS.analyze(ch, on);

    var guns = a.equipped.filter(function (w) { return w.dps; });
    var best = guns.slice().sort(function (x, y) { return y.dps - x.dps; })[0];
    var cards = a.equipped.map(function (w) {
      if (w.missing) return ['', w.slot, w.name, 'no stats on the wiki'];
      return w.dps ? [w.slot, fmt(w.dps, 0) + ' DPS', w.name + ' +' + w.level, fmt(w.weakDps, 0) + ' DPS on weak spots']
        : [w.slot, fmt(w.expectedHit, 0) + ' per hit', w.name + ' +' + w.level, fmt(w.expectedWeakHit, 0) + ' per weak spot hit'];
    }).concat([
      ['Summons', a.summonCount + ' at once', a.summons.length ? a.summons.map(function (s) { return s.count + '× ' + s.name; }).join(' + ') : 'no summoning mod equipped', a.summonDps ? fmt(a.summonDps, 0) + ' DPS from turrets' : ''],
      best ? ['Total while firing', fmt(best.dps + a.summonDps, 0) + ' DPS', best.name + (a.summonDps ? ' + summons' : ''), fmt(best.weakDps + a.summonDps, 0) + ' DPS on weak spots'] : null,
    ]).filter(Boolean).map(function (c) {
      return '<div class="card static"><div class="w">' + esc(c[0]) + '</div><div class="n neutral">' + esc(c[1]) + '</div><div class="of">' + esc(c[2]) + '</div><div class="now">' + esc(c[3] || '') + '</div></div>';
    }).join('');

    // Conditional bonuses the player can switch on.
    var conds = a.bonuses.filter(function (b) { return b.when; });
    var toggles = conds.length ? '<div class="toggles">' + conds.map(function (b) {
      return '<label class="check"><input type="checkbox" data-bonus="' + esc(bonusKey(b)) + '"' + (on(b) ? ' checked' : '') + '> ' +
        '<b>' + esc(b.source) + '</b> ' + esc(DPS.STAT_LABEL[b.stat] || b.stat) + ' ' + pct(b.value) + ' <span class="cat">' + esc(b.when) + '</span></label>';
    }).join('') + '</div><p><button type="button" class="btn small" data-bonus-all="1">All on</button> <button type="button" class="btn small" data-bonus-all="0">All off</button></p>'
      : '<p class="cat">Your build has no conditional bonuses.</p>';

    var weaponPanel = function (w) {
      if (w.missing) return panel(w.slot + ' — ' + w.name, '<p class="cat">No stats for this weapon on the wiki.</p>');
      var s = w.stats, max = DPS.weaponDps(w.name, w.maxLevel, a.bonuses, on);
      var rows = [
        ['Upgrade', '+' + w.level + ' of +' + w.maxLevel + (w.boss ? ' (boss weapon)' : '') + ' · ×' + fmt(w.upgrade, 2) + ' base damage'],
        ['Base damage', fmt(s.damage) + (s.damageNote ? ' (' + s.damageNote + ')' : '')],
        ['Damage bonus', pct(w.bonus)],
        ['Damage per hit', fmt(w.hit)],
        ['Crit chance', fmt(w.critChance * 100) + '% (weapon ' + s.crit + '%)'],
        ['Crit damage', '×' + fmt(w.critMult, 2)],
        ['Weak spot', '×' + fmt(w.weakMult, 2) + ' (weapon +' + s.weakspot + '%)'],
        ['Average hit (with crits)', fmt(w.expectedHit) + ' · ' + fmt(w.expectedWeakHit) + ' on weak spots'],
      ];
      if (w.rps) rows = rows.concat([
        ['Fire rate', fmt(w.rps, 2) + ' shots/s (weapon ' + s.rps + ')'],
        ['Magazine', s.magazine + ' · ' + fmt(w.perMagazine, 0) + ' damage · empties in ' + fmt(w.secondsPerMagazine, 1) + 's'],
        ['Ideal range', s.range ? s.range + ' m' : null],
        ['DPS', fmt(w.dps, 0) + ' · ' + fmt(w.weakDps, 0) + ' on weak spots'],
        max && w.level < w.maxLevel ? ['DPS at +' + w.maxLevel, fmt(max.dps, 0) + ' · ' + fmt(max.weakDps, 0) + ' on weak spots'] : null,
      ]);
      else if (s.special) rows.push(['Special', s.special]);
      var body = '<table class="kv">' + rows.filter(function (r) { return r && r[1] != null; }).map(function (r) { return '<tr><th>' + esc(r[0]) + '</th><td>' + esc(String(r[1])) + '</td></tr>'; }).join('') + '</table>';
      if (w.reloadBound) body += '<p class="cat">Only ' + s.magazine + ' shot' + (s.magazine > 1 ? 's' : '') + ' per magazine: real DPS is lower because of reloads (reload times are not on the wiki).</p>';
      if (!w.rps) body += '<p class="cat">The wiki has no attack speed for melee weapons, so this shows damage per hit.</p>';
      return panel(w.slot + ' — ' + w.name, body);
    };

    var modsBody = a.mods.length ? a.mods.map(function (m) {
      var facts = [m.type, m.summons ? m.summons + (m.summons > 1 ? ' summons' : ' summon') + ' at once' : '', m.hit != null ? fmt(m.hit) + ' damage per hit' : '', m.duration ? m.duration + 's' : ''].filter(Boolean).join(' · ');
      return '<div class="mod"><b>' + esc(m.name) + '</b> <span class="cat">on ' + esc(m.weapon) + '</span><div class="cat">' + esc(facts) + '</div><p>' + esc(m.effect || 'No description on the wiki.') + '</p></div>';
    }).join('') : '<p class="cat">No mods on your guns.</p>';
    var buffs = a.bonuses.filter(function (b) { return /^while /.test(b.when || ''); });
    var combo = a.mods.length > 1 ? '<p><b>Both together:</b> ' + (a.summonCount ? a.summonCount + ' summons at once' : 'no summons') +
      (buffs.length ? '; while active: ' + buffs.map(function (b) { return (DPS.STAT_LABEL[b.stat] || b.stat) + ' ' + pct(b.value) + ' (' + b.source + ')'; }).join(', ') : '') + '.</p>' : '';

    var totals = '<table class="kv"><tr><th></th><td><b>Always</b></td><td><b>With selected</b></td></tr>' + a.totals.filter(function (t) { return t.always || t.active; }).map(function (t) {
      return '<tr><th>' + esc(t.label) + '</th><td>' + pct(t.always) + '</td><td>' + pct(t.active) + '</td></tr>';
    }).join('') + '</table>';
    var sources = '<table class="kv">' + a.bonuses.map(function (b) {
      return '<tr><th>' + esc(b.source) + '</th><td>' + esc(DPS.STAT_LABEL[b.stat] || b.stat) + ' ' + (b.stat === 'noWeakspot' ? 'off' : pct(b.value)) + (b.when ? ' <span class="cat">' + esc(b.when) + '</span>' : '') + '</td></tr>';
    }).join('') + '</table>';

    // Guns that fire a few shots per magazine go last: their DPS ignores the reloads they spend most of their time in.
    var ranked = a.owned.slice().sort(function (x, y) { return (x.reloadBound - y.reloadBound) || (!x.rps - !y.rps); });
    var ranking = '<table class="kv"><tr><th>Weapon</th><td><b>Now</b></td><td><b>At max level</b></td></tr>' + ranked.map(function (w) {
      var max = DPS.weaponDps(w.name, w.maxLevel, a.bonuses, on);
      var now = w.dps ? fmt(w.dps, 0) + ' DPS' : fmt(w.expectedHit, 0) + ' per hit';
      var top = max.dps ? fmt(max.dps, 0) + ' DPS' : fmt(max.expectedHit, 0) + ' per hit';
      return '<tr><th>' + esc(w.name) + ' <span class="lvl">+' + w.level + '</span>' + (w.reloadBound ? ' <span class="cat">reload-bound</span>' : '') + '</th><td>' + now + '</td><td>' + top + '</td></tr>';
    }).join('') + '</table>';

    el.innerHTML = '<div class="summary">' + cards + '</div><div class="panels">' +
      panel('Conditional bonuses', toggles, true) +
      a.equipped.map(weaponPanel).join('') +
      panel('Skills (weapon mods)', modsBody + combo) +
      panel('Build bonuses', totals) +
      panel('Where the bonuses come from', sources) +
      panel('All your weapons by DPS', ranking) +
      panel('How this is calculated', '<p class="cat">Base weapon stats from the Fextralife wiki. Damage per hit = base × upgrade (+10% of base per level, +20% for boss weapons) × (1 + damage bonuses). ' +
        'Crits deal ×1.5 plus crit damage bonuses; weak spots add the weapon\'s weak spot bonus plus weak spot bonuses. Same-kind bonuses add up. ' +
        'DPS is while firing — the wiki has no reload times. Elemental, status, mod-power and defensive effects are not counted. Summon DPS is only shown when the wiki gives an attack rate.</p>', true) +
      '</div>';
  }

  // ---- events ------------------------------------------------------------

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
    // Links from tips to the map: switch to the Map tab, then jump to the area.
    $('tips-view').addEventListener('click', function (e) {
      var a = e.target.closest('[data-goto-map]'); if (!a) return;
      e.preventDefault();
      state.tab = 'map'; store('tab', state.tab); render();
      var z = $('zone-' + a.dataset.gotoMap); if (z && z.scrollIntoView) z.scrollIntoView({ behavior: 'smooth' });
    });
    // Raw data: fill a node the first time it is opened ('toggle' doesn't bubble, so listen while capturing).
    $('raw-view').addEventListener('toggle', function (e) {
      var d = e.target;
      if (!d.open || d.dataset.filled || d.dataset.raw == null) return;
      d.dataset.filled = '1';
      d.insertAdjacentHTML('beforeend', '<div class="rkids">' + rawChildren(rawNodes[+d.dataset.raw]) + '</div>');
    }, true);
    $('build-view').addEventListener('change', function (e) {
      var k = e.target.dataset && e.target.dataset.bonus; if (!k) return;
      dpsOn[k] = e.target.checked; renderBuildTab();
    });
    $('build-view').addEventListener('click', function (e) {
      var b = e.target.closest('[data-bonus-all]'); if (!b) return;
      var all = b.dataset.bonusAll === '1';
      $('build-view').querySelectorAll('input[data-bonus]').forEach(function (i) { dpsOn[i.dataset.bonus] = all; });
      renderBuildTab();
    });
    ['world-search', 'world-only-missing', 'world-hide-owned'].forEach(function (id) { $(id).addEventListener('input', renderWorld); });
    ['missing-search', 'missing-only-now', 'missing-show-owned'].forEach(function (id) { $(id).addEventListener('input', renderMissing); });
  }

  // Footer: "Version 2.0 · Updated on October 4, 2026" from js/version.js (the HTML already has it for crawlers).
  function showVersion() {
    if (typeof RWA_VERSION === 'undefined') return;
    var d = new Date(RWA_VERSION.date + 'T12:00:00');
    var when = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    $('version').innerHTML = 'Version ' + esc(RWA_VERSION.version) + ' · Updated on <time datetime="' + esc(RWA_VERSION.date) + '">' + esc(when) + '</time>';
  }

  showVersion();
  wire();
  tryAuto();
})();
