import { createAudioEngine } from './audio-engine.js';
import { createRenderer } from './renderer.js';
import { loadAvsPreset } from './avs/avs-engine.js';
import { parseAvsFileWithName } from './avs/avs-parser.js';
import { initPresetBrowser, open as openPresetLibrary, close as closePresetLibrary, isOpen as isPresetLibraryOpen, loadPresetById, findPresetId } from './preset-library/preset-browser.js';
import { initHelp } from './help.js';

const canvas = document.getElementById('visualizer');
const controls = document.getElementById('controls');
const splash = document.getElementById('splash');
const btnStart = document.getElementById('btn-start');
const splashStatus = document.getElementById('splash-status');
const btnPresets = document.getElementById('btn-presets');
const btnLoadPreset = document.getElementById('btn-load-preset');
const btnEditor = document.getElementById('btn-editor');
const presetName = document.getElementById('preset-name');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnSource = document.getElementById('btn-source');

const audio = createAudioEngine();
const viz = createRenderer(canvas);

// Default preset: circular scope with color cycling, fadeout, blitter feedback
const DEFAULT_PRESET = {
  name: 'Freezer Default',
  clearFrame: false,
  components: [
    { type: 'FadeOut', enabled: true, speed: 4, color: '#000000' },
    { type: 'BlitterFeedback', enabled: true, scale: 31, onBeatScale: 31, blendMode: 'REPLACE' },
    {
      type: 'SuperScope',
      enabled: true,
      drawMode: 'LINES',
      audioSource: 'WAVEFORM',
      audioChannel: 'CENTER',
      colors: ['#ffffff'],
      code: {
        init: 'n=200',
        perFrame: 't=t+0.03',
        onBeat: '',
        perPoint: 'asp=h/w; r=0.4+v*0.15; a=i*$PI*2+t; x=cos(a)*r*asp; y=sin(a)*r; hue=i+t*0.1; red=sin(hue*$PI*2)*0.5+0.5; green=sin((hue+0.333)*$PI*2)*0.5+0.5; blue=sin((hue+0.666)*$PI*2)*0.5+0.5',
      },
    },
  ],
};

const defaultAvs = loadAvsPreset(DEFAULT_PRESET);
viz.setPreset(defaultAvs);
viz.start(audio);

// Current preset JSON (for editor)
let currentPresetJSON = DEFAULT_PRESET;

// --- Splash screen: start system audio capture ---

btnStart.addEventListener('click', startCapture);

async function startCapture() {
  btnStart.textContent = 'CONNECTING...';
  splashStatus.textContent = '';
  splashStatus.classList.remove('error');

  try {
    await audio.switchSource('system');
    dismissSplash();
  } catch (e) {
    console.warn('System audio capture cancelled or failed:', e);
    btnStart.textContent = 'START CAPTURE';
    splashStatus.textContent = 'Capture cancelled \u2014 click to try again';
    splashStatus.classList.add('error');
  }
}

function dismissSplash() {
  splash.classList.add('hidden');
}

// --- Preset switching ---

function setActivePreset(name) {
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  const id = findPresetId(name);
  if (id) {
    const url = new URL(window.location);
    url.searchParams.set('preset', id);
    presetName.innerHTML = '';
    const link = document.createElement('a');
    link.href = url.toString();
    link.textContent = name || '';
    link.className = 'preset-link';
    link.title = 'Click to copy link';
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigator.clipboard.writeText(url.toString()).then(() => {
        link.textContent = 'Link copied!';
        setTimeout(() => { link.textContent = name; }, 1500);
      });
    });
    presetName.appendChild(link);
  } else {
    presetName.textContent = name || '';
  }
}

function loadPresetJSON(json, presetId) {
  try {
    currentPresetJSON = json;
    const preset = loadAvsPreset(json);
    viz.setPreset(preset);
    setActivePreset(preset.name);
    // Update URL with preset ID for sharing
    const id = presetId || findPresetId(preset.name);
    if (id) {
      const url = new URL(window.location);
      url.searchParams.set('preset', id);
      history.replaceState(null, '', url);
    }
    // Check for unsupported/incomplete components
    checkComponentSupport(json);
    // Refresh editor tree if open
    if (!document.getElementById('editor').classList.contains('hidden')) {
      buildEditorTree();
    }
  } catch (e) {
    console.error('Failed to load preset:', e);
  }
}

function checkComponentSupport(json) {
  if (!json.components) return;
  const unsupported = [];
  const incomplete = [];
  const allComps = flattenComponents(json.components);
  for (const c of allComps) {
    if (c._unsupported) {
      unsupported.push(c.type);
    } else if (c.type === 'MilkDropMotion' || c.type === 'CustomShader' || c.type === 'Echo' || c.type === 'DarkenCenter') {
      incomplete.push(c.type);
    }
  }
  if (unsupported.length > 0) {
    showNotification(`Unsupported components: ${unsupported.join(', ')}`, 'error');
  }
  if (incomplete.length > 0) {
    showNotification(`Experimental components (WIP): ${incomplete.join(', ')}`, 'warning');
  }
}

function flattenComponents(comps) {
  const result = [];
  for (const c of comps) {
    result.push(c);
    if (c.components) result.push(...flattenComponents(c.components));
  }
  return result;
}

let notificationTimer = null;
function showNotification(message, level) {
  let el = document.getElementById('preset-notification');
  if (!el) {
    el = document.createElement('div');
    el.id = 'preset-notification';
    el.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:999;padding:8px 18px;border-radius:6px;font-family:Rajdhani,sans-serif;font-size:13px;font-weight:600;opacity:0;transition:opacity 0.5s cubic-bezier(0.4,0,0.2,1);pointer-events:none;max-width:80vw;text-align:center;';
    document.body.appendChild(el);
  }
  clearTimeout(notificationTimer);
  el.textContent = message;
  if (level === 'error') {
    el.style.background = 'rgba(180,40,40,0.92)';
    el.style.color = '#ffaaaa';
    el.style.border = '1px solid rgba(255,80,80,0.4)';
  } else {
    el.style.background = 'rgba(160,120,20,0.92)';
    el.style.color = '#fff3cd';
    el.style.border = '1px solid rgba(255,200,60,0.4)';
  }
  el.style.opacity = '1';
  notificationTimer = setTimeout(() => { el.style.opacity = '0'; }, 3000);
}

/**
 * Load a preset file — handles both .avs (binary) and .json formats.
 */
function loadPresetFile(file) {
  const name = file.name;

  if (name.endsWith('.avs')) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = parseAvsFileWithName(reader.result, name);
        loadPresetJSON(json);
        dismissSplash();
      } catch (err) {
        console.error('Failed to parse .avs file:', err);
      }
    };
    reader.readAsArrayBuffer(file);
  } else if (name.endsWith('.json')) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        loadPresetJSON(JSON.parse(reader.result));
        dismissSplash();
      } catch (err) {
        console.error('Failed to parse preset JSON:', err);
      }
    };
    reader.readAsText(file);
  }
}

// --- Preset Library ---

let _loadedViaUrl = false;

initPresetBrowser((bufferOrJson, filename, presetId) => {
  try {
    let json;
    if (filename === null && typeof bufferOrJson === 'object' && !(bufferOrJson instanceof ArrayBuffer)) {
      json = bufferOrJson;
    } else {
      json = parseAvsFileWithName(bufferOrJson, filename);
    }
    loadPresetJSON(json, presetId);
    // Don't dismiss splash on URL auto-load — user still needs to do screen share
    if (!_loadedViaUrl) dismissSplash();
    _loadedViaUrl = false;
  } catch (err) {
    console.error('Failed to load library preset:', err);
  }
});

btnPresets.addEventListener('click', () => {
  if (isPresetLibraryOpen()) {
    closePresetLibrary();
  } else {
    openPresetLibrary();
  }
});

// --- Help dialog ---
initHelp();

// --- URL preset parameter ---
// Check for ?preset=<id> and auto-load (but keep splash for screen share)
{
  const params = new URLSearchParams(window.location.search);
  const presetParam = params.get('preset');
  if (presetParam) {
    _loadedViaUrl = true;
    loadPresetById(presetParam);
  }
}

// --- File Loader ---

// Persistent file input for Load button (some browsers block dynamic input.click())
const _fileInput = document.createElement('input');
_fileInput.type = 'file';
_fileInput.accept = '.avs,.json';
_fileInput.style.cssText = 'position:absolute;top:-9999px;left:-9999px;';
document.body.appendChild(_fileInput);
_fileInput.addEventListener('change', () => {
  if (_fileInput.files.length > 0) loadPresetFile(_fileInput.files[0]);
  _fileInput.value = ''; // reset so same file can be re-loaded
});

btnLoadPreset.addEventListener('click', () => {
  _fileInput.click();
});

// --- Editor Panel ---

const editor = document.getElementById('editor');
const editorTree = document.getElementById('editor-tree');
const btnEditorClose = document.getElementById('btn-editor-close');
const btnEdAdd = document.getElementById('btn-ed-add');
const btnEdRemove = document.getElementById('btn-ed-remove');
const btnEdUp = document.getElementById('btn-ed-up');
const btnEdDown = document.getElementById('btn-ed-down');
const btnEdNew = document.getElementById('btn-ed-new');
const componentPicker = document.getElementById('component-picker');
const btnPickerClose = document.getElementById('btn-picker-close');
const contextMenu = document.getElementById('editor-context-menu');

