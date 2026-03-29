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
      if (!r.hasBytes(32)) break; // boundary check for DLL ID
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

  // Byte 0: mode byte
  // bit 0 = clearFrame, bit 1 = !enabled, bit 7 = has extended config
  const byte0 = r.uint8();
  const enabled = !(byte0 & 0x02);
  const clearFrame = !!(byte0 & 0x01);
  const hasExtended = !!(byte0 & 0x80);

  r.skip(1); // byte 1 (unused)
  const inputBlend = r.uint8();  // byte 2
  const outputBlend = r.uint8(); // byte 3 (NOT XOR'd — direct index into BLEND_OUT)

  let enableOnBeat = false;
  let enableOnBeatFor = 1;
  let codeInit = '';
  let codePerFrame = '';
  let codeEnabled = false;

  if (hasExtended) {
    // Byte 4: config size (number of additional uint32 values)
    const configSize = r.uint8();

    // Extended config: 8 uint32 fields (32 bytes)
    if (configSize > 0 && r.hasBytes(configSize * 4)) {
      const inAdjust = r.uint32();
      const outAdjust = r.uint32();
      r.skip(4); // inBuffer
      r.skip(4); // outBuffer
      r.skip(4); // inBufferInvert
      r.skip(4); // outBufferInvert
      enableOnBeat = r.uint32() !== 0;
      enableOnBeatFor = r.uint32();
    }

    // Check for "AVS 2.8+ Effect List Config" header
    // Marker: uint32 0x00004000 followed by "AVS 2.8+ Effect List Config\0"
    if (r.hasBytes(4)) {
      const marker = r.bytes[r.pos] | (r.bytes[r.pos + 1] << 8);
      if (marker === 0x4000) {
        r.skip(36); // skip the 36-byte config header

        // Code section: uint32 size, then enabled + init + perFrame
        if (r.hasBytes(4)) {
          const codeSize = r.uint32();
          if (codeSize > 0 && r.hasBytes(codeSize)) {
            const codeEnd = r.pos + codeSize;
            codeEnabled = r.uint32() !== 0;
            codeInit = r.sizeString();
            codePerFrame = r.sizeString();
            r.pos = codeEnd; // ensure we advance past code section
          }
        }
      }
    }
  } else {
    r.skip(1); // byte 4 (no extended config)
  }

  // Everything remaining is the child component stream
  const children = parseComponents(r, endPos);

  return {
    type: 'EffectList',
    enabled,
    clearFrame,
    input: BLEND_IN[inputBlend] || 'IGNORE',
    output: BLEND_OUT[outputBlend] || 'REPLACE',
    enableOnBeat,
    enableOnBeatFor,
    code: { enabled: codeEnabled, init: codeInit, perFrame: codePerFrame },
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
    case 0x00: return parseSimple(r, endPos);
    case 0x05: return parseOnBeatClear(r, endPos);
    case 0x19: return parseClearScreen(r, endPos);
    case 0x2D: return parseColorModifier(r, endPos);
    case 0x25: return parseInvert(r, endPos);
    case 0x1A: return parseMirror(r, endPos);
    case 0x06: return parseBlur(r, endPos);
    case 0x16: return parseBrightness(r, endPos);
    case 0x2C: return parseFastBrightness(r, endPos);
    case 0x12: return parseBufferSave(r, endPos);
    case 0x1E: return parseMosaic(r, endPos);
    case 0x15: return parseComment(r, endPos);
    case 0x0B: return parseColorFade(r, endPos);
    case 0x0C: return parseColorClip(r, endPos);
    case 0x10: return parseScatter(r, endPos);
    case 0x17: return parseInterleave(r, endPos);
    case 0x18: return parseGrain(r, endPos);
    case 0x26: return parseUniqueTone(r, endPos);
    case 0x04: return parseBlitterFeedback(r, endPos);
    case 0x09: return parseRotoBlitter(r, endPos);
    case 0x0E: return parseRing(r, endPos);
    case 0x1B: return parseStarfield(r, endPos);
    case 0x11: return parseDotGrid(r, endPos);
    case 0x01: return parseDotPlane(r, endPos);
    case 0x13: return parseDotFountain(r, endPos);
    case 0x07: return parseBassSpin(r, endPos);
    case 0x0D: return parseRotatingStars(r, endPos);
    case 0x27: return parseTimescope(r, endPos);
    case 0x14: return parseWater(r, endPos);
    case 0x1F: return parseWaterBump(r, endPos);
    case 0x1D: return parseBump(r, endPos);
    case 0x28: return parseSetRenderMode(r, endPos);
    case 0x29: return parseInterferences(r, endPos);
    case 0x2A: return parseDynamicShift(r, endPos);
    case 0x23: return parseDynamicDistanceModifier(r, endPos);
    case 0x22: return parsePicture(r, endPos);
    case 0x08: return parseMovingParticle(r, endPos);
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
  };
}

