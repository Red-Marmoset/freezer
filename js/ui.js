import { createAudioEngine } from './audio-engine.js';
import { createRenderer } from './renderer.js';
import oscilloscope from './presets/oscilloscope.js';
import { loadAvsPreset } from './avs/avs-engine.js';
import { parseAvsFileWithName } from './avs/avs-parser.js';

const canvas = document.getElementById('visualizer');
const controls = document.getElementById('controls');
const splash = document.getElementById('splash');
const btnStart = document.getElementById('btn-start');
const splashStatus = document.getElementById('splash-status');
const btnScope = document.getElementById('btn-scope');
const btnLoadPreset = document.getElementById('btn-load-preset');
const btnEditor = document.getElementById('btn-editor');
const presetName = document.getElementById('preset-name');
const btnFullscreen = document.getElementById('btn-fullscreen');

const audio = createAudioEngine();
const viz = createRenderer(canvas);

viz.setPreset(oscilloscope);
viz.start(audio);

// Current preset JSON (for editor)
let currentPresetJSON = null;

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
  presetName.textContent = name || '';
}

function loadPresetJSON(json) {
  try {
    currentPresetJSON = json;
    const preset = loadAvsPreset(json);
    viz.setPreset(preset);
    setActivePreset(preset.name);
    // Refresh editor tree if open
    if (!document.getElementById('editor').classList.contains('hidden')) {
      buildEditorTree();
    }
  } catch (e) {
    console.error('Failed to load preset:', e);
  }
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

btnScope.addEventListener('click', () => {
  currentPresetJSON = null;
  viz.setPreset(oscilloscope);
  setActivePreset('Oscilloscope');
});

btnLoadPreset.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.avs,.json';
  input.onchange = () => {
    if (input.files.length > 0) loadPresetFile(input.files[0]);
  };
  input.click();
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
  'BassSpin','RotatingStars','Timescope','ClearScreen','OnBeatClear','Texer','Acko.net: Texer II'];
const TRANS_TYPES = ['FadeOut','Movement','DynamicMovement','Blur','Invert','Mirror','Mosaic',
  'Brightness','FastBrightness','ColorModifier','ChannelShift','ColorClip','Grain','Interleave',
  'ColorFade','UniqueTone','Scatter','BlitterFeedback','RotoBlitter','Water','WaterBump','Bump',
  'Interferences','DynamicShift','DynamicDistanceModifier','ColorMap'];

