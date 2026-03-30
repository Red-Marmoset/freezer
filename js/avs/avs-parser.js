// AVS Binary Preset Parser
// Parses .avs binary files into JSON structures compatible with avs-engine.js

import { BinaryReader } from './parsers/binary-reader.js';
import * as B from './parsers/builtin-parsers.js';
import * as A from './parsers/ape-parsers.js';

const EFFECTLIST_CODE = 0xFFFFFFFE;
const BUILTIN_MAX = 16384;

const COMPONENT_MAP = {
  0x00: 'Simple', 0x01: 'DotPlane', 0x02: 'OscStar',
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
  0x23: B.parseDynamicDistanceModifier, 0x22: B.parsePicture, 0x1C: B.parseText,
  0x08: B.parseMovingParticle,
  0x02: B.parseOscStar, 0x2C: B.parseFastBrightness, 0x21: B.parseCustomBPM,
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
  if (cleanId === 'Jheriko : MULTIFILTER' || cleanId.toLowerCase().includes('multifilter')) {
    const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
    const effect = r.hasBytes(4) ? r.uint32() : 0;
    const toggleOnBeat = r.hasBytes(4) ? r.uint32() !== 0 : false;
    return { type: 'MultiFilter', enabled, effect, toggleOnBeat };
  }

  // APE aliases for components we've implemented
  if (cleanId === 'Holden04: Video Delay' || cleanId === 'Video Delay') {
    const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
    const useBeats = r.hasBytes(4) ? r.uint32() !== 0 : false;
    const delay = r.hasBytes(4) ? r.uint32() : 10;
    return { type: 'VideoDelay', enabled, useBeats, delay };
  }
  if (cleanId === 'Holden05: Multi Delay' || cleanId === 'Multi Delay') {
    return { type: 'MultiDelay', enabled: true, _unsupported: true, _apeId: cleanId };
  }
  if (cleanId === 'Color Reduction') {
    const levels = r.hasBytes(4) ? r.uint32() : 7;
    return { type: 'ColorReduction', enabled: true, levels };
  }
  if (cleanId === 'Winamp Starfield v1') {
    return { type: 'Starfield', enabled: true };
  }
  if (cleanId.startsWith('Virtual Effect: Addborders') || cleanId === 'Addborders') {
    // Simple border effect — just read enabled state and skip data
    const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
    const color = r.hasBytes(4) ? r.color() : '#000000';
    const size = r.hasBytes(4) ? r.uint32() : 1;
    return { type: 'AddBorders', enabled, color, size, _unsupported: true };
  }
  if (cleanId === 'Normalise' || cleanId === 'Normalize') {
    return { type: 'Normalize', enabled: true, _unsupported: true };
  }
  if (cleanId === 'Buffer blend' || cleanId === 'Buffer Blend') {
    return { type: 'BufferBlend', enabled: true, _unsupported: true };
  }

  return { type: cleanId || 'UnknownAPE', enabled: true, _unsupported: true, _apeId: cleanId };
}

// ---- EffectList parser ----