// ---- Simple (0x00) — oscilloscope/spectrum ----

function parseSimple(r, endPos) {
  const effect = r.uint32();

  let audioSource, renderType;
  if (effect & (1 << 6)) {
    renderType = 'DOTS';
    audioSource = (effect & 2) ? 'WAVEFORM' : 'SPECTRUM';
  } else {
    switch (effect & 3) {
      case 0: audioSource = 'SPECTRUM'; renderType = 'SOLID'; break;
      case 1: audioSource = 'SPECTRUM'; renderType = 'LINES'; break;
      case 2: audioSource = 'WAVEFORM'; renderType = 'LINES'; break;
      case 3: audioSource = 'WAVEFORM'; renderType = 'SOLID'; break;
      default: audioSource = 'WAVEFORM'; renderType = 'LINES';
    }
  }

  const channelVal = (effect >> 2) & 3;
  const audioChannel = ['LEFT', 'RIGHT', 'CENTER'][channelVal] || 'CENTER';
  const posVal = (effect >> 4) & 3;
  const positionY = ['TOP', 'BOTTOM', 'CENTER'][posVal] || 'CENTER';

  const colors = [];
  if (r.hasBytes(4)) {
    const numColors = r.uint32();
    for (let i = 0; i < numColors && r.hasBytes(4); i++) {
      colors.push(r.color());
    }
  }

  return {
    type: 'Simple',
    audioSource,
    renderType,
    audioChannel,
    positionY,
    colors: colors.length > 0 ? colors : ['#ffffff'],
  };
}

// ---- OnBeatClear (0x05) ----

function parseOnBeatClear(r, endPos) {
  const color = r.hasBytes(4) ? r.color() : '#000000';
  const blendMode = r.hasBytes(4) ? r.uint32() : 0;
  const clearBeats = r.hasBytes(4) ? r.uint32() : 1;
  return { type: 'OnBeatClear', color, blendMode, clearBeats };
}

// ---- Brightness (0x16) ----

function parseBrightness(r, endPos) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const blend = r.hasBytes(4) ? r.uint32() : 0;
  const red = r.hasBytes(4) ? r.int32() : 0;
  const green = r.hasBytes(4) ? r.int32() : 0;
  const blue = r.hasBytes(4) ? r.int32() : 0;
  return { type: 'Brightness', enabled, blend, red, green, blue };
}

// ---- FastBrightness (0x2C) ----

function parseFastBrightness(r, endPos) {
  const mode = r.hasBytes(4) ? r.uint32() : 0;
  return { type: 'FastBrightness', mode };
}

// ---- BufferSave (0x12) ----

function parseBufferSave(r, endPos) {
  const action = r.hasBytes(4) ? r.uint32() : 0; // 0=save, 1=restore, 2=restoreEveryOther
  const buffer = r.hasBytes(4) ? r.uint32() : 0;
  const blendMode = r.hasBytes(4) ? r.uint32() : 0;
  const adjustBlend = r.hasBytes(4) ? r.uint32() : 128;
  return { type: 'BufferSave', action, buffer, blendMode, adjustBlend };
}

// ---- Mosaic (0x1E) ----

function parseMosaic(r, endPos) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const squareSize = r.hasBytes(4) ? r.uint32() : 8;
  const onBeatSquareSize = r.hasBytes(4) ? r.uint32() : 8;
  const onBeatDuration = r.hasBytes(4) ? r.uint32() : 1;
  return { type: 'Mosaic', enabled, squareSize, onBeatSquareSize, onBeatDuration };
}

// ---- Other components ----

function parseInvert(r, endPos) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  return { type: 'Invert', enabled };
}