// Known select-type fields and their options
const SELECT_FIELDS = {
  drawMode: ['DOTS', 'LINES'],
  audioSource: ['WAVEFORM', 'SPECTRUM'],
  audioChannel: ['LEFT', 'RIGHT', 'CENTER'],
  input: ['IGNORE', 'REPLACE', 'FIFTY_FIFTY', 'MAXIMUM'],
  output: ['IGNORE', 'REPLACE', 'FIFTY_FIFTY', 'MAXIMUM', 'ADDITIVE', 'SUB_1', 'SUB_2', 'EVERY_OTHER_LINE', 'EVERY_OTHER_PIXEL', 'XOR', 'ADJUSTABLE', 'MINIMUM'],
  renderType: ['DOTS', 'LINES', 'SOLID'],
  positionY: ['TOP', 'CENTER', 'BOTTOM'],
  blendMode: ['REPLACE', 'ADDITIVE', 'FIFTY_FIFTY', 'DEFAULT', 'EVERY_OTHER_LINE', 'EVERY_OTHER_PIXEL', 'XOR', 'ADJUSTABLE', 'MULTIPLY', 'MAXIMUM', 'MINIMUM', 'SUB_1', 'SUB_2'],
  onBeatAction: ['NONE', 'RANDOM', 'REVERSE'],
  sourceChannel: ['ZERO', 'RED', 'GREEN', 'BLUE'],
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
  Texer: { type: 'Texer', enabled: true, imageSrc: '', input: 0, output: 0 },
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
  BlitterFeedback: { type: 'BlitterFeedback', enabled: true, zoom: 256, onBeatZoom: 256, blendMode: 'REPLACE', onBeatBilinear: false, bilinear: true },
  RotoBlitter: { type: 'RotoBlitter', enabled: true, zoom: 256, rotate: 0, blendMode: 'REPLACE', onBeatReverse: false, onBeatZoom: 0, bilinear: true },
  Water: { type: 'Water', enabled: true },
  WaterBump: { type: 'WaterBump', enabled: true, density: 6, depth: 40, random: true, dropPositionX: 0, dropPositionY: 0, dropRadius: 40, method: 0 },
  Bump: { type: 'Bump', enabled: true, code: { init: '', perFrame: '', onBeat: '', perPoint: '' }, showDot: false, depth: 30, blend: false, blendMode: 'REPLACE', bilinear: true },
  Interferences: { type: 'Interferences', enabled: true, nPoints: 2, distance: 14, alpha: 128, rotation: 0, speed: 1, onBeatDistance: 14, onBeat: false, blendMode: 'REPLACE', separate: false },
  DynamicShift: { type: 'DynamicShift', enabled: true, code: { init: '', perFrame: '', onBeat: '', perPoint: '' }, blendMode: 'REPLACE', bilinear: true },
  DynamicDistanceModifier: { type: 'DynamicDistanceModifier', enabled: true, code: { init: '', perFrame: '', onBeat: '', perPoint: '' }, blendMode: 'REPLACE', bilinear: true },
  EffectList: { type: 'EffectList', enabled: true, input: 'IGNORE', output: 'REPLACE', clearFrame: true, components: [] },
  BufferSave: { type: 'BufferSave', enabled: true, action: 0, buffer: 0, blendMode: 'REPLACE' },
  SetRenderMode: { type: 'SetRenderMode', enabled: true },
  Comment: { type: 'Comment', enabled: true, text: '' },
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

function getSliderRange(key, val) {
  const k = key.toLowerCase();
  // Speed/opacity values (0-1 range)
  if (k === 'speed' || k === 'opacity' || k === 'alpha' || k === 'adjustblend') {
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
    return { min: 1, max: 16, step: 1 };
  }
  // Point count
  if (k === 'numstars' || k === 'numcolors' || k === 'numlayers' || k === 'sides') {
    return { min: 1, max: 4096, step: 1 };
  }
  // Rotation/angle
  if (k.includes('rot') || k.includes('angle') || k === 'distance') {
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
    const isSelected = selectedPath && selectedPath.join(',') === pathStr;

    const node = document.createElement('div');
    node.className = 'tree-node';

    // Row
    const row = document.createElement('div');
    row.className = 'tree-row' + (isSelected ? ' node-selected' : '');
    row.style.paddingLeft = indent + 'px';
    row.dataset.path = pathStr;

    row.innerHTML = `
      <span class="tree-toggle ${hasChildren ? 'open' : 'leaf'}">\u25B6</span>
      <span class="tree-icon ${unsupported ? 'unsupported' : cat}">${icon}</span>
      <span class="tree-label${disabled ? ' disabled' : ''}">${escHtml(comp.type)}</span>
      ${(cat !== 'container' && cat !== 'misc') ? `<span class="tree-badge ${cat}">${cat}</span>` : ''}
      ${unsupported ? '<span class="tree-badge misc">N/A</span>' : ''}
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

    parentEl.appendChild(node);
  }
}

// --- Editable detail pane ---

function buildDetailDom(container, comp, path) {
  container.innerHTML = '';

  const skipKeys = ['type', 'components', 'code', 'group', 'colors'];
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
          o.textContent = opt;
          if (String(val) === String(opt)) o.selected = true;
          sel.appendChild(o);
        }
        sel.addEventListener('change', () => {
          const newVal = typeof val === 'number' ? Number(sel.value) : sel.value;
          comp[key] = newVal;
          rebuildPreset();
        });
        valSpan.appendChild(sel);
      } else if (typeof val === 'boolean') {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'ed-input';
        cb.checked = val;
        cb.addEventListener('change', () => {
          comp[key] = cb.checked;
          rebuildPreset();
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
        numInp.value = Number.isInteger(val) ? val : val.toFixed(3);
        numInp.step = range.step;
        numInp.style.width = '65px';
        numInp.style.flexShrink = '0';

        slider.addEventListener('input', () => {
          const v = Number(slider.value);
          numInp.value = Number.isInteger(v) ? v : v.toFixed(3);
          comp[key] = v;
          rebuildPreset();
        });
        numInp.addEventListener('change', () => {
          const v = Number(numInp.value);
          slider.value = v;
          comp[key] = v;
          rebuildPreset();
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
            rebuildPreset();
          });
          valSpan.appendChild(colorInp);
        } else {
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.className = 'ed-input';
          inp.value = val;
          inp.addEventListener('change', () => {
            comp[key] = inp.value;
            rebuildPreset();
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
          rebuildPreset();
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
          rebuildPreset();
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
        rebuildPreset();
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
    const ta = document.createElement('textarea');
    ta.className = 'ed-textarea';
    ta.value = comp.text || '';
    ta.rows = 3;
    ta.addEventListener('change', () => {
      comp.text = ta.value;
      rebuildPreset();
    });
    section.appendChild(ta);
    container.appendChild(section);
  }

  // Movement code (custom effect, builtinEffect=13)
  // Always show for Movement so users can write custom code
  if (comp.type === 'Movement') {
    const section = document.createElement('div');
    section.className = 'tree-detail-section';
    section.innerHTML = '<div class="tree-detail-label">CUSTOM CODE (effect 13)</div>';
    const ta = document.createElement('textarea');
    ta.className = 'ed-textarea';
    ta.value = (typeof comp.code === 'string' ? comp.code : '') || '';
    ta.rows = 4;
    ta.placeholder = 'd=d*0.9; // polar: modify d (distance) and r (rotation)';
    ta.addEventListener('change', () => {
      comp.code = ta.value;
      comp.builtinEffect = 13; // switch to User Defined when code is entered
      rebuildPreset();
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
        rebuildPreset();
      });
      section.appendChild(ta);
      container.appendChild(section);
    }
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
window.loadDefaultPreset = () => { currentPresetJSON = null; viz.setPreset(oscilloscope); setActivePreset('Oscilloscope'); };
window.currentPresetJSON = () => currentPresetJSON;

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

// --- Keyboard shortcuts ---

document.addEventListener('keydown', (e) => {
  // Don't trigger shortcuts while typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.key === 'f' || e.key === 'F') {
    toggleFullscreen();
  }
});
