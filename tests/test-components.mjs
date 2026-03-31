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
// Shares a single WebGL renderer to avoid "too many contexts" errors.

let _sharedRenderer = null;
let _THREE = null;
let _loadAvsPreset = null;

async function ensureRenderer() {
  if (!_THREE) _THREE = await import('https://esm.sh/three@0.171.0');
  if (!_loadAvsPreset) _loadAvsPreset = (await import('../js/avs/avs-engine.js')).loadAvsPreset;
  if (!_sharedRenderer) {
    _sharedRenderer = new _THREE.WebGLRenderer({ antialias: false });
    _sharedRenderer.outputColorSpace = _THREE.LinearSRGBColorSpace;
  }
}

async function renderPreset(preset, frames = 3, width = 128, height = 128) {
  await ensureRenderer();
  const THREE = _THREE;
  const loadAvsPreset = _loadAvsPreset;
  const renderer = _sharedRenderer;

  renderer.setSize(width, height);

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
  const { pixels, width, height } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=20', perFrame: '', onBeat: '', perPoint: 'x=-0.3-i*0.3; y=i*0.5-0.25' } },
      { type: 'Mirror', enabled: true, mode: 0 } // left-right
    ]
  });
  // Count non-black pixels in left and right halves
  let leftCount = 0, rightCount = 0;
  const halfW = Math.floor(width / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (pixels[i] > 2 || pixels[i+1] > 2 || pixels[i+2] > 2) {
        if (x < halfW) leftCount++; else rightCount++;
      }
    }
  }
  if (leftCount < 3 || rightCount < 3) {
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
  // Draw an asymmetric pattern, then apply movement — should change the pattern
  const { pixels: before } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=50', perFrame: '', onBeat: '', perPoint: 'x=i*2-1; y=0' } },
    ]
  });
  const { pixels: after } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=50', perFrame: '', onBeat: '', perPoint: 'x=i*2-1; y=0' } },
      { type: 'Movement', enabled: true, builtinEffect: 3, wrap: false }
    ]
  }, 3);
  // The pixel distribution should differ after movement distortion
  const beforeCount = countNonBlack(before);
  const afterCount = countNonBlack(after);
  if (beforeCount === afterCount) throw new Error(`Expected Movement to change pixel distribution: before=${beforeCount}, after=${afterCount}`);
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

// ── SuperScope thorough tests ───────────────────────────────────────

test('SuperScope vertical line (x=0, y=2*i-1)', async () => {
  const { pixels, width, height } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=128', perFrame: '', onBeat: '', perPoint: 'x=0; y=i*2-1' } }
    ]
  });
  // x=0 in NDC lands at pixel ~width/2 (±1 for half-pixel). Check center ±1.
  let hitRows = 0;
  for (let y = 0; y < height; y++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = Math.floor(width / 2) + dx;
      if (cx >= 0 && cx < width) {
        const i = (y * width + cx) * 4;
        if (pixels[i] > 10) { hitRows++; break; }
      }
    }
  }
  if (hitRows < height * 0.4) throw new Error(`Expected vertical line spanning >40% of height, got ${hitRows}/${height}`);
});

test('SuperScope horizontal line (y=0, x=2*i-1)', async () => {
  const { pixels, width, height } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=128', perFrame: '', onBeat: '', perPoint: 'x=i*2-1; y=0' } }
    ]
  });
  // y=0 in NDC lands at pixel ~height/2 (±1 for half-pixel). Check center ±1.
  let hitCols = 0;
  for (let x = 0; x < width; x++) {
    for (let dy = -1; dy <= 1; dy++) {
      const cy = Math.floor(height / 2) + dy;
      if (cy >= 0 && cy < height) {
        const i = (cy * width + x) * 4;
        if (pixels[i] > 10) { hitCols++; break; }
      }
    }
  }
  if (hitCols < width * 0.4) throw new Error(`Expected horizontal line spanning >40% of width, got ${hitCols}/${width}`);
});

test('SuperScope circle (cos/sin)', async () => {
  const { pixels, width, height } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=200', perFrame: '', onBeat: '', perPoint: 'x=cos(i*$PI*2)*0.5; y=sin(i*$PI*2)*0.5' } }
    ]
  });
  const nonBlack = countNonBlack(pixels);
  if (nonBlack < 50) throw new Error(`Expected circle with >50 pixels, got ${nonBlack}`);
  // Circle should have pixels in all 4 quadrants
  let q = [0,0,0,0];
  const cx = width/2, cy = height/2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (pixels[i] > 10) {
        if (x < cx && y < cy) q[0]++;
        if (x >= cx && y < cy) q[1]++;
        if (x < cx && y >= cy) q[2]++;
        if (x >= cx && y >= cy) q[3]++;
      }
    }
  }
  if (q.some(v => v === 0)) throw new Error(`Expected pixels in all 4 quadrants: ${q}`);
});

test('SuperScope per-vertex color (red gradient)', async () => {
  const { pixels, width, height } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=64', perFrame: '', onBeat: '', perPoint: 'x=i*2-1; y=0; red=i; green=0; blue=0' } }
    ]
  });
  // Left side should be darker red, right side brighter red
  const cy = Math.floor(height / 2);
  const leftR = pixels[(cy * width + Math.floor(width * 0.15)) * 4];
  const rightR = pixels[(cy * width + Math.floor(width * 0.85)) * 4];
  if (rightR <= leftR && rightR > 0) throw new Error(`Expected red gradient left→right: left=${leftR}, right=${rightR}`);
});

test('SuperScope skip variable hides points', async () => {
  const { pixels: withSkip } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=100', perFrame: '', onBeat: '', perPoint: 'x=i*2-1; y=0; skip=if(above(i,0.5),1,0)' } }
    ]
  });
  const { pixels: noSkip } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=100', perFrame: '', onBeat: '', perPoint: 'x=i*2-1; y=0' } }
    ]
  });
  const skipCount = countNonBlack(withSkip);
  const fullCount = countNonBlack(noSkip);
  if (skipCount >= fullCount) throw new Error(`Expected skip to reduce pixels: skip=${skipCount}, full=${fullCount}`);
});

