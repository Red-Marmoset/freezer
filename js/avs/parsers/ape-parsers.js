// Parsers for AVS APE/DLL components (third-party plugins)
// Each function takes a BinaryReader and endPos, returns a component JSON object.

export function parseTriangleAPE(r, endPos) {
  const result = { type: 'Triangle', code: { init: '', perFrame: '', onBeat: '', perPoint: '' } };
  try {
    if (r.pos < endPos) result.code.init = r.ntString();
    if (r.pos < endPos) result.code.perFrame = r.ntString();
    if (r.pos < endPos) result.code.onBeat = r.ntString();
    if (r.pos < endPos) result.code.perPoint = r.ntString();
  } catch {}
  return result;
}

export function parseTexerAPE(r, endPos) {
  const result = { type: 'Texer', enabled: true, imageSrc: '', wrap: false, resize: false, numParticles: 100 };
  try {
    if (r.pos + 16 <= endPos) r.skip(16);
    if (r.pos + 260 <= endPos) result.imageSrc = r.fixedString(260);
    if (r.pos + 4 <= endPos) {
      const modeByte = r.uint8();
      result.inputMode = modeByte & 0x0f;
      result.outputMode = (modeByte >> 4) & 0x0f;
      r.skip(3);
    }
    if (r.pos + 4 <= endPos) r.skip(4);
    if (r.pos + 4 <= endPos) result.numParticles = r.uint32();
  } catch {}
  return result;
}

export function parseTexer2APE(r, endPos) {
  const result = {
    type: 'Acko.net: Texer II', enabled: true, imageSrc: '',
    code: { init: '', perFrame: '', onBeat: '', perPoint: '' },
    wrap: false, resize: false, colorFilter: 0,
  };
  try {
    if (!r.hasBytes(4)) return result;
    r.uint32(); // version
    if (r.pos + 260 <= endPos) result.imageSrc = r.fixedString(260);
    if (r.pos + 4 <= endPos) result.resize = r.uint32() !== 0;
    if (r.pos + 4 <= endPos) result.wrap = r.uint32() !== 0;
    if (r.pos + 4 <= endPos) result.colorFilter = r.uint32();
    if (r.pos + 4 <= endPos) r.skip(4); // unused padding
    if (r.pos + 4 <= endPos) result.code.init = r.sizeString();
    if (r.pos + 4 <= endPos) result.code.perFrame = r.sizeString();
    if (r.pos + 4 <= endPos) result.code.onBeat = r.sizeString();
    if (r.pos + 4 <= endPos) result.code.perPoint = r.sizeString();
  } catch {}
  return result;
}

export function parsePicture2APE(r, endPos) {
  const BLEND_MAP = ['REPLACE', 'ADDITIVE', 'MAXIMUM', 'FIFTY_FIFTY',
    'SUB_DEST_SRC', 'SUB_SRC_DEST', 'MULTIPLY', 'ADJUSTABLE', 'XOR', 'MINIMUM'];
  let imageSrc = '';
  if (r.pos + 260 <= endPos) imageSrc = r.fixedString(260);
  const rawBlend = r.hasBytes(4) ? r.uint32() : 0;
  const rawOnBeat = r.hasBytes(4) ? r.uint32() : 0;
  const bilinear = r.hasBytes(4) ? r.uint32() !== 0 : true;
  r.hasBytes(4) && r.uint32(); // onBeatBilinear
  const adjustBlend = r.hasBytes(4) ? r.uint32() : 128;
  const onBeatAdjustBlend = r.hasBytes(4) ? r.uint32() : 128;
  return {
    type: 'Picture', enabled: true, imageSrc,
    blendMode: BLEND_MAP[rawBlend] || 'REPLACE',
    onBeatBlendMode: BLEND_MAP[rawOnBeat] || 'REPLACE',
    bilinear, adjustBlend, onBeatAdjustBlend,
  };
}