// --- Selection state ---
// selectedPath is an array of indices tracing from root components to the selected node.
// e.g. [2] means currentPresetJSON.components[2]
// e.g. [0, 3] means currentPresetJSON.components[0].components[3]
let selectedPath = null;
// addMode: 'after' = insert after selected, 'into' = insert into EffectList
let pickerAddMode = 'after';

btnEditor.addEventListener('click', () => {
  editor.classList.toggle('hidden');
  if (!editor.classList.contains('hidden')) {
    buildEditorTree();
  }
});

btnEditorClose.addEventListener('click', () => {
  editor.classList.add('hidden');
});

// Component category classification
const RENDER_TYPES = ['SuperScope','Simple','Ring','Starfield','DotPlane','DotGrid','DotFountain',
  'BassSpin','RotatingStars','Timescope','ClearScreen','OnBeatClear','Texer','Acko.net: Texer II',
  'Triangle','Picture','MovingParticle'];
const TRANS_TYPES = ['FadeOut','Movement','DynamicMovement','Blur','Invert','Mirror','Mosaic',
  'Brightness','FastBrightness','ColorModifier','ChannelShift','ColorClip','Grain','Interleave',
  'ColorFade','UniqueTone','Scatter','BlitterFeedback','RotoBlitter','Water','WaterBump','Bump',
  'Interferences','DynamicShift','DynamicDistanceModifier','ColorMap',
  'Holden03: Convolution Filter'];

// Display name overrides for APE components with long IDs
const DISPLAY_NAMES = {
  'Holden03: Convolution Filter': 'Convolution Filter',
  'Acko.net: Texer II': 'Texer II',
  'Render: Triangle': 'Triangle',
  'Picture II': 'Picture II',
  'EelTrans': 'AVSTrans Automation',
  'Jheriko: Global': 'Global Variables',
};

// Components confirmed as finished/working by the user.
// Everything NOT in this set gets a yellow "under construction" marker in the editor.
// Add component type names here as they are verified.
const FINISHED_COMPONENTS = new Set([
  'Comment',
  'FadeOut',
  'EelTrans',
  'Blur',
  'Multiplier',
  'FastBrightness',
  'BlitterFeedback',
  'Holden03: Convolution Filter',
  'Mirror',
  'Invert',
  'UniqueTone',
]);

// Known select-type fields and their options
// Pretty display names for enum values
const PRETTY_NAMES = {
  REPLACE: 'Replace', ADDITIVE: 'Additive', FIFTY_FIFTY: '50/50',
  MAXIMUM: 'Maximum', MINIMUM: 'Minimum', MULTIPLY: 'Multiply',
  SUB_DEST_SRC: 'Sub (Dst-Src)', SUB_SRC_DEST: 'Sub (Src-Dst)',
  EVERY_OTHER_LINE: 'Every Other Line', EVERY_OTHER_PIXEL: 'Every Other Pixel',
  XOR: 'XOR (TODO)', ADJUSTABLE: 'Adjustable', IGNORE: 'Ignore', BUFFER: 'Buffer (TODO)',
  WAVEFORM: 'Waveform', SPECTRUM: 'Spectrum',
  LEFT: 'Left', RIGHT: 'Right', CENTER: 'Center',
  DOTS: 'Dots', LINES: 'Lines', SOLID: 'Solid',
  TOP: 'Top', BOTTOM: 'Bottom', CARTESIAN: 'Cartesian', POLAR: 'Polar',
  BEAT_RANDOM: 'Beat Random', BEAT_SEQUENTIAL: 'Beat Sequential', NONE: 'None',
  '(R+G+B)/2': '(R+G+B)/2', '(R+G+B)/3': '(R+G+B)/3',
};

// Context-aware pretty names for numeric dropdown values
const NUMERIC_PRETTY = {
  action: { 0: 'Save', 1: 'Restore', 2: 'Alt. Save/Restore', 3: 'Alt. Restore/Save' },
  clearMode: { 0: 'Clear', 1: 'No Clear' },
  mode: { 0: 'Left \u2192 Right', 1: 'Right \u2192 Left', 2: 'Top \u2192 Bottom', 3: 'Bottom \u2192 Top' },
  colorFilter: { 0: 'Off', 1: 'On (Multiply)' },
};

const BLEND_OPTIONS = ['REPLACE', 'ADDITIVE', 'FIFTY_FIFTY', 'MAXIMUM', 'MINIMUM', 'MULTIPLY', 'SUB_DEST_SRC', 'SUB_SRC_DEST', 'EVERY_OTHER_LINE', 'EVERY_OTHER_PIXEL', 'XOR', 'ADJUSTABLE'];
const BLEND_IO_OPTIONS = ['IGNORE', ...BLEND_OPTIONS, 'BUFFER'];

// Line blend mode options for SetRenderMode (integer indices matching AVS)
const LINE_BLEND_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

const SELECT_FIELDS = {
  drawMode: ['DOTS', 'LINES'],
  audioSource: ['WAVEFORM', 'SPECTRUM'],
  audioChannel: ['LEFT', 'RIGHT', 'CENTER'],
  input: BLEND_IO_OPTIONS,
  output: BLEND_IO_OPTIONS,
  renderType: ['DOTS', 'LINES', 'SOLID'],
  positionY: ['TOP', 'CENTER', 'BOTTOM'],
  blendMode: BLEND_OPTIONS,
  onBeatBlendMode: BLEND_OPTIONS,
  onBeatAction: ['NONE', 'RANDOM', 'REVERSE'],
  sourceChannel: ['ZERO', 'RED', 'GREEN', 'BLUE'],
  coordinates: ['POLAR', 'CARTESIAN'],
  coord: ['POLAR', 'CARTESIAN'],
  action: [0, 1, 2, 3],
  clearMode: [0, 1],
  key: ['RED', 'GREEN', 'BLUE', '(R+G+B)/2', 'MAX', '(R+G+B)/3'],
  mapCycleMode: ['NONE', 'BEAT_RANDOM', 'BEAT_SEQUENTIAL'],
  colorFilter: [0, 1, 2, 3],
  mode: [0, 1, 2, 3],
};

