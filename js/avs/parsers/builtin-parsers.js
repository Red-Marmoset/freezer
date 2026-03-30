// Parsers for all built-in AVS components (codes 0x00-0x2D)
// Each function takes a BinaryReader and endPos, returns a component JSON object.

export function parseSuperScope(r, endPos) {
  const version = r.uint8();
  const isNew = (version === 1);
  let perPoint, perFrame, onBeat, init;
  if (isNew) {
    perPoint = r.sizeString(); perFrame = r.sizeString();
    onBeat = r.sizeString(); init = r.sizeString();
  } else {
    r.pos--;
    perPoint = r.fixedString(256); perFrame = r.fixedString(256);
    onBeat = r.fixedString(256); init = r.fixedString(256);
  }
  let audioChannel = 'CENTER', audioSource = 'WAVEFORM';
  if (r.pos < endPos && r.hasBytes(4)) {
    const channelByte = r.uint32();
    audioChannel = ['LEFT', 'RIGHT', 'CENTER'][channelByte & 0x03] || 'CENTER';
    audioSource = (channelByte & 0x04) ? 'SPECTRUM' : 'WAVEFORM';
  }
  const colors = [];
  if (r.pos < endPos && r.hasBytes(4)) {
    const numColors = r.uint32();
    for (let i = 0; i < numColors && r.hasBytes(4); i++) colors.push(r.color());
  }
  let drawMode = 'LINES';
  if (r.pos < endPos && r.hasBytes(4)) drawMode = r.uint32() === 0 ? 'DOTS' : 'LINES';
  return {
    type: 'SuperScope',
    code: { init, perFrame, onBeat, perPoint },
    audioChannel, audioSource,
    colors: colors.length > 0 ? colors : ['#ffffff'],
    drawMode,
  };
}

export function parseFadeOut(r) {
  const speed = r.uint32();
  const color = r.color();
  return { type: 'FadeOut', speed, color };
}

export function parseMovement(r, endPos) {
  const effectId = r.uint32();
  let builtinEffect = 0, code = '', sourceMapped = false;
  let coordinates = 0, bilinear = true, wrap = false;

  if (effectId === 0x7FFF) {
    if (r.hasBytes(1) && r.bytes[r.pos] === 1) { r.skip(1); code = r.sizeString(); }
    else { code = r.fixedString(256); }
    builtinEffect = 13;
  } else if (effectId > 0 && effectId <= 23) {
    builtinEffect = effectId;
  }

  if (r.pos + 20 <= endPos) {
    r.uint32(); // rawOutput
    sourceMapped = r.uint32() !== 0;
    coordinates = r.uint32();
    bilinear = r.uint32() !== 0;
    wrap = r.uint32() !== 0;
  }

  return {
    type: 'Movement', builtinEffect, code, sourceMapped,
    coordinates: coordinates === 1 ? 'CARTESIAN' : 'POLAR', bilinear, wrap,
  };
}

export function parseDynamicMovement(r, endPos) {
  const version = r.uint8();
  const isNew = (version === 1);
  let perPoint, perFrame, onBeat, init;
  if (isNew) {
    perPoint = r.sizeString(); perFrame = r.sizeString();
    onBeat = r.sizeString(); init = r.sizeString();
  } else {
    r.pos--;
    perPoint = r.fixedString(256); perFrame = r.fixedString(256);
    onBeat = r.fixedString(256); init = r.fixedString(256);
  }
  let bilinear = true, coordinates = 0, gridW = 16, gridH = 16;
  let blend = false, wrap = true, buffer = 0, alphaOnly = false;
  if (r.hasBytes(32)) {
    bilinear = r.uint32() !== 0; coordinates = r.uint32();
    gridW = r.uint32(); gridH = r.uint32();
    blend = r.uint32() !== 0; wrap = r.uint32() !== 0;
    buffer = r.uint32(); alphaOnly = r.uint32() !== 0;
  }
  return {
    type: 'DynamicMovement',
    code: { init, perFrame, onBeat, perPoint },
    bFilter: bilinear, coord: coordinates === 1 ? 'CARTESIAN' : 'POLAR',
    gridW: Math.max(2, gridW + 1), gridH: Math.max(2, gridH + 1),
    blend, wrap, buffer, alphaOnly,
  };
}