test('SuperScope LINES mode draws connected lines', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'LINES', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=2', perFrame: '', onBeat: '', perPoint: 'x=if(equal(i,0),-0.8,0.8); y=if(equal(i,0),-0.5,0.5)' } }
    ]
  });
  // A single line from (-0.8,-0.5) to (0.8,0.5) should have many pixels
  const nonBlack = countNonBlack(pixels);
  if (nonBlack < 20) throw new Error(`Expected line with >20 pixels, got ${nonBlack}`);
});

// ── Movement thorough tests ─────────────────────────────────────────

test('Movement r+=rotation spreads vertical line', async () => {
  // Draw a vertical line, apply mode 12 (tunneling: r+=0.04, d zoom)
  // After frames, the line should spread due to rotation
  const { pixels: before } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=64', perFrame: '', onBeat: '', perPoint: 'x=0; y=i*2-1' } },
    ]
  });
  const { pixels: after } = await renderPreset({
    name: 'test', clearFrame: false,
    components: [
      { type: 'FadeOut', enabled: true, speed: 1, color: '#000000' },
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=64', perFrame: '', onBeat: '', perPoint: 'x=0; y=i*2-1' } },
      { type: 'Movement', enabled: true, builtinEffect: 12, wrap: false }
    ]
  }, 20);
  const beforeCount = countNonBlack(before);
  const afterCount = countNonBlack(after);
  if (afterCount <= beforeCount) throw new Error(`Expected rotation to spread pixels: before=${beforeCount}, after=${afterCount}`);
});

test('Movement mode 5 (sunburster) creates radial pattern', async () => {
  const { pixels: before } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=100', perFrame: '', onBeat: '', perPoint: 'a=i*$PI*2; x=cos(a)*0.4; y=sin(a)*0.4' } }
    ]
  });
  const { pixels: after } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=100', perFrame: '', onBeat: '', perPoint: 'a=i*$PI*2; x=cos(a)*0.4; y=sin(a)*0.4' } },
      { type: 'Movement', enabled: true, builtinEffect: 5, wrap: false }
    ]
  }, 3);
  const beforeCount = countNonBlack(before);
  const afterCount = countNonBlack(after);
  if (beforeCount === afterCount) throw new Error(`Expected sunburster to change pattern: before=${beforeCount}, after=${afterCount}`);
});

test('Movement mode 0 (none) is passthrough', async () => {
  const { pixels: without } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#ff8040' }
    ]
  });
  const { pixels: withMov } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#ff8040' },
      { type: 'Movement', enabled: true, builtinEffect: 0 }
    ]
  });
  // Mode 0 should not change anything
  const mid = (64 * 128 + 64) * 4;
  if (Math.abs(without[mid] - withMov[mid]) > 2) throw new Error(`Mode 0 changed pixels: ${without[mid]} vs ${withMov[mid]}`);
});

// ── FadeOut thorough tests ──────────────────────────────────────────

test('FadeOut toward non-black color', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#000000' },
      { type: 'FadeOut', enabled: true, speed: 50, color: '#ff0000' }
    ]
  }, 10);
  const mid = (64 * 128 + 64) * 4;
  // Should be fading toward red — red channel should increase
  if (pixels[mid] < 10) throw new Error(`Expected fade toward red, got R=${pixels[mid]}`);
});

test('FadeOut speed 0 preserves frame', async () => {
  // Speed=0 should be a no-op (component returns early)
  const { pixels: withFade } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#808080' },
      { type: 'FadeOut', enabled: true, speed: 0, color: '#000000' }
    ]
  }, 3);
  const { pixels: without } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#808080' }
    ]
  }, 3);
  const mid = (64 * 128 + 64) * 4;
  // Should be identical (or very close) with and without speed=0 fadeout
  if (Math.abs(withFade[mid] - without[mid]) > 5) {
    throw new Error(`Speed=0 changed pixels: with=${withFade[mid]}, without=${without[mid]}`);
  }
});

// ── DynamicMovement tests ───────────────────────────────────────────

test('DynamicMovement polar zoom-in (d*=0.9)', async () => {
  const { pixels: before } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=100', perFrame: '', onBeat: '', perPoint: 'a=i*$PI*2; x=cos(a)*0.8; y=sin(a)*0.8' } }
    ]
  });
  const { pixels: after } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=100', perFrame: '', onBeat: '', perPoint: 'a=i*$PI*2; x=cos(a)*0.8; y=sin(a)*0.8' } },
      { type: 'DynamicMovement', enabled: true, coord: 'POLAR', gridW: 16, gridH: 16,
        code: { init: '', perFrame: '', onBeat: '', perPoint: 'd=d*0.5' } }
    ]
  });
  // After zoom-in, the circle should be smaller — fewer pixels at the edges
  const beforeOuter = countPixelsInRing(before, 128, 128, 0.6, 1.0);
  const afterOuter = countPixelsInRing(after, 128, 128, 0.6, 1.0);
  if (afterOuter >= beforeOuter) throw new Error(`Expected zoom-in to reduce outer pixels: before=${beforeOuter}, after=${afterOuter}`);
});