// Default component values
const DEFAULTS = {
  SuperScope: { type: 'SuperScope', enabled: true, code: { init: 'n=100', perFrame: '', onBeat: '', perPoint: 'x=i*2-1; y=v' }, drawMode: 'LINES', colors: ['#ffffff'], audioSource: 'WAVEFORM', audioChannel: 'CENTER' },
  Simple: { type: 'Simple', enabled: true, audioSource: 'WAVEFORM', renderType: 'LINES', audioChannel: 'CENTER', positionY: 'CENTER', colors: ['#ffffff'] },
  Ring: { type: 'Ring', enabled: true, source: 0, size: 0.5, colors: ['#ffffff'] },
  Starfield: { type: 'Starfield', enabled: true, speed: 16, stars: 350, onBeatAction: 'NONE', onBeatSpeed: 24, color: '#ffffff', blendMode: 'REPLACE' },
  DotPlane: { type: 'DotPlane', enabled: true, rotationSpeed: 4, colorTop: '#0000ff', colorBottom: '#ffffff', angle: 0 },
  DotGrid: { type: 'DotGrid', enabled: true, color: '#ffffff', spacing: 8, speed: 5 },
  DotFountain: { type: 'DotFountain', enabled: true, color: '#ffffff', speed: 5, angle: 0 },
  BassSpin: { type: 'BassSpin', enabled: true, speed: 1000, mode: 0 },
  RotatingStars: { type: 'RotatingStars', enabled: true, colors: ['#ffffff'] },
  Timescope: { type: 'Timescope', enabled: true, color: '#ffffff', blendMode: 'REPLACE', bands: 0 },
  ClearScreen: { type: 'ClearScreen', enabled: true, color: '#000000', blendMode: 'REPLACE' },
  OnBeatClear: { type: 'OnBeatClear', enabled: true, color: '#000000', blendMode: 'REPLACE', nBeats: 1 },
  Texer: { type: 'Texer', enabled: true, imageSrc: '', numParticles: 100 },
  'Acko.net: Texer II': { type: 'Acko.net: Texer II', enabled: true, imageSrc: '', colorFilter: 1, wrap: false, resize: true, code: { init: 'n=100', perFrame: '', onBeat: '', perPoint: 'x=i*2-1; y=-v*0.5; sizex=1; sizey=1' } },
  Picture: { type: 'Picture', enabled: true, imageSrc: '', blendMode: 0, onBeatBlendMode: 0 },
  Triangle: { type: 'Triangle', enabled: true, code: { init: 'n=3', perFrame: 't=t+0.02', onBeat: '', perPoint: 'a=i*$PI*2+t; r=0.4+v*0.2;\nx1=cos(a)*r; y1=sin(a)*r;\nx2=cos(a+0.3)*r*0.6; y2=sin(a+0.3)*r*0.6;\nx3=cos(a-0.3)*r*0.6; y3=sin(a-0.3)*r*0.6;\nred1=sin(i*$PI*2)*0.5+0.5; green1=cos(i*$PI*4)*0.5+0.5; blue1=0.7' } },
  VertexTriangles: { type: 'VertexTriangles', enabled: true, code: { init: 'n=6', perFrame: 't=t+0.05', onBeat: '', perPoint: 'a=i*$PI*2+t; r1=0.3+v*0.2; x=cos(a)*r1; y=sin(a)*r1; red=sin(a)*0.5+0.5; green=cos(a)*0.5+0.5; blue=0.5' }, colors: ['#ffffff'], audioSource: 'WAVEFORM', audioChannel: 'CENTER' },
  MovingParticle: { type: 'MovingParticle', enabled: true, color: '#ffffff', maxdist: 16, size: 8, size2: 8, blend: 1 },
  FadeOut: { type: 'FadeOut', enabled: true, speed: 7, color: '#000000' },
  Movement: { type: 'Movement', enabled: true, builtinEffect: 13, code: 'd=d*0.9', bilinear: true, wrap: false, coordinates: 'POLAR', sourceMapped: false },
  DynamicMovement: { type: 'DynamicMovement', enabled: true, code: { init: '', perFrame: '', onBeat: '', perPoint: '' }, bilinear: true, wrap: false, coordinates: 'CARTESIAN', gridW: 16, gridH: 16, blend: false, buffer: 0 },
  Blur: { type: 'Blur', enabled: true, mode: 0 },
  Invert: { type: 'Invert', enabled: true },
  Mirror: { type: 'Mirror', enabled: true, mode: 0 },
  Mosaic: { type: 'Mosaic', enabled: true, squareSize: 8, onBeatSquareSize: 8, blendMode: 'REPLACE', onBeatSizeChange: false, onBeatDuration: 15 },
  Brightness: { type: 'Brightness', enabled: true, red: 0, green: 0, blue: 0, separate: false, excludeColor: '#000000', exclude: false, distance: 16 },
  FastBrightness: { type: 'FastBrightness', enabled: true, amount: 1 },
  ColorModifier: { type: 'ColorModifier', enabled: true, code: { init: '', perFrame: '', onBeat: '', perPoint: '' } },
  ChannelShift: { type: 'ChannelShift', enabled: true, mode: 0, onBeatRandom: false },
  ColorClip: { type: 'ColorClip', enabled: true, mode: 0, colorOutBelow: '#000000', colorOutAbove: '#ffffff', colorClipNear: '#000000', colorClipFar: '#ffffff', distance: 16 },
  Grain: { type: 'Grain', enabled: true, amount: 10, static: false, blendMode: 'REPLACE' },
  Interleave: { type: 'Interleave', enabled: true, x: 2, y: 2, blendMode: 'REPLACE', onBeatX: 2, onBeatY: 2, onBeatDuration: 15, onBeatEnable: false },
  ColorFade: { type: 'ColorFade', enabled: true, fader1: 8, fader2: 0, fader3: 0, beatFader1: 0, beatFader2: 0, beatFader3: 0, onBeat: false },
  UniqueTone: { type: 'UniqueTone', enabled: true, color: '#ff8000', blendMode: 'REPLACE', invert: false },
  Scatter: { type: 'Scatter', enabled: true, amount: 0 },
  BlitterFeedback: { type: 'BlitterFeedback', enabled: true, scale: 28, onBeatScale: 28, blendMode: 0 },
  RotoBlitter: { type: 'RotoBlitter', enabled: true, zoom: 256, rotate: 0, blendMode: 'REPLACE', onBeatReverse: false, onBeatZoom: 0, bilinear: true },
  Water: { type: 'Water', enabled: true },
  WaterBump: { type: 'WaterBump', enabled: true, density: 6, depth: 40, random: true, dropPositionX: 0, dropPositionY: 0, dropRadius: 40, method: 0 },
  Bump: { type: 'Bump', enabled: true, code: { init: '', perFrame: '', onBeat: '', perPoint: '' }, showDot: false, depth: 30, blend: false, blendMode: 'REPLACE', bilinear: true },
  Interferences: { type: 'Interferences', enabled: true, nPoints: 2, distance: 14, alpha: 128, rotation: 0, speed: 1, onBeatDistance: 14, onBeat: false, blendMode: 'REPLACE', separate: false },
  DynamicShift: { type: 'DynamicShift', enabled: true, code: { init: '', perFrame: '', onBeat: '', perPoint: '' }, blendMode: 'REPLACE', bilinear: true },
  DynamicDistanceModifier: { type: 'DynamicDistanceModifier', enabled: true, code: { init: '', perFrame: '', onBeat: '', perPoint: '' }, blendMode: 'REPLACE', bilinear: true },
  EffectList: { type: 'EffectList', enabled: true, input: 'IGNORE', output: 'REPLACE', clearFrame: true, components: [] },
  BufferSave: { type: 'BufferSave', enabled: true, action: 0, buffer: 0, blendMode: 'REPLACE' },
  SetRenderMode: { type: 'SetRenderMode', enabled: true, blend: 0, alpha: 128, lineSize: 1 },
  Comment: { type: 'Comment', enabled: true, text: '' },
  'Holden03: Convolution Filter': { type: 'Holden03: Convolution Filter', enabled: true, kernel: (() => { const k = new Array(49).fill(0); k[17]=-1; k[23]=-1; k[24]=5; k[25]=-1; k[31]=-1; return k; })(), scale: 1, bias: 0, wrap: false, absolute: false, twoPass: false },
  ColorMap: { type: 'ColorMap', enabled: true, key: 'RED', output: 'REPLACE', mapCycleMode: 'SINGLE', maps: [] },
};

function getDefaultComponent(type) {
  if (DEFAULTS[type]) {
    return JSON.parse(JSON.stringify(DEFAULTS[type]));
  }
  return { type, enabled: true };
}

function getCategory(type) {
  if (type === 'EffectList') return 'container';
  if (RENDER_TYPES.includes(type)) return 'render';
  if (TRANS_TYPES.includes(type)) return 'trans';
  return 'misc';
}