function parseMirror(r, endPos) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const mode = r.hasBytes(4) ? r.uint32() : 0;
  return { type: 'Mirror', enabled, mode };
}

function parseBlur(r, endPos) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const mode = r.hasBytes(4) ? r.uint32() : 0;
  return { type: 'Blur', enabled, mode };
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

// ---- ColorClip (0x0C) ----

function parseColorClip(r, endPos) {
  const mode = r.hasBytes(4) ? r.uint32() : 0;
  const color_clip = r.hasBytes(4) ? r.color() : '#000000';
  const color_clip_out = r.hasBytes(4) ? r.color() : '#000000';
  const distance = r.hasBytes(4) ? r.uint32() : 0;
  return { type: 'ColorClip', enabled: true, mode, color_clip, color_clip_out, distance };
}

// ---- ColorFade (0x0B) ----

function parseColorFade(r, endPos) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const fader1 = [];
  const fader2 = [];
  const fader3 = [];
  // 3 faders x 3 channels (R,G,B) = 9 int32 values
  for (let i = 0; i < 3; i++) fader1.push(r.hasBytes(4) ? r.int32() : 0);
  for (let i = 0; i < 3; i++) fader2.push(r.hasBytes(4) ? r.int32() : 0);
  for (let i = 0; i < 3; i++) fader3.push(r.hasBytes(4) ? r.int32() : 0);
  return { type: 'ColorFade', enabled, fader1, fader2, fader3 };
}

// ---- Scatter (0x10) ----

function parseScatter(r, endPos) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  return { type: 'Scatter', enabled };
}

// ---- Interleave (0x17) ----

function parseInterleave(r, endPos) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const x = r.hasBytes(4) ? r.uint32() : 0;
  const y = r.hasBytes(4) ? r.uint32() : 0;
  const color = r.hasBytes(4) ? r.color() : '#000000';
  const blendMode = r.hasBytes(4) ? r.uint32() : 0;
  const onBeatX = r.hasBytes(4) ? r.uint32() : 0;
  const onBeatY = r.hasBytes(4) ? r.uint32() : 0;
  const onBeatDuration = r.hasBytes(4) ? r.uint32() : 1;
  return { type: 'Interleave', enabled, x, y, color, blendMode, onBeatX, onBeatY, onBeatDuration };
}

// ---- Grain (0x18) ----

function parseGrain(r, endPos) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const blendMode = r.hasBytes(4) ? r.uint32() : 1;
  const amount = r.hasBytes(4) ? r.uint32() : 50;
  return { type: 'Grain', enabled, blendMode, amount };
}

// ---- UniqueTone (0x26) ----

function parseUniqueTone(r, endPos) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const blendMode = r.hasBytes(4) ? r.uint32() : 0;
  const color = r.hasBytes(4) ? r.color() : '#ffffff';
  return { type: 'UniqueTone', enabled, blendMode, color };
}

// ---- BlitterFeedback (0x04) ----

function parseBlitterFeedback(r, endPos) {
  const scale = r.hasBytes(4) ? r.uint32() : 256;
  const onBeatScale = r.hasBytes(4) ? r.uint32() : 256;
  const blendMode = r.hasBytes(4) ? r.uint32() : 0;
  return { type: 'BlitterFeedback', enabled: true, scale, onBeatScale, blendMode };
}

// ---- RotoBlitter (0x09) ----

// ---- MovingParticle (0x08) ----
// Binary: enabled_and_flags(u32), color(u32), distance(u32), size(u32), onBeatSize(u32), blendMode(u32)

function parseMovingParticle(r, endPos) {
  const flags = r.hasBytes(4) ? r.uint32() : 1;
  const enabled = !!(flags & 1);
  const onBeatSizeChange = !!(flags & 2);

  // Color is stored as 0x00BBGGRR
  const colorRaw = r.hasBytes(4) ? r.uint32() : 0xffffff;
  const cr = colorRaw & 0xff;
  const cg = (colorRaw >> 8) & 0xff;
  const cb = (colorRaw >> 16) & 0xff;
  const color = '#' + ((1 << 24) | (cr << 16) | (cg << 8) | cb).toString(16).slice(1);

  const maxdist = r.hasBytes(4) ? r.uint32() : 16;
  const size = r.hasBytes(4) ? r.uint32() : 8;
  const size2 = r.hasBytes(4) ? r.uint32() : 8;
  const blend = r.hasBytes(4) ? r.uint32() : 1;

  return { type: 'MovingParticle', enabled, color, maxdist, size, size2, blend, onBeatSizeChange };
}