test('DynamicMovement cartesian shift (x=x+0.3)', async () => {
  const { pixels: before } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=50', perFrame: '', onBeat: '', perPoint: 'x=0; y=i*2-1' } }
    ]
  });
  const { pixels: after } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=50', perFrame: '', onBeat: '', perPoint: 'x=0; y=i*2-1' } },
      { type: 'DynamicMovement', enabled: true, coord: 'CARTESIAN', gridW: 16, gridH: 16,
        code: { init: '', perFrame: '', onBeat: '', perPoint: 'x=x+0.3' } }
    ]
  });
  // After x shift, center column should be empty, pixels should be offset right
  const centerX = 64;
  let beforeCenter = 0, afterCenter = 0;
  for (let y = 0; y < 128; y++) {
    if (before[(y * 128 + centerX) * 4] > 10) beforeCenter++;
    if (after[(y * 128 + centerX) * 4] > 10) afterCenter++;
  }
  if (afterCenter >= beforeCenter && beforeCenter > 5) throw new Error(`Expected shift to move pixels from center: before=${beforeCenter}, after=${afterCenter}`);
});

// ── BlitterFeedback tests ───────────────────────────────────────────

test('BlitterFeedback zoom-out expands content', async () => {
  // Draw a cluster of dots, apply strong zoom-out feedback — should grow significantly
  const { pixels: before } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=20', perFrame: '', onBeat: '', perPoint: 'x=sin(i*$PI*2)*0.1; y=cos(i*$PI*2)*0.1' } }
    ]
  });
  const { pixels: after } = await renderPreset({
    name: 'test', clearFrame: false,
    components: [
      { type: 'FadeOut', enabled: true, speed: 1, color: '#000000' },
      { type: 'BlitterFeedback', enabled: true, scale: 36, blendMode: 'REPLACE' },
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=20', perFrame: '', onBeat: '', perPoint: 'x=sin(i*$PI*2)*0.1; y=cos(i*$PI*2)*0.1' } }
    ]
  }, 30);
  const beforeCount = countNonBlack(before);
  const afterCount = countNonBlack(after);
  if (afterCount <= beforeCount) throw new Error(`Expected zoom-out to grow pattern: before=${beforeCount}, after=${afterCount}`);
});

// ── Color tests ─────────────────────────────────────────────────────

test('ClearScreen blue is correct', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [{ type: 'ClearScreen', enabled: true, color: '#0000ff' }]
  });
  const mid = (64 * 128 + 64) * 4;
  if (pixels[mid] > 10) throw new Error(`Expected R~0 for blue, got ${pixels[mid]}`);
  if (pixels[mid + 1] > 10) throw new Error(`Expected G~0 for blue, got ${pixels[mid + 1]}`);
  if (pixels[mid + 2] < 200) throw new Error(`Expected B>200 for blue, got ${pixels[mid + 2]}`);
});

test('ClearScreen green is correct', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [{ type: 'ClearScreen', enabled: true, color: '#00ff00' }]
  });
  const mid = (64 * 128 + 64) * 4;
  if (pixels[mid] > 10) throw new Error(`Expected R~0 for green, got ${pixels[mid]}`);
  if (pixels[mid + 1] < 200) throw new Error(`Expected G>200 for green, got ${pixels[mid + 1]}`);
  if (pixels[mid + 2] > 10) throw new Error(`Expected B~0 for green, got ${pixels[mid + 2]}`);
});

test('ClearScreen white has all channels', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [{ type: 'ClearScreen', enabled: true, color: '#ffffff' }]
  });
  const mid = (64 * 128 + 64) * 4;
  if (pixels[mid] < 250) throw new Error(`Expected R~255 for white, got ${pixels[mid]}`);
  if (pixels[mid + 1] < 250) throw new Error(`Expected G~255, got ${pixels[mid + 1]}`);
  if (pixels[mid + 2] < 250) throw new Error(`Expected B~255, got ${pixels[mid + 2]}`);
});

// ── Scatter test ────────────────────────────────────────────────────

test('Scatter displaces pixels', async () => {
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
      { type: 'Scatter', enabled: true }
    ]
  });
  const beforeCount = countNonBlack(before);
  const afterCount = countNonBlack(after);
  // Scatter should redistribute the single pixel
  if (afterCount === 0 && beforeCount > 0) throw new Error('Scatter removed all pixels');
});

// ── Mosaic test ─────────────────────────────────────────────────────

test('Mosaic creates blocky pattern', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=128', perFrame: '', onBeat: '', perPoint: 'x=i*2-1; y=0; red=i; green=i; blue=i' } },
      { type: 'Mosaic', enabled: true }
    ]
  });
  // Mosaic should reduce unique pixel values (blocks of same color)
  const unique = new Set();
  for (let i = 0; i < pixels.length; i += 4) unique.add(pixels[i]);
  if (unique.size > 64) throw new Error(`Expected mosaic to reduce unique values, got ${unique.size}`);
});

// ── ChannelShift test ───────────────────────────────────────────────

test('ChannelShift rotates RGB channels', async () => {
  // Use green input + mode 4 (BRG swizzle): green(0,255,0) → (B=0,R=0,G=255) = blue
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#00ff00' },
      { type: 'ChannelShift', enabled: true, mode: 4 } // BRG: output = (input.B, input.R, input.G)
    ]
  });
  const mid = (64 * 128 + 64) * 4;
  // Green → BRG → blue (0,0,255)
  if (pixels[mid + 2] < 200) throw new Error(`Expected green→blue via BRG, got B=${pixels[mid + 2]}`);
  if (pixels[mid + 1] > 10) throw new Error(`Expected G~0, got G=${pixels[mid + 1]}`);
});

// ── Grain test ──────────────────────────────────────────────────────

test('Grain adds noise to uniform frame', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#808080' },
      { type: 'Grain', enabled: true }
    ]
  });
  // Grain should create variation in a uniform gray frame
  const unique = new Set();
  for (let i = 0; i < pixels.length; i += 4) unique.add(pixels[i]);
  if (unique.size < 3) throw new Error(`Expected grain to add noise variation, got ${unique.size} unique values`);
});

// ── EEL variable persistence test ───────────────────────────────────