function getIcon(type, cat) {
  if (cat === 'container') return '\u25A3';
  if (cat === 'render') return '\u25CF';
  if (cat === 'trans') return '\u25C6';
  if (type === 'Comment') return '\u2759';
  if (type === 'SetRenderMode') return '\u2699';
  if (type === 'BufferSave') return '\u29C9';
  return '\u25CB';
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatSliderValue(key, val) {
  const k = key.toLowerCase();
  // BlitterFeedback scale/onBeatScale: 32=1.00x, 0=inf zoom in, 63=~2x zoom out
  if (k === 'scale' || k === 'onbeatscale') {
    if (val === 0) return 'MAX';
    return (val / 32).toFixed(2) + 'x';
  }
  return Number.isInteger(val) ? String(val) : val.toFixed(3);
}

function getSliderRange(key, val) {
  const k = key.toLowerCase();
  // Speed: FadeOut uses 0-92 integers, others use 0-1 float
  if (k === 'speed') {
    return val > 1 ? { min: 0, max: 92, step: 1 } : { min: 0, max: 1, step: 0.005 };
  }
  if (k === 'opacity' || k === 'alpha' || k === 'adjustblend') {
    return { min: 0, max: 1, step: 0.005 };
  }
  // Zoom/scale values
  if (k === 'zoom' || k === 'scale' || k === 'onbeatzoom' || k === 'onbeatscale') {
    return { min: 0, max: 64, step: 1 };
  }
  // Effect index
  if (k === 'builtineffect' || k === 'effectindex') {
    return { min: 0, max: 23, step: 1 };
  }
  // Mode selectors
  if (k === 'mode' || k === 'blendmode' || k === 'clearmode' || k === 'action') {
    return { min: 0, max: 12, step: 1 };
  }
  // Grid size
  if (k === 'gridw' || k === 'gridh') {
    return { min: 2, max: 64, step: 1 };
  }
  // Size/thickness
  if (k === 'thickness' || k === 'linesize' || k === 'squaresize') {
    return { min: 1, max: 32, step: 1 };
  }
  // Particle sizes
  if (k === 'size' || k === 'size2') {
    return { min: 1, max: 128, step: 1 };
  }
  // Max distance
  if (k === 'maxdist') {
    return { min: 1, max: 64, step: 1 };
  }
  // Point count
  if (k === 'numstars' || k === 'numcolors' || k === 'numlayers' || k === 'sides') {
    return { min: 1, max: 4096, step: 1 };
  }
  // Rotation speed
  if (k.includes('rot') && k.includes('speed') || k === 'rotspeed') {
    return { min: -50, max: 50, step: 1 };
  }
  // Angle (degrees)
  if (k === 'angle') {
    return { min: -90, max: 90, step: 1 };
  }
  // Other rotation values (radians)
  if (k.includes('rot') || k === 'distance') {
    return { min: -6.28, max: 6.28, step: 0.01 };
  }
  // Density
  if (k === 'density') {
    return { min: 1, max: 10, step: 1 };
  }
  // Spacing
  if (k === 'spacing' || k === 'bands') {
    return { min: 1, max: 128, step: 1 };
  }
  // Convolution bias/scale
  if (k === 'bias') {
    return { min: -256, max: 256, step: 1 };
  }
  if (k === 'scale' && Math.abs(val) <= 1000) {
    return { min: -256, max: 256, step: 1 };
  }
  // Brightness offsets
  if (k === 'red' || k === 'green' || k === 'blue') {
    if (Math.abs(val) > 1) return { min: -4096, max: 4096, step: 1 };
    return { min: -1, max: 1, step: 0.01 };
  }
  // Generic: derive from current value
  if (Number.isInteger(val)) {
    const absVal = Math.abs(val) || 10;
    return { min: 0, max: Math.max(absVal * 4, 100), step: 1 };
  }
  return { min: -2, max: 2, step: 0.001 };
}

// --- Path-based JSON navigation ---

function getComponentAtPath(path) {
  if (!path || path.length === 0 || !currentPresetJSON) return null;
  let arr = currentPresetJSON.components;
  for (let i = 0; i < path.length - 1; i++) {
    const comp = arr[path[i]];
    if (!comp || !comp.components) return null;
    arr = comp.components;
  }
  return arr[path[path.length - 1]] || null;
}

function getParentArray(path) {
  if (!path || path.length === 0 || !currentPresetJSON) return null;
  let arr = currentPresetJSON.components;
  for (let i = 0; i < path.length - 1; i++) {
    const comp = arr[path[i]];
    if (!comp || !comp.components) return null;
    arr = comp.components;
  }
  return arr;
}

function getSelectedIndex() {
  if (!selectedPath || selectedPath.length === 0) return -1;
  return selectedPath[selectedPath.length - 1];
}

// --- Rebuild preset (the key function) ---

function rebuildPreset() {
  if (!currentPresetJSON) return;
  try {
    const preset = loadAvsPreset(currentPresetJSON);
    viz.setPreset(preset);
    setActivePreset(currentPresetJSON.name || 'Preset');
  } catch (e) {
    console.error('Failed to rebuild preset:', e);
  }
  buildEditorTree();
}

/**
 * Hot-reload a single component without rebuilding the entire preset.
 * Finds the component's path in the JSON tree and asks the renderer
 * to replace just that component, preserving the framebuffer.
 */
function updateComponent(comp) {
  if (!currentPresetJSON || !currentPresetJSON.components) {
    rebuildPreset();
    return;
  }
  const path = findComponentPath(currentPresetJSON.components, comp);
  if (path) {
    viz.hotReloadComponent(path, comp);
  } else {
    // Couldn't find it — fall back to full rebuild
    rebuildPreset();
  }
}

function findComponentPath(components, target, prefix) {
  prefix = prefix || [];
  for (let i = 0; i < components.length; i++) {
    if (components[i] === target) return [...prefix, i];
    if (components[i].components) {
      const found = findComponentPath(components[i].components, target, [...prefix, i]);
      if (found) return found;
    }
  }
  return null;
}

// --- Toolbar button states ---

function updateToolbarState() {
  const hasPreset = !!currentPresetJSON;
  const hasSel = hasPreset && selectedPath !== null;
  const comp = hasSel ? getComponentAtPath(selectedPath) : null;
  const parentArr = hasSel ? getParentArray(selectedPath) : null;
  const idx = getSelectedIndex();

  btnEdAdd.disabled = !hasPreset;
  btnEdRemove.disabled = !hasSel;
  btnEdUp.disabled = !hasSel || idx <= 0;
  btnEdDown.disabled = !hasSel || !parentArr || idx >= parentArr.length - 1;
}

// --- Tree building (with path tracking and editable details) ---

function buildEditorTree() {
  if (!currentPresetJSON) {
    editorTree.innerHTML = '<div class="editor-empty">Load a preset to see its component tree</div>';
    updateToolbarState();
    return;
  }

  const json = currentPresetJSON;
  const container = document.createElement('div');

  // Preset header row (editable name + clearFrame)
  const presetRow = document.createElement('div');
  presetRow.className = 'tree-row';
  presetRow.style.paddingLeft = '12px';
  presetRow.dataset.pathType = 'root';
  presetRow.innerHTML = `
    <span class="tree-icon container">\u25A3</span>
    <input class="ed-preset-name" type="text" value="${escHtml(json.name || 'Preset')}" title="Preset name" />
    <label style="display:flex;align-items:center;gap:4px;margin-left:8px;font-size:11px;color:var(--text-dim);cursor:pointer;">
      <input type="checkbox" class="ed-input" ${json.clearFrame ? 'checked' : ''} data-field="clearFrame" style="width:14px;height:14px;" />
      CLR
    </label>
  `;
  container.appendChild(presetRow);

  // Preset name edit
  const nameInput = presetRow.querySelector('.ed-preset-name');
  nameInput.addEventListener('change', () => {
    currentPresetJSON.name = nameInput.value;
    setActivePreset(nameInput.value);
  });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); });

  // ClearFrame toggle
  const clrCheck = presetRow.querySelector('[data-field="clearFrame"]');
  clrCheck.addEventListener('change', () => {
    currentPresetJSON.clearFrame = clrCheck.checked;
    rebuildPreset();
  });

  // Build component nodes
  buildTreeNodesDom(container, json.components || [], 1, []);

  editorTree.innerHTML = '';
  editorTree.appendChild(container);

  updateToolbarState();

  // Scroll selected into view if exists
  const selRow = editorTree.querySelector('.tree-row.node-selected');
  if (selRow) {
    selRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function buildTreeNodesDom(parentEl, components, depth, basePath) {
  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    const path = [...basePath, i];
    const pathStr = path.join(',');
    const cat = getCategory(comp.type);
    const icon = getIcon(comp.type, cat);
    const hasChildren = comp.type === 'EffectList';
    const indent = depth * 16;
    const disabled = comp.enabled === false;
    const unsupported = comp._unsupported;
    const wip = !unsupported && !FINISHED_COMPONENTS.has(comp.type);
    const isSelected = selectedPath && selectedPath.join(',') === pathStr;

    const node = document.createElement('div');
    node.className = 'tree-node';

    // Row
    const row = document.createElement('div');
    row.className = 'tree-row' + (isSelected ? ' node-selected' : '');
    row.style.paddingLeft = indent + 'px';
    row.dataset.path = pathStr;
    row.draggable = true;

    const labelClass = disabled ? ' disabled' : unsupported ? ' unsupported-label' : wip ? ' wip-label' : '';
    const iconContent = unsupported ? '\u26A0' : wip ? '\u{1F6A7}' : icon;
    const iconClass = unsupported ? 'unsupported' : cat;

    row.innerHTML = `
      <span class="tree-toggle ${hasChildren ? 'open' : 'leaf'}">\u25B6</span>
      <span class="tree-icon ${iconClass}">${iconContent}</span>
      <span class="tree-label${labelClass}">${escHtml(DISPLAY_NAMES[comp.type] || comp.type)}</span>
      ${(cat !== 'container' && cat !== 'misc' && !unsupported) ? `<span class="tree-badge ${cat}">${cat}</span>` : ''}
      ${unsupported ? '<span class="tree-badge unsupported-badge">UNSUPPORTED</span>' : ''}
      ${comp.drawMode ? `<span class="tree-badge misc">${escHtml(comp.drawMode)}</span>` : ''}
      ${comp.type === 'EffectList' ? `<span class="tree-badge misc">${(comp.input||'IGN').slice(0,3)}/${(comp.output||'IGN').slice(0,3)}</span>` : ''}
    `;
    node.appendChild(row);

    // Detail pane
    const detail = document.createElement('div');
    detail.className = 'tree-detail';
    detail.style.display = isSelected ? 'block' : 'none';
    buildDetailDom(detail, comp, path);
    node.appendChild(detail);

    // Children container for EffectLists
    if (hasChildren) {
      const childrenDiv = document.createElement('div');
      childrenDiv.className = 'tree-children';
      buildTreeNodesDom(childrenDiv, comp.components || [], depth + 1, path);
      node.appendChild(childrenDiv);
    }

    // Row click: select this node
    row.addEventListener('click', (e) => {
      // Don't select if clicking inside an input/select/textarea/button in detail
      if (e.target.closest('.tree-detail')) return;

      const toggle = row.querySelector('.tree-toggle');
      const childrenDiv = node.querySelector(':scope > .tree-children');

      // Toggle collapse on EffectList arrow click
      if (e.target.closest('.tree-toggle') && childrenDiv) {
        childrenDiv.classList.toggle('collapsed');
        toggle.classList.toggle('open');
        return;
      }

      // Select/deselect
      const wasSelected = selectedPath && selectedPath.join(',') === pathStr;
      if (wasSelected) {
        selectedPath = null;
        row.classList.remove('node-selected');
        detail.style.display = 'none';
      } else {
        // Deselect previous
        editorTree.querySelectorAll('.tree-row.node-selected').forEach(r => {
          r.classList.remove('node-selected');
          const d = r.parentElement.querySelector(':scope > .tree-detail');
          if (d) d.style.display = 'none';
        });
        selectedPath = path;
        row.classList.add('node-selected');
        detail.style.display = 'block';

        // Expand parent EffectList children if collapsed
        if (childrenDiv) {
          childrenDiv.classList.remove('collapsed');
          toggle.classList.add('open');
        }
      }
      updateToolbarState();
    });

    // Right-click context menu
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Select this node
      editorTree.querySelectorAll('.tree-row.node-selected').forEach(r => {
        r.classList.remove('node-selected');
        const d = r.parentElement.querySelector(':scope > .tree-detail');
        if (d) d.style.display = 'none';
      });
      selectedPath = path;
      row.classList.add('node-selected');
      detail.style.display = 'block';
      updateToolbarState();

      showContextMenu(e.clientX, e.clientY, comp);
    });

    // Drag start: store source path
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', pathStr);
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      editorTree.querySelectorAll('.drag-over-above, .drag-over-below, .drag-over-into').forEach(
        el => el.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-into')
      );
    });

    // Drop target: each row can receive drops above, below, or into (if EffectList)
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      // Determine drop position: top third = above, bottom third = below, middle = into (if EffectList)
      const rect = row.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const third = rect.height / 3;
      row.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-into');
      if (y < third) {
        row.classList.add('drag-over-above');
      } else if (y > third * 2 || !hasChildren) {
        row.classList.add('drag-over-below');
      } else {
        row.classList.add('drag-over-into');
      }
    });
    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-into');
    });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-into');

      const srcPathStr = e.dataTransfer.getData('text/plain');
      if (!srcPathStr || srcPathStr === pathStr) return;
      const srcPath = srcPathStr.split(',').map(Number);
      const dstPath = path;

      // Determine drop mode
      const rect = row.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const third = rect.height / 3;
      let dropMode = y < third ? 'above' : (y > third * 2 || !hasChildren ? 'below' : 'into');

      // Get source component and remove from original position
      const srcArr = getParentArray(srcPath);
      const srcIdx = srcPath[srcPath.length - 1];
      if (!srcArr || srcIdx < 0 || srcIdx >= srcArr.length) return;
      const [moved] = srcArr.splice(srcIdx, 1);

      // Determine destination
      if (dropMode === 'into' && hasChildren) {
        // Drop into EffectList
        const dstComp = getComponentAtPath(dstPath);
        if (dstComp && dstComp.components) {
          dstComp.components.push(moved);
        }
      } else {
        // Drop above or below a sibling
        const dstArr = getParentArray(dstPath);
        let dstIdx = dstPath[dstPath.length - 1];
        if (!dstArr) return;
        // Adjust index if source was before destination in the same array
        if (srcArr === dstArr && srcIdx < dstIdx) dstIdx--;
        if (dropMode === 'below') dstIdx++;
        dstArr.splice(dstIdx, 0, moved);
      }

      selectedPath = null;
      rebuildPreset();
    });

    parentEl.appendChild(node);
  }
}

