// AVS Binary Preset Parser
// Parses .avs binary files into JSON structures compatible with avs-engine.js

import { BinaryReader } from './parsers/binary-reader.js';
import * as B from './parsers/builtin-parsers.js';
import * as A from './parsers/ape-parsers.js';

const EFFECTLIST_CODE = 0xFFFFFFFE;
const BUILTIN_MAX = 16384;

const COMPONENT_MAP = {
  0x00: 'Simple', 0x01: 'DotPlane', 0x02: 'OscilloscopeStar',
  0x03: 'FadeOut', 0x04: 'BlitterFeedback', 0x05: 'OnBeatClear',
  0x06: 'Blur', 0x07: 'BassSpin', 0x08: 'MovingParticle',
  0x09: 'RotoBlitter', 0x0A: 'SVP', 0x0B: 'ColorFade',
  0x0C: 'ColorClip', 0x0D: 'RotatingStars', 0x0E: 'Ring',
  0x0F: 'Movement', 0x10: 'Scatter', 0x11: 'DotGrid',
  0x12: 'BufferSave', 0x13: 'DotFountain', 0x14: 'Water',
  0x15: 'Comment', 0x16: 'Brightness', 0x17: 'Interleave',
  0x18: 'Grain', 0x19: 'ClearScreen', 0x1A: 'Mirror',
  0x1B: 'Starfield', 0x1C: 'Text', 0x1D: 'Bump',
  0x1E: 'Mosaic', 0x1F: 'WaterBump', 0x20: 'AVI',
  0x21: 'CustomBPM', 0x22: 'Picture', 0x23: 'DynamicDistanceModifier',
  0x24: 'SuperScope', 0x25: 'Invert', 0x26: 'UniqueTone',
  0x27: 'Timescope', 0x28: 'SetRenderMode', 0x29: 'Interferences',
  0x2A: 'DynamicShift', 0x2B: 'DynamicMovement',
  0x2C: 'FastBrightness', 0x2D: 'ColorModifier',
};

const BLEND_IN = ['IGNORE', 'REPLACE', 'FIFTY_FIFTY', 'MAXIMUM', 'ADDITIVE',
  'SUB_DEST_SRC', 'SUB_SRC_DEST', 'EVERY_OTHER_LINE', 'EVERY_OTHER_PIXEL',
  'XOR', 'ADJUSTABLE', 'MULTIPLY', 'BUFFER'];
const BLEND_OUT = ['REPLACE', 'IGNORE', 'MAXIMUM', 'FIFTY_FIFTY',
  'SUB_DEST_SRC', 'ADDITIVE', 'EVERY_OTHER_LINE', 'SUB_SRC_DEST',
  'XOR', 'EVERY_OTHER_PIXEL', 'MULTIPLY', 'ADJUSTABLE', '', 'BUFFER'];

// ---- Builtin component dispatch ----

const BUILTIN_PARSERS = {
  0x24: B.parseSuperScope, 0x03: B.parseFadeOut, 0x0F: B.parseMovement,
  0x2B: B.parseDynamicMovement, 0x00: B.parseSimple, 0x05: B.parseOnBeatClear,
  0x19: B.parseClearScreen, 0x2D: B.parseColorModifier, 0x25: B.parseInvert,
  0x1A: B.parseMirror, 0x06: B.parseBlur, 0x16: B.parseBrightness,
  0x2C: B.parseFastBrightness, 0x12: B.parseBufferSave, 0x1E: B.parseMosaic,
  0x15: B.parseComment, 0x0B: B.parseColorFade, 0x0C: B.parseColorClip,
  0x10: B.parseScatter, 0x17: B.parseInterleave, 0x18: B.parseGrain,
  0x26: B.parseUniqueTone, 0x04: B.parseBlitterFeedback, 0x09: B.parseRotoBlitter,
  0x0E: B.parseRing, 0x1B: B.parseStarfield, 0x11: B.parseDotGrid,
  0x01: B.parseDotPlane, 0x13: B.parseDotFountain, 0x07: B.parseBassSpin,
  0x0D: B.parseRotatingStars, 0x27: B.parseTimescope, 0x14: B.parseWater,
  0x1F: B.parseWaterBump, 0x1D: B.parseBump, 0x28: B.parseSetRenderMode,
  0x29: B.parseInterferences, 0x2A: B.parseDynamicShift,
  0x23: B.parseDynamicDistanceModifier, 0x22: B.parsePicture,
  0x08: B.parseMovingParticle,
};