function parseRotoBlitter(r, endPos) {
  const zoom = r.hasBytes(4) ? r.uint32() : 256;
  const rotate = r.hasBytes(4) ? r.uint32() : 0;
  const blendMode = r.hasBytes(4) ? r.uint32() : 0;
  const onBeatZoom = r.hasBytes(4) ? r.uint32() : 256;
  const onBeatRotate = r.hasBytes(4) ? r.uint32() : 0;
  const bilinear = r.hasBytes(4) ? r.uint32() : 1;
  return { type: 'RotoBlitter', enabled: true, zoom, rotate, blendMode, onBeatZoom, onBeatRotate, bilinear };
}

// ---- Ring (0x0E) ----

function parseRing(r, endPos) {
  const audioSource = r.hasBytes(4) ? (r.uint32() === 0 ? 'WAVEFORM' : 'SPECTRUM') : 'WAVEFORM';
  // size is stored as uint32 but represents a float (AVS convention: divide by 256 or use as-is)
  const sizeRaw = r.hasBytes(4) ? r.uint32() : 128;
  const size = sizeRaw / 256;

  const colors = [];
  if (r.hasBytes(4)) {
    const numColors = r.uint32();
    for (let i = 0; i < numColors && r.hasBytes(4); i++) {
      colors.push(r.color());
    }
  }

  return {
    type: 'Ring',
    audioSource,
    size: Math.max(0.1, size),
    colors: colors.length > 0 ? colors : ['#ffffff'],
  };
}

// ---- Starfield (0x1B) ----

function parseStarfield(r, endPos) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const color = r.hasBytes(4) ? r.color() : '#ffffff';
  const numStars = r.hasBytes(4) ? r.uint32() : 350;
  const speed = r.hasBytes(4) ? r.uint32() : 16;
  const onBeatAction = r.hasBytes(4) ? r.uint32() : 0;
  const onBeatDuration = r.hasBytes(4) ? r.uint32() : 15;

  return {
    type: 'Starfield',
    enabled,
    color,
    numStars: Math.min(4096, numStars),
    speed,
    onBeatAction,
    onBeatDuration,
  };
}

// ---- DotGrid (0x11) ----

function parseDotGrid(r, endPos) {
  const numColors = r.hasBytes(4) ? r.uint32() : 1;
  const colors = [];
  for (let i = 0; i < numColors && i < 16 && r.hasBytes(4); i++) {
    colors.push(r.color());
  }
  const spacing = r.hasBytes(4) ? r.uint32() : 8;
  const xSpeed = r.hasBytes(4) ? r.uint32() : 0;
  const ySpeed = r.hasBytes(4) ? r.uint32() : 0;
  const blendMode = r.hasBytes(4) ? r.uint32() : 0;

  return {
    type: 'DotGrid',
    numColors,
    colors: colors.length > 0 ? colors : ['#ffffff'],
    spacing,
    xSpeed,
    ySpeed,
    blendMode,
  };
}

// ---- DotPlane (0x01) ----

function parseDotPlane(r, endPos) {
  const rotSpeed = r.hasBytes(4) ? r.uint32() : 16;
  const color = r.hasBytes(4) ? r.color() : '#ffffff';
  const angle = r.hasBytes(4) ? r.uint32() : 0;
  const style = r.hasBytes(4) ? r.uint32() : 0;

  return {
    type: 'DotPlane',
    rotSpeed,
    color,
    angle,
    style,
  };
}

// ---- DotFountain (0x13) ----

function parseDotFountain(r, endPos) {
  const rotSpeed = r.hasBytes(4) ? r.uint32() : 16;
  const color = r.hasBytes(4) ? r.color() : '#ff8800';
  const angle = r.hasBytes(4) ? r.uint32() : 0;
  const style = r.hasBytes(4) ? r.uint32() : 0;

  return {
    type: 'DotFountain',
    rotSpeed,
    color,
    angle,
    style,
  };
}

// ---- BassSpin (0x07) ----