// --- Editable detail pane ---

function buildDetailDom(container, comp, path) {
  container.innerHTML = '';

  const skipKeys = ['type', 'components', 'code', 'group', 'colors', 'kernel', 'maps'];
  // SetRenderMode has a custom UI for these fields
  if (comp.type === 'SetRenderMode') skipKeys.push('blend', 'alpha', 'lineSize');
  const props = Object.entries(comp).filter(([k]) => !skipKeys.includes(k) && !k.startsWith('_'));

  if (props.length > 0) {
    const section = document.createElement('div');
    section.className = 'tree-detail-section';
    section.innerHTML = '<div class="tree-detail-label">PROPERTIES</div>';

    for (const [key, val] of props) {
      const propDiv = document.createElement('div');
      propDiv.className = 'tree-detail-prop';

      const keySpan = document.createElement('span');
      keySpan.className = 'key';
      keySpan.textContent = key;
      propDiv.appendChild(keySpan);

      const valSpan = document.createElement('span');
      valSpan.className = 'val val-edit';

      // Determine input type
      if (SELECT_FIELDS[key]) {
        const sel = document.createElement('select');
        sel.className = 'ed-select';
        for (const opt of SELECT_FIELDS[key]) {
          const o = document.createElement('option');
          o.value = opt;
          const numPretty = NUMERIC_PRETTY[key] && NUMERIC_PRETTY[key][opt];
          o.textContent = numPretty || PRETTY_NAMES[opt] || opt;
          if (String(val) === String(opt)) o.selected = true;
          sel.appendChild(o);
        }
        sel.addEventListener('change', () => {
          const newVal = typeof val === 'number' ? Number(sel.value) : sel.value;
          comp[key] = newVal;
          updateComponent(comp);
        });
        valSpan.appendChild(sel);
        // Show adjustable blend slider when ADJUSTABLE is selected
        if ((key === 'blendMode' || key === 'onBeatBlendMode' || key === 'input' || key === 'output') && String(val) === 'ADJUSTABLE') {
          const adjKey = key + 'Adjust';
          const adjVal = comp[adjKey] !== undefined ? comp[adjKey] : (comp.adjustBlend !== undefined ? comp.adjustBlend : 128);
          const adjWrap = document.createElement('div');
          adjWrap.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:4px;';
          const adjLabel = document.createElement('span');
          adjLabel.className = 'key';
          adjLabel.textContent = 'blend %';
          adjLabel.style.minWidth = '50px';
          const adjSlider = document.createElement('input');
          adjSlider.type = 'range';
          adjSlider.className = 'ed-slider';
          adjSlider.min = 0; adjSlider.max = 255; adjSlider.step = 1;
          adjSlider.value = adjVal;
          const adjNum = document.createElement('input');
          adjNum.type = 'number';
          adjNum.className = 'ed-input';
          adjNum.value = adjVal;
          adjNum.style.width = '55px'; adjNum.style.flexShrink = '0';
          adjSlider.addEventListener('input', () => {
            adjNum.value = adjSlider.value;
            comp[adjKey] = Number(adjSlider.value);
            if (comp.adjustBlend !== undefined) comp.adjustBlend = Number(adjSlider.value);
            updateComponent(comp);
          });
          adjNum.addEventListener('change', () => {
            adjSlider.value = adjNum.value;
            comp[adjKey] = Number(adjNum.value);
            updateComponent(comp);
          });
          adjWrap.appendChild(adjLabel);
          adjWrap.appendChild(adjSlider);
          adjWrap.appendChild(adjNum);
          valSpan.appendChild(adjWrap);
        }
      } else if (typeof val === 'boolean') {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'ed-input';
        cb.checked = val;
        cb.addEventListener('change', () => {
          comp[key] = cb.checked;
          updateComponent(comp);
        });
        valSpan.appendChild(cb);
      } else if (typeof val === 'number') {
        // Slider + number input combo
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;gap:6px;align-items:center;width:100%;';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'ed-slider';
        // Guess reasonable min/max/step from key name and current value
        const range = getSliderRange(key, val);
        slider.min = range.min;
        slider.max = range.max;
        slider.step = range.step;
        slider.value = val;

        const numInp = document.createElement('input');
        numInp.type = 'number';
        numInp.className = 'ed-input';
        numInp.value = formatSliderValue(key, val);
        numInp.step = range.step;
        numInp.style.width = '65px';
        numInp.style.flexShrink = '0';

        // Show value during drag without rebuilding preset (smooth dragging)
        slider.addEventListener('input', () => {
          numInp.value = formatSliderValue(key, Number(slider.value));
        });
        // Only rebuild preset on release (change event)
        slider.addEventListener('change', () => {
          const v = Number(slider.value);
          numInp.value = formatSliderValue(key, v);
          comp[key] = v;
          updateComponent(comp);
        });
        numInp.addEventListener('change', () => {
          const v = Number(numInp.value);
          slider.value = v;
          comp[key] = v;
          updateComponent(comp);
        });
        wrap.appendChild(slider);
        wrap.appendChild(numInp);
        valSpan.appendChild(wrap);
      } else if (typeof val === 'string') {
        // Check if it looks like a color
        if (/^#[0-9a-fA-F]{6}$/.test(val) || (key.toLowerCase().includes('color') && val.startsWith('#'))) {
          const colorInp = document.createElement('input');
          colorInp.type = 'color';
          colorInp.className = 'ed-input';
          colorInp.value = val;
          colorInp.addEventListener('change', () => {
            comp[key] = colorInp.value;
            updateComponent(comp);
          });
          valSpan.appendChild(colorInp);
        } else {
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.className = 'ed-input';
          inp.value = val;
          inp.addEventListener('change', () => {
            comp[key] = inp.value;
            updateComponent(comp);
          });
          valSpan.appendChild(inp);
        }
      } else if (Array.isArray(val)) {
        const span = document.createElement('span');
        span.textContent = val.length + ' items';
        span.style.color = 'var(--text-dim)';
        span.style.fontSize = '12px';
        valSpan.appendChild(span);
      } else if (typeof val === 'object' && val !== null) {
        const span = document.createElement('span');
        span.textContent = JSON.stringify(val);
        span.style.color = 'var(--text-dim)';
        span.style.fontSize = '11px';
        span.style.wordBreak = 'break-all';
        valSpan.appendChild(span);
      } else {
        valSpan.textContent = String(val);
      }

      propDiv.appendChild(valSpan);
      section.appendChild(propDiv);
    }
    container.appendChild(section);
  }

  // Colors (editable)
  if (comp.colors && Array.isArray(comp.colors)) {
    const section = document.createElement('div');
    section.className = 'tree-detail-section';
    section.innerHTML = '<div class="tree-detail-label">COLORS</div>';

    const colorRow = document.createElement('div');
    colorRow.className = 'ed-color-row';

    function rebuildColors() {
      colorRow.innerHTML = '';
      comp.colors.forEach((c, ci) => {
        const swatch = document.createElement('span');
        swatch.className = 'ed-color-swatch';

        const colorInp = document.createElement('input');
        colorInp.type = 'color';
        colorInp.className = 'ed-input';
        colorInp.value = c;
        colorInp.style.width = '24px';
        colorInp.style.height = '24px';
        colorInp.title = c;
        colorInp.addEventListener('change', () => {
          comp.colors[ci] = colorInp.value;
          updateComponent(comp);
        });
        swatch.appendChild(colorInp);

        // Remove button
        const removeBtn = document.createElement('button');
        removeBtn.className = 'ed-color-remove';
        removeBtn.textContent = 'x';
        removeBtn.title = 'Remove color';
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          comp.colors.splice(ci, 1);
          rebuildColors();
          updateComponent(comp);
        });
        swatch.appendChild(removeBtn);

        colorRow.appendChild(swatch);
      });

      // Add color button
      const addBtn = document.createElement('button');
      addBtn.className = 'ed-color-add';
      addBtn.textContent = '+';
      addBtn.title = 'Add color';
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        comp.colors.push('#ffffff');
        rebuildColors();
        updateComponent(comp);
      });
      colorRow.appendChild(addBtn);
    }
    rebuildColors();

    section.appendChild(colorRow);
    container.appendChild(section);
  }

  // Comment text
  if (comp.type === 'Comment') {
    const section = document.createElement('div');
    section.className = 'tree-detail-section';
    section.innerHTML = '<div class="tree-detail-label">COMMENT</div>';

    // "AVS Comment View" button
    const viewBtn = document.createElement('button');
    viewBtn.className = 'ed-tool-btn';
    viewBtn.textContent = 'AVS Comment View';
    viewBtn.style.marginBottom = '6px';
    viewBtn.addEventListener('click', () => {
      const overlay = document.getElementById('comment-overlay');
      const textEl = document.getElementById('comment-overlay-text');
      textEl.textContent = comp.text || '(empty)';
      overlay.classList.remove('hidden');
    });
    section.appendChild(viewBtn);

    const ta = document.createElement('textarea');
    ta.className = 'ed-textarea';
    ta.value = comp.text || '';
    ta.rows = 5;
    ta.addEventListener('change', () => {
      comp.text = ta.value;
      updateComponent(comp);
    });
    section.appendChild(ta);
    container.appendChild(section);
  }

  // SetRenderMode: custom dropdowns for blend + linesize
  if (comp.type === 'SetRenderMode') {
    const LINE_BLEND_NAMES = [
      'Replace', 'Additive', 'Maximum', '50/50',
      'Sub (Dst-Src)', 'Sub (Src-Dst)', 'Multiply',
      'Adjustable', 'XOR (TODO)', 'Minimum',
    ];

    const section = document.createElement('div');
    section.className = 'tree-detail-section';
    section.innerHTML = '<div class="tree-detail-label">LINE RENDER MODE</div>';

    // Blend mode dropdown
    const blendRow = document.createElement('div');
    blendRow.className = 'tree-detail-prop';
    const blendLabel = document.createElement('span');
    blendLabel.className = 'key';
    blendLabel.textContent = 'blend';
    blendRow.appendChild(blendLabel);
    const blendSel = document.createElement('select');
    blendSel.className = 'ed-select';
    for (let i = 0; i < LINE_BLEND_NAMES.length; i++) {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = LINE_BLEND_NAMES[i];
      if (i === (comp.blend || 0)) o.selected = true;
      blendSel.appendChild(o);
    }
    blendSel.addEventListener('change', () => {
      comp.blend = Number(blendSel.value);
      updateComponent(comp);
    });
    const blendVal = document.createElement('span');
    blendVal.className = 'val val-edit';
    blendVal.appendChild(blendSel);
    blendRow.appendChild(blendVal);
    section.appendChild(blendRow);

    // Line size slider
    const sizeRow = document.createElement('div');
    sizeRow.className = 'tree-detail-prop';
    const sizeLabel = document.createElement('span');
    sizeLabel.className = 'key';
    sizeLabel.textContent = 'lineSize';
    sizeRow.appendChild(sizeLabel);
    const sizeWrap = document.createElement('div');
    sizeWrap.style.cssText = 'display:flex;gap:6px;align-items:center;width:100%;';
    const sizeSlider = document.createElement('input');
    sizeSlider.type = 'range';
    sizeSlider.className = 'ed-slider';
    sizeSlider.min = 1; sizeSlider.max = 32; sizeSlider.step = 1;
    sizeSlider.value = comp.lineSize || 1;
    const sizeNum = document.createElement('input');
    sizeNum.type = 'number';
    sizeNum.className = 'ed-input';
    sizeNum.value = comp.lineSize || 1;
    sizeNum.style.width = '55px';
    sizeSlider.addEventListener('input', () => {
      sizeNum.value = sizeSlider.value;
      comp.lineSize = Number(sizeSlider.value);
      updateComponent(comp);
    });
    sizeNum.addEventListener('change', () => {
      sizeSlider.value = sizeNum.value;
      comp.lineSize = Number(sizeNum.value);
      updateComponent(comp);
    });
    sizeWrap.appendChild(sizeSlider);
    sizeWrap.appendChild(sizeNum);
    const sizeVal = document.createElement('span');
    sizeVal.className = 'val val-edit';
    sizeVal.appendChild(sizeWrap);
    sizeRow.appendChild(sizeVal);
    section.appendChild(sizeRow);

    // Alpha slider
    const alphaRow = document.createElement('div');
    alphaRow.className = 'tree-detail-prop';
    const alphaLabel = document.createElement('span');
    alphaLabel.className = 'key';
    alphaLabel.textContent = 'alpha';
    alphaRow.appendChild(alphaLabel);
    const alphaWrap = document.createElement('div');
    alphaWrap.style.cssText = 'display:flex;gap:6px;align-items:center;width:100%;';
    const alphaSlider = document.createElement('input');
    alphaSlider.type = 'range';
    alphaSlider.className = 'ed-slider';
    alphaSlider.min = 0; alphaSlider.max = 255; alphaSlider.step = 1;
    alphaSlider.value = comp.alpha || 128;
    const alphaNum = document.createElement('input');
    alphaNum.type = 'number';
    alphaNum.className = 'ed-input';
    alphaNum.value = comp.alpha || 128;
    alphaNum.style.width = '55px';
    alphaSlider.addEventListener('input', () => {
      alphaNum.value = alphaSlider.value;
      comp.alpha = Number(alphaSlider.value);
      updateComponent(comp);
    });
    alphaNum.addEventListener('change', () => {
      alphaSlider.value = alphaNum.value;
      comp.alpha = Number(alphaNum.value);
      updateComponent(comp);
    });
    alphaWrap.appendChild(alphaSlider);
    alphaWrap.appendChild(alphaNum);
    const alphaVal = document.createElement('span');
    alphaVal.className = 'val val-edit';
    alphaVal.appendChild(alphaWrap);
    alphaRow.appendChild(alphaVal);
    section.appendChild(alphaRow);

    container.appendChild(section);
  }

  // Movement: show builtin effect description + code editor for custom (13)
  if (comp.type === 'Movement') {
    const EFFECT_NAMES = [
      'None', 'Slight Fuzzify', 'Shift Rotate Left', 'Big Swirl Out',
      'Medium Swirl', 'Sunburster', 'Squish', 'Chaos Dwarf',
      'Infinitely Zooming Shift Rotate', 'Tunnel', 'Gentle Zoom In',
      'Blocky Partial Out', 'Swirling Around Both Ways', 'User Defined',
      'Gentle Zoom Out', 'Swirl To Center', 'Starfish',
      'Yawning Rotation Left', 'Yawning Rotation Right',
      'Mild Zoom In With Slight Rotation', 'Drain', 'Super Drain',
      'Hyper Drain', 'Shift Down',
    ];

    const EFFECT_CODE = [
      '', // 0: None
      'd=d*0.99+0.005', // 1: Slight Fuzzify
      'd=d*0.98; r=r+0.04', // 2: Shift Rotate Left
      'd=d*1.01; r=r+0.05*(1.0-d)', // 3: Big Swirl Out
      'r=r+0.03', // 4: Medium Swirl
      'd=d*1.02; r=r+0.01', // 5: Sunburster
      'd=d*0.9', // 6: Squish
      'x=x+sin(y*4*$PI)*0.01; y=y+cos(x*4*$PI)*0.01', // 7: Chaos Dwarf
      'd=d*0.96; r=r+0.02', // 8: Inf Zoom Shift Rotate
      'd=0.8/(d+0.01)', // 9: Tunnel
      'd=d*0.98', // 10: Gentle Zoom In
      '// blocky partial out', // 11
      'r=r+0.1*sin(d*$PI*2)', // 12: Swirling Both Ways
      '', // 13: User Defined
      'd=d*1.02', // 14: Gentle Zoom Out
      'd=d*0.95; r=r+0.1*d', // 15: Swirl To Center
      'd=d*(0.96+0.04*sin(r*5)); r=r+0.02', // 16: Starfish
      'r=r+0.1*(1.0-d)', // 17: Yawning Rotation Left
      'r=r-0.1*(1.0-d)', // 18: Yawning Rotation Right
      'd=d*0.99; r=r+0.01', // 19: Mild Zoom + Rotation
      'd=d*0.98; r=r+0.06*(1.0-d)', // 20: Drain
      'd=d*0.96; r=r+0.1*(1.0-d)', // 21: Super Drain
      'd=d*0.94; r=r+0.15*(1.0-d)', // 22: Hyper Drain
      'y=y+0.02', // 23: Shift Down
    ];

    const idx = comp.builtinEffect || 0;
    const effectName = EFFECT_NAMES[idx] || 'Unknown';

    // Show effect name
    const nameSection = document.createElement('div');
    nameSection.className = 'tree-detail-section';
    nameSection.innerHTML = `<div class="tree-detail-label">EFFECT: ${effectName}</div>`;
    if (idx !== 13 && EFFECT_CODE[idx]) {
      const codePreview = document.createElement('div');
      codePreview.className = 'tree-detail-code';
      codePreview.textContent = EFFECT_CODE[idx];
      codePreview.style.opacity = '0.6';
      nameSection.appendChild(codePreview);
    }
    container.appendChild(nameSection);

    // Editable code textarea (for User Defined, effect 13)
    const section = document.createElement('div');
    section.className = 'tree-detail-section';
    section.innerHTML = '<div class="tree-detail-label">CUSTOM CODE</div>';
    const ta = document.createElement('textarea');
    ta.className = 'ed-textarea';
    ta.value = (typeof comp.code === 'string' ? comp.code : '') || '';
    ta.rows = 4;
    ta.placeholder = 'd=d*0.9; // polar: modify d (distance) and r (rotation)';
    ta.disabled = (idx !== 13);
    if (idx !== 13) ta.style.opacity = '0.3';
    ta.addEventListener('change', () => {
      comp.code = ta.value;
      comp.builtinEffect = 13;
      updateComponent(comp);
    });
    section.appendChild(ta);
    container.appendChild(section);
  }

  // Code sections (object with init/perFrame/onBeat/perPoint)
  if (comp.code && typeof comp.code === 'object') {
    const codeSections = ['init', 'perFrame', 'onBeat', 'perPoint'];
    for (const sec of codeSections) {
      const section = document.createElement('div');
      section.className = 'tree-detail-section';
      section.innerHTML = `<div class="tree-detail-label">${sec.toUpperCase()}</div>`;
      const ta = document.createElement('textarea');
      ta.className = 'ed-textarea';
      ta.value = comp.code[sec] || '';
      ta.rows = Math.max(2, (comp.code[sec] || '').split('\n').length);
      ta.addEventListener('change', () => {
        comp.code[sec] = ta.value;
        updateComponent(comp);
      });
      section.appendChild(ta);
      container.appendChild(section);
    }
  }

  // Convolution filter kernel grid (7x7)
  if (comp.kernel && Array.isArray(comp.kernel) && comp.kernel.length === 49) {
    const section = document.createElement('div');
    section.className = 'tree-detail-section';
    section.innerHTML = '<div class="tree-detail-label">7×7 KERNEL</div>';

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin:6px 0;';

    for (let i = 0; i < 49; i++) {
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.className = 'ed-input';
      inp.value = comp.kernel[i];
      inp.style.cssText = 'width:100%;text-align:center;padding:2px;font-size:11px;';
      if (i === 24) inp.style.borderColor = 'var(--accent)'; // center element highlight
      const idx = i;
      inp.addEventListener('change', () => {
        comp.kernel[idx] = Number(inp.value);
        updateComponent(comp);
      });
      grid.appendChild(inp);
    }
    section.appendChild(grid);

    // Auto-scale button
    const autoBtn = document.createElement('button');
    autoBtn.className = 'ed-tool-btn';
    autoBtn.textContent = 'Auto Scale';
    autoBtn.style.marginTop = '4px';
    autoBtn.addEventListener('click', () => {
      let sum = 0;
      for (let i = 0; i < 49; i++) sum += comp.kernel[i];
      if (comp.twoPass) sum *= 2;
      comp.scale = sum + (comp.bias || 0);
      if (comp.scale === 0) comp.scale = 1;
      updateComponent(comp);
      buildDetailDom(container, comp, path);
    });
    section.appendChild(autoBtn);

    container.appendChild(section);
  }

  // ColorMap gradient visualizer
  if (comp.type === 'ColorMap' && comp.maps && Array.isArray(comp.maps)) {
    const section = document.createElement('div');
    section.className = 'tree-detail-section';
    section.innerHTML = '<div class="tree-detail-label">GRADIENT MAPS</div>';

    function drawGradient(canvas, colors) {
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      if (!colors || colors.length === 0) {
        // Default: black to white
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, '#000000');
        grad.addColorStop(1, '#ffffff');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        return;
      }

      // Sort stops
      const stops = colors.slice().sort((a, b) => a.position - b.position);

      // Draw using Canvas gradient
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      for (const s of stops) {
        grad.addColorStop(Math.max(0, Math.min(1, s.position / 255)), s.color);
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }

    function rebuildMaps() {
      section.querySelectorAll('.cmap-entry').forEach(el => el.remove());

      comp.maps.forEach((map, mi) => {
        if (!map.enabled && map.colors && map.colors.length <= 2 &&
            map.colors[0]?.color === '#000000') return; // skip default empty maps

        const entry = document.createElement('div');
        entry.className = 'cmap-entry';
        entry.style.cssText = 'margin:6px 0;';

        // Map header
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:3px;';

        const enableCb = document.createElement('input');
        enableCb.type = 'checkbox';
        enableCb.checked = map.enabled !== false;
        enableCb.addEventListener('change', () => {
          map.enabled = enableCb.checked;
          updateComponent(comp);
        });
        header.appendChild(enableCb);

        const label = document.createElement('span');
        label.style.cssText = 'font-size:11px;color:var(--text-dim);';
        label.textContent = `Map ${mi + 1}` + (mi === (comp.currentMap || 0) ? ' (active)' : '');
        header.appendChild(label);

        entry.appendChild(header);

        // Gradient canvas
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 20;
        canvas.style.cssText = 'width:100%;height:20px;border-radius:3px;border:1px solid var(--glass-border);cursor:pointer;';
        drawGradient(canvas, map.colors);
        entry.appendChild(canvas);

        // Color stops row
        const stopsRow = document.createElement('div');
        stopsRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;align-items:center;';

        function rebuildStops() {
          stopsRow.innerHTML = '';
          (map.colors || []).forEach((stop, si) => {
            const stopWrap = document.createElement('div');
            stopWrap.style.cssText = 'display:flex;align-items:center;gap:2px;';

            const colorInp = document.createElement('input');
            colorInp.type = 'color';
            colorInp.value = stop.color;
            colorInp.style.cssText = 'width:20px;height:20px;padding:0;border:1px solid var(--glass-border);border-radius:2px;cursor:pointer;';
            colorInp.addEventListener('change', () => {
              stop.color = colorInp.value;
              drawGradient(canvas, map.colors);
              updateComponent(comp);
            });
            stopWrap.appendChild(colorInp);

            const posInp = document.createElement('input');
            posInp.type = 'number';
            posInp.className = 'ed-input';
            posInp.value = stop.position;
            posInp.min = 0; posInp.max = 255;
            posInp.style.cssText = 'width:40px;font-size:10px;padding:1px 3px;';
            posInp.addEventListener('change', () => {
              stop.position = Math.max(0, Math.min(255, Number(posInp.value)));
              drawGradient(canvas, map.colors);
              updateComponent(comp);
            });
            stopWrap.appendChild(posInp);

            // Remove stop
            if (map.colors.length > 1) {
              const rmBtn = document.createElement('button');
              rmBtn.textContent = '\u00d7';
              rmBtn.style.cssText = 'background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:12px;padding:0 2px;';
              rmBtn.addEventListener('click', () => {
                map.colors.splice(si, 1);
                rebuildStops();
                drawGradient(canvas, map.colors);
                updateComponent(comp);
              });
              stopWrap.appendChild(rmBtn);
            }

            stopsRow.appendChild(stopWrap);
          });

          // Add stop button
          const addBtn = document.createElement('button');
          addBtn.className = 'ed-tool-btn';
          addBtn.textContent = '+';
          addBtn.style.cssText = 'padding:1px 6px;font-size:11px;';
          addBtn.addEventListener('click', () => {
            const lastPos = map.colors.length > 0 ? map.colors[map.colors.length - 1].position : 0;
            map.colors.push({ position: Math.min(255, lastPos + 32), color: '#ffffff' });
            rebuildStops();
            drawGradient(canvas, map.colors);
            updateComponent(comp);
          });
          stopsRow.appendChild(addBtn);
        }
        rebuildStops();
        entry.appendChild(stopsRow);

        section.appendChild(entry);
      });
    }
    rebuildMaps();

    container.appendChild(section);
  }
}