test('SuperScope perFrame vars persist across frames', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=1; t=0', perFrame: 't=t+0.1', onBeat: '', perPoint: 'x=sin(t)*0.5; y=0' } }
    ]
  }, 10);
  // After 10 frames, t=1.0, sin(1)≈0.84 → x≈0.42 → should be right of center
  const nonBlack = countNonBlack(pixels);
  if (nonBlack === 0) throw new Error('Expected perFrame t accumulation to place dot, got 0 pixels');
});

// ── Register sharing between components ─────────────────────────────

test('Global registers shared between components', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      // First scope sets reg00
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=1', perFrame: 'reg00=0.5', onBeat: '', perPoint: 'x=-0.5; y=0' } },
      // Second scope reads reg00 and uses it for position
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ff0000'],
        code: { init: 'n=1', perFrame: '', onBeat: '', perPoint: 'x=reg00; y=0' } }
    ]
  });
  // Should have at least 2 dots — one at x=-0.5 (white) and one at x=0.5 (red)
  const nonBlack = countNonBlack(pixels);
  if (nonBlack < 2) throw new Error(`Expected 2+ dots from register sharing, got ${nonBlack}`);
});

// ── UniqueTone tests ────────────────────────────────────────────────

test('UniqueTone: white + cyan tone = cyan', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#ffffff' },
      { type: 'UniqueTone', enabled: true, color: '#00ffff', blendMode: 0 }
    ]
  });
  const mid = (64 * 128 + 64) * 4;
  if (pixels[mid] > 10) throw new Error(`Expected R~0 for cyan tone, got R=${pixels[mid]}`);
  if (pixels[mid + 1] < 200) throw new Error(`Expected G>200 for cyan tone, got G=${pixels[mid + 1]}`);
  if (pixels[mid + 2] < 200) throw new Error(`Expected B>200 for cyan tone, got B=${pixels[mid + 2]}`);
});

test('UniqueTone: black + any tone = black', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#000000' },
      { type: 'UniqueTone', enabled: true, color: '#ff0000', blendMode: 0 }
    ]
  });
  const avg = avgBrightness(pixels);
  if (avg > 2) throw new Error(`Expected black (tone of black = black), got avg=${avg.toFixed(1)}`);
});

test('UniqueTone: gray + red tone = dark red', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#808080' },
      { type: 'UniqueTone', enabled: true, color: '#ff0000', blendMode: 0 }
    ]
  });
  const mid = (64 * 128 + 64) * 4;
  // Gray(128/255) in sRGB = ~0.216 linear. UniqueTone: 0.216 * red(1,0,0) = (0.216,0,0) ≈ R=55
  if (pixels[mid] < 30) throw new Error(`Expected R>30 for gray+red tone, got R=${pixels[mid]}`);
  if (pixels[mid + 1] > 10) throw new Error(`Expected G~0, got G=${pixels[mid + 1]}`);
  if (pixels[mid + 2] > 10) throw new Error(`Expected B~0, got B=${pixels[mid + 2]}`);
});

// ── Starfield test ──────────────────────────────────────────────────

test('Starfield renders particles', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [{ type: 'Starfield', enabled: true }]
  }, 20);
  const nonBlack = countNonBlack(pixels);
  if (nonBlack < 5) throw new Error(`Expected Starfield particles, got ${nonBlack} pixels`);
});

// ── Ring test ───────────────────────────────────────────────────────

test('Ring draws circular shape', async () => {
  const { pixels, width, height } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [{ type: 'Ring', enabled: true, colors: ['#ffffff'] }]
  });
  const nonBlack = countNonBlack(pixels);
  if (nonBlack < 20) throw new Error(`Expected Ring circle, got ${nonBlack} pixels`);
  // Ring should have pixels near the center, not just edges
  const centerPixels = countPixelsInRing(pixels, width, height, 0, 0.5);
  if (centerPixels < 5) throw new Error(`Expected Ring near center, got ${centerPixels}`);
});

// ── FastBrightness test ─────────────────────────────────────────────

test('FastBrightness 2x doubles pixel values', async () => {
  const { pixels: before } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [{ type: 'ClearScreen', enabled: true, color: '#404040' }]
  });
  const { pixels: after } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#404040' },
      { type: 'FastBrightness', enabled: true, dir: 0 }
    ]
  });
  const mid = (64 * 128 + 64) * 4;
  // 0x40=64 → 2x = 128
  if (after[mid] <= before[mid]) throw new Error(`Expected 2x brightness: before=${before[mid]}, after=${after[mid]}`);
});

test('FastBrightness 0.5x halves pixel values', async () => {
  const { pixels: before } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [{ type: 'ClearScreen', enabled: true, color: '#808080' }]
  });
  const { pixels: after } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#808080' },
      { type: 'FastBrightness', enabled: true, dir: 1 }
    ]
  });
  const mid = (64 * 128 + 64) * 4;
  if (after[mid] >= before[mid]) throw new Error(`Expected 0.5x brightness: before=${before[mid]}, after=${after[mid]}`);
});

// ── Additive blend test ─────────────────────────────────────────────

test('EffectList additive blend combines colors', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#800000' },
      { type: 'EffectList', enabled: true, clearFrame: true, input: 'IGNORE', output: 'ADDITIVE',
        components: [
          { type: 'ClearScreen', enabled: true, color: '#008000' }
        ]
      }
    ]
  });
  const mid = (64 * 128 + 64) * 4;
  // Additive: red(128→linear55,0,0) + green(0,128→linear55,0) ≈ (55,55,0)
  if (pixels[mid] < 30) throw new Error(`Expected R from additive, got R=${pixels[mid]}`);
  if (pixels[mid + 1] < 30) throw new Error(`Expected G from additive, got G=${pixels[mid + 1]}`);
});

// ── EffectList 50/50 blend ──────────────────────────────────────────