function parseBassSpin(r, endPos) {
  const enabledLeft = r.hasBytes(4) ? r.uint32() : 1;
  const enabledRight = r.hasBytes(4) ? r.uint32() : 1;
  const colors = [];
  // Two colors: left channel, right channel
  colors.push(r.hasBytes(4) ? r.color() : '#ffffff');
  colors.push(r.hasBytes(4) ? r.color() : '#ffffff');
  const mode = r.hasBytes(4) ? r.uint32() : 0;

  return {
    type: 'BassSpin',
    enabledLeft,
    enabledRight,
    colors,
    mode,
  };
}

// ---- RotatingStars (0x0D) ----

function parseRotatingStars(r, endPos) {
  const numStars = r.hasBytes(4) ? r.uint32() : 1;
  const color = r.hasBytes(4) ? r.color() : '#ffffff';

  return {
    type: 'RotatingStars',
    numStars: Math.max(1, numStars),
    color,
  };
}

// ---- Timescope (0x27) ----

function parseTimescope(r, endPos) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const color = r.hasBytes(4) ? r.color() : '#ffffff';
  const blendMode = r.hasBytes(4) ? r.uint32() : 0;
  const bands = r.hasBytes(4) ? r.uint32() : 576;

  return {
    type: 'Timescope',
    enabled,
    color,
    blendMode,
    bands: Math.max(1, bands),
  };
}

// ---- Water (0x14) ----

function parseWater(r, endPos) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  return { type: 'Water', enabled };
}

// ---- WaterBump (0x1F) ----

function parseWaterBump(r, endPos) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const density = r.hasBytes(4) ? r.uint32() : 4;
  return { type: 'WaterBump', enabled, density };
}

// ---- Bump (0x1D) ----

function parseBump(r, endPos) {
  const version = r.uint8();
  const isNew = (version === 1);

  let init, perFrame, onBeat, perPoint;
  if (isNew) {
    // CodeIFBP order: init, perFrame, onBeat, perPoint
    init = r.sizeString();
    perFrame = r.sizeString();
    onBeat = r.sizeString();
    perPoint = r.sizeString();
  } else {
    r.pos--;
    init = r.fixedString(256);
    perFrame = r.fixedString(256);
    onBeat = r.fixedString(256);
    perPoint = r.fixedString(256);
  }

  let onBeatEnabled = false, depth = 30, blendMode = 0;
  if (r.hasBytes(4)) onBeatEnabled = r.uint32() !== 0;
  if (r.hasBytes(4)) depth = r.uint32();

  return {
    type: 'Bump',
    code: { init, perFrame, onBeat, perPoint },
    onBeat: onBeatEnabled,
    depth,
  };
}

// ---- SetRenderMode (0x28) ----

function parseSetRenderMode(r, endPos) {
  // g_line_blend_mode is a single packed uint32:
  //   bits 0-7:   blend mode index
  //   bits 8-15:  alpha value (0-255)
  //   bits 16-23: line size
  //   bit 31:     enabled flag
  const raw = r.hasBytes(4) ? r.uint32() : 0;
  const blend = raw & 0xff;
  const alpha = (raw >> 8) & 0xff;
  const lineSize = (raw >> 16) & 0xff;
  const enabled = !(raw & 0x80000000); // bit 31 set = disabled
  return { type: 'SetRenderMode', enabled, blend, alpha, lineSize: lineSize || 1 };
}

// ---- Interferences (0x29) ----

function parseInterferences(r, endPos) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const numLayers = r.hasBytes(4) ? r.uint32() : 2;
  const rotation = r.hasBytes(4) ? r.uint32() : 0;
  const distance = r.hasBytes(4) ? r.uint32() : 0;
  const alpha = r.hasBytes(4) ? r.uint32() : 128;
  const onBeatRotation = r.hasBytes(4) ? r.uint32() : 0;
  const onBeatDistance = r.hasBytes(4) ? r.uint32() : 0;
  return {
    type: 'Interferences',
    enabled, numLayers, rotation, distance, alpha,
    onBeatRotation, onBeatDistance,
  };
}

// ---- DynamicShift (0x2A) ----

function parseDynamicShift(r, endPos) {
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

  const blendMode = r.hasBytes(4) ? r.uint32() : 0;

  return {
    type: 'DynamicShift',
    code: { init, perFrame, onBeat },
    blendMode,
  };
}

