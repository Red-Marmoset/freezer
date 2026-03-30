// NSEEL Standard Library — built-in functions ported from ns-eel
// Maps EEL function names to Math.* equivalents and provides
// runtime functions for audio access, timing, etc.

// Global input state — updated by initInputTracking()
const inputState = {
  mouseX: 0,    // -1..1 (0 = center)
  mouseY: 0,    // -1..1 (0 = center)
  mouseLeft: 0,
  mouseRight: 0,
  mouseMiddle: 0,
  keys: {},     // keyCode → 1/0
};

let inputInitialized = false;

/**
 * Call once to start tracking mouse/keyboard input on the canvas.
 * @param {HTMLCanvasElement} canvas
 */
export function initInputTracking(canvas) {
  if (inputInitialized) return;
  inputInitialized = true;

  const target = canvas || document;

  target.addEventListener('mousemove', (e) => {
    const rect = (canvas || document.documentElement).getBoundingClientRect();
    // Map to -1..1 range (0,0 = center)
    inputState.mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    inputState.mouseY = ((e.clientY - rect.top) / rect.height) * 2 - 1;
  });

  target.addEventListener('mousedown', (e) => {
    if (e.button === 0) inputState.mouseLeft = 1;
    if (e.button === 2) inputState.mouseRight = 1;
    if (e.button === 1) inputState.mouseMiddle = 1;
  });

  target.addEventListener('mouseup', (e) => {
    if (e.button === 0) inputState.mouseLeft = 0;
    if (e.button === 2) inputState.mouseRight = 0;
    if (e.button === 1) inputState.mouseMiddle = 0;
  });

  // Keyboard tracking
  document.addEventListener('keydown', (e) => {
    inputState.keys[e.keyCode] = 1;
  });
  document.addEventListener('keyup', (e) => {
    inputState.keys[e.keyCode] = 0;
  });

  // Reset buttons on blur (user switches away)
  window.addEventListener('blur', () => {
    inputState.mouseLeft = 0;
    inputState.mouseRight = 0;
    inputState.mouseMiddle = 0;
    inputState.keys = {};
  });
}

// Functions that map directly to Math.* (used at compile time)
// Key = EEL name (lowercase), Value = JS expression prefix
export const STDLIB_MATH = {
  sin:    'Math.sin',
  cos:    'Math.cos',
  tan:    'Math.tan',
  asin:   'Math.asin',
  acos:   'Math.acos',
  atan:   'Math.atan',
  atan2:  'Math.atan2',
  abs:    'Math.abs',
  sqrt:   'Math.sqrt',
  pow:    'Math.pow',
  exp:    'Math.exp',
  log:    'Math.log',
  log10:  'Math.log10',
  floor:  'Math.floor',
  ceil:   'Math.ceil',
  min:    'Math.min',
  max:    'Math.max',
};

// Functions that are inlined by the compiler (not in this map,
// handled directly in nseel-compiler.js):
// sqr, invsqrt, sigmoid/sig, sign, rand, if, above, below, equal,
// band, bor, bnot, loop, while, exec2, exec3, assign, select,
// megabuf, gmegabuf

// Inline expansion hints for the compiler
export const STDLIB_INLINE = {
  sqr:      true,
  invsqrt:  true,
  sigmoid:  true,
  sig:      true,
  sign:     true,
  rand:     true,
  if:       true,
  above:    true,
  below:    true,
  equal:    true,
  band:     true,
  bor:      true,
  bnot:     true,
  loop:     true,
  while:    true,
  exec2:    true,
  exec3:    true,
  assign:   true,
  select:   true,
  megabuf:  true,
  gmegabuf: true,
};

/**
 * Create the runtime library object passed to compiled EEL functions.
 * Contains functions that need runtime data (audio, timing).
 *
 * @param {object} opts
 * @param {Uint8Array} opts.waveform — time-domain audio data (0-255, 128=silence)
 * @param {Float32Array} opts.spectrum — frequency data (dB values)
 * @param {number} opts.fftSize — FFT size
 * @param {number} opts.time — seconds since start
 * @returns {object} — runtime library
 */