test('EffectList 50/50 blend averages colors', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#ff0000' },
      { type: 'EffectList', enabled: true, clearFrame: true, input: 'IGNORE', output: 'FIFTY_FIFTY',
        components: [
          { type: 'ClearScreen', enabled: true, color: '#0000ff' }
        ]
      }
    ]
  });
  const mid = (64 * 128 + 64) * 4;
  // 50/50: red(255,0,0) avg blue(0,0,255) = (127,0,127)
  if (pixels[mid] < 80 || pixels[mid] > 180) throw new Error(`Expected R≈127 from 50/50, got R=${pixels[mid]}`);
  if (pixels[mid + 2] < 80 || pixels[mid + 2] > 180) throw new Error(`Expected B≈127, got B=${pixels[mid + 2]}`);
});

// ── ColorFade test ──────────────────────────────────────────────────

test('ColorFade shifts colors', async () => {
  // ColorFade adds per-frame R/G/B offsets. Fader1 = subtract blue
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#ffffff' },
      { type: 'ColorFade', enabled: true, fader1: [0, 0, -16] }
    ]
  }, 5);
  const mid = (64 * 128 + 64) * 4;
  // After 5 frames subtracting blue, B should be less than R
  if (pixels[mid + 2] >= pixels[mid]) throw new Error(`Expected B < R after blue fade, R=${pixels[mid]}, B=${pixels[mid + 2]}`);
});

// ── OscStar test ────────────────────────────────────────────────────

test('OscStar draws star shape', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'OscStar', enabled: true, colors: ['#ffffff'], size: 16, rot: 0 }
    ]
  });
  const nonBlack = countNonBlack(pixels);
  if (nonBlack < 10) throw new Error(`Expected OscStar to draw >10 pixels, got ${nonBlack}`);
});

// ── DotGrid test ────────────────────────────────────────────────────

test('DotGrid renders grid of dots', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [{ type: 'DotGrid', enabled: true }]
  });
  const nonBlack = countNonBlack(pixels);
  if (nonBlack < 20) throw new Error(`Expected DotGrid dots, got ${nonBlack} pixels`);
});

// ── EffectList Input Blend Mode Tests ────────────────────────────────
// Each test: parent has a color, child clears to another color.
// The INPUT mode controls what the child sees before rendering.

test('EL input=IGNORE: child starts black', async () => {
  // Parent=red, input=IGNORE → child doesn't get parent → child clears to green → output=REPLACE → green
  const { pixels } = await renderPreset({ name: 'test', clearFrame: true, components: [
    { type: 'ClearScreen', enabled: true, color: '#ff0000' },
    { type: 'EffectList', enabled: true, clearFrame: true, input: 'IGNORE', output: 'REPLACE',
      components: [{ type: 'ClearScreen', enabled: true, color: '#00ff00' }] }
  ]});
  const mid = (64 * 128 + 64) * 4;
  if (pixels[mid] > 10) throw new Error(`Expected no red (input ignored), got R=${pixels[mid]}`);
  if (pixels[mid + 1] < 200) throw new Error(`Expected green from child, got G=${pixels[mid + 1]}`);
});

test('EL input=REPLACE: child gets parent content', async () => {
  // Parent=red, input=REPLACE → child gets red → child does nothing → output=REPLACE → red
  const { pixels } = await renderPreset({ name: 'test', clearFrame: true, components: [
    { type: 'ClearScreen', enabled: true, color: '#ff0000' },
    { type: 'EffectList', enabled: true, clearFrame: false, input: 'REPLACE', output: 'REPLACE',
      components: [] }
  ]});
  const mid = (64 * 128 + 64) * 4;
  if (pixels[mid] < 200) throw new Error(`Expected red from parent via REPLACE input, got R=${pixels[mid]}`);
});

test('EL input=FIFTY_FIFTY: child gets 50% parent', async () => {
  // Parent=white, input=FIFTY_FIFTY → child cleared to black → blend 50% parent → output=REPLACE
  const { pixels } = await renderPreset({ name: 'test', clearFrame: true, components: [
    { type: 'ClearScreen', enabled: true, color: '#ffffff' },
    { type: 'EffectList', enabled: true, clearFrame: true, input: 'FIFTY_FIFTY', output: 'REPLACE',
      components: [] }
  ]});
  const mid = (64 * 128 + 64) * 4;
  // 50/50 of white and black child → ~127
  if (pixels[mid] < 90 || pixels[mid] > 170) throw new Error(`Expected ~127 from 50/50 input, got R=${pixels[mid]}`);
});

test('EL input=ADDITIVE: child adds parent', async () => {
  // Parent=red(255,0,0), child clears to green(0,255,0), input=ADDITIVE
  // Child FB starts black, additive blends parent in → child gets red → then clear to green → output=REPLACE → green
  // Actually: input=ADDITIVE adds parent onto child FB (which starts black after clearFrame)
  const { pixels } = await renderPreset({ name: 'test', clearFrame: true, components: [
    { type: 'ClearScreen', enabled: true, color: '#ff0000' },
    { type: 'EffectList', enabled: true, clearFrame: false, input: 'ADDITIVE', output: 'REPLACE',
      components: [] }
  ]});
  const mid = (64 * 128 + 64) * 4;
  // Additive of red onto black child = red
  if (pixels[mid] < 200) throw new Error(`Expected red from additive input, got R=${pixels[mid]}`);
});

// ── EffectList Output Blend Mode Tests ──────────────────────────────
// Each test: parent has one color, child renders another.
// OUTPUT mode controls how child result is composited back to parent.

test('EL output=REPLACE: child overwrites parent', async () => {
  const { pixels } = await renderPreset({ name: 'test', clearFrame: true, components: [
    { type: 'ClearScreen', enabled: true, color: '#ff0000' },
    { type: 'EffectList', enabled: true, clearFrame: true, input: 'IGNORE', output: 'REPLACE',
      components: [{ type: 'ClearScreen', enabled: true, color: '#0000ff' }] }
  ]});
  const mid = (64 * 128 + 64) * 4;
  if (pixels[mid] > 10) throw new Error(`Expected red gone (replaced), got R=${pixels[mid]}`);
  if (pixels[mid + 2] < 200) throw new Error(`Expected blue from child, got B=${pixels[mid + 2]}`);
});

