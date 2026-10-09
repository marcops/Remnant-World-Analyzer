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
  // Consumables are used up, so there's nothing to collect (skins are tracked, see "armor skins" below).
  var UNTRACKED = { 'Consumable': true };

  var state = {
    auto: false, dir: '', listing: null,
    files: {},          // name -> ArrayBuffer
    characters: [],     // from profile.sav
    charIndex: null,
    tab: 'world', mode: 'adventure', mapMode: 'Adventure',
    worldZones: {}, worldTypes: {}, worldCats: {}, missingWorld: null, missingType: null, missingMode: null,
    traitsShow: 'all', traitType: null, traitSel: null,
    itemsShow: 'all', itemsType: null, itemsWorld: null, itemsMode: null, itemSel: null,
  };
  P.ZONES.forEach(function (z) { state.worldZones[z] = true; });
  Object.keys(TYPE_LABEL).forEach(function (t) { state.worldTypes[t] = true; });
  CATEGORIES.forEach(function (c) { state.worldCats[c] = true; });
  function store(k, v) { try { localStorage.setItem('rwa.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function recall(k, d) { try { var v = localStorage.getItem('rwa.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  state.tab = recall('tab', 'world');

  // ---- where you left off ---------------------------------------------------
  // Everything the page shows (section, filters, searches, switches, open item, scroll of each section) is kept
  // in this browser and put back on the next visit; the defaults only apply to what you never changed.
  var VIEW_FIELDS = ['tab', 'mode', 'mapMode', 'worldZones', 'worldTypes', 'worldCats', 'missingWorld', 'missingType', 'missingMode',
    'itemsShow', 'itemsType', 'itemsWorld', 'itemsMode', 'itemSel', 'traitsShow', 'traitType', 'traitSel'];
  var VIEW_INPUTS = ['world-search', 'world-only-missing', 'world-hide-owned', 'missing-search', 'missing-only-now', 'missing-show-owned', 'items-search'];
  var savedView = recall('view', null) || {};
  VIEW_FIELDS.forEach(function (f) {
    if (!(f in savedView)) return;
    var v = savedView[f], cur = state[f];
    // Filter sets (worlds, event types, categories): keep entries added since, take the saved on/off.
    if (v && cur && typeof v === 'object' && typeof cur === 'object') Object.keys(cur).forEach(function (k) { if (k in v) cur[k] = v[k]; });
    else state[f] = v;
  });
  function restoreInputs() {
    var saved = savedView.inputs || {};
    VIEW_INPUTS.forEach(function (id) {
      var el = $(id); if (!el || !(id in saved)) return;
      if (el.type === 'checkbox') el.checked = !!saved[id]; else el.value = saved[id];
    });
  }
  function saveView() {
    var v = { inputs: {}, scroll: savedView.scroll || {} };
    VIEW_FIELDS.forEach(function (f) { v[f] = state[f]; });
    // About, credits and the drop zone aren't where you "left off": keep the last section with data.
    if (['home', 'about', 'credits', 'notes'].indexOf(state.tab) >= 0) v.tab = savedView.tab || 'world';
    VIEW_INPUTS.forEach(function (id) { var el = $(id); if (el) v.inputs[id] = el.type === 'checkbox' ? el.checked : el.value; });
    if (document.body.classList.contains('loaded')) v.scroll[state.tab] = Math.round(window.scrollY);
    if (typeof dpsOn !== 'undefined') v.dps = dpsOn;
    savedView = v;
    store('view', v);
  }
  // Scroll of a section as you left it (on the first load and when you come back to it).
  function restoreScroll() {
    var y = (savedView.scroll || {})[state.tab] || 0;
    setTimeout(function () { window.scrollTo(0, y); }, 60);
  }
  // Every tab opens on the adventure (falls back to the campaign when the save has none).

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

  // ---- armor skins -----------------------------------------------------------
  // Each skin is the look of an armor piece ("Vanguard Great Helm" = Carapace Great Helm). Whispers sells
  // them in Ward 13 (next to the Root Mother) for scrap and Glowing Fragments, which drop in Survival
  // mode; any character can buy them. The profile keeps a bought skin as the piece's path + "_Skin"
  // (Armor_Head_Carapace_Skin), and the skin uses the piece's picture.
  var SKIN_OF = {
    Survivor: 'Adventurer', Survival: 'Adventurer', Adventurer: 'Adventurer', Brigand: 'Bandit', Corrupted: 'Twisted',
    Headhunter: 'Osseous', Ritualist: 'Cultist', Roughneck: 'Scrapper', Vagrant: 'Drifter', Widowmaker: 'Hunter',
    Sentinel: 'Leto', Shadow: 'Akari', Harbringer: 'Slayer', Chaos: 'Void', Vanguard: 'Carapace', Bloodletter: 'Elder',
    Mystic: 'Labyrinth', Crusader: 'Radiant',
  };
  function armorSlot(name) {
    return /legging|trousers|greaves|pants|boots|kilt|britches|tassets/i.test(name) ? 'Legs' : /mask|hood|helm|goggles|visage|headdress|hat|skull|shroud/i.test(name) ? 'Head' : 'Body';
  }
  // The sheet lists the Adventurer Goggles Rigs sells among the skins, but that's the armor piece itself
  // (its skin is Whispers' Survival Goggles): the entry becomes another way to get the armor.
  DATA.items.forEach(function (it) {
    if (it.category !== 'Skin') return;
    var twin = DATA.items.filter(function (a) { return a.category === 'Armor' && a.name === it.name; })[0];
    if (!twin) return;
    twin.how = twin.how + ' Or: ' + it.how;
    it.merged = true;
  });
  DATA.items.forEach(function (it) {
    if (it.category !== 'Skin' || it.merged) return;
    var words = it.name.split(' '), set = SKIN_OF[words[0]], last = words[words.length - 1];
    var pieces = DATA.items.filter(function (a) { return a.category === 'Armor' && set && a.name.replace(/'s\b/, '').indexOf(set) === 0; });
    var base = pieces.filter(function (a) { return a.name.split(' ').pop() === last; })[0];
    if (!base) return;
    // Path of the piece; Adventurer Tunic and Leggings have none in the sheet, so take a sibling's folder.
    var sibling = base.key ? base : pieces.filter(function (a) { return a.key; })[0];
    var path = sibling && sibling.key.replace(/Armor_(Head|Body|Legs)_/, 'Armor_' + armorSlot(base.name) + '_');
    var seller = /Whispers/.test(it.how) ? 'Whispers' : /Rigs/.test(it.how) ? 'Rigs' : '';
    it.base = base;
    // The skin's path is its key: the profile lists it, and Whispers (Ward 13) sells it. Only Whispers'
    // skins: the "Adventurer Goggles" Rigs sells would share the Survival Goggles' path, so it stays unknown.
    it.skinPath = path && seller === 'Whispers' && !itemsByKey[path + '_Skin'] ? path + '_Skin' : null;
    if (it.skinPath) {
      it.key = it.skinPath;
      itemsByKey[it.key] = it;
      (DATA.events.Whispers = DATA.events.Whispers || { altName: null, items: [] }).items.push(it.key);
    }
    it.world = 'Ward 13';
    it.mode = '';
    it.how = it.how + (seller ? ' ' + seller + ' is in Ward 13' + (seller === 'Whispers' ? ', next to the Root Mother' : '') + '; ' : ' ') +
      'Glowing Fragments drop in Survival mode. The skin gives ' + base.name + ' this look.';
    if (RWA_WIKI.icons && !RWA_WIKI.icons[it.name] && RWA_WIKI.icons[base.name]) RWA_WIKI.icons[it.name] = RWA_WIKI.icons[base.name];
  });
  // Bought skins of the selected character (from the profile's inventory).
  var skinCache = { ch: null, have: {} };
  function skinOwned(it) {
    var ch = character();
    if (!ch || !it.skinPath) return null;
    if (skinCache.ch !== ch) { skinCache.ch = ch; skinCache.have = {}; (ch.inventory || []).forEach(function (p) { skinCache.have[p] = true; }); }
    return !!skinCache.have[it.skinPath];
  }

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
    document.body.classList.add('loaded');
    if (state.tab === 'home') state.tab = 'world';
    if (!state.auto) setStatus('Manual · files loaded at ' + new Date().toLocaleTimeString(), false);
    render();
    // Back where you left off, once (the automatic mode calls this again on every game save).
    if (!state.viewRestored) { state.viewRestored = true; restoreScroll(); }
  }

  // Character card above the menu: class and level, time, difficulty, scrap and how much you've collected.
  function renderWho() {
    var ch = state.profile && state.profile.characters && state.profile.characters[state.charIndex];
    var w = state.worlds && state.worlds[state.charIndex];
    if (!ch && !w) { $('who').innerHTML = ''; return; }
    var scrap = ch && (ch.resources || []).filter(function (r) { return r.name === 'Scrap'; })[0];
    var have = 0, total = 0;
    if (character()) TRACKED_ITEMS.forEach(function (it) { if (collectible(it)) { total++; if (itemOwned(it) === true) have++; } });
    var pct = total ? Math.round(100 * have / total) : 0;
    $('who').innerHTML = '<div class="name">' + esc(ch ? ch.archetype + ' · Level ' + ch.level : 'Character ' + (state.charIndex + 1)) + '</div>' +
      '<div class="sub">' + esc([w && w.timePlayed ? duration(w.timePlayed) : '', w && w.difficulty, scrap ? num(scrap.quantity) + ' scrap' : ''].filter(Boolean).join(' · ')) + '</div>' +
      (total ? '<div class="bar"><i style="width:' + pct + '%"></i></div><div class="xpl"><span>' + have + ' of ' + total + ' items</span><span>' + pct + '%</span></div>' : '');
  }

  // Which page is on screen. About and Version & credits are pages of their own and work before any
  // save is loaded; the other sections need the saves (until then "Load your save" shows the drop zone).
  var INFO_TABS = ['home', 'about', 'credits', 'notes'];
  function showPage() {
    var loaded = document.body.classList.contains('loaded');
    var page = !loaded && INFO_TABS.indexOf(state.tab) < 0 ? 'home' : state.tab;
    var info = page === 'about' || page === 'credits' || page === 'notes';
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === page); });
    document.querySelectorAll('.tab-panel').forEach(function (p) { p.hidden = p.id !== 'tab-' + page; });
    $('app').hidden = !loaded || info;
    if (info) $('loader').hidden = true;
    else if (!loaded) $('loader').hidden = false;
  }

  function render() {
    renderCharacters();
    state.owns = P.ownership(character());
    state.available = availability();
    $('profile-note').hidden = !!character();
    if (!$('tab-' + state.tab)) state.tab = 'world';
    showPage();
    renderWho();
    renderWorld();
    renderMissing();
    renderStateTab();
    renderMapTab();
    renderTipsTab();
    renderRawTab();
    renderCharacterTab();
    renderTraitsTab();
    renderItemsTab();
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

  // ---- quest items ------------------------------------------------------------
  // Key items you get in one place and hand over in another. They're tracked like items ("Quest items"):
  // done when you carry one or already own everything they unlock.
  //   from:    event that drops it, so the current world can list it
  //   usedAt:  events that only give these rewards for the item (not "available now" unless you carry it)
  //   hide:    the rewards are listed as this item instead (the Labyrinth set isn't something you pick up in Corsus)
  //   notOnly: the rewards can also be earned without it (Scavenger: picking up 50,000 scrap)
  function byName(names) { return names.map(function (n) { return DATA.items.filter(function (i) { return i.name === n; })[0]; }).filter(Boolean); }
  var CRYPTOLITH_REWARDS = ((DATA.events.Cryptolith || {}).items || []).map(function (p) { return itemsByKey[p]; }).filter(Boolean);
  var HEART_IKSAL = byName(['Crossbow', 'Slayer Mask', 'Slayer Mantle', 'Slayer Boots']), HEART_UNDYING = byName(['Riven']);
  // Every key item of the game (Fextralife wiki, "Key Items"). `rewards` are the sheet items it leads to;
  // story keys have none and are recognised from your progress instead (`seen`: achievements, profile
  // milestones, world flags or key items the world save records).
  var QUEST_ITEMS = [
    {
      id: 'sigil', name: 'Cryptolith Sigil', carried: /Sigil|Cryptolith/i, from: 'IskalQueen', hide: true, repeat: true,
      world: 'Corsus', dlc: 'Swamps of Corsus', rewards: CRYPTOLITH_REWARDS, usedAt: { Cryptolith: CRYPTOLITH_REWARDS },
      how: 'Drops from the Iskal Queen (Corsus, The Mist Fen). Use it on a Cryptolith tower — it can be in Earth, Rhom or Corsus — once per world, rerolling in between: ' +
        '1st use gives the Concentration trait, 2nd the Blood Bond trait, 3rd opens the Labyrinth room with the Labyrinth armor set (Labyrinth Helm, Armor and Greaves).',
    },
    {
      id: 'heart', name: "Guardian's Heart", carried: /GuardiansHeart|Guardian_?Heart/i, from: 'SwampGuardian',
      world: 'Corsus', rewards: HEART_IKSAL.concat(HEART_UNDYING), usedAt: { IskalQueen: HEART_IKSAL, UndyingKing: HEART_UNDYING },
      // Ixillis always drops the heart, so anything from that fight also shows you had it.
      proof: HEART_IKSAL.concat(HEART_UNDYING, byName(['Guardian Axe', 'Hive Cannon', 'Executioner'])),
      how: 'Drops from Ixillis (Corsus). Give it to the Iskal Queen (Corsus) for the Crossbow and the Slayer set (Mask, Mantle, Boots), or take it to the Undying King on Rhom for the Riven. ' +
        'There is one heart per world and giving it to one locks the other out, so you need two worlds to get all of them.',
    },
    { id: 'acidkey', name: 'Acid Cleaned Key', carried: /AcidCleaned|AcidKey/i, from: 'FetidPool', world: 'Corsus', dlc: 'Swamps of Corsus', rewards: byName(['Heart of Darkness', "Hero's Ring", 'Fortification']),
      how: 'Wear the Rusted Amulet (Fetid Pools, Corsus) and crouch in one of the acid pools: the amulet turns into this key. Opens the doors in the Fetid Pools: Heart of Darkness behind the second; with 3 keys and other players, Hero\'s Ring and the Fortification trait.' },
    { id: 'controlrod', name: 'Control Rod', carried: /ControlRod/i, from: 'HoundMaster', world: 'Rhom', rewards: byName(['Iron Sentinel']),
      how: 'Dropped by Maul (break the Houndmaster\'s horn first). Activates the Ancient Construct outside Wud\'s workshop on Rhom; completing that event gives the Ancient Core, crafted into the Iron Sentinel mod.' },
    { id: 'cagekey', name: 'Servant Cage Key', carried: /ServantCage|CageKey/i, from: 'CreepersPeeper', world: 'Reisum', dlc: 'Subject 2923', rewards: byName(['Twin Shot', "Swashbuckler's Signet"]),
      how: 'Found at the end of Watcher\'s Hollow (Reisum). Opens the cage of the Emin servants: kill the one with the false green eye for the Creeper\'s Peeper.' },
    { id: 'peeper', name: "Creeper's Peeper", carried: /CreepersPeeper|Peeper/i, from: 'CreepersPeeper', world: 'Reisum', dlc: 'Subject 2923', rewards: byName(['Twin Shot', "Swashbuckler's Signet"]),
      how: 'Dropped by the Emin servant with the false green eye in the Watcher\'s Hollow cage (needs the Servant Cage Key); killing only that one also gives Swashbuckler\'s Signet. Put the Peeper in the statue with a missing eye outside for the Twin Shot.' },
    { id: 'w13keycard', name: 'Ward 13 Keycard', carried: /Quest_Keycard$|Ward13Keycard/i, from: 'FoundersHideout', world: 'Ward 13', rewards: byName(['Submachine Gun', 'Elder Knowledge']), seen: { keyItems: /^Keycard$/ },
      how: 'On a table in the Founder\'s Hideout (Earth). Opens the doors on level B2 of Ward 13: the tape recorder in Dr. Itsaso\'s office gives Elder Knowledge, and it leads to the Fuse and the Master Key for the Submachine Gun.' },
    { id: 'w13fuse', name: 'Fuse', carried: /Quest_Fuse$|Ward13Fuse/i, from: 'Ward13', world: 'Ward 13', rewards: byName(['Submachine Gun']), seen: { fuse: /Zone_1_0\./ },
      how: 'In a room in the basement of Ward 13 (behind the keycard doors). Goes in the empty fuse box on level B3 to turn on the fans, part of the way to the Submachine Gun.' },
    { id: 'w13master', name: 'Ward 13 Master Key', carried: /Ward13Master/i, from: 'Ward13', world: 'Ward 13', rewards: byName(['Submachine Gun']), seen: { keyItems: /Ward13\s?Master/i },
      how: 'Behind the giant fan in the Ward 13 basement (after the keycard and the fuse). Opens the door at the end of level B2, where the Submachine Gun lies on a table.' },
    { id: 'glowingrod', name: 'Glowing Rod', carried: /GlowingRod/i, from: 'ArmorVault', world: 'Rhom', rewards: byName(['Akari Mask', 'Akari Garb', 'Akari Leggings']),
      how: 'Found in dungeons on Rhom when the Vault of the Heralds (Armor Vault) is in the world. Each of the three doors at the end of the vault needs one rod: Akari Mask, Garb and Leggings.' },
    { id: 'homestead', name: 'Homestead Basement Key', carried: /Homestead_?Key/i, from: 'WardPrime', world: 'Ward Prime', dlc: 'Subject 2923', rewards: byName(['Vanguard Ring']),
      how: 'In Dr. Enji Sato and Dr. Sebastian Weisskoof\'s office in Ward Prime, when the Homestead is in your Rural Earth. Destroy the shelves in the Homestead house, go down and unlock the basement for the Vanguard Ring.' },
    { id: 'hunterskey', name: "Hunter's Key", carried: /HuntersKey|HunterKey/i, from: 'HuntersHideout', world: 'Earth', rewards: byName(['Hunting Pistol']),
      how: 'Given by the dying Hunter at the start of the Hunter\'s Hideout dungeon (Hidden Grotto, Earth). Opens the Safehouse at the end, with the Hunting Pistol in a locker.' },
    { id: 'iskalvial', name: 'Iskal Vial', carried: /IskalVial/i, from: 'IskalQueen', world: 'Corsus', dlc: 'Swamps of Corsus', rewards: byName(['Ring of the Unclean', 'Potency']), usedAt: { GraveyardElf: byName(['Ring of the Unclean', 'Potency']) },
      how: 'With the Parasite effect (from an Iskal Infector), tell the Iskal Queen you want to help the Iskal. Needs the Graveyard Elf in the same Corsus map: sneak up to her cauldron with the vial for the Ring of the Unclean and the Potency trait.' },
    { id: 'janitorswatch', name: "Janitor's Watch", carried: /JanitorsWatch/i, from: 'JanitorsWatch', world: 'Reisum', dlc: 'Subject 2923', rewards: byName(['Amber Moonstone']),
      how: 'Random drop in Drolniir Woods (Reisum). Give it to Clementine for the Amber Moonstone ring.' },
    { id: 'lizkey', name: "Liz's Key", carried: /LizKey|LizsKey/i, from: 'LizAndLiz', world: 'Earth', rewards: byName(['Chicago Typewriter']),
      how: 'Reward for the "A Tale of Two Liz\'s" event (Earth). Opens the locked door with the Chicago Typewriter.' },
    { id: 'monkeykey', name: 'Monkey Key', carried: /MonkeyKey/i, from: 'LastWill', world: 'Earth', rewards: byName(['Assault Rifle']),
      how: 'Found during the "Supply Run" event in the Sorrow\'s Field dungeon (Earth). Opens the room with the Assault Rifle.' },
    { id: 'opalshell', name: 'Opalescent Shell', carried: /Opalescent/i, from: 'AbandonedThrone', world: 'Corsus', dlc: 'Swamps of Corsus', rewards: byName(['Luminescent']),
      how: 'Dropped by the Mudling Queen Beetle, who sometimes appears when you kill the beetles around the Abandoned Throne (Corsus). With the Parasite effect, buy the Luminescent trait from Mar\'Gosh for it.' },
    { id: 'tusk', name: "Packmaster's Tusk", carried: /Tusk/i, from: 'IceSkimmer', world: 'Reisum', dlc: 'Subject 2923', rewards: byName(['Warlord Skull', 'Warlord Armor', 'Warlord Boots']), seen: { talk: ['GaveTusk_Sebum'] },
      how: 'Dropped by the Pack Master (only when Sebum is in the map). Bring it to Sebum, after finding the hole in his ship\'s hull, and ask him about the armor for the Warlord set.' },
    { id: 'letoskeycard', name: 'Research Station Alpha Keycard', carried: /ResearchStation|LetoKeycard/i, world: 'Earth', rewards: byName(["Leto's Helmet", "Leto's Armor", "Leto's Leggings"]),
      how: 'Unlocks the doors of Research Station Alpha (Leto\'s Lab, Earth). Leto\'s set is in the room with the burning corpses, after the teleporter.' },
    { id: 'strangecoin', name: 'Strange Coin', carried: /StrangeCoin|AcesCoin/i, from: 'AcesCoin', world: 'Earth', rewards: byName(['Magnum Revolver']), seen: { achievements: ['Return_Ace_Coin'], talk: ['GaveCoinAlready'] },
      how: 'Spawns randomly anywhere on Earth. Give it to Ace in Ward 13 for the Magnum Revolver.' },
    { id: 'curio', name: 'Strange Curio', carried: /Curio/i, from: 'StuckMerchant', world: 'Yaesha', rewards: byName(['Radiant Visage', "Guardian's Blessing"]),
      how: 'In the back of the Stuck Merchant\'s wagon (Yaesha) — buy her Radiant Protector and Greaves first. Opens the Guardian Shrine: the Radiant Visage is on a statue at the end, and beating the Root Horror back at the wagon gives Guardian\'s Blessing.' },
    { id: 'tarnishedring', name: 'Tarnished Ring', carried: /TarnishedRing/i, from: 'ReggiesRing', world: 'Earth', rewards: byName(['Scavenger']), proof: [], notOnly: true,
      seen: { talk: ['ReggieGaveRing'], achievements: ['Return_Reggie_Ring'] },
      how: 'Spawns at a random place on Earth. Give it to Reggie in Ward 13 (exhaust his dialogue) for the Scavenger trait — also earned by picking up 50,000 scrap.' },
    // Story and door keys: no collection item, recognised from your progress.
    { id: 'datla', name: 'D.A.T.L.A. Key', carried: /DATLA/i, world: 'Ward 13', rewards: [], seen: { socket: /DATLA/, achievements: ['Kill_Dreamer'], flags: ['Finished Game'] },
      how: 'Given by Commander Ford after you turn on the reactor in Ward 13. Powers the crystal terminal on the way to Ward 17 (main story).' },
    { id: 'founderskey', name: "Founder's Key", carried: /FoundersKey/i, world: 'Ward 13', rewards: [], seen: { achievements: ['Kill_Dreamer'], flags: ['Finished Game'] },
      how: 'Given after you free the Founder in the Founder\'s Prison (Yaesha). Unlocks the computer connected to the mirror on the lower levels of Ward 13 (main story).' },
    { id: 'howlingkey', name: 'Howling Key', carried: /HowlingKey/i, world: 'Rhom', rewards: [], seen: { achievements: ['Meet_Undying_King', 'Kill_Undying_King'] },
      how: 'Dropped by Claviger or The Harrow (Rhom). Opens the altar of the Sun Gate that leads to the Undying King.' },
    { id: 'labyrinthkey', name: 'Labyrinth Key', carried: /LabyrinthKey/i, world: 'The Labyrinth', rewards: [], seen: { achievements: ['Meet_Labyrinth_Keeper'], milestones: ['Traveled To Labyrinth'] },
      how: 'Given by the Undying King for the Guardian\'s Heart, or as the reward for killing him. Opens the way to the Labyrinth.' },
    { id: 'wpfuse', name: 'Ward Prime Fuse', carried: /WardPrime_?Fuse/i, world: 'Ward Prime', dlc: 'Subject 2923', rewards: [], seen: { fuse: /Zone_204_|WardPrime/, flags: ['Fuse Used'], achievements: ['Kill_Harsgaard'] },
      how: 'Behind the obstructed door on the left of the Laboratory in Ward Prime. Restores power to the main level of Ward Prime (DLC story).' },
    { id: 'wpkeycard', name: 'Ward Prime Keycard', carried: /Keycard_?WardPrime/i, world: 'Ward Prime', dlc: 'Subject 2923', rewards: [], seen: { keyItems: /Keycard Ward Prime/i, achievements: ['Kill_Harsgaard'] },
      how: 'In the Medical Storage of Ward Prime: restore power from the reactor room and use the computer to unlock its door (DLC story).' },
    { id: 'wpmaintkey', name: 'Ward Prime Maintenance Key', carried: /Maintenance/i, world: 'Ward Prime', dlc: 'Subject 2923', rewards: [],
      how: 'In the Medical Area of Ward Prime: vault over a broken window and destroy a bookshelf.' },
  ];
  QUEST_ITEMS.forEach(function (q) {
    q.key = '__quest_' + q.id; q.category = 'Quest item'; q.quest = true; q.mode = ''; q.group = ''; q.dlc = q.dlc || '';
    q.hide = !!q.hide; q.usedAt = q.usedAt || {};
  });
  // Story keys: true when your saves show you already went past them.
  function questSeen(q) {
    var s = q.seen; if (!s) return false;
    var prof = state.profile || {}, ch = prof.characters && prof.characters[state.charIndex];
    var ws = state.worldStates && state.worldStates[state.charIndex];
    if ((s.achievements || []).some(function (id) { return (prof.achievements || []).some(function (a) { return a.id === id && a.value >= a.target; }); })) return true;
    if ((s.milestones || []).some(function (m) { return ch && ch.milestones && ch.milestones.indexOf(m) >= 0; })) return true;
    if ((s.flags || []).some(function (f) { return ws && ws.flags && ws.flags.indexOf(f) >= 0; })) return true;
    if (s.keyItems && ws && ws.keyItems && ws.keyItems.some(function (k) { return s.keyItems.test(k.name); })) return true;
    // NPC conversation flags (GaveTusk_Sebum, GaveCoinAlready), filled sockets and fuse boxes.
    if ((s.talk || []).some(function (t) { return ws && ws.conversations && ws.conversations.some(function (c) { return c.key === t; }); })) return true;
    if (s.socket && ws && ws.sockets && ws.sockets.some(function (x) { return x.full && s.socket.test(x.cls); })) return true;
    if (s.fuse && ws && ws.fuses && ws.fuses.some(function (f) { return s.fuse.test(f.where); })) return true;
    return false;
  }
  var SIGIL = QUEST_ITEMS[0], SIGIL_KEY = SIGIL.key;
  // Everything the Missing items tab counts: the sheet's items plus the quest items.
  var TRACKED_ITEMS = DATA.items.concat(QUEST_ITEMS);
  // Rewards listed as their quest item instead of on their own.
  function isCryptolithReward(it) { return QUEST_ITEMS.some(function (q) { return q.hide && q.rewards.indexOf(it) >= 0; }); }
  function carries(q) {
    var ch = state.profile && state.profile.characters && state.profile.characters[state.charIndex];
    return !!(ch && ch.extra && (ch.extra.questItems || []).some(function (x) { return q.carried.test(x.cls); }));
  }
  function hasSigil() { return carries(SIGIL); }
  // Quest items handed over at this event, and the rewards that need them.
  function gatedAt(ev) { return QUEST_ITEMS.filter(function (q) { return q.usedAt[ev.key]; }); }

  // Events that only hand out some items in exchange for another one: Brabus gives the Bandit set
  // for the Pocket Watch you get from Mudtooth.
  var EXCHANGES = {
    Brabus: { needs: 'Pocket Watch', items: /\/Armor\/Bandit\//, note: 'The Bandit set needs the Pocket Watch from Mudtooth.' },
  };
  // Items only someone who owns another item can get, wherever they are: the Twisted Mask lets you
  // talk to the Wailing Tree for Bark Skin.
  var REQUIRES = { 'Bark Skin': 'Twisted Mask' };
  function exchangeReady(ev) {
    var x = EXCHANGES[ev.key]; if (!x) return true;
    var need = DATA.items.filter(function (i) { return i.name === x.needs; })[0];
    return !!(need && state.owns && state.owns(need) === true);
  }

  // What a missing item still needs that you don't have: a key item you aren't carrying and haven't
  // used yet (the Akari set needs a Glowing Rod), or an item you don't own (the Bandit set needs the
  // Pocket Watch). Empty when nothing blocks it. Shown greyed out with "needs …".
  function blockedBy(it) {
    if (!it || it.quest || !character() || itemOwned(it) !== false) return [];
    var out = [];
    var keys = QUEST_ITEMS.filter(function (q) { return !q.hide && !q.notOnly && q.rewards.indexOf(it) >= 0; });
    // Any key of a chain is enough (Keycard → Fuse → Master Key for the Submachine Gun).
    if (keys.length && !keys.some(function (q) { return carries(q) || questSeen(q); })) out.push(keys[0].name);
    Object.keys(EXCHANGES).forEach(function (k) {
      var x = EXCHANGES[k];
      if (!x.items.test(it.key) || exchangeReady({ key: k })) return;
      if (out.indexOf(x.needs) < 0) out.push(x.needs);
    });
    var need = REQUIRES[it.name] && DATA.items.filter(function (x) { return x.name === REQUIRES[it.name]; })[0];
    if (need && itemOwned(need) === false && out.indexOf(need.name) < 0) out.push(need.name);
    return out;
  }
  // One item of an event (World state, map): status, icon, name; greyed out with "needs …" when blocked.
  function evItem(i, after) {
    var needs = i.item ? needsTag(i.item) : '';
    return '<div class="evitem' + (needs ? ' blocked' : '') + '">' + (i.item ? statusIcon(itemOwned(i.item)) : '') + ico(i.name) + esc(i.name) + (after || '') + needs + '</div>';
  }
  function needsTag(it) {
    var b = blockedBy(it);
    return b.length ? '<span class="needs" title="You can\'t get it before you have this">needs ' + esc(b.join(', ')) + '</span>' : '';
  }

  // key -> where it can drop in the currently loaded world
  function availability() {
    var map = {}, save = current();
    if (!save) return map;
    [['campaign', save.campaign], ['adventure', save.adventure]].forEach(function (pair) {
      var block = pair[1];
      if (!block) return;
      block.events.forEach(function (ev) {
        var at = { block: block.label + (block.world ? ' (' + block.world + ')' : ''), event: ev.name, location: ev.location };
        // Quest items this event drops (the Iskal Queen's Sigil, Ixillis' heart).
        QUEST_ITEMS.forEach(function (q) { if (q.from === ev.key) (map[q.key] = map[q.key] || []).push(at); });
        // Rewards handed out for a quest item or another item only count when you hold it.
        var locked = [];
        gatedAt(ev).forEach(function (q) { if (!carries(q)) locked = locked.concat(q.usedAt[ev.key].map(function (i) { return i.key; })); });
        var x = EXCHANGES[ev.key], ready = exchangeReady(ev);
        ev.items.forEach(function (p) {
          if (locked.indexOf(p) >= 0) return;
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

  // A key item counts as yours when you carry one, the saves record handing it in (the Tarnished Ring:
  // "ReggieGaveRing"), you already own everything it gives (nothing left to get from it), or you own something
  // that only comes through it (`proof`, by default its rewards). Story keys with no trace are unknown.
  function itemOwned(it) {
    if (it.quest) {
      if (!character()) return null;
      if (carries(it) || questSeen(it)) return true;
      if (it.rewards.length && it.rewards.every(function (r) { return state.owns(r) === true; })) return true;
      if (it.repeat) return false;
      if ((it.proof || it.rewards).some(function (r) { return state.owns(r) === true; })) return true;
      return it.rewards.length || it.proof ? false : null;
    }
    if (it.category === 'Skin') return skinOwned(it);
    return UNTRACKED[it.category] ? null : state.owns(it);
  }

  function itemDetails(it, extra) {
    var meta = [it.category, it.world && WORLD_LABEL[it.world] !== undefined ? WORLD_LABEL[it.world] : it.world, it.mode && 'Mode: ' + it.mode, it.dlc && 'DLC: ' + it.dlc]
      .filter(Boolean).join(' · ');
    var needs = needsTag(it);
    return '<details class="item' + (needs ? ' blocked' : '') + '"><summary>' + statusIcon(itemOwned(it)) + ' ' + ico(it.name) + esc(it.name) + itemWikiLink(it) +
      (it.category ? '<span class="cat">' + esc(it.category) + '</span>' : '') + needs + (extra || '') + '</summary>' +
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

  // Item pages come from js/wiki.js (tools/update.ps1), which only lists pages that exist.
  function itemWikiLink(it) { return globe(RWA_WIKI.items[it.name], it.name); }
  // Small picture of an item (img/items, from its wiki page); empty when there is none.
  function ico(name) {
    var src = RWA_WIKI.icons && RWA_WIKI.icons[name];
    return src ? '<img class="ico" src="' + esc(src) + '" alt="" width="22" height="22" loading="lazy">' : '';
  }

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
      // Whispers' skins are shown in Items, Missing items and the Ward 13 map, not in this table.
      if (ev.key === 'Whispers') return;
      if (!state.worldZones[ev.zone] || !state.worldTypes[ev.type]) return;
      var items = ev.items.map(itemForPath);
      // Quest items this event drops (Sigil from the Iskal Queen, heart from Ixillis), while something they unlock is missing.
      QUEST_ITEMS.forEach(function (qi) { if (qi.from === ev.key && (itemOwned(qi) !== true || qi.rewards.some(function (r) { return itemOwned(r) === false; }))) items.push(qi); });
      var wanted = function (it) { return itemOwned(it) === false; };
      if (!allCats) {
        items = items.filter(function (it) { return it.quest || state.worldCats[it.category]; });
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
        // Events that want a quest item: say which rewards need it and whether you carry it.
        gatedAt(ev).map(function (qi) {
          return '<div class="cat">' + esc(qi.usedAt[ev.key].length === qi.rewards.length ? 'Needs the ' + qi.name + '.' : qi.usedAt[ev.key].map(function (i) { return i.name; }).join(', ') + ' need the ' + qi.name + '.') +
            (carries(qi) ? ' You carry it.' : '') + '</div>';
        }).join('') +
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
    ['Skins', function (it) { return it.category === 'Skin'; }],
    ['Quest items', function (it) { return it.category === 'Quest item'; }],
  ];
  // The tutorial blade is taken away when the tutorial ends, so it can never be collected.
  function collectible(it) { return !UNTRACKED[it.category] && !it.merged && !(/^New characters begin/.test(it.how) && /removed/.test(it.how)); }

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
        var tags = (row.where && row.owned !== true ? '<span class="tag now">available now</span>' : '') +
          (it.mode ? '<span class="tag mode">' + esc(it.mode) + '</span>' : '') + (it.dlc ? '<span class="tag">' + esc(it.dlc) + '</span>' : '');
        var where = row.where && row.owned !== true ? '<div class="where">In your world: ' + row.where.map(function (x) {
          return esc(x.block + ' → ' + x.location + ' (' + x.event + ')') + wikiLink(x.location);
        }).join(' · ') + '</div>' : '';
        return '<div class="mrow">' + itemDetails(it, tags) + where + '</div>';
      }).join('') + '</div>';
    }).join('');
    $('missing-list').innerHTML = html || '<div class="empty">' + (hasProfile ? 'Nothing missing with these filters. 🎉' : 'Nothing matches these filters.') + '</div>';
  }

  // ---- traits --------------------------------------------------------------
  // Every trait as a picture: what you have (and its level), what you're missing, and a panel with
  // what it does per level and how to get it.
  var TRAITS = DATA.items.filter(function (it) { return it.category === 'Trait'; });
  function traitType(it) {
    var s = RWA_STATS.traits && RWA_STATS.traits[it.name];
    return s && s.type ? s.type.replace(/\s+\)/, ')') : 'Other';
  }
  function traitLevels() {
    var ch = state.profile && state.profile.characters && state.profile.characters[state.charIndex];
    var lv = {};
    ((ch && ch.traits) || []).forEach(function (t) { lv[t.name] = t.level; });
    return lv;
  }

  function renderTraitsTab() {
    var el = $('traits-view');
    var hasProfile = !!character();
    var lv = traitLevels();
    var show = hasProfile ? state.traitsShow : 'all';
    var rows = TRAITS.map(function (it) { return { it: it, owned: itemOwned(it), level: lv[it.name] || 0, type: traitType(it) }; });
    var have = rows.filter(function (r) { return r.owned === true; }).length;
    var ch = state.profile && state.profile.characters && state.profile.characters[state.charIndex];
    var types = [];
    rows.forEach(function (r) { if (types.indexOf(r.type) < 0) types.push(r.type); });
    types.sort();

    var list = rows.filter(function (r) {
      if (show === 'owned' && r.owned !== true) return false;
      if (show === 'missing' && r.owned === true) return false;
      return !state.traitType || r.type === state.traitType;
    });
    var tile = function (r) {
      var it = r.it, where = r.owned === true ? null : state.available[it.key];
      var locked = r.owned === false ? blockedBy(it) : [];
      var cls = 'ttile' + (r.owned === true ? ' owned' : r.owned == null ? '' : ' missing') + (locked.length ? ' blocked' : where ? ' now' : '') + (state.traitSel === it.name ? ' sel' : '');
      return '<button type="button" class="' + cls + '" data-trait="' + esc(it.name) + '" title="' + esc(it.name + (locked.length ? ' — needs ' + locked.join(', ') : '')) + '">' +
        (RWA_WIKI.icons && RWA_WIKI.icons[it.name] ? '<img src="' + esc(RWA_WIKI.icons[it.name]) + '" alt="" loading="lazy">' : '<span class="noimg"></span>') +
        '<span class="n">' + esc(it.name) + '</span>' +
        (r.owned === true ? '<span class="lv' + (r.level >= 20 ? ' max' : '') + '">' + (r.level ? r.level + ' / 20' : 'not leveled') + '</span><span class="tbar"><i style="width:' + Math.round(100 * r.level / 20) + '%"></i></span>'
          : '<span class="lv">' + (locked.length ? '🔒 locked' : where ? 'in your world' : r.owned == null ? '?' : 'missing') + '</span>') + '</button>';
    };
    var section = function (title, rs) {
      return rs.length ? '<h3 class="section-title more">' + esc(title) + ' (' + rs.length + ')</h3><div class="tgrid">' + rs.map(tile).join('') + '</div>' : '';
    };
    var owned = list.filter(function (r) { return r.owned === true; }).sort(function (a, b) { return b.level - a.level || a.it.name.localeCompare(b.it.name); });
    var rest = list.filter(function (r) { return r.owned !== true; }).sort(function (a, b) {
      var ra = state.available[a.it.key] ? 0 : 1, rb = state.available[b.it.key] ? 0 : 1;
      return ra - rb || a.it.name.localeCompare(b.it.name);
    });

    el.innerHTML = '<div class="summary">' +
      '<div class="card static"><div class="w">Traits</div><div class="n' + (have === TRAITS.length ? ' done' : ' neutral') + '">' + (hasProfile ? have + ' of ' + TRAITS.length : TRAITS.length) + '</div><div class="of">' + (hasProfile ? (TRAITS.length - have) + ' missing' : 'load profile.sav') + '</div></div>' +
      (ch ? '<div class="card static"><div class="w">Points spent</div><div class="n neutral">' + num(ch.traitPointsSpent) + ' / ' + num(TRAIT_POINTS_MAX) + '</div><div class="of">' + num(ch.traitPoints) + ' earned · ' + num(Math.max(0, (ch.traitPoints || 0) - (ch.traitPointsSpent || 0))) + ' to spend</div></div>' +
        '<div class="card static"><div class="w">At max</div><div class="n neutral">' + rows.filter(function (r) { return r.level >= 20; }).length + '</div><div class="of">traits at level 20</div></div>' : '') +
      '</div>' +
      '<div class="filters">' +
      (hasProfile ? '<div class="seg" id="traits-show">' + [['all', 'All ' + TRAITS.length], ['owned', 'I have ' + have], ['missing', 'I don\'t have ' + (TRAITS.length - have)]].map(function (s) {
        return '<button type="button" data-show="' + s[0] + '" class="' + (show === s[0] ? 'active' : '') + '">' + esc(s[1]) + '</button>';
      }).join('') + '</div>' : '') +
      '<div class="filter-row"><span class="filter-label">Type</span><div class="chips" id="traits-types">' +
      '<span class="chip' + (!state.traitType ? ' on' : '') + '" data-type="">All</span>' +
      types.map(function (t) { return '<span class="chip' + (state.traitType === t ? ' on' : '') + '" data-type="' + esc(t) + '">' + esc(t) + '</span>'; }).join('') +
      '</div></div></div>' +
      (owned.length || rest.length ? section('I have', owned) + section('I don\'t have', rest) : '<div class="empty">No traits with these filters.</div>');
    renderTraitDrawer();
  }

  // Side panel of one trait.
  function renderTraitDrawer() {
    var el = $('trait-drawer');
    // Only on the Traits page.
    var it = state.tab === 'traits' && state.traitSel && TRAITS.filter(function (t) { return t.name === state.traitSel; })[0];
    if (!it) { el.innerHTML = ''; return; }
    var owned = itemOwned(it), level = traitLevels()[it.name] || 0;
    var s = (RWA_STATS.traits && RWA_STATS.traits[it.name]) || {};
    var where = owned === true ? null : state.available[it.key];
    var locked = owned === false ? blockedBy(it) : [];
    var row = function (k, v) { return v ? '<tr><th>' + esc(k) + '</th><td>' + esc(v) + '</td></tr>' : ''; };
    el.innerHTML = '<aside class="tdrawer" role="dialog" aria-label="' + esc(it.name) + '"><button type="button" class="x" data-close-trait aria-label="Close">✕</button>' +
      '<div class="hero">' + (RWA_WIKI.icons && RWA_WIKI.icons[it.name] ? '<img src="' + esc(RWA_WIKI.icons[it.name]) + '" alt="">' : '') + '</div>' +
      '<h2>' + esc(it.name) + itemWikiLink(it) + '</h2>' +
      '<p class="cat">' + esc(traitType(it)) + (it.world ? ' · ' + esc(WORLD_LABEL[it.world] || it.world) : '') + (it.mode ? ' · ' + esc(it.mode) : '') + (it.dlc ? ' · ' + esc(it.dlc) : '') + '</p>' +
      '<p>' + statusIcon(owned) + ' ' + (owned === true ? 'You have it' + (level ? ' — level <b>' + level + ' / 20</b>' : ' — not leveled yet') : owned === false ? 'You don\'t have it' : 'Unknown (load profile.sav)') + '</p>' +
      (owned === true ? '<div class="bar"><i style="width:' + Math.round(100 * level / 20) + '%"></i></div>' : '') +
      (locked.length ? '<div class="how"><b>Needs first:</b> ' + esc(locked.join(', ')) + '</div>' : '') +
      (where ? '<div class="where">In your world now: ' + where.map(function (x) { return esc(x.event + ' — ' + x.location) + wikiLink(x.location); }).join(' · ') + '</div>' : '') +
      '<table class="kv">' + row('Effect', s.effect) + row('Per level', s.perLevel) + row('At level 20', s.max) + '</table>' +
      '<h3 class="section-title more">How to get it</h3><div class="how">' + (it.how ? esc(it.how) : '<i>No description in the sheet.</i>') + '</div></aside>';
  }

  // ---- items (picture grid) ------------------------------------------------
  // Same items as Missing items, as pictures by world: filter by what you have, type, world and mode;
  // an item opens a panel on the side with its stats and how to get it.
  function itemId(it) { return it.key || 'name:' + it.name; }
  function typeLabel(it) { return it.category === 'Weapon' && it.group ? it.group : it.category; }
  function iconImg(it) {
    var src = RWA_WIKI.icons && RWA_WIKI.icons[it.name];
    return src ? '<img src="' + esc(src) + '" alt="" loading="lazy">' : '<span class="noimg"></span>';
  }

  function renderItemsTab() {
    var el = $('items-view');
    var hasProfile = !!character();
    var show = hasProfile ? state.itemsShow : 'all';
    var q = $('items-search').value.trim().toLowerCase();
    var typeTest = state.itemsType && testFor(COLLECTION, state.itemsType);
    var modeTest = state.itemsMode && testFor(MODE_COLLECTION, state.itemsMode);
    var base = TRACKED_ITEMS.filter(collectible);
    // Consumables are used up, so they aren't part of the collection: they're listed only under their
    // own type, with how many this character carries.
    var pc = state.profile && state.profile.characters && state.profile.characters[state.charIndex];
    var qty = {};
    ((pc && pc.consumables) || []).forEach(function (c) { qty[c.name] = (qty[c.name] || 0) + (c.quantity || 0); });
    var CONS = DATA.items.filter(function (it) { return it.category === 'Consumable'; });
    var cons = state.itemsType === 'Consumables';
    if (cons) typeTest = null;
    var all = cons ? CONS : base;
    var ownedOf = function (it) { return it.category === 'Consumable' ? (hasProfile ? qty[it.name] > 0 : null) : itemOwned(it); };
    // Counts on the chips: each group applies the other filters.
    var keep = function (it, skip) {
      if (skip !== 'type' && typeTest && !typeTest(it)) return false;
      if (skip !== 'mode' && modeTest && !modeTest(it)) return false;
      if (skip !== 'world' && state.itemsWorld != null && worldOf(it) !== state.itemsWorld) return false;
      return true;
    };
    var have = all.filter(function (it) { return keep(it) && ownedOf(it) === true; }).length;
    var total = all.filter(function (it) { return keep(it); }).length;
    var chips = function (id, list, cur, skip) {
      return '<div class="filter-row"><span class="filter-label">' + esc(skip) + '</span><div class="chips" id="' + id + '">' +
        '<span class="chip' + (cur == null ? ' on' : '') + '" data-v="__all">All</span>' + list.map(function (x) {
          var from = skip === 'Type' ? (x.value === 'Consumables' ? CONS : base) : all;
          var n = from.filter(function (it) { return keep(it, skip.toLowerCase()) && x.test(it); });
          var h = n.filter(function (it) { return ownedOf(it) === true; }).length;
          return n.length ? '<span class="chip' + (cur === x.value ? ' on' : '') + '" data-v="' + esc(x.value) + '">' + esc(x.label) + ' <small>' + (hasProfile ? h + '/' : '') + n.length + '</small></span>' : '';
        }).join('') + '</div></div>';
    };
    var typeList = COLLECTION.map(function (c) { return { label: c[0], value: c[0], test: c[1] }; })
      .concat([{ label: 'Consumables', value: 'Consumables', test: function (it) { return it.category === 'Consumable'; } }]);
    var modeList = MODE_COLLECTION.map(function (c) { return { label: c[0], value: c[0], test: c[1] }; });
    var worldList = WORLD_ORDER.map(function (w) { return { label: WORLD_LABEL[w], value: w, test: function (it) { return worldOf(it) === w; } }; });

    var groups = {};
    all.forEach(function (it) {
      if (!keep(it)) return;
      var owned = ownedOf(it);
      if (show === 'owned' && owned !== true) return;
      if (show === 'missing' && owned === true) return;
      if (q && (it.name + ' ' + it.how + ' ' + it.group).toLowerCase().indexOf(q) === -1) return;
      // Skins can always be bought in Ward 13, so they aren't flagged as "in your world": a skin you
      // don't have looks faded like any other missing item.
      var where = owned === true || it.category === 'Skin' ? null : state.available[itemKeyForAvailability(it)];
      (groups[worldOf(it)] = groups[worldOf(it)] || []).push({ it: it, owned: owned, where: where, locked: owned === false ? blockedBy(it) : [] });
    });
    var rank = function (r) { return r.owned === true ? 3 : r.locked.length ? 2 : r.where ? 0 : 1; };
    var catOrder = function (it) { var i = COLLECTION.map(function (c) { return c[1](it); }).indexOf(true); return i < 0 ? 99 : i; };
    var tile = function (r) {
      var it = r.it, id = itemId(it);
      var cls = 'ttile' + (r.owned === true ? ' owned' : r.owned == null ? '' : ' missing') + (r.locked.length ? ' blocked' : r.where ? ' now' : '') + (state.itemSel === id ? ' sel' : '');
      var status = it.category === 'Consumable' ? (r.owned ? '×' + qty[it.name] + ' in your bag' : r.owned === false ? 'none' : '?') : r.owned === true ? '✔ have it' : r.locked.length ? '🔒 needs ' + r.locked.join(', ') : r.where ? 'in your world' : r.owned == null ? '?' : 'missing';
      return '<button type="button" class="' + cls + '" data-item="' + esc(id) + '" title="' + esc(it.name + (it.mode ? ' — ' + it.mode : '')) + '">' + iconImg(it) +
        (it.category === 'Skin' ? '<span class="skin-tag">SKIN</span>' : '') + '<span class="n">' + esc(it.name) + '</span><span class="ty">' + esc(typeLabel(it)) + (it.mode ? ' · ' + esc(it.mode) : '') + '</span><span class="lv">' + esc(status) + '</span></button>';
    };
    var body = WORLD_ORDER.filter(function (w) { return groups[w]; }).map(function (w) {
      var list = groups[w].sort(function (a, b) { return rank(a) - rank(b) || catOrder(a.it) - catOrder(b.it) || a.it.name.localeCompare(b.it.name); });
      var h = list.filter(function (r) { return r.owned === true; }).length;
      return '<div class="group"><h3>' + esc(WORLD_LABEL[w]) + ' <small>' + (hasProfile && show === 'all' ? h + ' of ' + list.length : list.length + ' items') + '</small></h3><div class="tgrid">' + list.map(tile).join('') + '</div></div>';
    }).join('');

    // Totals for the whole collection (the filters below don't change them).
    var tot = { have: 0, total: 0, now: 0, locked: 0, skins: 0, skinsHave: 0 };
    base.forEach(function (it) {
      var o = itemOwned(it);
      tot.total++;
      if (o === true) tot.have++;
      else if (o === false && blockedBy(it).length) tot.locked++;
      else if (state.available[itemKeyForAvailability(it)]) tot.now++;
      if (it.category === 'Skin') { tot.skins++; if (o === true) tot.skinsHave++; }
    });
    var held = CONS.filter(function (it) { return qty[it.name] > 0; }).length;
    var pct = tot.total ? Math.round(100 * tot.have / tot.total) : 0;
    var card = function (title, big, sub, cls) {
      return '<div class="card static"><div class="w">' + esc(title) + '</div><div class="n ' + (cls || 'neutral') + '">' + big + '</div><div class="of">' + sub + '</div></div>';
    };
    var cards = hasProfile ? '<div class="summary">' +
      card('Collection', tot.have + ' of ' + tot.total, (tot.total - tot.have) + ' missing · ' + pct + '%', tot.have === tot.total ? 'done' : 'neutral') +
      card('Obtainable now', tot.now, 'in the worlds you have loaded and Ward 13') +
      card('Need something first', tot.locked, 'a key item or another item comes first') +
      card('Skins', tot.skinsHave + ' of ' + tot.skins, 'bought from Whispers in Ward 13') +
      card('Consumables', held + ' of ' + CONS.length, 'kinds in your bag (not counted)') +
      '</div>' : '';

    $('items-cards').innerHTML = cards;
    el.innerHTML = '<div class="filters">' +
      (hasProfile ? '<div class="seg" id="items-show">' + [['all', 'All ' + total], ['owned', 'I have ' + have], ['missing', 'I don\'t have ' + (total - have)]].map(function (s) {
        return '<button type="button" data-show="' + s[0] + '" class="' + (show === s[0] ? 'active' : '') + '">' + esc(s[1]) + '</button>';
      }).join('') + '</div>' : '') +
      chips('items-types', typeList, state.itemsType, 'Type') + chips('items-modes', modeList, state.itemsMode, 'Mode') + chips('items-worlds', worldList, state.itemsWorld, 'World') +
      '</div>' + (body || '<div class="empty">No items with these filters.</div>');
    renderItemDrawer();
  }

  // Side panel of one item.
  // How many of a consumable the character carries.
  function carried(it) {
    var pc = state.profile && state.profile.characters && state.profile.characters[state.charIndex];
    if (!pc) return 'Load profile.sav to see how many you carry.';
    var n = (pc.consumables || []).filter(function (c) { return c.name === it.name; }).reduce(function (t, c) { return t + (c.quantity || 0); }, 0);
    return n ? 'You carry <b>×' + n + '</b>.' : 'None in your bag.';
  }

  function renderItemDrawer() {
    var el = $('item-drawer');
    var it = state.tab === 'items' && state.itemSel && TRACKED_ITEMS.filter(function (x) { return itemId(x) === state.itemSel; })[0];
    if (!it) { el.innerHTML = ''; return; }
    var owned = itemOwned(it);
    var where = owned === true ? null : state.available[itemKeyForAvailability(it)];
    var locked = owned === false ? blockedBy(it) : [];
    var S = RWA_STATS || {};
    var row = function (k, v) { return v || v === 0 ? '<tr><th>' + esc(k) + '</th><td>' + esc(String(v)) + '</td></tr>' : ''; };
    var stats = '';
    var w = S.weapons && S.weapons[it.name];
    if (w) stats = row('Damage', w.damage + (w.damageNote ? ' (' + w.damageNote + ')' : '')) + row('Fire rate', w.rps ? w.rps + ' shots/s' : '') + row('Magazine', w.magazine) +
      row('Ideal range', w.range ? w.range + ' m' : '') + row('Crit chance', w.crit ? w.crit + '%' : '') + row('Weak spot', w.weakspot ? '+' + w.weakspot + '%' : '') + row('Built-in mod', w.mod) + row('Special', w.special);
    var fx = (it.category === 'Ring' && S.rings && S.rings[it.name]) || (it.category === 'Amulet' && S.amulets && S.amulets[it.name]) || (it.category === 'Mod' && S.mods && S.mods[it.name]);
    if (fx) stats += row('Effect', fx.effect);
    var set = it.category === 'Armor' && S.sets && S.sets[it.group];
    if (set) stats += row('Set bonus', set.bonus + ' — ' + set.effect) + row('Per pieces', set.pieces.filter(Boolean).join(' · '));
    el.innerHTML = '<aside class="tdrawer" role="dialog" aria-label="' + esc(it.name) + '"><button type="button" class="x" data-close-item aria-label="Close">✕</button>' +
      '<div class="hero">' + (RWA_WIKI.icons && RWA_WIKI.icons[it.name] ? '<img src="' + esc(RWA_WIKI.icons[it.name]) + '" alt="">' : '') + '</div>' +
      '<h2>' + esc(it.name) + itemWikiLink(it) + '</h2>' +
      '<p class="cat">' + esc([typeLabel(it), WORLD_LABEL[worldOf(it)] || worldOf(it), it.mode, it.dlc, it.category === 'Armor' && it.group, it.base && 'look of ' + it.base.name].filter(Boolean).join(' · ')) + '</p>' +
      (it.category === 'Consumable' ? '<p>' + carried(it) + '</p>' :
        '<p>' + statusIcon(owned) + ' ' + (owned === true ? 'You have it' : owned === false ? 'You don\'t have it' : 'Unknown') + '</p>') +
      (locked.length ? '<div class="how"><b>Needs first:</b> ' + esc(locked.join(', ')) + '</div>' : '') +
      (where ? '<div class="where">In your world now: ' + where.map(function (x) { return esc(x.block + ' → ' + x.location + ' (' + x.event + ')') + wikiLink(x.location); }).join(' · ') + '</div>' : '') +
      (stats ? '<table class="kv">' + stats + '</table>' : '') +
      '<h3 class="section-title more">How to get it</h3><div class="how">' + (it.how ? esc(it.how) : '<i>No description in the sheet.</i>') + '</div></aside>';
  }

  // ---- my character --------------------------------------------------------
  function num(n) { return Math.round(n).toLocaleString('en-US'); }
  // Most trait points a character can have.
  var TRAIT_POINTS_MAX = 640;
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
      ['Traits', num(ch.traitPointsSpent) + ' / ' + num(TRAIT_POINTS_MAX) + ' points', leveled.length + ' traits leveled · ' + maxed + ' at max · ' + num(ch.traitPoints) + ' earned'],
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
      return '<tr><th>' + esc(l.label) + '</th><td>' + ico(e.name) + esc(e.name) + rowGlobe(e) + levelTag(e) + qty + mods + '</td></tr>';
    }).join('') + '</table>';

    var traits = leveled.length ? leveled.map(function (t) { return meter(ico(t.name) + esc(t.name) + rowGlobe(t), t.level, t.level / 20, t.level >= 20); }).join('') : '<p class="cat">No trait points spent yet.</p>';

    var tiles = function (rows) {
      return '<div class="tiles">' + rows.map(function (r) {
        var q = r.quantity != null ? r.quantity : 1;
        return '<div class="tile' + (q ? '' : ' zero') + '"><span class="tq">' + num(q) + '</span><span class="tn">' + ico(r.name) + esc(r.name) + rowGlobe(r) + '</span></div>';
      }).join('') + '</div>';
    };
    var resources = ch.resources.filter(function (r) { return r.name !== 'Dragon Heart upgrades'; });

    // Only what has been upgraded; the rest is summed up in one line.
    var arsenalList = function (cat) {
      var rows = ch.arsenal.filter(function (a) { return a.category === cat; });
      var up = rows.filter(function (a) { return a.level > 0; }), rest = rows.length - up.length;
      return (up.length ? up.map(function (a) { return meter(ico(a.name) + esc(a.name) + rowGlobe(a), '+' + a.level, a.level / 20, a.level >= 20); }).join('') : '<p class="cat">None upgraded yet.</p>') +
        (rest ? '<p class="cat">' + rest + ' more owned at +0.</p>' : '');
    };

    var topKills = ch.kills.length ? ch.kills[0].kills : 0;
    var kills = ch.kills.map(function (k) { return meter(ico(k.name) + esc(k.name) + rowGlobe(k), num(k.kills), topKills ? k.kills / topKills : 0); }).join('');
    var s = ch.stats;
    var statRows = [
      ['Kills with your weapons', ch.kills.reduce(function (n, k) { return n + k.kills; }, 0)], ['Weak spot kills', s.weakspotKills], ['Kills with explosive damage', s.explosiveKills],
      ['Allies revived', s.revives], ['Times revived', s.timesRevived],
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
      panel('Traits (' + num(ch.traitPointsSpent) + ' / ' + num(ch.traitPoints) + ' points spent · max ' + num(TRAIT_POINTS_MAX) + ')', traits) +
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
        var items = e.items.map(function (i) { return evItem(i, i.item ? itemWikiLink(i.item) : ''); }).join('');
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
      eventTable('Adventure') + eventTable('Campaign') +
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

    // The counter goes back to 0 after the third use, so owning every reward also means done.
    var allOwned = rewards.every(function (r) { return r[1].every(function (n) { var it = sheetItem(n); return it && itemOwned(it) === true; }); });
    if (allOwned) phase = 3;
    var next;
    if (phase >= 3) next = 'Done: all three Cryptolith rewards are yours (Concentration, Blood Bond and the Labyrinth set).';
    else if (sigil) next = towers.length ? 'Use the Sigil on the Cryptolith tower in ' + towers[0].area + ' (tile ' + towers[0].tileId + ').' : 'Use the Sigil on a Cryptolith tower — this world has none; reroll an adventure until one shows up.';
    else next = queen ? (queen.done ? 'You defeated the Iskal Queen in this world — if you didn\'t get the Sigil, it drops from her.' : 'Defeat the Iskal Queen in ' + queen.area + ' to get the Cryptolith Sigil.')
      : 'Get the Cryptolith Sigil from the Iskal Queen (Corsus, The Mist Fen) — she is not in this world.';

    var rows = [
      ['Next step', '<b>' + esc(next) + '</b>'],
      ['Sigil in your inventory', sigil ? '<span class="st ok">✔</span> yes' : allOwned ? 'no — not needed any more (all three rewards are yours)' : '<span class="st miss">✘</span> no'],
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
      // Leto's Amulet: its rare secret room is the "Penitent" event. In the world: go; not: reroll.
      var leto = sheetItem("Leto's Amulet");
      if (missing(leto)) {
        var save = current(), room = null;
        [save && save.campaign, save && save.adventure].forEach(function (b) { if (b && !room && b.events.some(function (e) { return e.key === 'Penitent'; })) room = b; });
        world.push(ico(leto.name) + '<b>Leto\'s Amulet</b>' + itemWikiLink(leto) + ': ' +
          (room ? '<b>in this world</b> (' + esc(room.label) + ') — secret room inside the Sunken Passage or the Hidden Sanctum, behind the wall "Only the penitent man may pass": crouch and walk into it.'
            : 'not in this world. <b>Reroll.</b>'));
      }
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
    // Quest items whose rewards aren't all yours yet (the Sigil has its own panel above).
    QUEST_ITEMS.filter(function (qi) { return !qi.hide && qi.rewards.some(function (r) { return itemOwned(r) === false; }); }).forEach(function (qi) {
      var miss = qi.rewards.filter(function (r) { return itemOwned(r) === false; });
      me.push('<b>' + esc(qi.name) + '</b>' + (carries(qi) ? ' (you carry one)' : itemOwned(qi) === true ? ' (you already had one — getting the rest needs another)' : '') + ': still missing ' + miss.map(function (r) { return esc(r.name) + itemWikiLink(r); }).join(', ') +
        '<div class="cat">' + esc(qi.how) + '</div>');
    });
    if ((x.newItems || []).length) me.push('New items you haven\'t looked at: ' + x.newItems.map(esc).join(', '));
    prof.achievements.filter(function (a) { return a.target > 1 && a.value < a.target && a.value / a.target >= 0.5; }).forEach(function (a) {
      me.push('Almost there: <b>' + esc(a.name) + '</b> ' + num(a.value) + ' / ' + num(a.target));
    });

    // Collection.
    var coll = [], gaps = {}, modeOnly = { Survival: [], Hardcore: [], Campaign: [] };
    DATA.items.forEach(function (it) {
      if (!collectible(it) || itemOwned(it) !== false) return;
      if (modeOnly[it.mode]) { modeOnly[it.mode].push(it); return; }
      if (/^(Earth|Rhom|Corsus|Yaesha|Reisum)$/.test(it.world)) (gaps[it.world] = gaps[it.world] || []).push(it);
    });
    var ranked = Object.keys(gaps).sort(function (a, b) { return gaps[b].length - gaps[a].length; });
    if (ranked.length) coll.push('<b>Best world to roll next:</b> ' + ranked.map(function (w) { return esc(WORLD_LABEL[w] || w) + ' (' + gaps[w].length + ' missing)'; }).join(' · '));
    // Campaign-only items are left out of "best world to roll": an adventure never has them.
    Object.keys(modeOnly).forEach(function (m) { if (modeOnly[m].length) coll.push((m === 'Campaign' ? '<b>Campaign only</b> (never in an adventure, reroll the campaign): ' : '<b>' + m + ' mode</b> only: ') + modeOnly[m].length + ' items missing — ' + modeOnly[m].map(function (i) { return esc(i.name) + itemWikiLink(i); }).join(', ')); });
    // Armor skins: what Whispers (Ward 13) would sell you with the scrap and Glowing Fragments you have.
    var pc = state.profile && state.profile.characters && state.profile.characters[state.charIndex];
    if (pc) {
      var res = {};
      (pc.resources || []).forEach(function (r) { res[r.name] = r.quantity || 0; });
      var skins = DATA.items.filter(function (it) { return it.category === 'Skin' && !it.merged && itemOwned(it) === false; }).map(function (it) {
        var m = /([\d,]+) Scrap and (\d+) Glowing Fragments/i.exec(it.how);
        return m && { it: it, scrap: +m[1].replace(/,/g, ''), frag: +m[2] };
      }).filter(Boolean).sort(function (a, b) { return a.frag - b.frag || a.scrap - b.scrap || a.it.name.localeCompare(b.it.name); });
      if (skins.length) {
        var frag = res['Glowing Fragment'] || 0, scrap = res.Scrap || 0, buy = [], f = frag, s = scrap;
        skins.forEach(function (x) { if (x.frag <= f && x.scrap <= s) { buy.push(x); f -= x.frag; s -= x.scrap; } });
        var allFrag = skins.reduce(function (n, x) { return n + x.frag; }, 0);
        coll.push('<b>Armor skins</b> from Whispers (Ward 13): you have ' + num(frag) + ' Glowing Fragments and ' + num(scrap) + ' scrap — ' +
          (buy.length ? 'enough for <b>' + buy.length + '</b> of the ' + skins.length + ' skins you don\'t have, cheapest first: ' + buy.map(function (x) { return ico(x.it.name) + esc(x.it.name) + ' <span class="cat">' + x.frag + ' fragments</span>'; }).join(', ')
            : 'not enough for any yet (the cheapest takes ' + skins[0].frag + ' fragments and ' + num(skins[0].scrap) + ' scrap)') +
          '. All ' + skins.length + ' take ' + num(allFrag) + ' fragments; they drop in Survival mode.');
      }
    }
    if (state.available) {
      var now = DATA.items.filter(function (it) { var k = itemKeyForAvailability(it); return collectible(it) && it.category !== 'Skin' && itemOwned(it) === false && k && state.available[k]; });
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
  // Where a passage leads. "1007_Zone" is the area whose quest id is 1007 (Junk Town), "1008_Zone_POI"
  // the way out of that area's dungeon back here, and the Cryptolith teleporter goes to the Labyrinth.
  // Returns { zone, kind: 'entrance' | 'way' | 'back' | 'teleport', text } or null.
  function passageTo(l, here) {
    var ws = state.worldStates && state.worldStates[state.charIndex];
    if (!ws || !ws.zones || l.type !== 'Link') return null;
    var zone = null, kind;
    var m = /^(\d+)_Zone(_POI)?$/.exec(l.to || '');
    if (m) {
      zone = ws.zones.filter(function (x) { return String(x.questId) === m[1]; })[0];
      kind = m[2] ? 'back' : 'way';
    } else if (/CryptolithTeleporter/.test(l.name)) {
      zone = ws.zones.filter(function (x) { return /Cryptolith/.test(x.name) && x.parent != null; })[0];
      kind = 'teleport';
    }
    if (!zone) return null;
    if (kind === 'way' && here && zone.parent === here.id) kind = 'entrance';
    var text = { entrance: '→ ' + zone.name, way: '→ ' + zone.name, back: '↩ out of ' + zone.name, teleport: '⇄ ' + zone.name }[kind];
    return { zone: zone, kind: kind, text: text };
  }

  // Tiles your walked path (fog of war cells) covers. The save doesn't say how its cells line up with the
  // tiles, so every tile size (40–64 cells) and offset that puts nearly all cells on tiles and covers the
  // tiles known to be visited is tried; a tile counts only when all of them agree. Cached per area.
  var walkedCache = {};
  function walkedTiles(z, core, known) {
    var key = z.id + ':' + z.fow.length;
    if (walkedCache[key]) return walkedCache[key];
    var set = {};
    core.forEach(function (t) { set[t.x + ',' + t.y] = t; });
    var anchors = core.filter(function (t) { return known[t.id]; });
    var mx = Infinity, my = Infinity;
    z.fow.forEach(function (c) { if (c[0] < mx) mx = c[0]; if (c[1] < my) my = c[1]; });
    var votes = {}, fits = 0;
    for (var S = 40; S <= 64; S += 2) {
      for (var ox = 0; ox < S; ox += 4) for (var oy = 0; oy < S; oy += 4) {
        var cnt = {};
        z.fow.forEach(function (c) { var k = Math.floor((c[0] - mx + ox) / S) + ',' + Math.floor((c[1] - my + oy) / S); cnt[k] = (cnt[k] || 0) + 1; });
        var cells = Object.keys(cnt).map(function (k) { var p = k.split(','); return [+p[0], +p[1], cnt[k]]; });
        // The first known tile (the start) has to hold some cells: only shifts that put a cell group on it.
        var shifts = anchors.length ? cells.map(function (c) { return [anchors[0].x - c[0], anchors[0].y - c[1]]; }) : [];
        for (var si = 0; si < shifts.length; si++) {
          var dx = shifts[si][0], dy = shifts[si][1], hit = 0;
          cells.forEach(function (c) { if (set[(c[0] + dx) + ',' + (c[1] + dy)]) hit += c[2]; });
          if (hit < z.fow.length * 0.97) continue;
          if (!anchors.every(function (t) { return cnt[(t.x - dx) + ',' + (t.y - dy)]; })) continue;
          fits++;
          core.forEach(function (t) { if ((cnt[(t.x - dx) + ',' + (t.y - dy)] || 0) >= 3) votes[t.id] = (votes[t.id] || 0) + 1; });
        }
      }
    }
    walkedCache[key] = fits ? core.filter(function (t) { return votes[t.id] === fits; }).map(function (t) { return t.id; }) : [];
    return walkedCache[key];
  }

  function zoneLayoutSvg(z) {
    var core = z.tiles.filter(function (t) { return t.kind !== 'blank' && t.kind !== 'vista'; });
    if (!core.length) return '<p class="cat">No tile layout stored for this area (fixed map).</p>';
    var xs = core.map(function (t) { return t.x; }), ys = core.map(function (t) { return t.y; });
    var minX = Math.min.apply(null, xs), minY = Math.min.apply(null, ys), maxX = Math.max.apply(null, xs), maxY = Math.max.apply(null, ys);
    // The save's grid is turned 90° from the in-game map: its +Y is the map's right, its +X the map's up.
    var C = TILE_CELL, w = (maxY - minY + 1) * C, h = (maxX - minX + 1) * C;
    var px = function (t) { return (t.y - minY) * C; }, py = function (t) { return (maxX - t.x) * C; };
    var out = [];
    var fixedOnTile = fixedEventsIn(z);
    z.tiles.forEach(function (t) {
      if (t.kind !== 'vista' || t.x < minX || t.x > maxX || t.y < minY || t.y > maxY) return;
      out.push('<rect class="t-vista" x="' + (px(t) + 6) + '" y="' + (py(t) + 6) + '" width="' + (C - 12) + '" height="' + (C - 12) + '" rx="6"/>');
    });
    // Connections between tiles, drawn first so the tiles (all opaque) cover them: only the short bar
    // between two boxes shows. Turned like the tiles (grid dx, dy -> screen dy, -dx).
    core.forEach(function (t) {
      var cx = px(t) + C / 2, cy = py(t) + C / 2;
      WS.EDGES.forEach(function (e) { if (t.edges & e[0]) out.push('<line class="t-path" x1="' + cx + '" y1="' + cy + '" x2="' + (cx + e[2] * C / 2) + '" y2="' + (cy - e[1] * C / 2) + '"/>'); });
    });
    // Where you've been: tiles the save proves (an area you walked: its start, an opened chest, a completed
    // event, a passage or waypoint you used), plus every tile on the way from the start to each of them,
    // following the tiles' connections (you can't reach them without walking through).
    var at = {};
    core.forEach(function (t) { at[t.x + ',' + t.y] = t; });
    var proved = function (t) { return t.kind === 'start' || t.chestsOpen > 0 || t.events.some(function (e) { return e.done; }) || t.links.some(function (l) { return l.used; }); };
    var been = {};
    var start = z.fow.length ? core.filter(function (t) { return t.kind === 'start'; })[0] : null;
    if (start) {
      // Shortest way from the start to every tile (breadth-first over the tile connections).
      var prev = {}, queue = [start], seen = {};
      seen[start.id] = true;
      while (queue.length) {
        var t0 = queue.shift();
        WS.EDGES.forEach(function (e) {
          var n = (t0.edges & e[0]) && at[(t0.x + e[1]) + ',' + (t0.y + e[2])];
          if (n && !seen[n.id]) { seen[n.id] = true; prev[n.id] = t0; queue.push(n); }
        });
      }
      core.filter(proved).forEach(function (t) { for (var p = t; p; p = prev[p.id]) been[p.id] = true; });
      // Plus the tiles your walked path covers, when every way of laying it on the tiles agrees.
      if (core.length > 2) walkedTiles(z, core, been).forEach(function (id) { been[id] = true; });
    }
    core.forEach(function (t) {
      var x = px(t), y = py(t);
      var precious = t.loot.some(function (l) { return l.item && /Ring|Amulet|Weapon|Armor|Mod|Trait/.test(l.item.category) || l.name === 'Trait Book'; });
      var tip = [z.name + ' — tile ' + t.id + ' (' + t.level + ')', t.role !== 'None' ? 'Role: ' + t.role : '', t.tag && t.tag !== 'None' ? 'Tag: ' + t.tag : '']
        .concat(t.events.map(function (e) { return e.type + ': ' + e.name + (e.done ? ' (completed)' : ''); }))
        .concat(t.links.map(function (l) {
          var p = passageTo(l, z);
          if (p) return { entrance: 'Entrance: ', way: 'Way to: ', back: 'Way out of: ', teleport: 'Teleporter to: ' }[p.kind] + p.zone.name + (l.used ? ' (used)' : '');
          return ({ Waypoint: 'Waypoint', Checkpoint: 'Respawn checkpoint', Link: 'Passage' }[l.type] || l.type) + (l.label ? ': ' + l.label : '') + (l.used ? ' (used)' : '') + (l.active ? '' : ' (inactive)');
        }))
        .concat(t.chests ? ['Chests: ' + t.chestsOpen + ' of ' + t.chests + ' opened'] : [])
        .concat(t.loot.map(function (l) { return 'On the ground: ' + l.name + (l.quantity > 1 ? ' ×' + l.quantity : ''); }))
        .filter(Boolean).join('\n');
      // Full colour where the save proves you were (the start of an area you walked, an opened chest,
      // a completed event, a passage or waypoint you used); faded everywhere else.
      var was = !!been[t.id];
      out.push('<g class="tile t-' + t.kind + (was ? ' been' : ' unseen') + '"><title>' + esc(tip + (was ? '' : '\n(no sign you have been here yet)')) + '</title>' +
        // A faded tile still hides the passage lines under it: an opaque base, then the tile's colour faded.
        (was ? '' : '<rect class="base" x="' + (x + 8) + '" y="' + (y + 8) + '" width="' + (C - 16) + '" height="' + (C - 16) + '" rx="7"/>') +
        '<rect x="' + (x + 8) + '" y="' + (y + 8) + '" width="' + (C - 16) + '" height="' + (C - 16) + '" rx="7"/>');
      var lines = [];
      if (t.kind === 'start') lines.push(['Start', '']);
      fixedOnTile.forEach(function (x) { if (x.tile(t)) lines.push([short(x.ev.name, 15), 'acc']); });
      // Passages by the name of the area they lead to; otherwise the tile's tag ("→ City").
      var named = t.links.map(function (l) { return passageTo(l, z); }).filter(Boolean);
      named.forEach(function (p) { lines.push([short(p.text, 15), p.kind === 'teleport' ? 'acc' : '']); });
      if (!named.length && t.kind === 'exit') lines.push([short(t.tag && t.tag !== 'None' ? t.tag.replace(/^To/, '→ ') : 'Exit', 12), '']);
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

  // Map cells you walked through (the trail the in-game map reveals). `size` is the longest side in pixels.
  function zoneFogSvg(z, size) {
    if (!z.fow.length) return '<p class="cat">You have not walked here yet.</p>';
    // Frame the trail on where most of it is: a few stray cells (teleports, falls) would leave the drawing mostly empty.
    var pick = function (axis) {
      var v = z.fow.map(function (c) { return c[axis]; }).sort(function (a, b) { return a - b; });
      var lo = v[Math.floor(v.length * 0.005)], hi = v[Math.ceil(v.length * 0.995) - 1];
      return [lo - 6, hi + 6];
    };
    var bx = pick(0), by = pick(1);
    var cells = z.fow.filter(function (c) { return c[0] >= bx[0] && c[0] <= bx[1] && c[1] >= by[0] && c[1] <= by[1]; });
    var xs = cells.map(function (c) { return c[0]; }), ys = cells.map(function (c) { return c[1]; });
    // Turned like the tile layout (90° counter-clockwise) to match the in-game map.
    var maxX = Math.max.apply(null, xs), minX = Math.min.apply(null, xs), minY = Math.min.apply(null, ys);
    var w = Math.max.apply(null, ys) - minY + 1, h = maxX - minX + 1;
    var d = cells.map(function (c) { return 'M' + (c[1] - minY) + ' ' + (maxX - c[0]) + 'h1v1h-1z'; }).join('');
    var scale = Math.min(size ? 4 : 3, (size || 300) / Math.max(w, h));
    return '<svg class="zfog" viewBox="0 0 ' + w + ' ' + h + '" width="' + Math.round(w * scale) + '" height="' + Math.round(h * scale) + '" shape-rendering="crispEdges" role="img" aria-label="Explored part of ' + esc(z.name) + '"><path d="' + d + '"/></svg>';
  }

  // Everything an area holds, as a list: events, waypoints, chests and loot on the ground.
  // Fixed places the world save keeps no event for, shown where they are on the map: Founder's Hideout is
  // the start of Fairview (the tile the save tags "POI_Ford"), in the main Earth campaign.
  var FIXED_ON_MAP = { FoundersHideout: { zone: 'Fairview', tile: function (t) { return /Ford/.test(t.tag || ''); } } };
  function fixedEventsIn(z) {
    var save = current(), out = [];
    if (!save) return out;
    [save.campaign, save.adventure].forEach(function (b) {
      if (!b) return;
      b.events.forEach(function (ev) { var f = FIXED_ON_MAP[ev.key]; if (f && f.zone === z.name) out.push({ ev: ev, tile: f.tile }); });
    });
    return out;
  }

  function zoneContents(z, ws) {
    var rows = [];
    fixedEventsIn(z).forEach(function (x) {
      var items = x.ev.items.map(function (p) { var it = itemsByKey[p]; return { name: it ? it.name : p, item: it }; });
      rows.push(statusIcon(items.every(function (i) { return i.item && itemOwned(i.item) === true; })) + ' ' + esc(x.ev.name) + ' <span class="cat">' + esc(TYPE_LABEL[x.ev.type] || x.ev.type) + ' · on the start tile</span>' +
        items.map(function (i) { return evItem(i); }).join(''));
    });
    ws.events.filter(function (e) { return e.zoneId === z.id || e.ownZone === z.id; }).forEach(function (e) {
      // Item drops don't record completion: they count as done when you own the item; trait books can't be told.
      var sheet = e.items.filter(function (i) { return i.item; });
      var done = e.done ? true : e.type !== 'Item drop' ? false : sheet.length ? sheet.every(function (i) { return itemOwned(i.item) === true; }) : null;
      rows.push(statusIcon(done) + ' ' + esc(e.name) + ' <span class="cat">' + esc(e.type) + '</span>' +
        e.items.map(function (i) { return evItem(i); }).join(''));
    });
    // Ward 13: Whispers and the armor skins he sells (the world save doesn't list merchants' stock as events).
    if (/^Ward 13\b/.test(z.name) && DATA.events.Whispers) {
      var skins = DATA.events.Whispers.items.map(function (p) { return { name: itemsByKey[p].name, item: itemsByKey[p] }; });
      rows.push(statusIcon(skins.every(function (i) { return itemOwned(i.item) === true; })) + ' Whispers <span class="cat">Merchant · armor skins for scrap and Glowing Fragments</span>' +
        skins.map(function (i) { return evItem(i); }).join(''));
    }
    // Passages: dungeon entrances, ways to other areas and out of a dungeon, the Cryptolith teleporter.
    z.links.forEach(function (l) {
      var p = passageTo(l, z); if (!p) return;
      var what = { entrance: 'dungeon entrance', way: 'way to another area', back: 'way out of its dungeon', teleport: 'Cryptolith teleporter' }[p.kind];
      rows.push('<a href="#zone-' + p.zone.id + '">' + esc(p.text) + '</a> <span class="cat">' + what + (l.used ? ' · used' : '') + '</span>');
    });
    z.links.filter(function (l) { return l.type !== 'Link'; }).forEach(function (l) {
      rows.push((l.type === 'Waypoint' ? '⚑ ' : '✚ ') + esc(l.label || (l.type === 'Waypoint' ? 'Waypoint' : 'Respawn checkpoint')) + (l.active ? '' : ' <span class="cat">inactive</span>'));
    });
    if (z.chests) rows.push('▣ ' + z.chestsOpen + ' of ' + z.chests + ' chests opened');
    var loot = {};
    ws.loot.filter(function (l) { return l.zone === z.id; }).forEach(function (l) { loot[l.name] = (loot[l.name] || 0) + l.quantity; });
    Object.keys(loot).forEach(function (n) { rows.push('• ' + esc(n) + (loot[n] > 1 ? ' ×' + num(loot[n]) : '') + ' <span class="cat">on the ground</span>'); });
    var npcs = ws.npcs.filter(function (n) { return /Zone_(\d+)_/.exec(n.where) && +/Zone_(\d+)_/.exec(n.where)[1] === z.id; });
    npcs.forEach(function (n) { rows.push('☺ ' + esc(n.name) + (n.items.length ? ' <span class="cat">carries ' + esc(n.items.join(', ')) + '</span>' : '')); });
    return rows.length ? '<ul class="here">' + rows.map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ul>' : '<p class="cat">Nothing recorded here.</p>';
  }

  // Re-render the expensive tabs only when they're shown.
  function renderMapTab() {
    var el = $('map-view');
    if (state.tab !== 'map') return;
    var ws = state.worldStates && state.worldStates[state.charIndex];
    if (!ws) { el.innerHTML = '<div class="empty">Load a world save (save_N.sav) to see the map.</div>'; return; }
    if (ws.error) { el.innerHTML = '<div class="empty">Could not read the world: ' + esc(ws.error) + '</div>'; return; }
    var depthOf = function (z) { var d = 0, p = z; while (p && p.parent != null && d < 5) { p = ws.zones.filter(function (x) { return x.id === p.parent; })[0]; d++; } return d; };
    // Campaign and adventure are separate maps: show one at a time, adventure first.
    var modes = ['Adventure', 'Campaign', 'Ward 13'].filter(function (m) { return ws.zones.some(function (z) { return z.mode === m; }); });
    if (modes.indexOf(state.mapMode) < 0) state.mapMode = modes[0];
    var zones = ws.zones.filter(function (z) { return !modes.length || z.mode === state.mapMode || (!z.mode && state.mapMode === modes[0]); });
    var switcher = modes.length > 1 ? '<div class="seg" id="map-mode">' + modes.map(function (m) {
      return '<button type="button" data-map-mode="' + esc(m) + '" class="' + (m === state.mapMode ? 'active' : '') + '">' + esc(m) + ' <span class="cat">' + ws.zones.filter(function (z) { return z.mode === m; }).length + '</span></button>';
    }).join('') + '</div>' : '';
    // Place filter in alphabetical order.
    var index = zones.slice().sort(function (a, b) { return a.name.localeCompare(b.name); })
      .map(function (z) { return '<a class="chip on" href="#zone-' + z.id + '">' + esc(z.name) + '</a>'; }).join('');
    var legend = '<div class="legend"><span class="lg t-start">Start</span><span class="lg t-exit">Exit / way to another area</span><span class="lg t-poi">Event / point of interest</span>' +
      '<span class="lg t-straight">Path</span><span class="lg t-vista">Scenery</span> <span class="cat">faded tile: no sign you have been there yet · ✔ completed · ⚑ waypoint · ✚ respawn checkpoint · ▣ chests opened/total · • loot on the ground · ★ gear or trait book on the ground · hover a tile for everything in it</span></div>';
    el.innerHTML = switcher + '<div class="chips map-index">' + index + '</div>' + legend + zones.map(function (z) {
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
      // Fixed maps (Ward 13, Ward Prime, boss arenas…) keep no tile layout: the path you walked is their map,
      // drawn large, with what the area holds listed next to it (the save has no usable positions for them).
      var core = z.tiles.filter(function (t) { return t.kind !== 'blank' && t.kind !== 'vista'; });
      var here = '<div class="zhere"><div class="section-title">What\'s here</div>' + zoneContents(z, ws) + '</div>';
      var views = (core.length > 2
        ? '<div><div class="section-title">Layout</div>' + zoneLayoutSvg(z) + '</div><div><div class="section-title">Your path</div>' + zoneFogSvg(z) + '</div>'
        : '<div><div class="section-title">Your path <span class="cat">(fixed map: no tile layout in the save)</span></div>' + zoneFogSvg(z, 560) + '</div>') + here;
      return '<section class="panel zone" id="zone-' + z.id + '"><h3>' + esc(z.name) + wikiLink(z.name) + '</h3><p class="cat">' + esc(facts) + '</p>' +
        (links ? '<div class="chips">' + links + '</div>' : '') +
        '<div class="zviews">' + views + '</div>' +
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
      return '<tr><th>' + ico(w.name) + esc(w.name) + ' <span class="lvl">+' + w.level + '</span>' + (w.reloadBound ? ' <span class="cat">reload-bound</span>' : '') + '</th><td>' + now + '</td><td>' + top + '</td></tr>';
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
    // Light / dark theme, remembered in this browser (index.html applies it before the page draws).
    var showTheme = function () { $('theme').textContent = document.documentElement.dataset.theme === 'dark' ? '☀' : '☾'; };
    showTheme();
    $('theme').addEventListener('click', function () {
      var dark = document.documentElement.dataset.theme !== 'dark';
      if (dark) document.documentElement.dataset.theme = 'dark'; else delete document.documentElement.dataset.theme;
      store('theme', dark ? 'dark' : 'light');
      showTheme();
    });
    $('reload').addEventListener('click', function () { $('loader').hidden = false; $('drop').scrollIntoView({ behavior: 'smooth' }); });
    $('character').addEventListener('change', function (e) { state.charIndex = +e.target.value; store('char', state.charIndex); render(); });
    document.querySelector('.tabs').addEventListener('click', function (e) {
      var b = e.target.closest('.tab'); if (!b) return;
      // Remember how far down the section you leave was, and open the next one where you left it.
      if (document.body.classList.contains('loaded')) (savedView.scroll = savedView.scroll || {})[state.tab] = Math.round(window.scrollY);
      state.tab = b.dataset.tab;
      // Reopen on the last section with data, not on About.
      if (INFO_TABS.indexOf(state.tab) < 0) store('tab', state.tab);
      if (document.body.classList.contains('loaded')) { render(); restoreScroll(); } else showPage();
    });
    $('mode-switch').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      state.mode = b.dataset.mode; renderWorld();
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
    // Map: Adventure / Campaign / Ward 13 switch.
    $('map-view').addEventListener('click', function (e) {
      var b = e.target.closest('[data-map-mode]'); if (!b) return;
      state.mapMode = b.dataset.mapMode; renderMapTab();
    });
    // Links from tips to the map: switch to the Map tab, then jump to the area.
    // Items: have / don't have, type, mode, world, search; an item opens its panel on the side.
    $('items-search').addEventListener('input', renderItemsTab);
    $('items-view').addEventListener('click', function (e) {
      var s = e.target.closest('[data-show]');
      if (s) { state.itemsShow = s.dataset.show; renderItemsTab(); return; }
      var c = e.target.closest('.chip[data-v]');
      if (c) {
        var key = { 'items-types': 'itemsType', 'items-modes': 'itemsMode', 'items-worlds': 'itemsWorld' }[c.parentNode.id];
        var v = c.dataset.v === '__all' ? null : c.dataset.v;
        state[key] = state[key] === v ? null : v; renderItemsTab(); return;
      }
      var b = e.target.closest('[data-item]');
      if (b && !e.target.closest('a')) {
        state.itemSel = state.itemSel === b.dataset.item ? null : b.dataset.item;
        document.querySelectorAll('#items-view .ttile').forEach(function (x) { x.classList.toggle('sel', x.dataset.item === state.itemSel); });
        renderItemDrawer();
      }
    });
    $('item-drawer').addEventListener('click', function (e) {
      if (e.target.closest('[data-close-item]')) { state.itemSel = null; renderItemsTab(); }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.itemSel) { state.itemSel = null; renderItemsTab(); } });
    // Traits: have / don't have, type, and a trait opens its panel on the side.
    $('traits-view').addEventListener('click', function (e) {
      var s = e.target.closest('[data-show]');
      if (s) { state.traitsShow = s.dataset.show; renderTraitsTab(); return; }
      var t = e.target.closest('#traits-types [data-type]');
      if (t) { state.traitType = t.dataset.type || null; renderTraitsTab(); return; }
      var b = e.target.closest('[data-trait]');
      if (b) {
        state.traitSel = state.traitSel === b.dataset.trait ? null : b.dataset.trait;
        document.querySelectorAll('.ttile').forEach(function (x) { x.classList.toggle('sel', x.dataset.trait === state.traitSel); });
        renderTraitDrawer();
      }
    });
    $('trait-drawer').addEventListener('click', function (e) {
      if (e.target.closest('[data-close-trait]')) { state.traitSel = null; renderTraitsTab(); }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.traitSel) { state.traitSel = null; renderTraitsTab(); } });
    $('tips-view').addEventListener('click', function (e) {
      var a = e.target.closest('[data-goto-map]'); if (!a) return;
      e.preventDefault();
      // Show the map (campaign or adventure) the area belongs to.
      var ws = state.worldStates && state.worldStates[state.charIndex];
      var zone = ws && ws.zones ? ws.zones.filter(function (z) { return String(z.id) === a.dataset.gotoMap; })[0] : null;
      if (zone && zone.mode) state.mapMode = zone.mode;
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
  restoreInputs();
  if (savedView.dps) Object.keys(savedView.dps).forEach(function (k) { dpsOn[k] = savedView.dps[k]; });
  wire();
  // Keep what you change: after every click, typing or switch, and the scroll as you move.
  ['click', 'input', 'change'].forEach(function (t) { document.addEventListener(t, function () { setTimeout(saveView, 0); }, true); });
  var scrollTimer = null;
  window.addEventListener('scroll', function () { clearTimeout(scrollTimer); scrollTimer = setTimeout(saveView, 250); });
  window.addEventListener('beforeunload', saveView);
  showPage();
  tryAuto();
})();
