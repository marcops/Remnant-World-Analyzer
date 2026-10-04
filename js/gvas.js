// Reader for the property format Gunfire uses in Remnant: From the Ashes saves.
//
// A save (and every nested "PersistenceBlob" inside it) is laid out as
//   [u32 package version][u64 name table offset][u32 version][u64 object table offset]
//   then, for every object: [u32 index][u32 size][properties][u8 has components]
//   [u32 count][components: FString key, u32 size, properties]...
// Property and type names are u16 indexes into that save's own name table.
// The outer .sav file adds [u32 crc][u32 size][u32 version][u32 build] and the
// save class path in front. Offsets are relative to the start of each save/blob.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.RWA_GVAS = factory();
})(this, function () {
  'use strict';

  function Reader(bytes, pos) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = pos;
  }
  Reader.prototype = {
    u8: function () { return this.bytes[this.pos++]; },
    i8: function () { return this.view.getInt8(this.pos++); },
    u16: function () { var v = this.view.getUint16(this.pos, true); this.pos += 2; return v; },
    i32: function () { var v = this.view.getInt32(this.pos, true); this.pos += 4; return v; },
    u32: function () { var v = this.view.getUint32(this.pos, true); this.pos += 4; return v; },
    u64: function () { var lo = this.u32(), hi = this.u32(); return hi * 4294967296 + lo; },
    f32: function () { var v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; },
    str: function () {
      var len = this.i32(), s = '', i;
      if (len === 0) return '';
      if (len < 0) { // UTF-16
        for (i = 0; i < -len - 1; i++) s += String.fromCharCode(this.view.getUint16(this.pos + i * 2, true));
        this.pos += -len * 2;
      } else {
        for (i = 0; i < len - 1; i++) s += String.fromCharCode(this.bytes[this.pos + i]);
        this.pos += len;
      }
      return s;
    },
  };

  function toBytes(buffer) {
    if (buffer instanceof Uint8Array) return buffer;
    return new Uint8Array(buffer);
  }

  // Parses one save or nested blob starting at `base`; `outer` for the .sav file itself.
  function readSave(bytes, base, outer) {
    var r = new Reader(bytes, base);
    if (outer) r.pos += 16;
    r.u32();
    if (outer) r.str();
    var namesOff = r.u64(); r.u32(); var objOff = r.u64();
    var dataStart = r.pos;

    var nr = new Reader(bytes, base + namesOff), names = [], n = nr.u32(), i;
    for (i = 0; i < n; i++) names.push(nr.str());

    var or = new Reader(bytes, base + objOff), objects = [], on = or.u32();
    for (i = 0; i < on; i++) {
      var loaded = or.u8(), path = or.str();
      if (!loaded) or.pos += 10; // FName + outer object index of runtime-created objects
      objects.push({ path: path, props: null, comps: null });
    }

    var ctx = { bytes: bytes, names: names, objects: objects };
    r.pos = dataStart;
    for (i = 0; i < objects.length; i++) {
      var idx = r.u32(), size = r.u32(), start = r.pos;
      var obj = objects[idx] || {};
      obj.props = readProps(ctx, r, start + size);
      r.pos = start + size;
      obj.comps = {};
      if (r.u8()) {
        var cn = r.u32();
        for (var c = 0; c < cn; c++) {
          var key = r.str(), csz = r.u32(), c0 = r.pos;
          obj.comps[key] = readProps(ctx, r, c0 + csz);
          r.pos = c0 + csz;
        }
      }
    }
    return { objects: objects, names: names, root: objects[0] };
  }

  // Properties become a plain object { name: value }; repeated names (static arrays) become arrays.
  function readProps(ctx, r, end) {
    var out = {};
    while (r.pos < end) {
      var name = readName(ctx, r);
      if (name === 'None' || name === undefined) break;
      var type = readName(ctx, r), size = r.u32(); r.u32();
      var start = r.pos, value = readValue(ctx, r, type, size);
      if (name in out) out[name] = [].concat(out[name], [value]); else out[name] = value;
      if (r.pos < start) break;
    }
    return out;
  }

  // FName: u16 index into the name table; the high bit means an instance number follows (Name_10 is stored as Name + 11).
  function readName(ctx, r) {
    var i = r.u16();
    if (i & 0x8000) { var num = r.i32(); return ctx.names[i & 0x7fff] + (num > 0 ? '_' + (num - 1) : ''); }
    return ctx.names[i];
  }

  function objRef(ctx, i) { return i < 0 || !ctx.objects[i] ? null : ctx.objects[i]; }

  function readValue(ctx, r, type, size) {
    var N = function () { return readName(ctx, r); };
    var start, v;
    switch (type) {
      case 'IntProperty': r.u8(); return r.i32();
      case 'FloatProperty': r.u8(); return r.f32();
      case 'Int8Property': r.u8(); return r.i8();
      case 'Int16Property': r.u8(); v = r.view.getInt16(r.pos, true); r.pos += 2; return v;
      case 'UInt16Property': r.u8(); return r.u16();
      case 'UInt32Property': r.u8(); return r.u32();
      case 'Int64Property': case 'UInt64Property': r.u8(); return r.u64();
      case 'DoubleProperty': r.u8(); v = r.view.getFloat64(r.pos, true); r.pos += 8; return v;
      case 'BoolProperty': v = r.u8(); r.u8(); return !!v;
      case 'ByteProperty': v = N(); r.u8(); return v === 'None' ? r.u8() : N();
      case 'EnumProperty': N(); r.u8(); return N();
      case 'NameProperty': r.u8(); return N();
      case 'StrProperty': case 'SoftObjectProperty': r.u8(); return r.str();
      case 'ObjectProperty': r.u8(); return objRef(ctx, r.i32());
      case 'TextProperty': {
        r.u8(); start = r.pos; r.u32(); var h = r.i8(), t = null;
        if (h === 0) { r.str(); r.str(); t = r.str(); }
        // "No history": an optional culture-invariant string. Empty texts stop here; never read past the value.
        else if (h === -1 && start + size - r.pos >= 9 && r.u32() === 1) t = r.str();
        r.pos = start + size; return t;
      }
      case 'StructProperty': {
        var st = N(); r.pos += 16; r.u8(); start = r.pos;
        v = readStruct(ctx, r, st, start + size);
        r.pos = start + size; return v;
      }
      case 'ArrayProperty': {
        var inner = N(); r.u8(); start = r.pos;
        var count = r.u32(), items = [], i;
        if (inner === 'ByteProperty') { r.pos = start + size; return { bytes: count }; }
        if (inner === 'StructProperty') {
          N(); N(); var esz = r.u32(); r.u32(); var est = N(); r.pos += 16; r.u8();
          var e0 = r.pos;
          for (i = 0; i < count; i++) items.push(readStruct(ctx, r, est, e0 + esz));
        } else {
          for (i = 0; i < count; i++) items.push(readElem(ctx, r, inner));
        }
        r.pos = start + size; return items;
      }
      case 'MapProperty': {
        var kt = N(), vt = N(); r.u8(); start = r.pos; r.u32();
        var mn = r.u32(), map = [];
        for (var m = 0; m < mn; m++) map.push([readElem(ctx, r, kt), readElem(ctx, r, vt)]);
        r.pos = start + size; return map;
      }
      default: r.u8(); r.pos += size; return undefined;
    }
  }

  function readElem(ctx, r, type) {
    switch (type) {
      case 'IntProperty': return r.i32();
      case 'FloatProperty': return r.f32();
      case 'BoolProperty': case 'ByteProperty': return r.u8();
      case 'Int8Property': return r.i8();
      case 'UInt16Property': return r.u16();
      case 'UInt32Property': return r.u32();
      case 'Int64Property': case 'UInt64Property': return r.u64();
      case 'NameProperty': case 'EnumProperty': return readName(ctx, r);
      case 'StrProperty': case 'SoftObjectProperty': return r.str();
      case 'ObjectProperty': return objRef(ctx, r.i32());
      case 'StructProperty': return readProps(ctx, r, ctx.bytes.length);
      default: throw new Error('Unsupported element type ' + type);
    }
  }

  function readStruct(ctx, r, st, end) {
    switch (st) {
      case 'Guid': r.pos += 16; return null;
      case 'Vector': case 'Rotator': return [r.f32(), r.f32(), r.f32()];
      case 'DateTime': case 'Timespan': return r.u64();
      case 'SoftClassPath': case 'SoftObjectPath': return r.str();
      // A nested save; parsed on demand with readBlob().
      case 'PersistenceBlob': { var len = r.u32(); var at = r.pos; r.pos += len; return { blobAt: at, blobLength: len }; }
      default: return readProps(ctx, r, end);
    }
  }

  return {
    readFile: function (buffer) { return readSave(toBytes(buffer), 0, true); },
    readBlob: function (buffer, blob) { return readSave(toBytes(buffer), blob.blobAt, false); },
  };
});
