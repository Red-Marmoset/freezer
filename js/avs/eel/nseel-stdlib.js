// NSEEL Standard Library — built-in functions ported from ns-eel
// Maps EEL function names to Math.* equivalents and provides
// runtime functions for audio access, timing, etc.

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

  return {
    /**
     * getosc(band, width, channel)
     * Sample the waveform at a position.
     * band: 0.0 to 1.0 — position in the waveform
     * width: size of the averaging window (0 = single sample)
     * channel: 0=center, 1=left, 2=right (we only have center)
     */
    getosc(band, width, channel) {
      if (!waveform) return 0;
      const center = Math.floor(band * sampleCount) % sampleCount;
      const halfW = Math.max(0, Math.floor(width * sampleCount / 2));
      if (halfW === 0) {
        const idx = ((center % sampleCount) + sampleCount) % sampleCount;
        return (waveform[idx] - 128) / 128;
      }
      let sum = 0;
      let count = 0;
      for (let i = center - halfW; i <= center + halfW; i++) {
        const idx = ((i % sampleCount) + sampleCount) % sampleCount;
        sum += (waveform[idx] - 128) / 128;
        count++;
      }
      return count > 0 ? sum / count : 0;
    },

    /**
     * getspec(band, width, channel)
     * Sample the spectrum at a position.
     * band: 0.0 to 1.0 — position in the spectrum
     * width: averaging window
     * channel: 0=center, 1=left, 2=right
     */
    getspec(band, width, channel) {
      if (!spectrum) return 0;
      const center = Math.floor(band * sampleCount) % sampleCount;
      const halfW = Math.max(0, Math.floor(width * sampleCount / 2));
      if (halfW === 0) {
        const idx = ((center % sampleCount) + sampleCount) % sampleCount;
        // Normalize dB to 0-1 range (spectrum is typically -100 to 0 dB)
        return Math.max(0, (spectrum[idx] + 100) / 100);
      }
      let sum = 0;
      let count = 0;
      for (let i = center - halfW; i <= center + halfW; i++) {
        const idx = ((i % sampleCount) + sampleCount) % sampleCount;
        sum += Math.max(0, (spectrum[idx] + 100) / 100);
        count++;
      }
      return count > 0 ? sum / count : 0;
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
  };
}