export function createStdlib(opts = {}) {
  const { waveform, spectrum, fftSize = 2048 } = opts;
  const sampleCount = fftSize / 2;

  // Per-frame cache for getosc/getspec — same arguments = same result within a frame
  const _oscCache = new Map();
  const _specCache = new Map();

  function _sampleOsc(band, width) {
    if (!waveform) return 0;
    const center = Math.floor(band * sampleCount) % sampleCount;
    const halfW = Math.max(0, Math.floor(width * sampleCount / 2));
    if (halfW === 0) {
      const idx = ((center % sampleCount) + sampleCount) % sampleCount;
      return (waveform[idx] - 128) / 128;
    }
    let sum = 0, count = 0;
    for (let i = center - halfW; i <= center + halfW; i++) {
      sum += (waveform[((i % sampleCount) + sampleCount) % sampleCount] - 128) / 128;
      count++;
    }
    return count > 0 ? sum / count : 0;
  }

  function _sampleSpec(band, width) {
    if (!spectrum) return 0;
    const center = Math.floor(band * sampleCount) % sampleCount;
    const halfW = Math.max(0, Math.floor(width * sampleCount / 2));
    if (halfW === 0) {
      const idx = ((center % sampleCount) + sampleCount) % sampleCount;
      return Math.max(0, (spectrum[idx] + 100) / 100);
    }
    let sum = 0, count = 0;
    for (let i = center - halfW; i <= center + halfW; i++) {
      sum += Math.max(0, (spectrum[((i % sampleCount) + sampleCount) % sampleCount] + 100) / 100);
      count++;
    }
    return count > 0 ? sum / count : 0;
  }

  return {
    getosc(band, width, channel) {
      // Cache key: quantize to avoid float precision issues
      const key = (band * 10000 | 0) + ',' + (width * 10000 | 0);
      if (_oscCache.has(key)) return _oscCache.get(key);
      const val = _sampleOsc(band, width);
      _oscCache.set(key, val);
      return val;
    },

    getspec(band, width, channel) {
      const key = (band * 10000 | 0) + ',' + (width * 10000 | 0);
      if (_specCache.has(key)) return _specCache.get(key);
      const val = _sampleSpec(band, width);
      _specCache.set(key, val);
      return val;
    },

    /**
     * gettime(x)
     * Original AVS: GetTickCount()/1000.0 - x
     * x ≈ -1: Winamp playback position in seconds (not supported, returns 0)
     * x ≈ -2: Winamp playback position in ms (not supported, returns 0)
     * Anything else: returns currentTime - x (delta timing)
     *
     * We use opts.time (seconds since preset load) to keep the float
     * small and preserve precision over long sessions.
     *
     * Common pattern:
     *   time = time + gettime(lasttime);  // accumulate elapsed
     *   lasttime = gettime(0);            // store current time
     */
    gettime(x) {
      if (x > -1.001 && x < -0.999) return 0;
      if (x > -2.001 && x < -1.999) return 0;
      return (opts.time || 0) - x;
    },

    /**
     * getkbmouse(which) — keyboard/mouse state
     * 1=mouse X (-1..1), 2=mouse Y (-1..1),
     * 3=left button, 4=right button, 5=middle button,
     * >5=GetAsyncKeyState(which)
     */
    getkbmouse(which) {
      const w = Math.round(which);
      if (w === 1) return inputState.mouseX;
      if (w === 2) return inputState.mouseY;
      if (w === 3) return inputState.mouseLeft;
      if (w === 4) return inputState.mouseRight;
      if (w === 5) return inputState.mouseMiddle;
      if (w > 5) return inputState.keys[w] ? 1 : 0;
      return 0;
    },
  };
}
