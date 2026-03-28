import { createAudioEngine } from './audio-engine.js';
import { createRenderer } from './renderer.js';
import oscilloscope from './presets/oscilloscope.js';
import { loadAvsPreset } from './avs/avs-engine.js';

const canvas = document.getElementById('visualizer');
const controls = document.getElementById('controls');
const intro = document.getElementById('intro');
const btnSystem = document.getElementById('btn-system');
const btnMic = document.getElementById('btn-mic');
const btnFile = document.getElementById('btn-file');
const fileInput = document.getElementById('file-input');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnDismiss = document.getElementById('btn-dismiss');

const audio = createAudioEngine();
const viz = createRenderer(canvas);

viz.setPreset(oscilloscope);
viz.start(audio);

// --- AVS preset loading ---

function loadAvsJSON(json) {
  try {
    const preset = loadAvsPreset(json);
    viz.setPreset(preset);
    console.log('Loaded AVS preset:', preset.name);
  } catch (e) {
    console.error('Failed to load AVS preset:', e);
  }
}

// Expose for console testing
window.loadAvsJSON = loadAvsJSON;
window.loadDefaultPreset = () => viz.setPreset(oscilloscope);

// --- Audio source switching ---

function setActiveButton(btn) {
  document.querySelectorAll('.source-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

btnSystem.addEventListener('click', async () => {
  try {
    await audio.switchSource('system');
    setActiveButton(btnSystem);
    dismissIntro();
  } catch (e) {
    console.warn('System audio capture cancelled or failed:', e);
  }
});

btnMic.addEventListener('click', async () => {
  try {
    await audio.switchSource('mic');
    setActiveButton(btnMic);
    dismissIntro();
  } catch (e) {
    console.warn('Mic capture failed:', e);
  }
});

btnFile.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    audio.loadFile(fileInput.files[0]);
    setActiveButton(btnFile);
    dismissIntro();
  }
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

  // AVS preset JSON files
  if (file.name.endsWith('.json')) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result);
        loadAvsJSON(json);
        dismissIntro();
      } catch (err) {
        console.error('Failed to parse preset JSON:', err);
      }
    };
    reader.readAsText(file);
    return;
  }

  // Audio files
  if (file.type.startsWith('audio/')) {
    audio.loadFile(file);
    setActiveButton(btnFile);
    dismissIntro();
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
  } else if (e.key === '1') {
    btnSystem.click();
  } else if (e.key === '2') {
    btnMic.click();
  } else if (e.key === '3') {
    btnFile.click();
  }
});

// --- Intro tooltip ---

function dismissIntro() {
  intro.classList.add('hidden');
  localStorage.setItem('intro-dismissed', '1');
}

if (localStorage.getItem('intro-dismissed')) {
  intro.classList.add('hidden');
} else {
  btnDismiss.addEventListener('click', dismissIntro);
}
