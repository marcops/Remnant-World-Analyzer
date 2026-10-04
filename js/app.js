/* global RWA_DATA, RWA_PARSER */
(function () {
  'use strict';

  var DATA = RWA_DATA, P = RWA_PARSER;
  var $ = function (id) { return document.getElementById(id); };

  var WORLD_LABEL = { Earth: 'Terra', Rhom: 'Rhom', Corsus: 'Corsus', Yaesha: 'Yaesha', Reisum: 'Reisum',
    'Ward 13': 'Ward 13', 'Ward 17': 'Ward 17', 'Ward Prime': 'Ward Prime', 'The Labyrinth': 'Labirinto', '': 'Geral / conquistas' };
  var WORLD_ORDER = ['Earth', 'Rhom', 'Corsus', 'Yaesha', 'Reisum', 'Ward 13', 'Ward 17', 'Ward Prime', 'The Labyrinth', ''];
  var TYPE_LABEL = { 'World Boss': 'Chefe', 'Miniboss': 'Mini-chefe', 'Side Dungeon': 'Masmorra', 'Siege': 'Cerco',
    'Point of Interest': 'Ponto de interesse', 'Item Drop': 'Item', 'Loot Beetle': 'Besouro', 'Home': 'Base', 'Quest Event': 'Evento' };
  var CATEGORIES = ['Arma', 'Armadura', 'Amuleto', 'Anel', 'Mod', 'Trait', 'Emote', 'Skin', 'Consumível'];
  // Skins and consumables are not stored as unlocks in the profile, so we can't tell if you have them.
  var UNTRACKED = { 'Skin': true, 'Consumível': true };

  var state = {
    auto: false, dir: '', listing: null,
    files: {},          // name -> ArrayBuffer
    characters: [],     // from profile.sav
    charIndex: null,
    tab: 'world', mode: 'campaign',
    worldZones: {}, worldTypes: {}, missingCats: {}, missingWorld: null,
  };
  P.ZONES.forEach(function (z) { state.worldZones[z] = true; });
  Object.keys(TYPE_LABEL).forEach(function (t) { state.worldTypes[t] = true; });
  CATEGORIES.forEach(function (c) { state.missingCats[c] = !UNTRACKED[c]; });

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
    if (!files.length) return showLoadError('Nenhum arquivo .sav encontrado. Escolha o save_N.sav e o profile.sav.');
    Promise.all(files.map(function (f) {
      return readFile(f).then(function (buf) {
        var name = f.name.toLowerCase();
        if (/profile/.test(name)) name = 'profile.sav';
        else if (saveIndexOf(name) == null) name = 'save_' + nextFreeIndex() + '.sav'; // renamed copy
        state.files[name] = buf;
      });
    })).then(function () {
      rebuild();
      if (state.charIndex == null && !state.characters.length) return showLoadError('Não achei nenhum save de mundo (save_N.sav) nos arquivos escolhidos.');
      showApp();
    }).catch(function (e) { showLoadError('Erro lendo os arquivos: ' + e); });
  }
  function nextFreeIndex() { var i = 0; while (state.files['save_' + i + '.sav']) i++; return i; }

  function showLoadError(msg) { var el = $('load-error'); el.textContent = msg; el.hidden = !msg; }

  // Automatic mode: the page is served by server.ps1 (Iniciar.bat), which can read the save folder.
  function api(path) { return fetch(path, { cache: 'no-store' }); }
  function tryAuto() {
    if (location.protocol === 'file:') return;
    api('api/saves').then(function (r) { return r.ok ? r.json() : null; }).then(function (info) {
      if (!info) return;
      state.auto = true;
      state.dir = info.dir;
      if (!info.found) {
        setStatus('Pasta de saves não encontrada: ' + info.dir, false);
        showLoadError('O servidor não achou a pasta de saves em ' + info.dir + '. Arraste os arquivos manualmente ou rode o Iniciar.bat com o caminho certo.');
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
      setStatus('Automático · ' + state.dir + ' · atualizado às ' + new Date().toLocaleTimeString(), true);
      if (state.charIndex != null || state.characters.length) showApp();
      return true;
    });
  }

  function poll() {
    api('api/saves').then(function (r) { return r.json(); }).then(function (info) {
      if (info.found) return syncFromServer(info.files);
    }).catch(function () { setStatus('Servidor parado — feche e abra o Iniciar.bat de novo', false); });
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
    if (!state.auto) setStatus('Manual · arquivos carregados às ' + new Date().toLocaleTimeString(), false);
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
      var label = 'Personagem ' + (i + 1) + (c ? ' — ' + c.archetype : '') + ' (save_' + i + '.sav' + (hasSave ? '' : ', não carregado') + ')';
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
    if (owned === true) return '<span class="st ok" title="Já tenho">✔</span>';
    if (owned === false) return '<span class="st miss" title="Falta">✘</span>';
    return '<span class="st unk" title="Desconhecido">?</span>';
  }

  function itemOwned(it) { return UNTRACKED[it.category] ? null : state.owns(it); }

  function itemDetails(it, extra) {
    var meta = [it.category, it.world && WORLD_LABEL[it.world] !== undefined ? WORLD_LABEL[it.world] : it.world, it.mode && 'Modo: ' + it.mode, it.dlc && 'DLC: ' + it.dlc]
      .filter(Boolean).join(' · ');
    return '<details class="item"><summary>' + statusIcon(itemOwned(it)) + ' ' + esc(it.name) +
      (it.category ? '<span class="cat">' + esc(it.category) + '</span>' : '') + (extra || '') + '</summary>' +
      '<div class="how">' + (it.how ? esc(it.how) : '<i>Sem descrição na planilha.</i>') +
      (meta ? '<div class="meta">' + esc(meta) + '</div>' : '') + '</div></details>';
  }

  function chip(label, on, attrs) { return '<span class="chip' + (on ? ' on' : '') + '" ' + attrs + '>' + esc(label) + '</span>'; }

  function renderWorld() {
    var save = current();
    var seg = $('mode-switch');
    if (!save) { seg.innerHTML = ''; $('world-body').innerHTML = ''; return showEmpty('Escolha um personagem com save carregado.'); }
    if (save.error) { $('world-body').innerHTML = ''; return showEmpty('Não consegui ler ' + save.file + ': ' + save.error); }
    if (state.mode === 'adventure' && !save.adventure) state.mode = 'campaign';
    if (state.mode === 'campaign' && !save.campaign && save.adventure) state.mode = 'adventure';
    seg.innerHTML = [['campaign', save.campaign], ['adventure', save.adventure]].map(function (p) {
      if (!p[1]) return '';
      var label = p[1].label + (p[1].world ? ' — ' + p[1].world : '');
      return '<button data-mode="' + p[0] + '" class="' + (state.mode === p[0] ? 'active' : '') + '">' + esc(label) + '</button>';
    }).join('');

    $('world-zones').innerHTML = P.ZONES.map(function (z) { return chip(WORLD_LABEL[z], state.worldZones[z], 'data-zone="' + z + '"'); }).join('');
    $('world-types').innerHTML = Object.keys(TYPE_LABEL).map(function (t) { return chip(TYPE_LABEL[t], state.worldTypes[t], 'data-type="' + esc(t) + '"'); }).join('');

    var block = save[state.mode];
    if (!block) {
      $('world-body').innerHTML = '';
      return showEmpty('Nenhuma campanha ou aventura encontrada neste save. Se você acabou de criar o personagem, termine o tutorial e use o cristal para viajar antes de analisar.');
    }
    var q = $('world-search').value.trim().toLowerCase();
    var onlyMissing = $('world-only-missing').checked;
    var rows = [], lastZone = null, shown = 0;
    block.events.forEach(function (ev) {
      if (!state.worldZones[ev.zone] || !state.worldTypes[ev.type]) return;
      var items = ev.items.map(itemForPath);
      if (onlyMissing && !items.some(function (it) { return itemOwned(it) === false; })) return;
      if (q && (ev.name + ' ' + ev.location + ' ' + items.map(function (i) { return i.name; }).join(' ')).toLowerCase().indexOf(q) === -1) return;
      if (ev.zone !== lastZone) { rows.push('<tr class="zone-row"><td colspan="4">' + esc(WORLD_LABEL[ev.zone]) + '</td></tr>'); lastZone = ev.zone; }
      shown++;
      rows.push('<tr><td class="loc">' + esc(ev.location) + '</td><td class="type"><span class="type-badge">' + esc(TYPE_LABEL[ev.type] || ev.type) +
        '</span></td><td class="name">' + esc(ev.name) + '</td><td>' +
        (items.length ? items.map(function (it) { return itemDetails(it); }).join('') : '<span class="cat">—</span>') + '</td></tr>');
    });
    $('world-body').innerHTML = rows.join('');
    if (shown) $('world-empty').hidden = true; else showEmpty('Nada com esses filtros.');
  }

  function showEmpty(msg) { var el = $('world-empty'); el.textContent = msg; el.hidden = false; }

  function renderMissing() {
    var hasProfile = !!character();
    var q = $('missing-search').value.trim().toLowerCase();
    var onlyNow = $('missing-only-now').checked;
    var showOwned = $('missing-show-owned').checked || !hasProfile;

    $('missing-cats').innerHTML = CATEGORIES.map(function (c) {
      return chip(c + (UNTRACKED[c] ? ' (não rastreável)' : ''), state.missingCats[c], 'data-cat="' + esc(c) + '"');
    }).join('');

    var stats = {};
    WORLD_ORDER.forEach(function (w) { stats[w] = { total: 0, missing: 0, now: 0 }; });
    var groups = {};
    DATA.items.forEach(function (it) {
      if (!state.missingCats[it.category]) return;
      var w = WORLD_LABEL[it.world] !== undefined ? it.world : '';
      var owned = itemOwned(it);
      var key = itemKeyForAvailability(it);
      var where = key && state.available[key];
      if (!UNTRACKED[it.category]) {
        stats[w].total++;
        if (owned === false) { stats[w].missing++; if (where) stats[w].now++; }
      }
      if (state.missingWorld != null && state.missingWorld !== w) return;
      if (owned === true && !showOwned) return;
      if (onlyNow && !where) return;
      if (q && (it.name + ' ' + it.how + ' ' + it.group).toLowerCase().indexOf(q) === -1) return;
      (groups[w] = groups[w] || []).push({ it: it, owned: owned, where: where });
    });

    $('summary').innerHTML = WORLD_ORDER.filter(function (w) { return stats[w].total; }).map(function (w) {
      var s = stats[w], pct = s.total ? Math.round(100 * (s.total - s.missing) / s.total) : 0;
      var big = hasProfile ? (s.missing ? 'falta ' + s.missing : 'completo') : s.total + ' itens';
      return '<button class="card' + (state.missingWorld === w ? ' on' : '') + '" data-world="' + esc(w) + '">' +
        '<div class="w">' + esc(WORLD_LABEL[w]) + '</div>' +
        '<div class="n' + (!hasProfile ? ' neutral' : !s.missing ? ' done' : '') + '">' + esc(big) + '</div>' +
        (hasProfile ? '<div class="of">' + (s.total - s.missing) + ' de ' + s.total + ' itens</div>' : '<div class="of">carregue o profile.sav</div>') +
        (hasProfile && s.now ? '<div class="now">' + s.now + ' dá para pegar agora</div>' : '') +
        (hasProfile ? '<div class="bar"><i style="width:' + pct + '%"></i></div>' : '') + '</button>';
    }).join('');

    var html = WORLD_ORDER.filter(function (w) { return groups[w]; }).map(function (w) {
      var list = groups[w].sort(function (a, b) { return (a.where ? 0 : 1) - (b.where ? 0 : 1) || a.it.category.localeCompare(b.it.category) || a.it.name.localeCompare(b.it.name); });
      return '<div class="group"><h3>' + esc(WORLD_LABEL[w]) + ' <small>' + list.length + ' itens</small></h3>' + list.map(function (row) {
        var it = row.it;
        var tags = (row.where ? '<span class="tag now">disponível agora</span>' : '') +
          (it.mode ? '<span class="tag mode">' + esc(it.mode) + '</span>' : '') + (it.dlc ? '<span class="tag">' + esc(it.dlc) + '</span>' : '');
        var where = row.where ? '<div class="where">No seu mundo: ' + row.where.map(function (x) {
          return esc(x.block + ' → ' + x.location + ' (' + x.event + ')');
        }).join(' · ') + '</div>' : '';
        return '<div class="mrow">' + itemDetails(it, tags) + where + '</div>';
      }).join('') + '</div>';
    }).join('');
    $('missing-list').innerHTML = html || '<div class="empty">' + (hasProfile ? 'Nada faltando com esses filtros. 🎉' : 'Nada com esses filtros.') + '</div>';
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
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { $('copy-path').textContent = 'Copiado!'; }, function () {});
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
    $('missing-cats').addEventListener('click', function (e) { var c = e.target.closest('.chip'); if (c) { state.missingCats[c.dataset.cat] = !state.missingCats[c.dataset.cat]; renderMissing(); } });
    $('summary').addEventListener('click', function (e) {
      var c = e.target.closest('.card'); if (!c) return;
      state.missingWorld = state.missingWorld === c.dataset.world ? null : c.dataset.world; renderMissing();
    });
    ['world-search', 'world-only-missing'].forEach(function (id) { $(id).addEventListener('input', renderWorld); });
    ['missing-search', 'missing-only-now', 'missing-show-owned'].forEach(function (id) { $(id).addEventListener('input', renderMissing); });
  }

  wire();
  tryAuto();
})();