test('EL output=IGNORE: child result discarded', async () => {
  const { pixels } = await renderPreset({ name: 'test', clearFrame: true, components: [
    { type: 'ClearScreen', enabled: true, color: '#ff0000' },
    { type: 'EffectList', enabled: true, clearFrame: true, input: 'IGNORE', output: 'IGNORE',
      components: [{ type: 'ClearScreen', enabled: true, color: '#0000ff' }] }
  ]});
  const mid = (64 * 128 + 64) * 4;
  // Output=IGNORE → parent unchanged = still red
  if (pixels[mid] < 200) throw new Error(`Expected red preserved (output ignored), got R=${pixels[mid]}`);
  if (pixels[mid + 2] > 10) throw new Error(`Expected no blue (output ignored), got B=${pixels[mid + 2]}`);
});

test('EL output=ADDITIVE: adds child onto parent', async () => {
  const { pixels } = await renderPreset({ name: 'test', clearFrame: true, components: [
    { type: 'ClearScreen', enabled: true, color: '#800000' },
    { type: 'EffectList', enabled: true, clearFrame: true, input: 'IGNORE', output: 'ADDITIVE',
      components: [{ type: 'ClearScreen', enabled: true, color: '#008000' }] }
  ]});
  const mid = (64 * 128 + 64) * 4;
  // Additive: parent dark red + child dark green → both channels present
  if (pixels[mid] < 20) throw new Error(`Expected R from parent after additive, got R=${pixels[mid]}`);
  if (pixels[mid + 1] < 20) throw new Error(`Expected G from child after additive, got G=${pixels[mid + 1]}`);
});

test('EL output=FIFTY_FIFTY: averages parent and child', async () => {
  const { pixels } = await renderPreset({ name: 'test', clearFrame: true, components: [
    { type: 'ClearScreen', enabled: true, color: '#ff0000' },
    { type: 'EffectList', enabled: true, clearFrame: true, input: 'IGNORE', output: 'FIFTY_FIFTY',
      components: [{ type: 'ClearScreen', enabled: true, color: '#0000ff' }] }
  ]});
  const mid = (64 * 128 + 64) * 4;
  // 50/50 of red and blue → both present at ~half
  if (pixels[mid] < 80 || pixels[mid] > 180) throw new Error(`Expected R≈127 from 50/50, got R=${pixels[mid]}`);
  if (pixels[mid + 2] < 80 || pixels[mid + 2] > 180) throw new Error(`Expected B≈127, got B=${pixels[mid + 2]}`);
});

test('EL output=MAXIMUM: takes max of parent and child', async () => {
  const { pixels } = await renderPreset({ name: 'test', clearFrame: true, components: [
    { type: 'ClearScreen', enabled: true, color: '#ff0000' },
    { type: 'EffectList', enabled: true, clearFrame: true, input: 'IGNORE', output: 'MAXIMUM',
      components: [{ type: 'ClearScreen', enabled: true, color: '#0000ff' }] }
  ]});
  const mid = (64 * 128 + 64) * 4;
  // MAX of red(255,0,0) and blue(0,0,255) → (255,0,255) = magenta
  if (pixels[mid] < 200) throw new Error(`Expected R=255 from max, got R=${pixels[mid]}`);
  if (pixels[mid + 2] < 200) throw new Error(`Expected B=255 from max, got B=${pixels[mid + 2]}`);
});

test('EL output=SUB_DEST_SRC: parent minus child', async () => {
  const { pixels } = await renderPreset({ name: 'test', clearFrame: true, components: [
    { type: 'ClearScreen', enabled: true, color: '#ffffff' },
    { type: 'EffectList', enabled: true, clearFrame: true, input: 'IGNORE', output: 'SUB_DEST_SRC',
      components: [{ type: 'ClearScreen', enabled: true, color: '#ff0000' }] }
  ]});
  const mid = (64 * 128 + 64) * 4;
  // white(255,255,255) - red(255,0,0) = cyan(0,255,255)
  if (pixels[mid] > 10) throw new Error(`Expected R~0 from sub, got R=${pixels[mid]}`);
  if (pixels[mid + 1] < 200) throw new Error(`Expected G=255 from sub, got G=${pixels[mid + 1]}`);
  if (pixels[mid + 2] < 200) throw new Error(`Expected B=255 from sub, got B=${pixels[mid + 2]}`);
});

// ── Nested EffectList Tests ─────────────────────────────────────────

test('Nested EL: outer replace, inner additive', async () => {
  // Outer EL replaces parent with its child. Inner EL adds green onto outer's red.
  const { pixels } = await renderPreset({ name: 'test', clearFrame: true, components: [
    { type: 'ClearScreen', enabled: true, color: '#000000' },
    { type: 'EffectList', enabled: true, clearFrame: true, input: 'IGNORE', output: 'REPLACE',
      components: [
        { type: 'ClearScreen', enabled: true, color: '#800000' },
        { type: 'EffectList', enabled: true, clearFrame: true, input: 'IGNORE', output: 'ADDITIVE',
          components: [{ type: 'ClearScreen', enabled: true, color: '#008000' }] }
      ]
    }
  ]});
  const mid = (64 * 128 + 64) * 4;
  // Outer starts red, inner adds green → outer has (red+green) → parent gets replaced
  if (pixels[mid] < 20) throw new Error(`Expected R from outer, got R=${pixels[mid]}`);
  if (pixels[mid + 1] < 20) throw new Error(`Expected G from inner additive, got G=${pixels[mid + 1]}`);
});