export function parseColorMapAPE(r, endPos) {
  const KEY_NAMES = ['RED', 'GREEN', 'BLUE', '(R+G+B)/2', 'MAX', '(R+G+B)/3'];
  const BLEND_NAMES = ['REPLACE', 'ADDITIVE', 'MAXIMUM', 'MINIMUM', '5050',
    'SUB1', 'SUB2', 'MULTIPLY', 'XOR', 'ADJUSTABLE'];
  const CYCLE_NAMES = ['NONE', 'BEAT_RANDOM', 'BEAT_SEQUENTIAL'];

  const result = {
    type: 'ColorMap', enabled: true, key: 'RED', blendMode: 'REPLACE',
    mapCycleMode: 'NONE', adjustableAlpha: 128, dontSkipFastBeats: false,
    mapCycleSpeed: 8, maps: [], currentMap: 0,
  };

  try {
    result.key = KEY_NAMES[r.hasBytes(4) ? r.uint32() : 0] || 'RED';
    result.blendMode = BLEND_NAMES[r.hasBytes(4) ? r.uint32() : 0] || 'REPLACE';
    result.mapCycleMode = CYCLE_NAMES[r.hasBytes(4) ? r.uint32() : 0] || 'NONE';
    if (r.hasBytes(4)) {
      result.adjustableAlpha = r.uint8(); r.skip(1);
      result.dontSkipFastBeats = r.uint8() !== 0;
      result.mapCycleSpeed = r.uint8() || 8;
    }
    const mapHeaders = [];
    for (let m = 0; m < 8; m++) {
      mapHeaders.push({
        enabled: r.hasBytes(4) ? r.uint32() !== 0 : false,
        numColors: r.hasBytes(4) ? r.uint32() : 0,
        mapId: r.hasBytes(4) ? r.uint32() : 0,
        filepath: r.hasBytes(48) ? r.fixedString(48) : '',
      });
    }
    for (let m = 0; m < 8; m++) {
      const colors = [];
      for (let c = 0; c < mapHeaders[m].numColors; c++) {
        if (r.pos + 12 > endPos) break;
        const position = r.uint32();
        // Color stored as COLORREF (0x00BBGGRR) — use same extraction as r.color()
        const color = r.color();
        r.skip(4); // color_id (ignored)
        colors.push({ position, color });
      }
      result.maps.push({
        enabled: mapHeaders[m].enabled,
        colors: colors.length > 0 ? colors : [{ position: 0, color: '#000000' }, { position: 255, color: '#ffffff' }],
      });
    }
  } catch {}
  if (result.maps.length === 0) result.maps.push({ enabled: true, colors: [{ position: 0, color: '#000000' }, { position: 255, color: '#ffffff' }] });
  return result;
}

export function parseGlobalVariablesAPE(r, endPos) {
  const loadTime = r.hasBytes(4) ? r.uint32() : 0;
  if (r.hasBytes(24)) r.skip(24); // unused bytes
  let init = '', frame = '', beat = '', file = '', saveRegRanges = '', saveBufRanges = '';
  if (r.pos < endPos) init = r.ntString();
  if (r.pos < endPos) frame = r.ntString();
  if (r.pos < endPos) beat = r.ntString();
  if (r.pos < endPos) file = r.ntString();
  if (r.pos < endPos) saveRegRanges = r.ntString();
  if (r.pos < endPos) saveBufRanges = r.ntString();
  return {
    type: 'Jheriko: Global',
    enabled: true,
    loadTime,
    code: { init, frame, beat },
    file: file.replace(/.*[/\\]/, ''), // strip path, keep basename
  };
}

export function parseEelTransAPE(r, endPos) {
  const translateEnabled = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const logEnabled = r.hasBytes(4) ? r.uint32() !== 0 : false;
  const translateFirstLevel = r.hasBytes(4) ? r.uint32() !== 0 : true;
  const readCommentCodes = r.hasBytes(4) ? r.uint32() !== 0 : true;
  let code = '';
  if (r.pos < endPos) code = r.ntString();
  return {
    type: 'EelTrans',
    enabled: translateEnabled,
    code,
    logEnabled,
    translateFirstLevel,
    readCommentCodes,
  };
}

export function parseConvolutionAPE(r, endPos) {
  const result = {
    type: 'Holden03: Convolution Filter', enabled: true,
    wrap: false, absolute: false, twoPass: false,
    kernel: new Array(49).fill(0), bias: 0, scale: 1,
  };
  try {
    if (r.pos + 4 <= endPos) result.enabled = r.uint32() !== 0;
    if (r.pos + 4 <= endPos) result.wrap = r.uint32() !== 0;
    if (r.pos + 4 <= endPos) result.absolute = r.uint32() !== 0;
    if (r.pos + 4 <= endPos) result.twoPass = r.uint32() !== 0;
    for (let i = 0; i < 49; i++) { if (r.pos + 4 <= endPos) result.kernel[i] = r.int32(); }
    if (r.pos + 4 <= endPos) result.bias = r.int32();
    if (r.pos + 4 <= endPos) result.scale = r.int32();
  } catch {}
  return result;
}