// ---- APE/DLL component dispatch ----

function parseDllComponent(dllId, r, endPos) {
  const cleanId = dllId.replace(/\0/g, '').trim();

  if (cleanId === 'Channel Shift' || cleanId === 'Misc: Channel Shift') {
    return { type: 'ChannelShift', enabled: true, mode: r.hasBytes(4) ? r.uint32() : 0, onBeatMode: r.hasBytes(4) ? r.uint32() : 0 };
  }
  if (cleanId === 'Render: Triangle' || cleanId === 'Triangle') return A.parseTriangleAPE(r, endPos);
  if (cleanId === 'Texer') return A.parseTexerAPE(r, endPos);
  if (cleanId === 'Acko.net: Texer II') return A.parseTexer2APE(r, endPos);
  if (cleanId === 'Multiply' || cleanId === 'Multiplier') return { type: 'Multiplier', enabled: true, mode: r.hasBytes(4) ? r.uint32() : 0 };
  if (cleanId === 'Holden03: Convolution Filter' || (cleanId.startsWith('Holden') && cleanId.toLowerCase().includes('convolution'))) return A.parseConvolutionAPE(r, endPos);
  if (cleanId === 'Color Map') return A.parseColorMapAPE(r, endPos);
  if (cleanId === 'Picture II') return A.parsePicture2APE(r, endPos);
  if (cleanId.startsWith('Misc: AVSTrans') || cleanId === 'AVS Trans Automation') return A.parseEelTransAPE(r, endPos);
  if (cleanId === 'Jheriko: Global' || cleanId.includes('Global')) return A.parseGlobalVariablesAPE(r, endPos);

  return { type: cleanId || 'UnknownAPE', enabled: true, _unsupported: true, _apeId: cleanId };
}

// ---- EffectList parser ----

function parseEffectList(r, endPos) {
  if (!r.hasBytes(5)) { r.pos = endPos; return null; }

  // Mode byte: bit 0=clearfb, bit 1=!enabled, bit 7=has extended uint32
  // When bit 7 set: read next 4 bytes as uint32, OR into mode
  // mode bits 8-12 = blendin (5 bits), bits 16-20 = blendout^1 (5 bits)
  // bits 24-31 = extended data size
  let mode = r.uint8();
  if (mode & 0x80) {
    mode = (mode & ~0x80) | r.uint32();
  } else {
    // Legacy: bytes 1,2,3 are unused,blendin,blendout
    r.skip(1);
    const bi = r.uint8();
    const bo = r.uint8();
    mode = (mode & 0xFF) | (bi << 8) | (bo << 16);
  }

  const enabled = !!((mode & 2) ^ 2); // bit 1 set = disabled
  const clearFrame = !!(mode & 1);
  const inputBlend = (mode >> 8) & 31;
  const outputBlend = ((mode >> 16) & 31) ^ 1; // XOR 1 per original
  const extDataSize = (mode >> 24) & 0xFF;

  let enableOnBeat = false, enableOnBeatFor = 1;
  let inAdjust = 128, outAdjust = 128;
  let codeInit = '', codePerFrame = '', codeEnabled = false;

  if (extDataSize > 0) {
    if (r.hasBytes(extDataSize * 4)) {
      inAdjust = r.uint32();
      outAdjust = r.uint32();
      r.skip(16); // inBuffer, outBuffer, invert flags
      enableOnBeat = r.uint32() !== 0;
      enableOnBeatFor = r.uint32();
    }
    if (r.hasBytes(4)) {
      const marker = r.bytes[r.pos] | (r.bytes[r.pos + 1] << 8);
      if (marker === 0x4000) {
        r.skip(36);
        if (r.hasBytes(4)) {
          const codeSize = r.uint32();
          if (codeSize > 0 && r.hasBytes(codeSize)) {
            const codeEnd = r.pos + codeSize;
            codeEnabled = r.uint32() !== 0;
            codeInit = r.sizeString();
            codePerFrame = r.sizeString();
            r.pos = codeEnd;
          }
        }
      }
    }
  }

  const children = parseComponents(r, endPos);

  return {
    type: 'EffectList', enabled, clearFrame,
    input: BLEND_IN[inputBlend] || 'IGNORE',
    output: BLEND_OUT[outputBlend] || 'REPLACE',
    inAdjust, outAdjust,
    enableOnBeat, enableOnBeatFor,
    code: { enabled: codeEnabled, init: codeInit, perFrame: codePerFrame },
    components: children,
  };
}