export function parseSimple(r) {
  const effect = r.uint32();
  let audioSource, renderType;
  if (effect & (1 << 6)) {
    renderType = 'DOTS'; audioSource = (effect & 2) ? 'WAVEFORM' : 'SPECTRUM';
  } else {
    switch (effect & 3) {
      case 0: audioSource = 'SPECTRUM'; renderType = 'SOLID'; break;
      case 1: audioSource = 'SPECTRUM'; renderType = 'LINES'; break;
      case 2: audioSource = 'WAVEFORM'; renderType = 'LINES'; break;
      case 3: audioSource = 'WAVEFORM'; renderType = 'SOLID'; break;
      default: audioSource = 'WAVEFORM'; renderType = 'LINES';
    }
  }
  const audioChannel = ['LEFT', 'RIGHT', 'CENTER'][(effect >> 2) & 3] || 'CENTER';
  const positionY = ['TOP', 'BOTTOM', 'CENTER'][(effect >> 4) & 3] || 'CENTER';
  const colors = [];
  if (r.hasBytes(4)) {
    const n = r.uint32();
    for (let i = 0; i < n && r.hasBytes(4); i++) colors.push(r.color());
  }
  return { type: 'Simple', audioSource, renderType, audioChannel, positionY, colors: colors.length > 0 ? colors : ['#ffffff'] };
}

export function parseClearScreen(r) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const color = r.hasBytes(4) ? r.color() : '#000000';
  const clearMode = r.hasBytes(4) ? r.uint32() : 0;
  const onBeatAction = r.hasBytes(4) ? r.uint32() : 0;
  const onBeatColor = r.hasBytes(4) ? r.color() : '#000000';
  return { type: 'ClearScreen', enabled, color, clearMode, onBeatAction, onBeatColor };
}

export function parseOnBeatClear(r) {
  const color = r.hasBytes(4) ? r.color() : '#000000';
  const blendMode = r.hasBytes(4) ? r.uint32() : 0;
  const clearBeats = r.hasBytes(4) ? r.uint32() : 1;
  return { type: 'OnBeatClear', color, blendMode, clearBeats };
}

export function parseColorModifier(r) {
  const version = r.uint8();
  const isNew = (version === 1);
  let init, perFrame, onBeat;
  if (isNew) { init = r.sizeString(); perFrame = r.sizeString(); onBeat = r.sizeString(); }
  else { r.pos--; init = r.fixedString(256); perFrame = r.fixedString(256); onBeat = r.fixedString(256); }
  return { type: 'ColorModifier', code: { init, perFrame, onBeat } };
}

export function parseBrightness(r) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const blend = r.hasBytes(4) ? r.uint32() : 0;
  const red = r.hasBytes(4) ? r.int32() : 0;
  const green = r.hasBytes(4) ? r.int32() : 0;
  const blue = r.hasBytes(4) ? r.int32() : 0;
  return { type: 'Brightness', enabled, blend, red, green, blue };
}

export function parseFastBrightness(r) {
  return { type: 'FastBrightness', mode: r.hasBytes(4) ? r.uint32() : 0 };
}

export function parseBufferSave(r) {
  const action = r.hasBytes(4) ? r.uint32() : 0;
  // Buffer index is stored 0-based (0 to NBUF-1) in the original r_stack.cpp
  const buffer = r.hasBytes(4) ? r.uint32() : 0;
  const blendMode = r.hasBytes(4) ? r.uint32() : 0;
  const adjustBlend = r.hasBytes(4) ? r.uint32() : 128;
  return { type: 'BufferSave', action, buffer: Math.max(0, Math.min(7, buffer)), blendMode, adjustBlend };
}

