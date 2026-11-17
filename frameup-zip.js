// FrameUp tiny ZIP writer. Stores files uncompressed ("stored", method 0):
// JPEG and PNG are already compressed, so deflate would only cost time.
// No dependencies; works in the browser (window.FrameUpZip) and in Node
// (module.exports) so the tests can check the bytes.
//
//   FrameUpZip.zip([{ name: 'a.jpeg', data: Uint8Array, date: Date }]) -> Uint8Array
//
// Limits: classic ZIP (no ZIP64), so each file and the whole archive must
// stay under 4 GB and 65,535 entries. Size packs are a few MB.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FrameUpZip = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // MS-DOS date/time, local time, 2-second resolution (years 1980–2107).
  function dosDateTime(date) {
    const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const year = Math.min(2107, Math.max(1980, d.getFullYear()));
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }

  function utf8(text) {
    return new TextEncoder().encode(String(text));
  }

  // Safe names inside the archive: no folders that climb out, no absolute paths.
  function cleanName(name) {
    const parts = String(name || '').replace(/\\/g, '/').split('/')
      .filter(part => part && part !== '.' && part !== '..');
    return parts.join('/') || 'file';
  }

  function zip(files) {
    if (!Array.isArray(files) || !files.length) throw new Error('Nothing to zip.');
    const used = new Set();
    const entries = files.map(file => {
      let name = cleanName(file.name);
      // Same name twice would be ambiguous: add -2, -3… before the extension.
      if (used.has(name)) {
        const dot = name.lastIndexOf('.');
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : '';
        let n = 2;
        while (used.has(`${stem}-${n}${ext}`)) n++;
        name = `${stem}-${n}${ext}`;
      }
      used.add(name);
      const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data || 0);
      return { nameBytes: utf8(name), data, crc: crc32(data), stamp: dosDateTime(file.date) };
    });

    const localSize = entries.reduce((sum, e) => sum + 30 + e.nameBytes.length + e.data.length, 0);
    const centralSize = entries.reduce((sum, e) => sum + 46 + e.nameBytes.length, 0);
    if (localSize + centralSize + 22 > 0xFFFFFFFF || entries.length > 0xFFFF) throw new Error('Too large for a ZIP file.');
    const out = new Uint8Array(localSize + centralSize + 22);
    const view = new DataView(out.buffer);
    let at = 0;
    const offsets = [];

    entries.forEach(e => {
      offsets.push(at);
      view.setUint32(at, 0x04034B50, true); // local file header
      view.setUint16(at + 4, 20, true); // version needed
      view.setUint16(at + 6, 0x0800, true); // flags: UTF-8 names
      view.setUint16(at + 8, 0, true); // method: stored
      view.setUint16(at + 10, e.stamp.time, true);
      view.setUint16(at + 12, e.stamp.date, true);
      view.setUint32(at + 14, e.crc, true);
      view.setUint32(at + 18, e.data.length, true);
      view.setUint32(at + 22, e.data.length, true);
      view.setUint16(at + 26, e.nameBytes.length, true);
      view.setUint16(at + 28, 0, true);
      out.set(e.nameBytes, at + 30);
      out.set(e.data, at + 30 + e.nameBytes.length);
      at += 30 + e.nameBytes.length + e.data.length;
    });

    const centralStart = at;
    entries.forEach((e, i) => {
      view.setUint32(at, 0x02014B50, true); // central directory header
      view.setUint16(at + 4, 20, true); // made by
      view.setUint16(at + 6, 20, true); // version needed
      view.setUint16(at + 8, 0x0800, true);
      view.setUint16(at + 10, 0, true);
      view.setUint16(at + 12, e.stamp.time, true);
      view.setUint16(at + 14, e.stamp.date, true);
      view.setUint32(at + 16, e.crc, true);
      view.setUint32(at + 20, e.data.length, true);
      view.setUint32(at + 24, e.data.length, true);
      view.setUint16(at + 28, e.nameBytes.length, true);
      // extra, comment, disk, internal attrs, external attrs stay 0
      view.setUint32(at + 42, offsets[i], true);
      out.set(e.nameBytes, at + 46);
      at += 46 + e.nameBytes.length;
    });

    view.setUint32(at, 0x06054B50, true); // end of central directory
    view.setUint16(at + 8, entries.length, true);
    view.setUint16(at + 10, entries.length, true);
    view.setUint32(at + 12, at - centralStart, true);
    view.setUint32(at + 16, centralStart, true);
    return out;
  }

  return Object.freeze({ zip, crc32, cleanName, dosDateTime });
});