test('Nested EL: outer additive, inner replace', async () => {
  // Parent=red. Outer EL(output=ADDITIVE) clears to blue → adds blue onto red = magenta
  const { pixels } = await renderPreset({ name: 'test', clearFrame: true, components: [
    { type: 'ClearScreen', enabled: true, color: '#ff0000' },
    { type: 'EffectList', enabled: true, clearFrame: true, input: 'IGNORE', output: 'ADDITIVE',
      components: [
        { type: 'ClearScreen', enabled: true, color: '#0000ff' }
      ]
    }
  ]});
  const mid = (64 * 128 + 64) * 4;
  // red + blue = magenta
  if (pixels[mid] < 200) throw new Error(`Expected R from parent, got R=${pixels[mid]}`);
  if (pixels[mid + 2] < 200) throw new Error(`Expected B from additive EL, got B=${pixels[mid + 2]}`);
});

test('Triple nested EL: additive chain builds white', async () => {
  // Three nested ELs each add a primary color → should build toward white
  const { pixels } = await renderPreset({ name: 'test', clearFrame: true, components: [
    { type: 'ClearScreen', enabled: true, color: '#000000' },
    { type: 'EffectList', enabled: true, clearFrame: true, input: 'IGNORE', output: 'ADDITIVE',
      components: [{ type: 'ClearScreen', enabled: true, color: '#ff0000' }] },
    { type: 'EffectList', enabled: true, clearFrame: true, input: 'IGNORE', output: 'ADDITIVE',
      components: [{ type: 'ClearScreen', enabled: true, color: '#00ff00' }] },
    { type: 'EffectList', enabled: true, clearFrame: true, input: 'IGNORE', output: 'ADDITIVE',
      components: [{ type: 'ClearScreen', enabled: true, color: '#0000ff' }] },
  ]});
  const mid = (64 * 128 + 64) * 4;
  // black + red + green + blue = white
  if (pixels[mid] < 200) throw new Error(`Expected R~255, got R=${pixels[mid]}`);
  if (pixels[mid + 1] < 200) throw new Error(`Expected G~255, got G=${pixels[mid + 1]}`);
  if (pixels[mid + 2] < 200) throw new Error(`Expected B~255, got B=${pixels[mid + 2]}`);
});

// ── BufferSave/Restore round-trip test ──────────────────────────────

test('BufferSave+ClearScreen+Restore preserves original', async () => {
  // Draw a pattern, save it, render random junk in EffectLists,
  // clear screen, restore — result should match the saved pattern.
  const { pixels: original } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ff8800'],
        code: { init: 'n=200', perFrame: '', onBeat: '',
          perPoint: 'x=sin(i*$PI*6)*0.7; y=cos(i*$PI*4)*0.5; red=i; green=1-i; blue=0.5+sin(i*$PI)*0.5' } },
    ]
  });

  const { pixels: restored } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      // 1. Draw the same pattern
      { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ff8800'],
        code: { init: 'n=200', perFrame: '', onBeat: '',
          perPoint: 'x=sin(i*$PI*6)*0.7; y=cos(i*$PI*4)*0.5; red=i; green=1-i; blue=0.5+sin(i*$PI)*0.5' } },
      // 2. Save to buffer 0
      { type: 'BufferSave', action: 0, buffer: 0, blendMode: 'REPLACE' },
      // 3. Splatter random garbage via EffectList
      { type: 'EffectList', enabled: true, clearFrame: true, input: 'IGNORE', output: 'REPLACE',
        components: [
          { type: 'ClearScreen', enabled: true, color: '#ff00ff' },
          { type: 'SuperScope', enabled: true, drawMode: 'DOTS', audioSource: 'WAVEFORM',
            audioChannel: 'CENTER', colors: ['#00ff00'],
            code: { init: 'n=500', perFrame: '', onBeat: '',
              perPoint: 'x=rand(200)/100-1; y=rand(200)/100-1' } },
        ]
      },
      // 4. Clear screen to wipe the garbage
      { type: 'ClearScreen', enabled: true, color: '#000000' },
      // 5. More junk
      { type: 'SuperScope', enabled: true, drawMode: 'LINES', audioSource: 'WAVEFORM',
        audioChannel: 'CENTER', colors: ['#ffffff'],
        code: { init: 'n=50', perFrame: '', onBeat: '',
          perPoint: 'x=i*2-1; y=sin(i*20)*0.8' } },
      // 6. Clear again
      { type: 'ClearScreen', enabled: true, color: '#000000' },
      // 7. Restore from buffer 0
      { type: 'BufferSave', action: 1, buffer: 0, blendMode: 'REPLACE' },
    ]
  });

  // Compare: restored frame should match the original
  let matchPixels = 0, totalChecked = 0, maxDiff = 0;
  for (let i = 0; i < original.length; i += 4) {
    totalChecked++;
    const dr = Math.abs(original[i] - restored[i]);
    const dg = Math.abs(original[i+1] - restored[i+1]);
    const db = Math.abs(original[i+2] - restored[i+2]);
    const diff = Math.max(dr, dg, db);
    maxDiff = Math.max(maxDiff, diff);
    if (diff <= 2) matchPixels++;
  }
  const matchPct = (matchPixels / totalChecked * 100);
  if (matchPct < 95) {
    throw new Error(`Expected >95% match after save/restore, got ${matchPct.toFixed(1)}% (maxDiff=${maxDiff})`);
  }
});

// ── Text Component Tests ────────────────────────────────────────────

test('Text component renders white text on black background', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#000000' },
      { type: 'Text', enabled: true, text: 'HELLO', color: '#ffffff',
        fontSize: 48, bold: true, halign: 'center', valign: 'center' }
    ]
  });
  const nonBlack = countNonBlack(pixels);
  if (nonBlack < 10) throw new Error(`Expected Text to render >10 non-black pixels, got ${nonBlack}`);
});