export function parseMosaic(r) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const squareSize = r.hasBytes(4) ? r.uint32() : 8;
  const onBeatSquareSize = r.hasBytes(4) ? r.uint32() : 8;
  const onBeatDuration = r.hasBytes(4) ? r.uint32() : 1;
  return { type: 'Mosaic', enabled, squareSize, onBeatSquareSize, onBeatDuration };
}

export function parseInvert(r) { return { type: 'Invert', enabled: r.hasBytes(4) ? r.uint32() !== 0 : true }; }
export function parseMirror(r) { return { type: 'Mirror', enabled: r.hasBytes(4) ? r.uint32() !== 0 : true, mode: r.hasBytes(4) ? r.uint32() : 0 }; }
export function parseBlur(r) { return { type: 'Blur', enabled: r.hasBytes(4) ? r.uint32() !== 0 : true, mode: r.hasBytes(4) ? r.uint32() : 0 }; }

export function parseComment(r, endPos) {
  // Comment binary format: uint32 length + text (size-prefixed string)
  let text = '';
  if (r.pos + 4 <= endPos) {
    text = r.sizeString();
  }
  r.pos = endPos;
  return { type: 'Comment', text, enabled: false };
}

export function parseColorClip(r) {
  const mode = r.hasBytes(4) ? r.uint32() : 0;
  const color_clip = r.hasBytes(4) ? r.color() : '#000000';
  const color_clip_out = r.hasBytes(4) ? r.color() : '#000000';
  const distance = r.hasBytes(4) ? r.uint32() : 0;
  return { type: 'ColorClip', enabled: true, mode, color_clip, color_clip_out, distance };
}

export function parseColorFade(r) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const fader1 = [], fader2 = [], fader3 = [];
  for (let i = 0; i < 3; i++) fader1.push(r.hasBytes(4) ? r.int32() : 0);
  for (let i = 0; i < 3; i++) fader2.push(r.hasBytes(4) ? r.int32() : 0);
  for (let i = 0; i < 3; i++) fader3.push(r.hasBytes(4) ? r.int32() : 0);
  return { type: 'ColorFade', enabled, fader1, fader2, fader3 };
}

export function parseScatter(r) { return { type: 'Scatter', enabled: r.hasBytes(4) ? r.uint32() !== 0 : true }; }

export function parseInterleave(r) {
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

export function parseGrain(r) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const blendMode = r.hasBytes(4) ? r.uint32() : 1;
  const amount = r.hasBytes(4) ? r.uint32() : 50;
  return { type: 'Grain', enabled, blendMode, amount };
}

export function parseUniqueTone(r) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const blendMode = r.hasBytes(4) ? r.uint32() : 0;
  const color = r.hasBytes(4) ? r.color() : '#ffffff';
  return { type: 'UniqueTone', enabled, blendMode, color };
}

export function parseBlitterFeedback(r) {
  const scale = r.hasBytes(4) ? r.uint32() : 256;
  const onBeatScale = r.hasBytes(4) ? r.uint32() : 256;
  const blendMode = r.hasBytes(4) ? r.uint32() : 0;
  return { type: 'BlitterFeedback', enabled: true, scale, onBeatScale, blendMode };
}

export function parseMovingParticle(r) {
  const flags = r.hasBytes(4) ? r.uint32() : 1;
  const enabled = !!(flags & 1);
  const onBeatSizeChange = !!(flags & 2);
  const colorRaw = r.hasBytes(4) ? r.uint32() : 0xffffff;
  // File bytes are BGR order: byte0=B, byte1=G, byte2=R
  const cb = colorRaw & 0xff, cg = (colorRaw >> 8) & 0xff, cr = (colorRaw >> 16) & 0xff;
  const color = '#' + ((1 << 24) | (cr << 16) | (cg << 8) | cb).toString(16).slice(1);
  const maxdist = r.hasBytes(4) ? r.uint32() : 16;
  const size = r.hasBytes(4) ? r.uint32() : 8;
  const size2 = r.hasBytes(4) ? r.uint32() : 8;
  const blend = r.hasBytes(4) ? r.uint32() : 1;
  return { type: 'MovingParticle', enabled, color, maxdist, size, size2, blend, onBeatSizeChange };
}

