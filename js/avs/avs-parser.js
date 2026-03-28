// AVS Binary Preset Parser
// Parses .avs binary files into JSON structures compatible with avs-engine.js
// Based on the Nullsoft AVS binary format and grandchild/AVS-File-Decoder.

const HEADER_V2 = 'Nullsoft AVS Preset 0.2\x1A';
const HEADER_V1 = 'Nullsoft AVS Preset 0.1\x1A';
const HEADER_LEN = 25;
const EFFECTLIST_CODE = 0xFFFFFFFE;
const BUILTIN_MAX = 16384;

// Component code → type name mapping
const COMPONENT_MAP = {
  0x00: 'Simple',
  0x01: 'DotPlane',
  0x02: 'OscilloscopeStar',
  0x03: 'FadeOut',
  0x04: 'BlitterFeedback',
  0x05: 'OnBeatClear',
  0x06: 'Blur',
  0x07: 'BassSpin',
  0x08: 'MovingParticle',
  0x09: 'RotoBlitter',
  0x0A: 'SVP',
  0x0B: 'ColorFade',
  0x0C: 'ColorClip',
  0x0D: 'RotatingStars',
  0x0E: 'Ring',
  0x0F: 'Movement',
  0x10: 'Scatter',
  0x11: 'DotGrid',
  0x12: 'BufferSave',
  0x13: 'DotFountain',
  0x14: 'Water',
  0x15: 'Comment',
  0x16: 'Brightness',
  0x17: 'Interleave',
  0x18: 'Grain',
  0x19: 'ClearScreen',
  0x1A: 'Mirror',
  0x1B: 'Starfield',
  0x1C: 'Text',
  0x1D: 'Bump',
  0x1E: 'Mosaic',
  0x1F: 'WaterBump',
  0x20: 'AVI',
  0x21: 'CustomBPM',
  0x22: 'Picture',
  0x23: 'DynamicDistanceModifier',
  0x24: 'SuperScope',
  0x25: 'Invert',
  0x26: 'UniqueTone',
  0x27: 'Timescope',
  0x28: 'SetRenderMode',
  0x29: 'Interferences',
  0x2A: 'DynamicShift',
  0x2B: 'DynamicMovement',
  0x2C: 'FastBrightness',
  0x2D: 'ColorModifier',
};

// Blend mode tables (indices differ for input vs output)
const BLEND_IN = ['IGNORE', 'REPLACE', 'FIFTY_FIFTY', 'MAXIMUM', 'ADDITIVE',
  'SUB_DEST_SRC', 'SUB_SRC_DEST', 'EVERY_OTHER_LINE', 'EVERY_OTHER_PIXEL',
  'XOR', 'ADJUSTABLE', 'MULTIPLY', 'BUFFER'];
const BLEND_OUT = ['REPLACE', 'IGNORE', 'MAXIMUM', 'FIFTY_FIFTY',
  'SUB_DEST_SRC', 'ADDITIVE', 'EVERY_OTHER_LINE', 'SUB_SRC_DEST',
  'XOR', 'EVERY_OTHER_PIXEL', 'MULTIPLY', 'ADJUSTABLE', '', 'BUFFER'];

// Built-in movement effect names
const MOVEMENT_EFFECTS = [
  'None', 'Slight Fuzzify', 'Shift Rotate Left', 'Big Swirl Out',
  'Medium Swirl', 'Sunburster', 'Squish', 'Chaos Dwarf',
  'Infinitely Zooming Shift Rotate', 'Tunnel', 'Gentle Zoom In',
  'Blocky Partial Out', 'Swirling Around Both Ways', 'User Defined',
  'Gentle Zoom Out', 'Swirl To Center', 'Starfish',
  'Yawning Rotation Left', 'Yawning Rotation Right',
  'Mild Zoom In With Slight Rotation', 'Drain', 'Super Drain',
  'Hyper Drain', 'Shift Down',
];

// ---- Low-level readers ----

class BinaryReader {
  constructor(buffer) {
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
    this.pos = 0;
    this.length = buffer.byteLength;
  }

  hasBytes(n) { return this.pos + n <= this.length; }

