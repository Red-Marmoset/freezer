// Low-level binary reader for AVS preset files
// Reads little-endian integers, strings, and colors from an ArrayBuffer.

export class BinaryReader {
  constructor(buffer) {
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
    this.pos = 0;
    this.length = buffer.byteLength;
  }

  hasBytes(n) { return this.pos + n <= this.length; }

  uint32() {
    if (!this.hasBytes(4)) return 0;
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  int32() {
    if (!this.hasBytes(4)) return 0;
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  uint8() {
    if (!this.hasBytes(1)) return 0;
    return this.bytes[this.pos++];
  }

  skip(n) { this.pos += n; }

  sizeString() {
    const len = this.uint32();
    if (len <= 0 || !this.hasBytes(len)) return '';
    let end = this.pos;
    const limit = this.pos + len;
    while (end < limit && this.bytes[end] !== 0) end++;
    const str = this.decodeString(this.pos, end);
    this.pos = this.pos + len;
    return str;
  }

  fixedString(size = 256) {
    if (!this.hasBytes(size)) return '';
    let end = this.pos;
    const limit = this.pos + size;
    while (end < limit && this.bytes[end] !== 0) end++;
    const str = this.decodeString(this.pos, end);
    this.pos += size;
    return str;
  }

  ntString() {
    let end = this.pos;
    while (end < this.length && this.bytes[end] !== 0) end++;
    const str = this.decodeString(this.pos, end);
    this.pos = end + 1;
    return str;
  }

  decodeString(start, end) {
    const bytes = this.bytes.slice(start, end);
    let str = '';
    for (let i = 0; i < bytes.length; i++) {
      str += String.fromCharCode(bytes[i]);
    }
    return str;
  }

  color() {
    const v = this.uint32();
    const r = v & 0xFF;
    const g = (v >> 8) & 0xFF;
    const b = (v >> 16) & 0xFF;
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }
}
