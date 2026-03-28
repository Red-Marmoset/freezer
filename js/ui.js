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
const btnEditor = document.getElementById('btn-editor');
const presetInput = document.getElementById('preset-input');
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
    console.log('Loaded preset:', preset.name, json);
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

presetInput.addEventListener('change', () => {
  if (presetInput.files.length === 0) return;
  loadPresetFile(presetInput.files[0]);
  presetInput.value = '';
});

// --- Editor ---

btnEditor.addEventListener('click', () => {
  if (!currentPresetJSON) {
    console.log('No AVS preset loaded — load a preset first');
    return;
  }
  // For now, dump the parsed preset JSON to console and show in a new window
  const jsonStr = JSON.stringify(currentPresetJSON, null, 2);
  console.log('Current preset JSON:', jsonStr);
  const win = window.open('', '_blank', 'width=700,height=800');
  win.document.title = 'Preset Editor — ' + (currentPresetJSON.name || 'Untitled');
  win.document.body.style.cssText = 'margin:0;background:#0a0e14;color:#c8dce8;font-family:monospace;';
  const pre = win.document.createElement('pre');
  pre.style.cssText = 'padding:20px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;';
  pre.textContent = jsonStr;
  win.document.body.appendChild(pre);
});

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
