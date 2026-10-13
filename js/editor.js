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
  var RESOURCES = [
    ['Resource_Scraps', 'Scrap'], ['Resource_Rare_Iron', 'Simple Iron'], ['Resource_Rare_ForgedIron', 'Forged Iron'],
    ['Resource_Rare_GalvanizedIron', 'Galvanized Iron'], ['Resource_Rare_HardenedIron', 'Hardened Iron'],
    ['Resource_Special_LumeniteCrystal', 'Lumenite Crystal'], ['Resource_Special_Simulacrum', 'Simulacrum'],
    ['Resource_Special_GlowingFragment', 'Glowing Fragment'],
  ];
  // Limits: what the game showed fine when tried (scrap 999,999; every other resource 999); trait points up to 2,000.
  var MAX = 999, SCRAP_MAX = 999999, TRAIT_MAX = 2000;
  function maxOf(key) { return key === 'Resource_Scraps' ? SCRAP_MAX : MAX; }

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
        key: r[0], label: r[1], max: maxOf(r[0]), editable: !!(inst && inst.props),
        value: has ? inst.props.Quantity : inst ? 0 : null,
        note: !inst ? 'not in your bag yet: pick one up in the game first' : r[0] === 'Resource_Special_GlowingFragment' && L.account ? 'also the account’s Glowing Fragments' : '',
      });
    });
    var t = L.traits || {};
    out.push({ key: 'TraitPoints', label: 'Trait points (earned)', value: t.TraitPoints || 0, min: t.TraitPointsSpent || 0, max: TRAIT_MAX,
      editable: !!(t._at && t._at.TraitPoints), note: (t.TraitPointsSpent || 0) + ' spent · the rest are free to spend in the game' });
    return out;
  }

  // A copy of the profile with `values` ({ key: number }) written in.
  function apply(buffer, charIndex, values) {
    var src = toBytes(buffer), L = locate(src, charIndex);
    var out = new Uint8Array(src), view = new DataView(out.buffer);
    var inserts = [];
    var setInt = function (pos, v) { view.setInt32(pos, v, true); };
    var check = function (key, v, min, max) {
      if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v || v < min || v > max) throw new Error(key + ': ' + v + ' is not a whole number between ' + min + ' and ' + max + '.');
    };
    Object.keys(values).forEach(function (key) {
      var v = values[key];
      if (key === 'TraitPoints') {
        var t = L.traits;
        check('Trait points', v, t.TraitPointsSpent || 0, TRAIT_MAX);
        if (!t._at.TraitPoints) throw new Error('No trait points in this character.');
        return setInt(t._at.TraitPoints.valuePos, v);
      }
      var label = (RESOURCES.filter(function (r) { return r[0] === key; })[0] || [key, key])[1];
      check(label, v, 0, maxOf(key));
      var e = L.inBag[key], inst = e && e.InstanceData;
      if (!inst || !inst.props) throw new Error(label + ' is not in the bag: pick one up in the game first.');
      if (inst.props._at.Quantity) setInt(inst.props._at.Quantity.valuePos, v);
      else if (v !== 0) inserts.push({ obj: inst, value: v });
      if (key === 'Resource_Special_GlowingFragment' && L.account && L.account._at.Quantity) setInt(L.account._at.Quantity.valuePos, v);
    });
    if (inserts.length) out = insertQuantities(out, L, inserts);
    view = new DataView(out.buffer);
    view.setUint32(4, out.length, true);
    view.setUint32(0, crc32(out, 4), true);
    // Read it back: every value must be there and nothing else may have moved.
    var got = fields(out, charIndex), want = fields(src, charIndex);
    got.forEach(function (f, i) {
      var expect = f.key in values ? values[f.key] : want[i].value;
      if (f.value !== expect) throw new Error('Check failed for ' + f.label + ': ' + f.value + ' instead of ' + expect + '. Nothing was saved.');
    });
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