export function parseRotoBlitter(r) {
  const zoom = r.hasBytes(4) ? r.uint32() : 256;
  const rotate = r.hasBytes(4) ? r.uint32() : 0;
  const blendMode = r.hasBytes(4) ? r.uint32() : 0;
  const onBeatZoom = r.hasBytes(4) ? r.uint32() : 256;
  const onBeatRotate = r.hasBytes(4) ? r.uint32() : 0;
  const bilinear = r.hasBytes(4) ? r.uint32() : 1;
  return { type: 'RotoBlitter', enabled: true, zoom, rotate, blendMode, onBeatZoom, onBeatRotate, bilinear };
}

export function parseRing(r) {
  const audioSource = r.hasBytes(4) ? (r.uint32() === 0 ? 'WAVEFORM' : 'SPECTRUM') : 'WAVEFORM';
  const sizeRaw = r.hasBytes(4) ? r.uint32() : 128;
  const colors = [];
  if (r.hasBytes(4)) { const n = r.uint32(); for (let i = 0; i < n && r.hasBytes(4); i++) colors.push(r.color()); }
  return { type: 'Ring', audioSource, size: Math.max(0.1, sizeRaw / 256), colors: colors.length > 0 ? colors : ['#ffffff'] };
}

export function parseStarfield(r) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const color = r.hasBytes(4) ? r.color() : '#ffffff';
  const numStars = r.hasBytes(4) ? r.uint32() : 350;
  const speed = r.hasBytes(4) ? r.uint32() : 16;
  const onBeatAction = r.hasBytes(4) ? r.uint32() : 0;
  const onBeatDuration = r.hasBytes(4) ? r.uint32() : 15;
  return { type: 'Starfield', enabled, color, numStars: Math.min(4096, numStars), speed, onBeatAction, onBeatDuration };
}

export function parseDotGrid(r) {
  const numColors = r.hasBytes(4) ? r.uint32() : 1;
  const colors = [];
  for (let i = 0; i < numColors && i < 16 && r.hasBytes(4); i++) colors.push(r.color());
  const spacing = r.hasBytes(4) ? r.uint32() : 8;
  const xSpeed = r.hasBytes(4) ? r.uint32() : 0;
  const ySpeed = r.hasBytes(4) ? r.uint32() : 0;
  const blendMode = r.hasBytes(4) ? r.uint32() : 0;
  return { type: 'DotGrid', numColors, colors: colors.length > 0 ? colors : ['#ffffff'], spacing, xSpeed, ySpeed, blendMode };
}

// DotPlane and DotFountain share the same binary layout:
// rotSpeed(i32), colors[5](u32 each as 0xBBGGRR), angle(i32), rotation(i32 as rot*32)
function parseDotCommon(r, type) {
  const rotSpeed = r.hasBytes(4) ? r.int32() : 16;
  const colors = [];
  for (let i = 0; i < 5; i++) colors.push(r.hasBytes(4) ? r.color() : '#ffffff');
  const angle = r.hasBytes(4) ? r.int32() : -20;
  const rotation = r.hasBytes(4) ? r.int32() / 32 : 0;
  return { type, rotSpeed, colors, angle, rotation };
}

export function parseDotPlane(r) { return parseDotCommon(r, 'DotPlane'); }
export function parseDotFountain(r) { return parseDotCommon(r, 'DotFountain'); }

export function parseBassSpin(r) {
  const enabledLeft = r.hasBytes(4) ? r.uint32() : 1;
  const enabledRight = r.hasBytes(4) ? r.uint32() : 1;
  const colors = [];
  colors.push(r.hasBytes(4) ? r.color() : '#ffffff');
  colors.push(r.hasBytes(4) ? r.color() : '#ffffff');
  const mode = r.hasBytes(4) ? r.uint32() : 0;
  return { type: 'BassSpin', enabledLeft, enabledRight, colors, mode };
}

export function parseRotatingStars(r) {
  return { type: 'RotatingStars', numStars: Math.max(1, r.hasBytes(4) ? r.uint32() : 1), color: r.hasBytes(4) ? r.color() : '#ffffff' };
}