  uint32() {
    if (!this.hasBytes(4)) return 0;
    const v = this.view.getUint32(this.pos, true); // little-endian
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

  // Read a size-prefixed string (uint32 length, then bytes, null-terminated)
  sizeString() {
    const len = this.uint32();
    if (len <= 0 || !this.hasBytes(len)) return '';
    let end = this.pos;
    const limit = this.pos + len;
    while (end < limit && this.bytes[end] !== 0) end++;
    const str = this.decodeString(this.pos, end);
    this.pos = this.pos + len; // advance past full declared length
    return str;
  }

  // Read a fixed-size string (256 bytes, null-terminated)
  fixedString(size = 256) {
    if (!this.hasBytes(size)) return '';
    let end = this.pos;
    const limit = this.pos + size;
    while (end < limit && this.bytes[end] !== 0) end++;
    const str = this.decodeString(this.pos, end);
    this.pos += size;
    return str;
  }

  // Read a null-terminated string (no length prefix, scans for \0)
  ntString() {
    let end = this.pos;
    while (end < this.length && this.bytes[end] !== 0) end++;
    const str = this.decodeString(this.pos, end);
    this.pos = end + 1; // skip null terminator
    return str;
  }

  decodeString(start, end) {
    // Handle ASCII strings (most AVS code is ASCII)
    const bytes = this.bytes.slice(start, end);
    let str = '';
    for (let i = 0; i < bytes.length; i++) {
      str += String.fromCharCode(bytes[i]);
    }
    return str;
  }

  // Read color as #RRGGBB (AVS stores as 0x00BBGGRR little-endian)
  color() {
    const v = this.uint32();
    const r = v & 0xFF;
    const g = (v >> 8) & 0xFF;
    const b = (v >> 16) & 0xFF;
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }
}

// ---- Main parser ----

/**
 * Parse a binary .avs file into a JSON preset structure.
 * @param {ArrayBuffer} buffer — raw file bytes
 * @returns {object} — preset JSON compatible with avs-engine.js
 */
export function parseAvsFile(buffer) {
  const r = new BinaryReader(buffer);

  // Read and verify header (24 bytes: "Nullsoft AVS Preset 0.2\x1A")
  const headerBytes = r.decodeString(0, 24);
  if (!headerBytes.startsWith('Nullsoft AVS Preset 0.')) {
    throw new Error('Not a valid AVS preset file');
  }
  r.pos = 24; // skip past the 24-byte magic header

  // Clear frame flag (byte 24)
  const clearFrame = r.uint8() !== 0;

  // Parse the component stream (top level is an implicit EffectList)
  const components = parseComponents(r, r.length);

  return {
    name: 'AVS Preset',
    clearFrame,
    components,
  };
}

function parseComponents(r, endPos) {
  const components = [];

  while (r.pos <= endPos - 8 && r.hasBytes(8)) {
    const code = r.uint32();

    // Check if it's a DLL/APE component
    const isDll = (code !== EFFECTLIST_CODE && code >= BUILTIN_MAX);
    let dllId = '';
    if (isDll) {
      dllId = r.fixedString(32);
    }

    const size = r.uint32();
    const dataStart = r.pos;
    const dataEnd = Math.min(dataStart + size, endPos);

    if (code === EFFECTLIST_CODE) {
      const comp = parseEffectList(r, dataEnd);
      if (comp) components.push(comp);
    } else if (isDll) {
      const comp = parseDllComponent(dllId, r, dataEnd);
      if (comp) components.push(comp);
      r.pos = dataEnd;
    } else {
      const typeName = COMPONENT_MAP[code];
      if (typeName) {
        const comp = parseBuiltinComponent(code, typeName, r, dataEnd);
        if (comp) components.push(comp);
      }
      r.pos = dataEnd; // ensure we advance past component data
    }
  }

  return components;
}

// ---- EffectList (0xFFFFFFFE) ----

function parseEffectList(r, endPos) {
  if (!r.hasBytes(5)) { r.pos = endPos; return null; }

  const byte0 = r.uint8();
  const enabled = !(byte0 & 0x02);
  const clearFrame = !!(byte0 & 0x01);

  r.skip(1); // byte1 (duplicate)
  const inputBlend = r.uint8();
  const outputBlendRaw = r.uint8();
  const outputBlend = outputBlendRaw ^ 1; // XOR with 1

  const configSize = r.uint8();

  // Extended config (if configSize > 0)
  let enableOnBeat = false;
  let enableOnBeatFor = 1;
  if (configSize > 0 && r.hasBytes(32)) {
    r.skip(8);  // inAdjustBlend, outAdjustBlend
    r.skip(8);  // inBuffer, outBuffer
    r.skip(8);  // inBufferInvert, outBufferInvert
    enableOnBeat = r.uint32() !== 0;
    enableOnBeatFor = r.uint32();
  }

  // Check for AVS 2.8+ Effect List Config header
  // Skip it if present (36 bytes starting with 0x00 0x40)
  if (r.hasBytes(36)) {
    const marker1 = r.bytes[r.pos];
    const marker2 = r.bytes[r.pos + 1];
    if (marker1 === 0x00 && marker2 === 0x40) {
      r.skip(36); // skip the config header
      // Read code section: enabled flag + init + perFrame
      if (r.hasBytes(4)) {
        const codeEnabled = r.uint32();
        const initCode = r.sizeString();
        const perFrameCode = r.sizeString();
      }
    }
  }

  // Parse child components
  const children = parseComponents(r, endPos);

  return {
    type: 'EffectList',
    enabled,
    clearFrame,
    input: BLEND_IN[inputBlend] || 'IGNORE',
    output: BLEND_OUT[outputBlend] || 'REPLACE',
    enableOnBeat,
    enableOnBeatFor,
    components: children,
  };
}

// ---- Builtin component parsers ----

function parseBuiltinComponent(code, typeName, r, endPos) {
  switch (code) {
    case 0x24: return parseSuperScope(r, endPos);
    case 0x03: return parseFadeOut(r, endPos);
    case 0x0F: return parseMovement(r, endPos);
    case 0x2B: return parseDynamicMovement(r, endPos);
    case 0x19: return parseClearScreen(r, endPos);
    case 0x2D: return parseColorModifier(r, endPos);
    case 0x25: return parseInvert(r, endPos);
    case 0x1A: return parseMirror(r, endPos);
    case 0x06: return parseBlur(r, endPos);
    case 0x15: return parseComment(r, endPos);
    default:
      // Return a generic component with the type name so it's visible
      return { type: typeName, enabled: true, _unsupported: true };
  }
}

// ---- SuperScope (0x24) ----

function parseSuperScope(r, endPos) {
  const version = r.uint8();
  const isNew = (version === 1);

  let perPoint, perFrame, onBeat, init;
  if (isNew) {
    // New format: size-prefixed strings in order: perPoint, perFrame, onBeat, init
    perPoint = r.sizeString();
    perFrame = r.sizeString();
    onBeat = r.sizeString();
    init = r.sizeString();
  } else {
    // Legacy: 256-byte fixed strings
    r.pos--; // version byte is part of data in legacy mode
    perPoint = r.fixedString(256);
    perFrame = r.fixedString(256);
    onBeat = r.fixedString(256);
    init = r.fixedString(256);
  }

  // Audio channel/source byte
  let audioChannel = 'CENTER';
  let audioSource = 'WAVEFORM';
  if (r.pos < endPos && r.hasBytes(4)) {
    const channelByte = r.uint32();
    const ch = channelByte & 0x03;
    audioChannel = ['LEFT', 'RIGHT', 'CENTER'][ch] || 'CENTER';
    audioSource = (channelByte & 0x04) ? 'SPECTRUM' : 'WAVEFORM';
  }

  // Colors
  const colors = [];
  if (r.pos < endPos && r.hasBytes(4)) {
    const numColors = r.uint32();
    for (let i = 0; i < numColors && r.hasBytes(4); i++) {
      colors.push(r.color());
    }
  }

  // Draw mode
  let drawMode = 'LINES';
  if (r.pos < endPos && r.hasBytes(4)) {
    drawMode = r.uint32() === 0 ? 'DOTS' : 'LINES';
  }

  return {
    type: 'SuperScope',
    code: { init, perFrame, onBeat, perPoint },
    audioChannel,
    audioSource,
    colors: colors.length > 0 ? colors : ['#ffffff'],
    drawMode,
  };
}

// ---- FadeOut (0x03) ----

function parseFadeOut(r, endPos) {
  const speed = r.uint32();
  const color = r.color();
  return {
    type: 'FadeOut',
    speed: speed / 255, // normalize 0-255 to 0-1
    color,
  };
}

// ---- Movement (0x0F) ----

function parseMovement(r, endPos) {
  const dataSize = endPos - r.pos;

  // Read the effect index (old style)
  const effectId = r.uint32();

  let builtinEffect = 0;
  let code = '';
  let output = 'REPLACE';
  let sourceMapped = false;
  let coordinates = 0; // 0=POLAR, 1=CARTESIAN
  let bilinear = true;
  let wrap = false;

  if (effectId === 0x7FFF) {
    // Custom code
    if (r.hasBytes(1) && r.bytes[r.pos] === 1) {
      r.skip(1); // new version marker
      code = r.sizeString();
    } else {
      code = r.fixedString(256);
    }
    builtinEffect = 13; // "User Defined"
  } else if (effectId > 0 && effectId <= 23) {
    builtinEffect = effectId;
  }

  // Read remaining params if available
  if (r.pos + 20 <= endPos) {
    const rawOutput = r.uint32();
    sourceMapped = r.uint32() !== 0;
    coordinates = r.uint32();
    bilinear = r.uint32() !== 0;
    wrap = r.uint32() !== 0;
  }

  // If effectId was 0, check for effectIdNew at a specific offset
  if (effectId === 0 && !code) {
    builtinEffect = 0; // None
  }

  return {
    type: 'Movement',
    builtinEffect,
    code,
    sourceMapped,
    coordinates: coordinates === 1 ? 'CARTESIAN' : 'POLAR',
    bilinear,
    wrap,
  };
}

// ---- DynamicMovement (0x2B) ----

function parseDynamicMovement(r, endPos) {
  const version = r.uint8();
  const isNew = (version === 1);

  let perPoint, perFrame, onBeat, init;
  if (isNew) {
    perPoint = r.sizeString();
    perFrame = r.sizeString();
    onBeat = r.sizeString();
    init = r.sizeString();
  } else {
    r.pos--;
    perPoint = r.fixedString(256);
    perFrame = r.fixedString(256);
    onBeat = r.fixedString(256);
    init = r.fixedString(256);
  }

  let bilinear = true, coordinates = 0, gridW = 16, gridH = 16;
  let blend = false, wrap = true, buffer = 0, alphaOnly = false;

  if (r.hasBytes(32)) {
    bilinear = r.uint32() !== 0;
    coordinates = r.uint32();
    gridW = r.uint32();
    gridH = r.uint32();
    blend = r.uint32() !== 0;
    wrap = r.uint32() !== 0;
    buffer = r.uint32();
    alphaOnly = r.uint32() !== 0;
  }

  return {
    type: 'DynamicMovement',
    code: { init, perFrame, onBeat, perPoint },
    bFilter: bilinear,
    coord: coordinates === 1 ? 'CARTESIAN' : 'POLAR',
    gridW: Math.max(2, gridW + 1),
    gridH: Math.max(2, gridH + 1),
    blend,
    wrap,
    buffer,
    alphaOnly,
  };
}

// ---- ClearScreen (0x19) ----

function parseClearScreen(r, endPos) {
  let enabled = true;
  let color = '#000000';
  let clearMode = 0;
  let onBeatAction = 0;
  let onBeatColor = '#000000';

  if (r.hasBytes(4)) {
    enabled = r.uint32() !== 0;
  }
  if (r.hasBytes(4)) {
    color = r.color();
  }
  if (r.hasBytes(4)) {
    clearMode = r.uint32();
  }
  if (r.hasBytes(4)) {
    onBeatAction = r.uint32();
  }
  if (r.hasBytes(4)) {
    onBeatColor = r.color();
  }

  return {
    type: 'ClearScreen',
    enabled,
    color,
    clearMode,
    onBeatAction,
    onBeatColor,
  };
}

// ---- ColorModifier (0x2D) ----

function parseColorModifier(r, endPos) {
  const version = r.uint8();
  const isNew = (version === 1);

  let init, perFrame, onBeat;
  if (isNew) {
    // CodeIFB order: init, perFrame, onBeat
    init = r.sizeString();
    perFrame = r.sizeString();
    onBeat = r.sizeString();
  } else {
    r.pos--;
    init = r.fixedString(256);
    perFrame = r.fixedString(256);
    onBeat = r.fixedString(256);
  }

  return {
    type: 'ColorModifier',
    code: { init, perFrame, onBeat },
    _unsupported: true,
  };
}

// ---- Simple components ----

function parseInvert(r, endPos) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  return { type: 'Invert', enabled, _unsupported: true };
}

function parseMirror(r, endPos) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const mode = r.hasBytes(4) ? r.uint32() : 0;
  return { type: 'Mirror', enabled, mode, _unsupported: true };
}

function parseBlur(r, endPos) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const mode = r.hasBytes(4) ? r.uint32() : 0;
  return { type: 'Blur', enabled, mode, _unsupported: true };
}

function parseComment(r, endPos) {
  const dataSize = endPos - r.pos;
  let text = '';
  if (dataSize > 0) {
    text = r.decodeString(r.pos, Math.min(r.pos + dataSize, endPos));
  }
  r.pos = endPos;
  return { type: 'Comment', text, enabled: false };
}

// ---- DLL/APE components ----

function parseDllComponent(dllId, r, endPos) {
  const cleanId = dllId.replace(/\0/g, '').trim();
  return {
    type: cleanId || 'UnknownAPE',
    enabled: true,
    _unsupported: true,
    _apeId: cleanId,
  };
}

// ---- Public API ----

/**
 * Parse an .avs file and extract the preset name from the filename.
 */
export function parseAvsFileWithName(buffer, filename) {
  const preset = parseAvsFile(buffer);
  if (filename) {
    preset.name = filename.replace(/\.avs$/i, '');
  }
  return preset;
}