// ---- DynamicDistanceModifier (0x23) ----

function parseDynamicDistanceModifier(r, endPos) {
  const version = r.uint8();
  const isNew = (version === 1);

  let perPoint, perFrame, onBeat, init;
  if (isNew) {
    // CodePFBI: perPoint, perFrame, onBeat, init
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

  return {
    type: 'DynamicDistanceModifier',
    code: { init, perFrame, onBeat, perPoint },
  };
}

// ---- Picture (0x22) ----

function parsePicture(r, endPos) {
  // Binary layout: enabled(u32), blend_additive(u32), blend_5050(u32),
  //   on_beat_additive(u32), on_beat_duration(u32), image(ntString),
  //   keep_aspect_ratio(u32), fit_height(u32)
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const blendAdditive = r.hasBytes(4) ? r.uint32() !== 0 : false;
  const blend5050 = r.hasBytes(4) ? r.uint32() !== 0 : false;
  const onBeatAdditive = r.hasBytes(4) ? r.uint32() !== 0 : false;
  const onBeatDuration = r.hasBytes(4) ? r.uint32() : 1;

  let imageSrc = '';
  if (r.pos < endPos) {
    imageSrc = r.ntString();
  }

  const keepAspect = (r.pos + 4 <= endPos) ? r.uint32() !== 0 : false;
  const fitHeight = (r.pos + 4 <= endPos) ? r.uint32() !== 0 : false;

  // Derive blend modes from flags
  let blendMode = 'REPLACE';
  if (blendAdditive) blendMode = 'ADDITIVE';
  else if (blend5050) blendMode = 'FIFTY_FIFTY';

  let onBeatBlendMode = blendMode;
  if (onBeatAdditive) onBeatBlendMode = 'ADDITIVE';

  return { type: 'Picture', enabled, blendMode, onBeatBlendMode, imageSrc, onBeatDuration, keepAspect };
}

// ---- DLL/APE components ----

function parseDllComponent(dllId, r, endPos) {
  const cleanId = dllId.replace(/\0/g, '').trim();

  // Channel Shift APE
  if (cleanId === 'Channel Shift' || cleanId === 'Misc: Channel Shift') {
    const mode = r.hasBytes(4) ? r.uint32() : 0;
    const onBeatMode = r.hasBytes(4) ? r.uint32() : 0;
    return { type: 'ChannelShift', enabled: true, mode, onBeatMode };
  }

  // Triangle APE
  if (cleanId === 'Render: Triangle' || cleanId === 'Triangle') {
    return parseTriangleAPE(r, endPos);
  }

  // Texer APE
  if (cleanId === 'Texer') {
    return parseTexerAPE(r, endPos);
  }

  // Texer II APE (Acko.net)
  if (cleanId === 'Acko.net: Texer II') {
    return parseTexer2APE(r, endPos);
  }

  // Multiplier APE
  if (cleanId === 'Multiply' || cleanId === 'Multiplier') {
    const mode = r.hasBytes(4) ? r.uint32() : 0;
    return { type: 'Multiplier', enabled: true, mode };
  }

  // Convolution Filter APE (Holden03)
  if (cleanId === 'Holden03: Convolution Filter' || (cleanId.startsWith('Holden') && cleanId.toLowerCase().includes('convolution'))) {
    return parseConvolutionAPE(r, endPos);
  }

  // Color Map APE
  if (cleanId === 'Color Map') {
    return parseColorMapAPE(r, endPos);
  }

  return {
    type: cleanId || 'UnknownAPE',
    enabled: true,
    _unsupported: true,
    _apeId: cleanId,
  };
}

// ---- Triangle APE (Render: Triangle) ----
// Format: NtCodeIFBP — 4 null-terminated strings

function parseTriangleAPE(r, endPos) {
  const result = {
    type: 'Triangle',
    code: { init: '', perFrame: '', onBeat: '', perPoint: '' },
  };
  try {
    if (r.pos < endPos) result.code.init = r.ntString();
    if (r.pos < endPos) result.code.perFrame = r.ntString();
    if (r.pos < endPos) result.code.onBeat = r.ntString();
    if (r.pos < endPos) result.code.perPoint = r.ntString();
  } catch {}
  return result;
}

// ---- Texer APE ----
// Binary layout (after DLL ID + size header already consumed):
//   uint32 version (0 or 1)
//   null-terminated image filename string
//   Size-prefixed code strings (init, perFrame, onBeat, perPoint)
//   Trailing flags: wrap(uint32), resize(uint32)

function parseTexerAPE(r, endPos) {
  const result = {
    type: 'Texer',
    enabled: true,
    imageSrc: '',
    code: { init: '', perFrame: '', onBeat: '', perPoint: '' },
    wrap: false,
    resize: false,
  };

  try {
    if (!r.hasBytes(1)) return result;

    // Some Texer versions start with a version/enabled uint32.
    // Peek: if the first byte is 0 or 1 and the next three are zero,
    // treat it as a uint32 version field.
    const firstByte = r.bytes[r.pos];

    if (firstByte <= 1 && r.hasBytes(4) &&
        r.bytes[r.pos + 1] === 0 && r.bytes[r.pos + 2] === 0 && r.bytes[r.pos + 3] === 0) {
      r.uint32(); // skip version/enabled
    }

    // Read image source filename (null-terminated)
    if (r.pos < endPos) {
      result.imageSrc = r.ntString();
    }

    // Try to read code strings (size-prefixed)
    if (r.pos + 4 <= endPos) {
      result.code.init = r.sizeString();
    }
    if (r.pos + 4 <= endPos) {
      result.code.perFrame = r.sizeString();
    }
    if (r.pos + 4 <= endPos) {
      result.code.onBeat = r.sizeString();
    }
    if (r.pos + 4 <= endPos) {
      result.code.perPoint = r.sizeString();
    }

    // Trailing flags
    if (r.pos + 4 <= endPos) {
      result.wrap = r.uint32() !== 0;
    }
    if (r.pos + 4 <= endPos) {
      result.resize = r.uint32() !== 0;
    }
  } catch {
    // If parsing fails, return with empty code — the component will still render
    // using the gaussian blob fallback with default behavior.
  }

  return result;
}

// ---- Texer II APE (Acko.net: Texer II) ----
// Binary layout (after DLL ID + size header already consumed):
//   uint32 version
//   null-terminated image filename string
//   uint32 resize flag
//   uint32 wrap flag
//   uint32 color filtering mode
//   Code sections: init, perFrame, onBeat, perPoint (size-prefixed strings)

function parseTexer2APE(r, endPos) {
  const result = {
    type: 'Acko.net: Texer II',
    enabled: true,
    imageSrc: '',
    code: { init: '', perFrame: '', onBeat: '', perPoint: '' },
    wrap: false,
    resize: false,
    colorFilter: 0,
  };

  try {
    if (!r.hasBytes(4)) return result;

    // Version
    const version = r.uint32();

    // Image source — null-terminated string
    if (r.pos < endPos) {
      result.imageSrc = r.ntString();
    }

    // Flags
    if (r.pos + 4 <= endPos) {
      result.resize = r.uint32() !== 0;
    }
    if (r.pos + 4 <= endPos) {
      result.wrap = r.uint32() !== 0;
    }
    if (r.pos + 4 <= endPos) {
      result.colorFilter = r.uint32();
    }

    // Code sections (size-prefixed strings)
    if (r.pos + 4 <= endPos) {
      result.code.init = r.sizeString();
    }
    if (r.pos + 4 <= endPos) {
      result.code.perFrame = r.sizeString();
    }
    if (r.pos + 4 <= endPos) {
      result.code.onBeat = r.sizeString();
    }
    if (r.pos + 4 <= endPos) {
      result.code.perPoint = r.sizeString();
    }
  } catch {
    // If parsing fails, return with empty code — the fallback blob will render
  }

  return result;
}

// ---- Color Map APE ----
// Binary: header(16), 8 map headers(60 each), then color stops(12 each)

function parseColorMapAPE(r, endPos) {
  const KEY_NAMES = ['RED', 'GREEN', 'BLUE', '(R+G+B)/2', 'MAX', '(R+G+B)/3'];
  const BLEND_NAMES = ['REPLACE', 'ADDITIVE', 'MAXIMUM', 'MINIMUM', '5050',
    'SUB1', 'SUB2', 'MULTIPLY', 'XOR', 'ADJUSTABLE'];
  const CYCLE_NAMES = ['NONE', 'BEAT_RANDOM', 'BEAT_SEQUENTIAL'];

  const result = {
    type: 'ColorMap',
    enabled: true,
    key: 'RED',
    blendMode: 'REPLACE',
    mapCycleMode: 'NONE',
    adjustableAlpha: 128,
    dontSkipFastBeats: false,
    mapCycleSpeed: 8,
    maps: [],
    currentMap: 0,
  };

  try {
    // Header (16 bytes)
    const colorKey = r.hasBytes(4) ? r.uint32() : 0;
    result.key = KEY_NAMES[colorKey] || 'RED';

    const blendmode = r.hasBytes(4) ? r.uint32() : 0;
    result.blendMode = BLEND_NAMES[blendmode] || 'REPLACE';

    const cycleMode = r.hasBytes(4) ? r.uint32() : 0;
    result.mapCycleMode = CYCLE_NAMES[cycleMode] || 'NONE';

    if (r.hasBytes(4)) {
      result.adjustableAlpha = r.uint8();
      r.skip(1); // unused
      result.dontSkipFastBeats = r.uint8() !== 0;
      result.mapCycleSpeed = r.uint8() || 8;
    }

    // 8 map headers (60 bytes each)
    const mapHeaders = [];
    for (let m = 0; m < 8; m++) {
      const enabled = r.hasBytes(4) ? r.uint32() !== 0 : false;
      const numColors = r.hasBytes(4) ? r.uint32() : 0;
      const mapId = r.hasBytes(4) ? r.uint32() : 0;
      const filepath = r.hasBytes(48) ? r.fixedString(48) : '';
      mapHeaders.push({ enabled, numColors, filepath });
    }

    // Color stops
    for (let m = 0; m < 8; m++) {
      const colors = [];
      for (let c = 0; c < mapHeaders[m].numColors; c++) {
        if (r.pos + 12 > endPos) break;
        const position = r.uint32();
        const colorRaw = r.uint32();
        r.skip(4); // color_id (ignored)
        // Color is 0x00RRGGBB
        const cr = (colorRaw >> 16) & 0xff;
        const cg = (colorRaw >> 8) & 0xff;
        const cb = colorRaw & 0xff;
        const hex = '#' + ((1 << 24) | (cr << 16) | (cg << 8) | cb).toString(16).slice(1);
        colors.push({ position, color: hex });
      }
      result.maps.push({
        enabled: mapHeaders[m].enabled,
        colors: colors.length > 0 ? colors : [
          { position: 0, color: '#000000' },
          { position: 255, color: '#ffffff' },
        ],
      });
    }
  } catch {
    // Partial parse
  }

  // Default if no maps
  if (result.maps.length === 0) {
    result.maps.push({
      enabled: true,
      colors: [
        { position: 0, color: '#000000' },
        { position: 255, color: '#ffffff' },
      ],
    });
  }

  return result;
}

// ---- Convolution Filter APE (Holden03: Convolution Filter) ----
// Binary layout: enabled(u32), wrap(u32), absolute(u32), twoPass(u32),
//   kernel[49](u32 each), bias(u32), scale(u32), saveFile(remaining bytes)

function parseConvolutionAPE(r, endPos) {
  const result = {
    type: 'Holden03: Convolution Filter',
    enabled: true,
    wrap: false,
    absolute: false,
    twoPass: false,
    kernel: new Array(49).fill(0),
    bias: 0,
    scale: 1,
  };

  try {
    if (r.pos + 4 <= endPos) result.enabled = r.uint32() !== 0;
    if (r.pos + 4 <= endPos) result.wrap = r.uint32() !== 0;
    if (r.pos + 4 <= endPos) result.absolute = r.uint32() !== 0;
    if (r.pos + 4 <= endPos) result.twoPass = r.uint32() !== 0;

    // 49 kernel values (signed int32)
    for (let i = 0; i < 49; i++) {
      if (r.pos + 4 <= endPos) {
        result.kernel[i] = r.int32();
      }
    }

    if (r.pos + 4 <= endPos) result.bias = r.int32();
    if (r.pos + 4 <= endPos) result.scale = r.int32();
    // Remaining bytes = save file path (ignore)
  } catch {
    // Partial parse is fine
  }

  return result;
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