// --- CRUD operations ---

// New Preset
btnEdNew.addEventListener('click', () => {
  selectedPath = null;
  currentPresetJSON = { name: 'New Preset', clearFrame: true, components: [] };
  rebuildPreset();
});

// Add
btnEdAdd.addEventListener('click', () => {
  if (!currentPresetJSON) {
    // Auto-create a new preset
    currentPresetJSON = { name: 'New Preset', clearFrame: true, components: [] };
    rebuildPreset();
  }
  pickerAddMode = 'after';
  // If selected is an EffectList, default to adding into it
  if (selectedPath) {
    const comp = getComponentAtPath(selectedPath);
    if (comp && comp.type === 'EffectList') {
      pickerAddMode = 'into';
    }
  }
  openPicker();
});

// Remove
btnEdRemove.addEventListener('click', () => {
  if (!selectedPath || !currentPresetJSON) return;
  const arr = getParentArray(selectedPath);
  const idx = getSelectedIndex();
  if (!arr || idx < 0 || idx >= arr.length) return;
  arr.splice(idx, 1);
  // Adjust selection
  if (arr.length === 0) {
    selectedPath = selectedPath.length > 1 ? selectedPath.slice(0, -1) : null;
  } else if (idx >= arr.length) {
    selectedPath[selectedPath.length - 1] = arr.length - 1;
  }
  rebuildPreset();
});