function parseEffectList(r, endPos) {
  if (!r.hasBytes(1)) { r.pos = endPos; return null; }

  // Mode byte: bit 0=clearfb, bit 1=!enabled, bit 7=has extended uint32
  // vis_avs r_list.cpp load_config:
  //   mode = data[pos++]
  //   if (mode & 0x80) { mode &= ~0x80; mode |= GET_INT(); pos+=4; }
  //   ext = get_extended_datasize() + 5
  //   (extended_datasize is bytes 24-31 of mode, it's a BYTE count not uint32 count)
  const startPos = r.pos;
  let mode = r.uint8();
  if (mode & 0x80) {
    if (!r.hasBytes(4)) { r.pos = endPos; return null; }
    mode = (mode & ~0x80) | r.uint32();
  } else {
    // Legacy: 3 more bytes (unused, blendin, blendout)
    if (r.hasBytes(3)) {
      r.skip(1);
      const bi = r.uint8();
      const bo = r.uint8();
      mode = (mode & 0xFF) | (bi << 8) | (bo << 16);
    }
  }

  const enabled = !!((mode & 2) ^ 2);
  const clearFrame = !!(mode & 1);
  const inputBlend = (mode >> 8) & 31;
  const outputBlend = ((mode >> 16) & 31) ^ 1;
  const extDataSizeBytes = (mode >> 24) & 0xFF; // BYTE count of extended data

  let enableOnBeat = false, enableOnBeatFor = 1;
  let inAdjust = 128, outAdjust = 128;
  let codeInit = '', codePerFrame = '', codeEnabled = false;

  // vis_avs load_config: ext = get_extended_datasize() + 5
  // pos starts at 5 (after mode byte + uint32), reads while pos < ext
  // Standard ext data is 36 bytes: 8 uint32 fields + 4 bytes padding
  // ("size of extended data + 4 cause we fucked up" — from vis_avs source)
  if (extDataSizeBytes > 0) {
    const extEnd = startPos + extDataSizeBytes + 5;
    const safeEnd = Math.min(extEnd, endPos);
    if (r.pos + 4 <= safeEnd) inAdjust = r.uint32();
    if (r.pos + 4 <= safeEnd) outAdjust = r.uint32();
    if (r.pos + 4 <= safeEnd) r.uint32(); // bufferin
    if (r.pos + 4 <= safeEnd) r.uint32(); // bufferout
    if (r.pos + 4 <= safeEnd) r.uint32(); // ininvert
    if (r.pos + 4 <= safeEnd) r.uint32(); // outinvert
    // Last two use pos<ext-4 in vis_avs (stricter check)
    if (r.pos + 8 <= safeEnd) enableOnBeat = r.uint32() !== 0;
    if (r.pos + 8 <= safeEnd) enableOnBeatFor = r.uint32();
    // Do NOT jump to extEnd — vis_avs continues from wherever pos ended up
    // The "+4 cause we fucked up" padding is NOT skipped in the original
  }

  // After extended data, the component stream follows.
  // The EffectList's own code section (if any) appears as a DLL component
  // with a special extsigstr identifier — parseComponents/parseDllComponent
  // will handle it. We detect it there and extract the code.
  const children = [];
  while (r.pos <= endPos - 8 && r.hasBytes(8)) {
    const compStart = r.pos;
    const code = r.uint32();
    const isDll = (code !== EFFECTLIST_CODE && code >= BUILTIN_MAX);
    let dllId = '';
    if (isDll) {
      if (!r.hasBytes(32)) break;
      dllId = r.fixedString(32);
    }
    const size = r.uint32();
    const dataEnd = Math.min(r.pos + size, endPos);

    // Check for EffectList code section (extsigstr)
    if (isDll && extDataSizeBytes > 0) {
      const cleanId = dllId.replace(/\0/g, '').trim();
      if (cleanId.startsWith('AVS 2.8')) {
        // This is the EffectList's embedded code section, not a real component
        if (size > 0 && r.pos + 4 <= dataEnd) {
          codeEnabled = r.uint32() !== 0;
          codeInit = r.hasBytes(4) ? r.sizeString() : '';
          codePerFrame = r.hasBytes(4) ? r.sizeString() : '';
        }
        r.pos = dataEnd;
        continue;
      }
    }

    if (code === EFFECTLIST_CODE) {
      const comp = parseEffectList(r, dataEnd);
      if (comp) children.push(comp);
    } else if (isDll) {
      const comp = parseDllComponent(dllId, r, dataEnd);
      if (comp) children.push(comp);
      r.pos = dataEnd;
    } else {
      const parser = BUILTIN_PARSERS[code];
      if (parser) {
        const comp = parser(r, dataEnd);
        if (comp) children.push(comp);
      } else {
        const typeName = COMPONENT_MAP[code];
        if (typeName) children.push({ type: typeName, enabled: true, _unsupported: true });
      }
      r.pos = dataEnd;
    }
  }

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