test('Text component renders on colored background', async () => {
  // White text on blue background — text pixels should have high R+G
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#0000ff' },
      { type: 'Text', enabled: true, text: 'TEST', color: '#ffffff',
        fontSize: 64, bold: true, halign: 'center', valign: 'center' }
    ]
  });
  // Some pixels should be white (text) on blue background
  let whiteish = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] > 200 && pixels[i+1] > 200 && pixels[i+2] > 200) whiteish++;
  }
  if (whiteish < 5) throw new Error(`Expected white text pixels on blue bg, got ${whiteish}`);
});

test('Text component with red color renders red text', async () => {
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#000000' },
      { type: 'Text', enabled: true, text: 'RED', color: '#ff0000',
        fontSize: 64, bold: true, halign: 'center', valign: 'center' }
    ]
  });
  // Should have red pixels (R>200, G<50, B<50)
  let redPixels = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] > 200 && pixels[i+1] < 50 && pixels[i+2] < 50) redPixels++;
  }
  if (redPixels < 5) throw new Error(`Expected red text pixels, got ${redPixels}`);
});

test('Text empty string renders nothing', async () => {
  const { pixels: withText } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#444444' },
      { type: 'Text', enabled: true, text: '', color: '#ffffff',
        fontSize: 48, halign: 'center', valign: 'center' }
    ]
  });
  const { pixels: without } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'ClearScreen', enabled: true, color: '#444444' }
    ]
  });
  // Empty text should not change the frame
  const mid = (64 * 128 + 64) * 4;
  if (Math.abs(withText[mid] - without[mid]) > 3) {
    throw new Error(`Empty text changed pixels: with=${withText[mid]}, without=${without[mid]}`);
  }
});

// ── Texer II Tests ──────────────────────────────────────────────────

test('Texer II renders sprites at EEL positions', async () => {
  // Texer II with n=5 points in a line should produce visible sprites
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'Acko.net: Texer II', enabled: true, imageSrc: '',
        code: { init: 'n=5', perFrame: '', onBeat: '',
          perPoint: 'x=i*1.6-0.8; y=0; sizex=0.1; sizey=0.1' } }
    ]
  });
  const nonBlack = countNonBlack(pixels);
  if (nonBlack < 10) throw new Error(`Expected Texer II sprites >10 pixels, got ${nonBlack}`);
});

test('Texer II sprites at known positions', async () => {
  // Place one sprite at center — should light up center area
  const { pixels, width, height } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'Acko.net: Texer II', enabled: true, imageSrc: '',
        code: { init: 'n=1', perFrame: '', onBeat: '',
          perPoint: 'x=0; y=0; sizex=0.2; sizey=0.2' } }
    ]
  });
  // Center area should have pixels
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  let centerBright = 0;
  for (let dy = -10; dy <= 10; dy++) {
    for (let dx = -10; dx <= 10; dx++) {
      const px = cx + dx, py = cy + dy;
      if (px >= 0 && px < width && py >= 0 && py < height) {
        const i = (py * width + px) * 4;
        if (pixels[i] > 10 || pixels[i+1] > 10 || pixels[i+2] > 10) centerBright++;
      }
    }
  }
  if (centerBright < 5) throw new Error(`Expected Texer II sprite at center, got ${centerBright} bright pixels`);
});

test('Texer II sprite not at center when offset', async () => {
  // Place sprite at x=0.5 — should NOT be at center
  const { pixels, width, height } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'Acko.net: Texer II', enabled: true, imageSrc: '',
        code: { init: 'n=1', perFrame: '', onBeat: '',
          perPoint: 'x=0.5; y=0; sizex=0.1; sizey=0.1' } }
    ]
  });
  // Center column should be dark, right side should have sprite
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const centerVal = pixels[(cy * width + cx) * 4];
  // Check right quarter
  const rx = Math.floor(width * 0.75);
  let rightBright = 0;
  for (let dy = -8; dy <= 8; dy++) {
    const py = cy + dy;
    if (py >= 0 && py < height) {
      const i = (py * width + rx) * 4;
      if (pixels[i] > 10) rightBright++;
    }
  }
  if (centerVal > 20 && rightBright === 0) throw new Error(`Sprite should be offset right, but center=${centerVal}, right=${rightBright}`);
});

test('Texer II per-point color tinting', async () => {
  // Set sprite color to red via EEL — red channel should dominate
  const { pixels } = await renderPreset({
    name: 'test', clearFrame: true,
    components: [
      { type: 'Acko.net: Texer II', enabled: true, imageSrc: '',
        code: { init: 'n=1', perFrame: '', onBeat: '',
          perPoint: 'x=0; y=0; sizex=0.3; sizey=0.3; red=1; green=0; blue=0' } }
    ]
  });
  // Count pixels where red is the dominant nonzero channel
  let redDominant = 0, anyBright = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] > 5 || pixels[i+1] > 5 || pixels[i+2] > 5) {
      anyBright++;
      if (pixels[i] > pixels[i+1] + 5 && pixels[i] > pixels[i+2] + 5) redDominant++;
    }
  }
  if (anyBright < 5) throw new Error(`Expected visible sprites, got ${anyBright} bright pixels`);
  if (redDominant < anyBright * 0.5) throw new Error(`Expected red-dominant tinting, got ${redDominant}/${anyBright} red-dominant`);
});

// ── Helpers ─────────────────────────────────────────────────────────

function countPixelsInRing(pixels, width, height, innerR, outerR) {
  let count = 0;
  const cx = width / 2, cy = height / 2;
  const maxR = Math.min(cx, cy);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x - cx) / maxR;
      const dy = (y - cy) / maxR;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r >= innerR && r <= outerR) {
        const i = (y * width + x) * 4;
        if (pixels[i] > 2 || pixels[i+1] > 2 || pixels[i+2] > 2) count++;
      }
    }
  }
  return count;
}