// Move Up
btnEdUp.addEventListener('click', () => {
  if (!selectedPath || !currentPresetJSON) return;
  const arr = getParentArray(selectedPath);
  const idx = getSelectedIndex();
  if (!arr || idx <= 0) return;
  [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
  selectedPath[selectedPath.length - 1] = idx - 1;
  rebuildPreset();
});

// Move Down
btnEdDown.addEventListener('click', () => {
  if (!selectedPath || !currentPresetJSON) return;
  const arr = getParentArray(selectedPath);
  const idx = getSelectedIndex();
  if (!arr || idx >= arr.length - 1) return;
  [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
  selectedPath[selectedPath.length - 1] = idx + 1;
  rebuildPreset();
});

// --- Component Picker ---

function openPicker() {
  componentPicker.classList.remove('hidden');
}

function closePicker() {
  componentPicker.classList.add('hidden');
}

btnPickerClose.addEventListener('click', closePicker);
componentPicker.querySelector('.comp-picker-backdrop').addEventListener('click', closePicker);

// Handle pick
componentPicker.querySelectorAll('.comp-pick-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.type;
    addComponent(type);
    closePicker();
  });
});

function addComponent(type) {
  if (!currentPresetJSON) return;
  const newComp = getDefaultComponent(type);

  if (pickerAddMode === 'into' && selectedPath) {
    // Add into EffectList
    const parent = getComponentAtPath(selectedPath);
    if (parent && parent.type === 'EffectList') {
      if (!parent.components) parent.components = [];
      parent.components.push(newComp);
      selectedPath = [...selectedPath, parent.components.length - 1];
    } else {
      // Fallback: add after
      insertAfterSelected(newComp);
    }
  } else {
    insertAfterSelected(newComp);
  }

  rebuildPreset();
}

