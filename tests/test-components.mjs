/**
 * Component Render Tests
 *
 * Tests individual AVS components by constructing minimal presets,
 * rendering them for a few frames, and verifying pixel-level properties.
 *
 * These run in the browser (needs WebGL). Open tests/index.html to run.
 * Or run via Playwright for CI.
 *
 * Usage: import and call runComponentTests() from test page
 */

export const componentTests = [];

function test(name, fn) {
  componentTests.push({ name, fn });
}

// ── Helper: render a preset for N frames and read pixels ────────────

async function renderPreset(preset, frames = 3, width = 128, height = 128) {
  const { loadAvsPreset } = await import('../js/avs/avs-engine.js');
  const THREE = await import('https://esm.sh/three@0.171.0');

  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  const ctx = {
    scene,
    camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    _renderer: renderer,
    audioData: {
      waveform: new Uint8Array(1024).fill(128),
      spectrum: new Float32Array(512).fill(-60),
      fftSize: 1024,
    },
    time: 0,
    dt: 1 / 60,
    width,
    height,
  };

  const avsPreset = loadAvsPreset(preset);
  avsPreset.init(ctx);

  for (let i = 0; i < frames; i++) {
    ctx.time = i / 60;
    ctx.dt = 1 / 60;
    avsPreset.update(ctx);
  }

  // Read pixels from framebuffer
  const fb = avsPreset.framebuffer;
  const pixels = new Uint8Array(width * height * 4);
  renderer.setRenderTarget(fb.getActiveTarget());
  renderer.readRenderTargetPixels(fb.getActiveTarget(), 0, 0, width, height, pixels);
  renderer.setRenderTarget(null);

  avsPreset.destroy(ctx);
  renderer.dispose();

  return { pixels, width, height };
}

function countNonBlack(pixels) {
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] > 2 || pixels[i + 1] > 2 || pixels[i + 2] > 2) count++;
  }
  return count;
}

function avgBrightness(pixels) {
  let sum = 0;
  const n = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    sum += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
  }
  return sum / n;
}

// ── Tests ───────────────────────────────────────────────────────────

test('ClearScreen fills with color', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#ff0000', onBeat: false }
    ]
  });
  // Center pixel should be red
  const mid = (64 * 128 + 64) * 4;
  if (pixels[mid] < 200) throw new Error(`Expected red >200, got ${pixels[mid]}`);
  if (pixels[mid + 1] > 10) throw new Error(`Expected green ~0, got ${pixels[mid + 1]}`);
});

test('FadeOut reduces brightness', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#ffffff' },
      { type: 'FadeOut', enabled: true, speed: 20, color: '#000000' }
    ]
  }, 5);
  const avg = avgBrightness(pixels);
  // After 5 frames of fade at speed=20, brightness decreases ~20/255 per frame
  // From 255, expect ~255 - 5*(20/255)*255 ≈ 155. Allow wide range.
  if (avg > 245) throw new Error(`Expected brightness <245 after fade, got ${avg.toFixed(1)}`);
  if (avg < 10) throw new Error(`Expected some brightness remaining, got ${avg.toFixed(1)}`);
});

test('Invert flips colors', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#ff0000' },
      { type: 'Invert', enabled: true }
    ]
  });
  const mid = (64 * 128 + 64) * 4;
  // Red inverted = cyan (0, 255, 255)
  if (pixels[mid] > 10) throw new Error(`Expected red ~0 after invert, got ${pixels[mid]}`);
  if (pixels[mid + 2] < 200) throw new Error(`Expected blue >200 after invert, got ${pixels[mid + 2]}`);
});

test('Mirror creates symmetry', async () => {
  const { pixels, width } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=1', perFrame: '', onBeat: '', perPoint: 'x=-0.5; y=0' } },
      { type: 'Mirror', enabled: true, mode: 0 } // left-right
    ]
  });
  // Should have pixels on both sides
  const leftCount = countNonBlack(pixels.slice(0, width * 128 * 2));
  const rightCount = countNonBlack(pixels.slice(width * 128 * 2));
  if (leftCount === 0 || rightCount === 0) {
    throw new Error(`Expected pixels on both sides: left=${leftCount}, right=${rightCount}`);
  }
});

test('SuperScope renders points', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=100', perFrame: '', onBeat: '', perPoint: 'x=i*2-1; y=0' } }
    ]
  });
  const nonBlack = countNonBlack(pixels);
  if (nonBlack < 10) throw new Error(`Expected >10 non-black pixels from SuperScope, got ${nonBlack}`);
});

test('Blur spreads pixels', async () => {
  const { pixels: before } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=1', perFrame: '', onBeat: '', perPoint: 'x=0; y=0' } }
    ]
  });
  const { pixels: after } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=1', perFrame: '', onBeat: '', perPoint: 'x=0; y=0' } },
      { type: 'Blur', enabled: true, mode: 'MEDIUM' }
    ]
  });
  const beforeCount = countNonBlack(before);
  const afterCount = countNonBlack(after);
  if (afterCount <= beforeCount) {
    throw new Error(`Expected blur to spread pixels: before=${beforeCount}, after=${afterCount}`);
  }
});

test('Brightness changes pixel values', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#808080' },
      { type: 'Brightness', enabled: true, red: 128, green: 128, blue: 128 }
    ]
  });
  const mid = (64 * 128 + 64) * 4;
  // Brightness should modify the gray
  if (pixels[mid] === 128) throw new Error('Expected brightness to change pixel values');
});

test('Movement mode 3 distorts frame', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: false,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#ffffff' },
      { type: 'Movement', enabled: true, preset: 3, wrap: false }
    ]
  }, 5);
  // After movement, should not be uniform white anymore
  const nonBlack = countNonBlack(pixels);
  const avg = avgBrightness(pixels);
  // Movement should create non-uniform pattern (some black from wrapping)
  if (avg > 250) throw new Error(`Expected distortion to create variation, avg=${avg.toFixed(1)}`);
});

test('ColorReduction posterizes', async () => {
  // Gradient → reduction should reduce unique colors
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=128', perFrame: '', onBeat: '', perPoint: 'x=i*2-1; y=0; red=i; green=i; blue=i' } },
      { type: 'ColorReduction', enabled: true, levels: 2 }
    ]
  });
  // With levels=2, should only have ~4 distinct brightness values
  const unique = new Set();
  for (let i = 0; i < pixels.length; i += 4) unique.add(pixels[i]);
  if (unique.size > 8) throw new Error(`Expected few unique values with reduction, got ${unique.size}`);
});

test('EffectList renders children', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'EffectList', enabled: true, clearFrame: true,
        input: 'IGNORE', output: 'REPLACE',
        components: [
          { type: 'ClearScreen', enabled: true, color: '#00ff00' }
        ]
      }
    ]
  });
  const mid = (64 * 128 + 64) * 4;
  if (pixels[mid + 1] < 200) throw new Error(`Expected green from EffectList child, got ${pixels[mid + 1]}`);
});

test('Disabled component does nothing', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#000000' },
      { type: 'ClearScreen', enabled: false, color: '#ffffff' }
    ]
  });
  const avg = avgBrightness(pixels);
  if (avg > 5) throw new Error(`Expected black (disabled component), got avg=${avg.toFixed(1)}`);
});