// ---- Component stream parser ----

function parseComponents(r, endPos) {
  const components = [];

  while (r.pos <= endPos - 8 && r.hasBytes(8)) {
    const code = r.uint32();
    const isDll = (code !== EFFECTLIST_CODE && code >= BUILTIN_MAX);
    let dllId = '';
    if (isDll) {
      if (!r.hasBytes(32)) break;
      dllId = r.fixedString(32);
    }

    const size = r.uint32();
    const dataEnd = Math.min(r.pos + size, endPos);

    if (code === EFFECTLIST_CODE) {
      const comp = parseEffectList(r, dataEnd);
      if (comp) components.push(comp);
    } else if (isDll) {
      const comp = parseDllComponent(dllId, r, dataEnd);
      if (comp) components.push(comp);
      r.pos = dataEnd;
    } else {
      const parser = BUILTIN_PARSERS[code];
      if (parser) {
        const comp = parser(r, dataEnd);
        if (comp) components.push(comp);
      } else {
        const typeName = COMPONENT_MAP[code];
        if (typeName) components.push({ type: typeName, enabled: true, _unsupported: true });
      }
      r.pos = dataEnd;
    }
  }

  return components;
}

// ---- Public API ----

export function parseAvsFile(buffer) {
  const r = new BinaryReader(buffer);
  const headerBytes = r.decodeString(0, 24);
  if (!headerBytes.startsWith('Nullsoft AVS Preset 0.')) {
    throw new Error('Not a valid AVS preset file');
  }
  r.pos = 24;

  // Root EffectList uses the SAME load_config as nested ones (vis_avs r_list.cpp:1268).
  // Mode byte: bit 0=clearfb, bit 1=!enabled, bit 7=has extended uint32
  let mode = r.uint8();
  if (mode & 0x80) {
    mode = (mode & ~0x80) | r.uint32();
  }

  const clearFrame = !!(mode & 1);
  const extDataSize = (mode >> 24) & 0xFF;

  // Skip extended data fields if present (same as nested EffectList)
  // ext = get_extended_datasize() + 5 (the +5 accounts for the mode byte+uint32)
  if (extDataSize > 0) {
    // inblendval, outblendval, bufferin, bufferout, ininvert, outinvert, beat_render, beat_render_frames
    const extBytes = Math.min(extDataSize * 4, r.length - r.pos);
    r.skip(extBytes);

    // Check for the code section marker (0x4000) that may follow extended data
    // This is the APE-style embedded code section for the root EffectList
    if (r.hasBytes(4)) {
      const peek = r.bytes[r.pos] | (r.bytes[r.pos + 1] << 8) | (r.bytes[r.pos + 2] << 16) | (r.bytes[r.pos + 3] << 24);
      if (peek >= BUILTIN_MAX) {
        // This is an APE/DLL identifier for the code section — parse like nested EL
        r.skip(4); // effect_index (DLLRENDERBASE+)
        if (r.hasBytes(32)) r.skip(32); // DLL ID string
        if (r.hasBytes(4)) {
          const codeLen = r.uint32();
          if (codeLen > 0 && r.hasBytes(codeLen)) {
            r.skip(codeLen); // code section data
          }
        }
      }
    }
  }

  const components = parseComponents(r, r.length);
  return { name: 'AVS Preset', clearFrame, components };
}

export function parseAvsFileWithName(buffer, filename) {
  const preset = parseAvsFile(buffer);
  if (filename) preset.name = filename.replace(/\.avs$/i, '');
  return preset;
}
