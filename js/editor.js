// Save editor: changes resource quantities and trait points in profile.sav.
//
// Numbers already in the file are overwritten in place. A resource the character still has in the bag
// but used up keeps no Quantity (default values aren't written): it gets one, a 17-byte IntProperty
// added before the end of its item data, and every size and offset around it grows by the same amount
// (the item's object, the character blob and its tables, the CharacterData property, the SavedCharacter
// object, the file's tables). Then the file size and the CRC32 in the header are written again, and the
// result is read back and checked before it is handed out.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./gvas.js'));
  else root.RWA_EDITOR = factory(root.RWA_GVAS);
})(this, function (GVAS) {
  'use strict';

  // What can be edited, in the order shown. Glowing Fragments are kept per character and per account.
  // A resource with its game path can be added to a bag that doesn't have it yet (a new character).
  var UP = '/Game/World_Base/Items/Resources/UpgradeResources/';
  var RESOURCES = [
    ['Resource_Scraps', 'Scrap'], ['Resource_Rare_Iron', 'Simple Iron', UP + 'Resource_Rare_Iron.Resource_Rare_Iron_C'],
    ['Resource_Rare_ForgedIron', 'Forged Iron', UP + 'Resource_Rare_ForgedIron.Resource_Rare_ForgedIron_C'],
    ['Resource_Rare_GalvanizedIron', 'Galvanized Iron', UP + 'Resource_Rare_GalvanizedIron.Resource_Rare_GalvanizedIron_C'],
    ['Resource_Rare_HardenedIron', 'Hardened Iron', UP + 'Resource_Rare_HardenedIron.Resource_Rare_HardenedIron_C'],
    ['Resource_Special_LumeniteCrystal', 'Lumenite Crystal', UP + 'Resource_Special_LumeniteCrystal.Resource_Special_LumeniteCrystal_C'],
    ['Resource_Special_Simulacrum', 'Simulacrum', UP + 'Resource_Special_Simulacrum.Resource_Special_Simulacrum_C'],
    ['Resource_Special_GlowingFragment', 'Glowing Fragment', '/Game/SurvivalMode/Items/Resources/Resource_Special_GlowingFragment.Resource_Special_GlowingFragment_C'],
    // Up to 3.
    ['Resource_Swamp_HardenedCarapace', 'Hardened Carapace', '/Game/World_Swamp/Items/Resources/WorldResources/Resource_Swamp_HardenedCarapace.Resource_Swamp_HardenedCarapace_C', 3],
  ];
  // Limits: scrap up to 9,999,999, every other resource 9,999 (the Hardened Carapace 3); trait points up to 2,000.
  var MAX = 9999, SCRAP_MAX = 9999999, TRAIT_MAX = 2000;
  function resource(key) { return RESOURCES.filter(function (r) { return r[0] === key; })[0] || null; }
  function maxOf(key) { var r = resource(key); return r && r[3] ? r[3] : key === 'Resource_Scraps' ? SCRAP_MAX : MAX; }

  var CRC_TABLE = (function () {
    var t = [], c, n, k;
    for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes, from) {
    var c = 0xFFFFFFFF;
    for (var i = from || 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function toBytes(buffer) { return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer); }
  function className(p) { return String(p && (p.path || p) || '').split('/').pop().split('.').pop().replace(/_C$/, ''); }

  // Everything the editor needs about one character of a profile.
  function locate(bytes, charIndex) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 8 || view.getUint32(4, true) !== bytes.length) throw new Error('This is not a profile.sav (size field does not match).');
    if (crc32(bytes, 4) !== view.getUint32(0, true)) throw new Error('profile.sav fails its own checksum: it may be damaged, so it is not edited.');
    var file = GVAS.readFile(bytes);
    var saved = (file.root.props.Characters || [])[charIndex];
    if (!saved || !saved.props || !saved.props.CharacterData) throw new Error('No character ' + (charIndex + 1) + ' in this profile.');
    var ref = saved.props.CharacterData, blob = GVAS.readBlob(bytes, ref);
    var items = ((blob.root.comps.Inventory || {}).Items) || [];
    var inBag = {};
    items.forEach(function (e) { if (e && e.ItemBP) inBag[className(e.ItemBP)] = e; });
    var account = (file.root.props.AccountCurrencies || []).filter(function (c) { return c && /GlowingFragment/.test(className(c.CurrencyType)); })[0];
    return { view: view, file: file, saved: saved, ref: ref, blob: blob, inBag: inBag, account: account, traits: blob.root.comps.Traits };
  }

  // The editable fields of a character: [{ key, label, value, max, note, editable }].
  function fields(buffer, charIndex) {
    var L = locate(toBytes(buffer), charIndex), out = [];
    RESOURCES.forEach(function (r) {
      var e = L.inBag[r[0]], inst = e && e.InstanceData;
      var has = inst && inst.props && inst.props.Quantity != null;
      out.push({
        key: r[0], label: r[1], max: maxOf(r[0]), editable: !!(inst && inst.props) || !!(!e && r[2]),
        value: has ? inst.props.Quantity : inst || (!e && r[2]) ? 0 : null,
        note: !e && r[2] ? 'not in your bag: saving adds it (up to ' + maxOf(r[0]) + ')' : !inst ? 'not in your bag yet: pick one up in the game first'
          : r[0] === 'Resource_Special_GlowingFragment' && L.account ? 'also the account’s Glowing Fragments' : r[3] ? 'up to ' + r[3] : '',
      });
    });
    var t = L.traits || {};
    // A character that never earned a trait point has none stored (default values aren't written): saving adds it.
    out.push({ key: 'TraitPoints', label: 'Trait points (earned)', value: t.TraitPoints || 0, min: t.TraitPointsSpent || 0, max: TRAIT_MAX,
      editable: !!t._at, note: (t.TraitPointsSpent || 0) + ' spent · the rest are free to spend in the game' });
    return out;
  }

  // A copy of the profile with `values` ({ key: number }) written in.
  function apply(buffer, charIndex, values) {
    var src = toBytes(buffer), L = locate(src, charIndex);
    var out = new Uint8Array(src), view = new DataView(out.buffer);
    var inserts = [], adds = [], newTraitPoints = null;
    var setInt = function (pos, v) { view.setInt32(pos, v, true); };
    var check = function (key, v, min, max) {
      if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v || v < min || v > max) throw new Error(key + ': ' + v + ' is not a whole number between ' + min + ' and ' + max + '.');
    };
    Object.keys(values).forEach(function (key) {
      var v = values[key];
      if (key === 'TraitPoints') {
        var t = L.traits;
        check('Trait points', v, t.TraitPointsSpent || 0, TRAIT_MAX);
        if (!t._at) throw new Error('No traits in this character.');
        if (!t._at.TraitPoints) { if (v > 0) newTraitPoints = v; return; }
        return setInt(t._at.TraitPoints.valuePos, v);
      }
      var r = resource(key) || [key, key], label = r[1];
      check(label, v, 0, maxOf(key));
      var e = L.inBag[key], inst = e && e.InstanceData;
      if (!e && r[2]) { if (v > 0) adds.push({ path: r[2], value: v }); return; }
      if (!inst || !inst.props) throw new Error(label + ' is not in the bag: pick one up in the game first.');
      if (inst.props._at.Quantity) setInt(inst.props._at.Quantity.valuePos, v);
      else if (v !== 0) inserts.push({ obj: inst, value: v });
      if (key === 'Resource_Special_GlowingFragment' && L.account && L.account._at.Quantity) setInt(L.account._at.Quantity.valuePos, v);
    });
    if (inserts.length) out = insertQuantities(out, L, inserts);
    view = new DataView(out.buffer);
    view.setUint32(4, out.length, true);
    view.setUint32(0, crc32(out, 4), true);
    adds.forEach(function (a) { out = addItem(out, charIndex, a.path, a.value); });
    if (newTraitPoints != null) out = addTraitPoints(out, charIndex, newTraitPoints);
    // Read it back: every value must be there and nothing else may have moved.
    var got = fields(out, charIndex), want = fields(src, charIndex);
    got.forEach(function (f, i) {
      var expect = f.key in values ? values[f.key] : want[i].value;
      if (f.value !== expect) throw new Error('Check failed for ' + f.label + ': ' + f.value + ' instead of ' + expect + '. Nothing was saved.');
    });
    return out;
  }

  // Adds a new resource to the bag, stored exactly like one already there (any resource with a quantity):
  // an Items[] element (ID, ItemBP, New, Hidden, EquipmentSlotIndex, InstanceData), two objects (the
  // item's class path, and its ItemInstanceData with the Quantity) in the character's object table and
  // data, the next item ID (IDGen keeps the last one handed out), and every size and offset around them.
  // The result is read back and checked before it is returned.
  function addItem(bytes, charIndex, path, qty) {
    var L = locate(bytes, charIndex), blob = L.blob, base = L.ref.blobAt;
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var inv = blob.root.comps.Inventory, items = inv.Items, idx = function (o) { return blob.objects.indexOf(o); };
    var tpl = null, k, i;
    for (k = 1; k < items.length && !tpl; k++) {
      var c = items[k], d = c.InstanceData;
      if (/^Resource_/.test(className(c.ItemBP)) && d && d._at && d._at.size === 23 && d.props.Quantity != null) tpl = c;
    }
    if (!tpl) throw new Error('No resource in the bag to copy the layout from: nothing was changed.');
    k = items.indexOf(tpl);
    var elem = bytes.slice(items[k - 1]._at.None + 2, tpl._at.None + 2), ev = new DataView(elem.buffer);
    var inst = tpl.InstanceData._at, instData = bytes.slice(inst.sizePos - 4, inst.start + inst.size + 1);
    // Object table: the template's instance entry and every instance-name number in use.
    var tableStart = base + blob._at.objOff, p = tableStart + 4, nObj = view.getUint32(tableStart, true), entries = [];
    for (i = 0; i < nObj; i++) {
      var at = p, loaded = bytes[p++], len = view.getInt32(p, true); p += 4 + len;
      if (!loaded) p += 10;
      entries.push({ at: at, end: p, loaded: loaded });
    }
    if (p !== base + blob._at.namesOff) throw new Error('Unexpected object table: nothing was changed.');
    var ti = idx(tpl.InstanceData), tc = idx(tpl.ItemBP);
    var instEntry = bytes.slice(entries[ti].at, entries[ti].end);
    var numbers = entries.filter(function (x) { return !x.loaded; }).map(function (x) { return view.getInt32(x.end - 8, true); });
    var number = Math.min.apply(null, numbers.filter(function (x) { return x > 0; })) - 1;
    var ci = nObj, ii = nObj + 1, id = inv.IDGen + 1;
    // The element's ID, ItemBP and InstanceData values, found by property name and type.
    var N = function (n) { return blob.names.indexOf(n); };
    var field = function (name, type) {
      for (var o = 0; o + 4 < elem.length; o++) if (ev.getUint16(o, true) === N(name) && ev.getUint16(o + 2, true) === N(type)) return o + 13;
      return -1;
    };
    var oId = field('ID', 'IntProperty'), oBP = field('ItemBP', 'ObjectProperty'), oIn = field('InstanceData', 'ObjectProperty');
    if (oId < 0 || oBP < 0 || oIn < 0 || ev.getInt32(oId, true) !== tpl.ID || ev.getInt32(oBP, true) !== tc || ev.getInt32(oIn, true) !== ti || instData.length !== 32) {
      throw new Error('Unexpected item layout: nothing was changed.');
    }
    ev.setInt32(oId, id, true); ev.setInt32(oBP, ci, true); ev.setInt32(oIn, ii, true);
    var dv = new DataView(instData.buffer); dv.setUint32(0, ii, true); dv.setInt32(21, qty, true);
    var classData = new Uint8Array(9); new DataView(classData.buffer).setUint32(0, ci, true);
    var pathBytes = new Uint8Array(path.length + 1); for (i = 0; i < path.length; i++) pathBytes[i] = path.charCodeAt(i) & 0xff;
    var classEntry = new Uint8Array(5 + pathBytes.length); classEntry[0] = 1; new DataView(classEntry.buffer).setInt32(1, pathBytes.length, true); classEntry.set(pathBytes, 5);
    new DataView(instEntry.buffer).setInt32(instEntry.length - 8, number, true);
    // Sizes and offsets.
    var sizePos = inv._at.Items.sizePos, countPos = sizePos + 11, eszPos = countPos + 8;
    var arrayEnd = sizePos + 11 + view.getUint32(sizePos, true);
    var firstProp = Math.min.apply(null, Object.keys(inv._at).filter(function (x) { return x !== 'None'; }).map(function (x) { return inv._at[x].sizePos - 4; }));
    if (view.getUint32(countPos, true) !== items.length || items[items.length - 1]._at.None + 2 !== arrayEnd || view.getUint32(firstProp - 4, true) !== inv._at.None + 6 - firstProp) {
      throw new Error('Unexpected inventory layout: nothing was changed.');
    }
    var dE = elem.length, dD = classData.length + instData.length, dT = classEntry.length + instEntry.length, total = dE + dD + dT;
    var out0 = new Uint8Array(bytes), v0 = new DataView(out0.buffer);
    var add32 = function (pos, d2) { v0.setUint32(pos, v0.getUint32(pos, true) + d2, true); };
    add32(sizePos, dE); add32(countPos, 1); add32(eszPos, dE); add32(firstProp - 4, dE);
    v0.setInt32(inv._at.IDGen.valuePos, id, true);
    v0.setUint32(tableStart, nObj + 2, true);
    add32(blob._at.objOffPos, dE + dD); add32(blob._at.namesOffPos, total);
    add32(base - 4, total); add32(L.saved.props._at.CharacterData.sizePos, total); add32(L.saved._at.sizePos, total);
    add32(L.file._at.objOffPos, total); add32(L.file._at.namesOffPos, total);
    var cuts = [arrayEnd, tableStart, base + blob._at.namesOff], parts = [elem, cat(classData, instData), cat(classEntry, instEntry)];
    var out = new Uint8Array(out0.length + total), from = 0, to = 0;
    cuts.forEach(function (c2, j) { out.set(out0.subarray(from, c2), to); to += c2 - from; from = c2; out.set(parts[j], to); to += parts[j].length; });
    out.set(out0.subarray(from), to);
    var ov = new DataView(out.buffer);
    ov.setUint32(4, out.length, true);
    ov.setUint32(0, crc32(out, 4), true);
    // Read back: one more item, the right one, a unique ID, every other item as it was.
    var M = locate(out, charIndex), after = M.blob.root.comps.Inventory.Items, added = after[after.length - 1];
    var same = items.every(function (x, n) { return after[n].ID === x.ID && String(after[n].ItemBP && after[n].ItemBP.path) === String(x.ItemBP && x.ItemBP.path); });
    if (after.length !== items.length + 1 || String(added.ItemBP.path) !== path || added.ID !== id || !same || !added.InstanceData ||
        added.InstanceData.props.Quantity !== qty || after.filter(function (x) { return x.ID === id; }).length !== 1 || M.blob.root.comps.Inventory.IDGen !== id) {
      throw new Error('Check failed after adding ' + className(path) + ': nothing was saved.');
    }
    return out;
  }
  function cat(a, b) { var c = new Uint8Array(a.length + b.length); c.set(a, 0); c.set(b, a.length); return c; }

  // Trait points for a character that has none stored: a TraitPoints IntProperty (17 bytes) added to the
  // Traits component, before its None, and — when the character's name table doesn't have "TraitPoints" yet —
  // that name added at the end of the table. Every size and offset around them grows to match; the result is
  // read back and checked before it is returned.
  function addTraitPoints(bytes, charIndex, value) {
    var L = locate(bytes, charIndex), blob = L.blob, base = L.ref.blobAt, t = L.traits;
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (!t || !t._at || t._at.TraitPoints) throw new Error('Unexpected traits: nothing was changed.');
    var names = blob.names, ii = names.indexOf('IntProperty'), ni = names.indexOf('TraitPoints');
    if (ii < 0 || ii > 0x7fff) throw new Error('This character has no number property to copy: nothing was changed.');
    // The names table: count, then FStrings; it must end the blob for a name to be added after it.
    var namesStart = base + blob._at.namesOff, p = namesStart + 4, count = view.getUint32(namesStart, true);
    for (var i = 0; i < count; i++) { var len = view.getInt32(p, true); p += 4 + (len < 0 ? -len * 2 : len); }
    var blobEnd = base + L.ref.blobLength;
    var nameBytes = new Uint8Array(0);
    if (ni < 0) {
      if (p !== blobEnd) throw new Error('Unexpected name table: nothing was changed.');
      var s = 'TraitPoints';
      nameBytes = new Uint8Array(4 + s.length + 1);
      new DataView(nameBytes.buffer).setInt32(0, s.length + 1, true);
      for (i = 0; i < s.length; i++) nameBytes[4 + i] = s.charCodeAt(i);
      ni = count;
    }
    if (ni > 0x7fff) throw new Error('Too many names: nothing was changed.');
    // The component's own size sits just before its first property (name + type: 4 bytes before its size field).
    var firstProp = Math.min.apply(null, Object.keys(t._at).filter(function (x) { return x !== 'None'; }).map(function (x) { return t._at[x].sizePos - 4; }));
    var at = t._at.None;
    if (view.getUint32(firstProp - 4, true) !== at + 6 - firstProp || at >= base + blob._at.objOff) throw new Error('Unexpected traits layout: nothing was changed.');
    var prop = new Uint8Array(17), pd = new DataView(prop.buffer);
    pd.setUint16(0, ni, true); pd.setUint16(2, ii, true); pd.setUint32(4, 4, true); pd.setUint32(8, 0, true); prop[12] = 0; pd.setInt32(13, value, true);
    var total = prop.length + nameBytes.length;
    var out0 = new Uint8Array(bytes), v0 = new DataView(out0.buffer);
    var add32 = function (pos, d) { v0.setUint32(pos, v0.getUint32(pos, true) + d, true); };
    add32(firstProp - 4, prop.length);
    add32(blob._at.objOffPos, prop.length); add32(blob._at.namesOffPos, prop.length);
    if (nameBytes.length) v0.setUint32(namesStart, count + 1, true);
    add32(base - 4, total); add32(L.saved.props._at.CharacterData.sizePos, total); add32(L.saved._at.sizePos, total);
    add32(L.file._at.objOffPos, total); add32(L.file._at.namesOffPos, total);
    var out = new Uint8Array(out0.length + total);
    out.set(out0.subarray(0, at), 0);
    out.set(prop, at);
    out.set(out0.subarray(at, blobEnd), at + prop.length);
    out.set(nameBytes, blobEnd + prop.length);
    out.set(out0.subarray(blobEnd), blobEnd + total);
    var ov = new DataView(out.buffer);
    ov.setUint32(4, out.length, true);
    ov.setUint32(0, crc32(out, 4), true);
    // Read back: the trait points are there, the traits and the bag as they were.
    var M = locate(out, charIndex);
    if (M.traits.TraitPoints !== value || JSON.stringify(M.traits.Traits) !== JSON.stringify(t.Traits) ||
        M.blob.root.comps.Inventory.Items.length !== blob.root.comps.Inventory.Items.length) {
      throw new Error('Check failed after adding the trait points: nothing was saved.');
    }
    return out;
  }

  // Adds a Quantity IntProperty to item data that has none, fixing every size and offset that spans it.
  function insertQuantities(bytes, L, inserts) {
    var names = L.blob.names, qi = names.indexOf('Quantity'), ii = names.indexOf('IntProperty');
    if (qi < 0 || ii < 0 || qi > 0x7fff || ii > 0x7fff) throw new Error('This character has no quantity on any item yet, so one can’t be added safely.');
    var delta = 17 * inserts.length;
    var file = L.file._at, blob = L.blob._at, saved = L.saved;
    var head = [file.namesOffPos, file.objOffPos, saved._at.sizePos, saved.props._at.CharacterData.sizePos, L.ref.blobAt - 4, blob.namesOffPos, blob.objOffPos];
    var spots = inserts.map(function (x) { return x.obj.props._at.None; });
    var first = Math.min.apply(null, spots), last = Math.max.apply(null, spots);
    // Everything we rewrite must sit before the inserts, and every table they point to after them.
    if (head.some(function (p) { return p >= first; }) || file.namesOff <= last || file.objOff <= last ||
        blob.base + blob.namesOff <= last || blob.base + blob.objOff <= last || last >= L.ref.blobAt + L.ref.blobLength) {
      throw new Error('Unexpected layout around the items: nothing was changed.');
    }
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var add32 = function (p, d) { view.setUint32(p, view.getUint32(p, true) + d, true); };
    add32(file.namesOffPos, delta); add32(file.objOffPos, delta);       // u64s: these stay far below 4 GB
    add32(saved._at.sizePos, delta);
    add32(saved.props._at.CharacterData.sizePos, delta);
    add32(L.ref.blobAt - 4, delta);
    add32(blob.namesOffPos, delta); add32(blob.objOffPos, delta);
    inserts.forEach(function (x) { add32(x.obj._at.sizePos, 17); });
    // name, type, size 4, array index 0, no guid, value
    var prop = function (v) {
      var p = new Uint8Array(17), d = new DataView(p.buffer);
      d.setUint16(0, qi, true); d.setUint16(2, ii, true); d.setUint32(4, 4, true); d.setUint32(8, 0, true); p[12] = 0; d.setInt32(13, v, true);
      return p;
    };
    var sorted = inserts.slice().sort(function (a, b) { return a.obj.props._at.None - b.obj.props._at.None; });
    var out = new Uint8Array(bytes.length + delta), from = 0, to = 0;
    sorted.forEach(function (x) {
      var at = x.obj.props._at.None;
      out.set(bytes.subarray(from, at), to); to += at - from; from = at;
      out.set(prop(x.value), to); to += 17;
    });
    out.set(bytes.subarray(from), to);
    return out;
  }

  return { fields: fields, apply: apply, crc32: crc32, RESOURCES: RESOURCES };
});