function insertAfterSelected(newComp) {
  if (selectedPath) {
    const arr = getParentArray(selectedPath);
    const idx = getSelectedIndex();
    if (arr) {
      arr.splice(idx + 1, 0, newComp);
      selectedPath[selectedPath.length - 1] = idx + 1;
      return;
    }
  }
  // No selection or invalid: add to root
  currentPresetJSON.components.push(newComp);
  selectedPath = [currentPresetJSON.components.length - 1];
}

// --- Duplicate ---

function duplicateSelected() {
  if (!selectedPath || !currentPresetJSON) return;
  const comp = getComponentAtPath(selectedPath);
  if (!comp) return;
  const clone = JSON.parse(JSON.stringify(comp));
  const arr = getParentArray(selectedPath);
  const idx = getSelectedIndex();
  if (arr) {
    arr.splice(idx + 1, 0, clone);
    selectedPath[selectedPath.length - 1] = idx + 1;
  }
  rebuildPreset();
}

// --- Context Menu ---

function showContextMenu(x, y, comp) {
  const isEffectList = comp && comp.type === 'EffectList';
  const addIntoItem = contextMenu.querySelector('[data-action="add-into"]');
  if (isEffectList) {
    addIntoItem.classList.remove('ctx-item-disabled');
  } else {
    addIntoItem.classList.add('ctx-item-disabled');
  }

  // Position
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.classList.remove('hidden');

  // Adjust if off-screen
  requestAnimationFrame(() => {
    const rect = contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      contextMenu.style.left = (x - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      contextMenu.style.top = (y - rect.height) + 'px';
    }
  });
}

function hideContextMenu() {
  contextMenu.classList.add('hidden');
}

// Close context menu on click elsewhere
document.addEventListener('click', (e) => {
  if (!contextMenu.contains(e.target)) {
    hideContextMenu();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideContextMenu();
    closePicker();
  }
});

// Context menu actions
contextMenu.querySelectorAll('.ctx-item').forEach(item => {
  item.addEventListener('click', () => {
    const action = item.dataset.action;
    hideContextMenu();
    switch (action) {
      case 'add':
        pickerAddMode = 'after';
        openPicker();
        break;
      case 'add-into':
        pickerAddMode = 'into';
        openPicker();
        break;
      case 'duplicate':
        duplicateSelected();
        break;
      case 'move-up':
        btnEdUp.click();
        break;
      case 'move-down':
        btnEdDown.click();
        break;
      case 'remove':
        btnEdRemove.click();
        break;
    }
  });
});

// --- Keyboard shortcuts for editor ---

document.addEventListener('keydown', (e) => {
  // Only handle if editor is open and not typing in an input
  if (editor.classList.contains('hidden')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  if (e.key === 'Delete' && selectedPath) {
    e.preventDefault();
    btnEdRemove.click();
  }
});

// Expose for console
window.loadPresetJSON = loadPresetJSON;
window.loadDefaultPreset = () => { currentPresetJSON = DEFAULT_PRESET; viz.setPreset(loadAvsPreset(DEFAULT_PRESET)); setActivePreset('Freezer Default'); };
window.currentPresetJSON = () => currentPresetJSON;

// --- Comment overlay ---
document.getElementById('btn-comment-close').addEventListener('click', () => {
  document.getElementById('comment-overlay').classList.add('hidden');
});
document.querySelector('.comment-overlay-backdrop').addEventListener('click', () => {
  document.getElementById('comment-overlay').classList.add('hidden');
});

// --- Drag and drop ---

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('dragover');
});

document.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) {
    document.body.classList.remove('dragover');
  }
});

document.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (!file) return;

  if (file.name.endsWith('.avs') || file.name.endsWith('.json')) {
    loadPresetFile(file);
    return;
  }

  if (file.type.startsWith('audio/')) {
    audio.loadFile(file);
    dismissSplash();
  }
});

// --- Fullscreen ---

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
}

btnFullscreen.addEventListener('click', toggleFullscreen);

btnSource.addEventListener('click', async () => {
  try {
    await audio.switchSource('system');
    dismissSplash();
  } catch (e) {
    console.warn('Audio source change cancelled:', e);
  }
});

// --- Fullscreen auto-hide controls ---

let hideTimer = null;

function showControls() {
  controls.classList.remove('hidden');
  clearTimeout(hideTimer);
  if (document.fullscreenElement) {
    hideTimer = setTimeout(() => {
      controls.classList.add('hidden');
    }, 3000);
  }
}

document.addEventListener('mousemove', showControls);

document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement) {
    showControls();
  } else {
    clearTimeout(hideTimer);
    controls.classList.remove('hidden');
  }
});

// --- FPS counter ---

let fpsVisible = false;
let fpsEl = null;
let fpsFrames = 0;
let fpsLastTime = performance.now();

function toggleFps() {
  fpsVisible = !fpsVisible;
  if (fpsVisible) {
    if (!fpsEl) {
      fpsEl = document.createElement('div');
      fpsEl.id = 'fps-counter';
      fpsEl.style.cssText = 'position:fixed;top:12px;left:12px;z-index:600;font-family:"Share Tech Mono",Consolas,monospace;font-size:14px;font-weight:600;color:var(--accent,#00e5ff);pointer-events:none;padding:6px 12px;background:rgba(0,10,20,0.6);border:1px solid rgba(0,229,255,0.15);border-radius:8px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);letter-spacing:1px;';
      document.body.appendChild(fpsEl);
    }
    fpsEl.style.display = '';
    fpsFrames = 0;
    fpsLastTime = performance.now();
    requestAnimationFrame(updateFps);
  } else if (fpsEl) {
    fpsEl.style.display = 'none';
  }
}

function updateFps() {
  if (!fpsVisible) return;
  fpsFrames++;
  const now = performance.now();
  const elapsed = now - fpsLastTime;
  if (elapsed >= 500) {
    const fps = (fpsFrames / elapsed * 1000).toFixed(1);
    fpsEl.textContent = `${fps} fps`;
    fpsFrames = 0;
    fpsLastTime = now;
  }
  requestAnimationFrame(updateFps);
}

// --- Keyboard shortcuts ---

document.addEventListener('keydown', (e) => {
  // Don't trigger shortcuts while typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  switch (e.key) {
    case 'f': case 'F':
      if (!e.ctrlKey && !e.altKey && !e.metaKey) toggleFps();
      break;
    case 'Enter':
      if (e.altKey) { e.preventDefault(); toggleFullscreen(); }
      break;
  }
});