export function parseTimescope(r) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const color = r.hasBytes(4) ? r.color() : '#ffffff';
  const blendMode = r.hasBytes(4) ? r.uint32() : 0;
  const bands = r.hasBytes(4) ? r.uint32() : 576;
  return { type: 'Timescope', enabled, color, blendMode, bands: Math.max(1, bands) };
}

export function parseWater(r) { return { type: 'Water', enabled: r.hasBytes(4) ? r.uint32() !== 0 : true }; }
export function parseWaterBump(r) { return { type: 'WaterBump', enabled: r.hasBytes(4) ? r.uint32() !== 0 : true, density: r.hasBytes(4) ? r.uint32() : 4 }; }

export function parseBump(r) {
  const version = r.uint8();
  const isNew = (version === 1);
  let init, perFrame, onBeat, perPoint;
  if (isNew) { init = r.sizeString(); perFrame = r.sizeString(); onBeat = r.sizeString(); perPoint = r.sizeString(); }
  else { r.pos--; init = r.fixedString(256); perFrame = r.fixedString(256); onBeat = r.fixedString(256); perPoint = r.fixedString(256); }
  let onBeatEnabled = false, depth = 30;
  if (r.hasBytes(4)) onBeatEnabled = r.uint32() !== 0;
  if (r.hasBytes(4)) depth = r.uint32();
  return { type: 'Bump', code: { init, perFrame, onBeat, perPoint }, onBeat: onBeatEnabled, depth };
}

export function parseText(r, endPos) {
  // Binary layout from r_text.cpp:
  // enabled(i32), color(i32), blend(i32), blendavg(i32), onbeat(i32),
  // insertBlank(i32), randomPos(i32), valign(i32), halign(i32),
  // onbeatSpeed(i32), normSpeed(i32),
  // CHOOSEFONT struct (60 bytes), LOGFONT struct (92 bytes),
  // text size(i32), text data(size bytes),
  // outline(i32), outlinecolor(i32), xshift(i32), yshift(i32),
  // outlinesize(i32), randomword(i32), shadow(i32)
  const result = { type: 'Text', enabled: true, text: '', color: '#ffffff', blend: 0 };
  try {
    if (r.hasBytes(4)) result.enabled = r.uint32() !== 0;
    if (r.hasBytes(4)) result.color = r.color();
    if (r.hasBytes(4)) result.blend = r.uint32();
    if (r.hasBytes(4)) result.blendavg = r.uint32();
    if (r.hasBytes(4)) result.onbeat = r.uint32() !== 0;
    if (r.hasBytes(4)) result.insertBlank = r.uint32() !== 0;
    if (r.hasBytes(4)) result.randomPos = r.uint32() !== 0;
    if (r.hasBytes(4)) result.valign = r.uint32(); // 0=top, 1=center, 2=bottom
    if (r.hasBytes(4)) result.halign = r.uint32(); // 0=left, 1=center, 2=right
    if (r.hasBytes(4)) result.onbeatSpeed = r.uint32();
    if (r.hasBytes(4)) result.normSpeed = r.uint32();
    // Skip CHOOSEFONT (60 bytes on 32-bit Windows)
    if (r.hasBytes(60)) r.skip(60);
    // LOGFONTA: 28 bytes header + 32 bytes faceName = 60 bytes total
    if (r.hasBytes(60)) {
      const lfStart = r.pos;
      result.fontHeight = Math.abs(r.int32()); // lfHeight (negative = char height)
      r.pos = lfStart + 16; // skip to lfWeight
      const weight = r.uint32();
      result.bold = weight >= 700;
      result.italic = r.uint8() !== 0;
      r.pos = lfStart + 28; // skip to lfFaceName
      result.fontName = r.fixedString(32);
      r.pos = lfStart + 60;
    }
    // Text content: size-prefixed
    if (r.hasBytes(4)) {
      const size = r.uint32();
      if (size > 0 && r.hasBytes(size)) {
        result.text = r.decodeString(r.pos, r.pos + size);
        r.pos += size;
      }
    }
    // Trailing fields
    if (r.hasBytes(4)) result.outline = r.uint32() !== 0;
    if (r.hasBytes(4)) result.outlineColor = r.color();
    if (r.hasBytes(4)) result.xshift = r.int32();
    if (r.hasBytes(4)) result.yshift = r.int32();
    if (r.hasBytes(4)) result.outlineSize = r.uint32();
    if (r.hasBytes(4)) result.randomWord = r.uint32() !== 0;
    if (r.hasBytes(4)) result.shadow = r.uint32() !== 0;
  } catch {}
  r.pos = endPos;
  return result;
}

