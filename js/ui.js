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

function getCategory(type) {
  if (type === 'EffectList') return 'container';
  if (RENDER_TYPES.includes(type)) return 'render';
  if (TRANS_TYPES.includes(type)) return 'trans';
  return 'misc';
}

function getIcon(type, cat) {
  if (cat === 'container') return '\u25A3'; // filled square with square
  if (cat === 'render') return '\u25CF'; // filled circle
  if (cat === 'trans') return '\u25C6'; // filled diamond
  if (type === 'Comment') return '\u2759'; // bar
  if (type === 'SetRenderMode') return '\u2699'; // gear
  if (type === 'BufferSave') return '\u29C9'; // two squares
  return '\u25CB'; // open circle
}

function buildEditorTree() {
  if (!currentPresetJSON) {
    editorTree.innerHTML = '<div class="editor-empty">Load a preset to see its component tree</div>';
    return;
  }

  const json = currentPresetJSON;
  let html = '';

  // Preset header
  html += `<div class="tree-row" style="padding-left:12px;">
    <span class="tree-icon container">\u25A3</span>
    <span class="tree-label" style="color:var(--accent);font-weight:700;">${json.name || 'Preset'}</span>
    <span class="tree-badge misc">${json.clearFrame ? 'CLR' : 'NO CLR'}</span>
  </div>`;

  html += buildTreeNodes(json.components || [], 1);
  editorTree.innerHTML = html;

  // Wire up all clicks
  editorTree.querySelectorAll('.tree-row').forEach(row => {
    row.addEventListener('click', (e) => {
      const node = row.parentElement;
      const toggle = row.querySelector('.tree-toggle');
      const children = node.querySelector(':scope > .tree-children');
      const detail = node.querySelector(':scope > .tree-detail');

      // If clicked on the toggle arrow, collapse/expand children
      if (e.target.closest('.tree-toggle') && children) {
        children.classList.toggle('collapsed');
        toggle.classList.toggle('open');
        return;
      }

      // If has children (EffectList), toggle collapse on row click too
      if (children) {
        children.classList.toggle('collapsed');
        toggle.classList.toggle('open');
      }

      // Toggle detail pane
      if (detail) {
        const isVisible = detail.style.display !== 'none';
        detail.style.display = isVisible ? 'none' : 'block';
        row.classList.toggle('selected', !isVisible);
      }
    });
  });
}

function buildTreeNodes(components, depth) {
  let html = '';
  for (const comp of components) {
    const cat = getCategory(comp.type);
    const icon = getIcon(comp.type, cat);
    const hasChildren = comp.components && comp.components.length > 0;
    const hasDetail = true; // all components are expandable
    const indent = depth * 16;
    const disabled = comp.enabled === false;
    const unsupported = comp._unsupported;

    html += '<div class="tree-node">';

    // Row
    html += `<div class="tree-row${hasDetail ? ' selected' : ''}" style="padding-left:${indent}px;" ${hasChildren ? 'data-toggle' : ''} ${hasDetail ? 'data-detail' : ''}>`;
    html += `<span class="tree-toggle ${hasChildren ? 'open' : 'leaf'}">\u25B6</span>`;
    html += `<span class="tree-icon ${unsupported ? 'unsupported' : cat}">${icon}</span>`;
    html += `<span class="tree-label${disabled ? ' disabled' : ''}">${comp.type}</span>`;

    // Badges
    if (cat !== 'container' && cat !== 'misc') {
      html += `<span class="tree-badge ${cat}">${cat}</span>`;
    }
    if (unsupported) {
      html += `<span class="tree-badge misc">N/A</span>`;
    }
    if (comp.drawMode) {
      html += `<span class="tree-badge misc">${comp.drawMode}</span>`;
    }
    if (comp.type === 'EffectList') {
      const io = `${(comp.input||'IGN').slice(0,3)}/${(comp.output||'IGN').slice(0,3)}`;
      html += `<span class="tree-badge misc">${io}</span>`;
    }

    html += '</div>';

    // Detail pane (visible by default for selected, hidden for others)
    if (hasDetail) {
      html += '<div class="tree-detail" style="display:none;">';
      html += buildDetail(comp);
      html += '</div>';
    }

    // Children (EffectLists start collapsed)
    if (hasChildren) {
      html += `<div class="tree-children">`;
      html += buildTreeNodes(comp.components, depth + 1);
      html += '</div>';
    }

    html += '</div>';
  }
  return html;
}

function buildDetail(comp) {
  let html = '';

  // Properties — show everything except children and code (shown separately)
  const skipKeys = ['type','components','code','group'];
  const props = Object.entries(comp).filter(([k]) => !skipKeys.includes(k) && !k.startsWith('_'));
  if (props.length > 0) {
    html += '<div class="tree-detail-section">';
    html += '<div class="tree-detail-label">PROPERTIES</div>';
    for (const [key, val] of props) {
      let display;
      if (typeof val === 'boolean') {
        display = val ? '\u2705 yes' : '\u274C no';
      } else if (typeof val === 'number') {
        display = Number.isInteger(val) ? String(val) : val.toFixed(4);
      } else if (Array.isArray(val)) {
        display = val.length + ' items';
      } else if (typeof val === 'object' && val !== null) {
        display = JSON.stringify(val);
      } else {
        display = String(val);
      }
      html += `<div class="tree-detail-prop"><span class="key">${escHtml(key)}</span><span class="val">${escHtml(display)}</span></div>`;
    }
    html += '</div>';
  }

  // Colors
  if (comp.colors && comp.colors.length > 0) {
    html += '<div class="tree-detail-section">';
    html += '<div class="tree-detail-label">COLORS</div>';
    html += '<div style="display:flex;gap:4px;flex-wrap:wrap;">';
    for (const c of comp.colors) {
      html += `<span style="width:18px;height:18px;border-radius:3px;background:${c};border:1px solid rgba(255,255,255,0.15);display:inline-block;" title="${c}"></span>`;
    }
    html += '</div></div>';
  }

  // Comment text
  if (comp.type === 'Comment' && comp.text) {
    html += '<div class="tree-detail-section">';
    html += '<div class="tree-detail-label">COMMENT</div>';
    html += `<div class="tree-detail-code">${escHtml(comp.text.trim())}</div>`;
    html += '</div>';
  }

  // Movement code (stored as string, not object)
  if (comp.type === 'Movement' && typeof comp.code === 'string' && comp.code.trim()) {
    html += '<div class="tree-detail-section">';
    html += '<div class="tree-detail-label">CODE</div>';
    html += `<div class="tree-detail-code">${escHtml(comp.code.trim())}</div>`;
    html += '</div>';
  }

  // Code sections (object with init/perFrame/onBeat/perPoint)
  if (comp.code && typeof comp.code === 'object') {
    for (const [section, code] of Object.entries(comp.code)) {
      if (code && typeof code === 'string' && code.trim()) {
        html += '<div class="tree-detail-section">';
        html += `<div class="tree-detail-label">${section.toUpperCase()}</div>`;
        html += `<div class="tree-detail-code">${escHtml(code.trim())}</div>`;
        html += '</div>';
      }
    }
  }

  return html;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Expose for console
window.loadPresetJSON = loadPresetJSON;
window.loadDefaultPreset = () => { currentPresetJSON = null; viz.setPreset(oscilloscope); setActivePreset('Oscilloscope'); };

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
  if (e.key === 'f' || e.key === 'F') {
    toggleFullscreen();
  }
});
