import { createAudioEngine } from './audio-engine.js';
import { createRenderer } from './renderer.js';
import oscilloscope from './presets/oscilloscope.js';
import { loadAvsPreset } from './avs/avs-engine.js';

const canvas = document.getElementById('visualizer');
const controls = document.getElementById('controls');
const splash = document.getElementById('splash');
const btnStart = document.getElementById('btn-start');
const splashStatus = document.getElementById('splash-status');
const btnScope = document.getElementById('btn-scope');
const btnLoadPreset = document.getElementById('btn-load-preset');
const presetInput = document.getElementById('preset-input');
const presetName = document.getElementById('preset-name');
const btnFullscreen = document.getElementById('btn-fullscreen');

const audio = createAudioEngine();
const viz = createRenderer(canvas);

viz.setPreset(oscilloscope);
viz.start(audio);

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
    splashStatus.textContent = 'Capture cancelled — click to try again';
    splashStatus.classList.add('error');
  }
}

function dismissSplash() {
  splash.classList.add('hidden');
}

// --- Preset switching ---

function setActivePreset(btn, name) {
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  presetName.textContent = name || '';
}

function loadAvsJSON(json) {
  try {
    const preset = loadAvsPreset(json);
    viz.setPreset(preset);
    setActivePreset(btnLoadPreset, preset.name);
  } catch (e) {
    console.error('Failed to load AVS preset:', e);
  }
}

btnScope.addEventListener('click', () => {
  viz.setPreset(oscilloscope);
  setActivePreset(btnScope, '');
});

btnLoadPreset.addEventListener('click', () => {
  presetInput.click();
});

presetInput.addEventListener('change', () => {
  if (presetInput.files.length === 0) return;
  const file = presetInput.files[0];
  const reader = new FileReader();
  reader.onload = () => {
    try {
      loadAvsJSON(JSON.parse(reader.result));
    } catch (err) {
      console.error('Failed to parse preset JSON:', err);
    }
  };
  reader.readAsText(file);
  presetInput.value = '';
});

// Expose for console
window.loadAvsJSON = loadAvsJSON;
window.loadDefaultPreset = () => { viz.setPreset(oscilloscope); setActivePreset(btnScope, ''); };

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

  // AVS preset JSON files
  if (file.name.endsWith('.json')) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        loadAvsJSON(JSON.parse(reader.result));
        dismissSplash();
      } catch (err) {
        console.error('Failed to parse preset JSON:', err);
      }
    };
    reader.readAsText(file);
    return;
  }

  // Audio files — load and start capture
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