export function parseSetRenderMode(r) {
  // g_line_blend_mode packed uint32: bit 31 = ENABLED (set = active), bits 0-7 = blend,
  // bits 8-15 = alpha, bits 16-23 = linesize. Default = 0x80010000 (enabled, blend 0, linesize 1)
  const raw = r.hasBytes(4) ? r.uint32() : 0x80010000;
  return { type: 'SetRenderMode', enabled: !!(raw & 0x80000000), blend: raw & 0xff, alpha: (raw >> 8) & 0xff, lineSize: ((raw >> 16) & 0xff) || 1 };
}

export function parseInterferences(r) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const numLayers = r.hasBytes(4) ? r.uint32() : 2;
  const rotation = r.hasBytes(4) ? r.uint32() : 0;
  const distance = r.hasBytes(4) ? r.uint32() : 0;
  const alpha = r.hasBytes(4) ? r.uint32() : 128;
  const onBeatRotation = r.hasBytes(4) ? r.uint32() : 0;
  const onBeatDistance = r.hasBytes(4) ? r.uint32() : 0;
  return { type: 'Interferences', enabled, numLayers, rotation, distance, alpha, onBeatRotation, onBeatDistance };
}

export function parseDynamicShift(r) {
  const version = r.uint8();
  const isNew = (version === 1);
  let init, perFrame, onBeat;
  if (isNew) { init = r.sizeString(); perFrame = r.sizeString(); onBeat = r.sizeString(); }
  else { r.pos--; init = r.fixedString(256); perFrame = r.fixedString(256); onBeat = r.fixedString(256); }
  const blendMode = r.hasBytes(4) ? r.uint32() : 0;
  return { type: 'DynamicShift', code: { init, perFrame, onBeat }, blendMode };
}

export function parseDynamicDistanceModifier(r) {
  const version = r.uint8();
  const isNew = (version === 1);
  let perPoint, perFrame, onBeat, init;
  if (isNew) { perPoint = r.sizeString(); perFrame = r.sizeString(); onBeat = r.sizeString(); init = r.sizeString(); }
  else { r.pos--; perPoint = r.fixedString(256); perFrame = r.fixedString(256); onBeat = r.fixedString(256); init = r.fixedString(256); }
  return { type: 'DynamicDistanceModifier', code: { init, perFrame, onBeat, perPoint } };
}

export function parsePicture(r, endPos) {
  const enabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const blendAdditive = r.hasBytes(4) ? r.uint32() !== 0 : false;
  const blend5050 = r.hasBytes(4) ? r.uint32() !== 0 : false;
  const onBeatAdditive = r.hasBytes(4) ? r.uint32() !== 0 : false;
  const onBeatDuration = r.hasBytes(4) ? r.uint32() : 1;
  let imageSrc = '';
  if (r.pos < endPos) imageSrc = r.ntString();
  const keepAspect = (r.pos + 4 <= endPos) ? r.uint32() !== 0 : false;
  let blendMode = 'REPLACE';
  if (blendAdditive) blendMode = 'ADDITIVE';
  else if (blend5050) blendMode = 'FIFTY_FIFTY';
  let onBeatBlendMode = blendMode;
  if (onBeatAdditive) onBeatBlendMode = 'ADDITIVE';
  return { type: 'Picture', enabled, blendMode, onBeatBlendMode, imageSrc, onBeatDuration, keepAspect };
}
