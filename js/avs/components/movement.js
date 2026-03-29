// AVS Movement component — 24 built-in UV transform presets + user-defined EEL code
// Built-in effects run in a GLSL shader. User-defined (effect 13) runs EEL code
// on a CPU grid and writes displaced UVs, same approach as DynamicMovement.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { compileEEL, createState } from '../eel/nseel-compiler.js';
import { createStdlib } from '../eel/nseel-stdlib.js';

const VERT_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Built-in effects as individual fragment shaders (no branching)
const BUILTIN_FRAGS = {
  0: null, // None
  1: 'uv = uv * 0.99 + 0.005;', // Slight fuzzify
  2: 'd *= 0.98; r += 0.04;', // Shift rotate left
  3: 'd *= 1.01; r += 0.05 * (1.0 - d);', // Big swirl out
  4: 'r += 0.03;', // Medium swirl
  5: 'd *= 1.02; r += 0.01;', // Sunburster
  6: 'd *= 0.9;', // Squish
  7: null, // Chaos dwarf (cartesian, handled separately)
  8: 'd *= 0.96; r += 0.02;', // Inf zoom shift rotate
  9: 'd = 0.8 / (d + 0.01);', // Tunnel
  10: 'd *= 0.98;', // Gentle zoom in
  11: null, // Blocky partial out (cartesian, handled separately)
  12: 'r += 0.1 * sin(d * PI * 2.0);', // Swirling both ways
  13: null, // User defined (CPU path)
  14: 'd *= 1.02;', // Gentle zoom out
  15: 'd *= 0.95; r += 0.1 * d;', // Swirl to center
  16: 'd *= (0.96 + 0.04 * sin(r * 5.0)); r += 0.02;', // Starfish
  17: 'r += 0.1 * (1.0 - d);', // Yawning rotation left
  18: 'r -= 0.1 * (1.0 - d);', // Yawning rotation right
  19: 'd *= 0.99; r += 0.01;', // Mild zoom + rotation
  20: 'd *= 0.98; r += 0.06 * (1.0 - d);', // Drain
  21: 'd *= 0.96; r += 0.1 * (1.0 - d);', // Super drain
  22: 'd *= 0.94; r += 0.15 * (1.0 - d);', // Hyper drain
  23: null, // Shift down (cartesian, handled separately)
};

// Special cartesian effects
const CARTESIAN_FRAGS = {
  7: 'uv += vec2(sin(uv.y * PI * 4.0) * 0.01, cos(uv.x * PI * 4.0) * 0.01);', // Chaos dwarf
  11: 'uv = floor(uv * 8.0) / 8.0 * 0.98 + 0.01;', // Blocky partial out
  23: 'uv.y += 0.02;', // Shift down
};

function buildBuiltinFrag(effectIdx, wrap) {
  const polarCode = BUILTIN_FRAGS[effectIdx];
  const cartCode = CARTESIAN_FRAGS[effectIdx];
  const wrapCode = wrap
    ? 'uv = fract(uv);'
    : 'uv = clamp(uv, 0.0, 1.0);';

  if (polarCode) {
    return `
      precision mediump float;
      uniform sampler2D tSource;
      varying vec2 vUv;
      #define PI 3.14159265358979
      void main() {
        vec2 uv = vUv;
        vec2 c = uv - 0.5;
        float d = length(c) * 2.0;
        float r = atan(c.y, c.x);
        ${polarCode}
        uv = vec2(cos(r), sin(r)) * d * 0.5 + 0.5;
        ${wrapCode}
        gl_FragColor = texture2D(tSource, uv);
      }
    `;
  }
  if (cartCode) {
    return `
      precision mediump float;
      uniform sampler2D tSource;
      varying vec2 vUv;
      #define PI 3.14159265358979
      void main() {
        vec2 uv = vUv;
        ${cartCode}
        ${wrapCode}
        gl_FragColor = texture2D(tSource, uv);
      }
    `;
  }
  // Fallback: passthrough
  return `
    precision mediump float;
    uniform sampler2D tSource;
    varying vec2 vUv;
    void main() { gl_FragColor = texture2D(tSource, vUv); }
  `;
}

// Grid fragment shader for user-defined (UVs displaced by CPU)
const GRID_FRAG = `
  precision mediump float;
  uniform sampler2D tSource;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(tSource, vUv);
  }
`;

const GRID_SIZE = 32; // grid resolution for user-defined movement

export class Movement extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.effectIndex = typeof opts.builtinEffect === 'number'
      ? opts.builtinEffect
      : parseEffectName(opts.builtinEffect || opts.preset || 0);
    this.bilinear = opts.bilinear !== false;
    this.wrap = opts.wrap || false;
    this.onBeatReverse = opts.onBeatReverse || false;
    this.coordinates = (opts.coordinates || 'POLAR').toUpperCase();
    this._reversed = false;

    // User-defined code (effect 13)
    this.code = opts.code || '';
    this.codeFn = null;

    this.state = null;
    this.firstFrame = true;

    this._scene = null;
    this._camera = null;
    this._material = null;
    this._geometry = null;
  }

  init(ctx) {
    this.state = createState(ctx.globalRegisters, ctx.globalMegabuf);
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    if (this.effectIndex === 13 && this.code) {
      // User-defined: grid mesh + EEL code
      this.codeFn = compileEEL(this.code);
      this._geometry = new THREE.PlaneGeometry(2, 2, GRID_SIZE, GRID_SIZE);
      this._material = new THREE.ShaderMaterial({
        uniforms: { tSource: { value: null } },
        vertexShader: VERT_SHADER,
        fragmentShader: GRID_FRAG,
        depthTest: false,
      });
    } else {
      // Built-in effect: full-screen quad with per-pixel shader
      this._geometry = new THREE.PlaneGeometry(2, 2);
      this._material = new THREE.ShaderMaterial({
        uniforms: { tSource: { value: null } },
        vertexShader: VERT_SHADER,
        fragmentShader: buildBuiltinFrag(this.effectIndex, this.wrap),
        depthTest: false,
      });
    }

    this._scene.add(new THREE.Mesh(this._geometry, this._material));
    this.firstFrame = true;
  }

  render(ctx, fb) {
    if (!this.enabled) return;
    if (this.effectIndex === 0 && !this.code) return;

    if (this.onBeatReverse && ctx.beat) {
      this._reversed = !this._reversed;
    }

    // User-defined: run EEL code on grid vertices
    if (this.effectIndex === 13 && this.codeFn) {
      this._renderUserDefined(ctx);
    }

    // Read from active, write to back, swap
    this._material.uniforms.tSource.value = fb.getActiveTexture();
    ctx.renderer.setRenderTarget(fb.getBackTarget());
    ctx.renderer.render(this._scene, this._camera);
    fb.swap();
    this._material.uniforms.tSource.value = null;
  }

  _renderUserDefined(ctx) {
    const s = this.state;
    const lib = createStdlib({
      waveform: ctx.audioData.waveform,
      spectrum: ctx.audioData.spectrum,
      fftSize: ctx.audioData.fftSize,
      time: ctx.time,
    });

    s.w = ctx.width;
    s.h = ctx.height;
    s.b = ctx.beat ? 1 : 0;

    if (this.firstFrame) {
      try { this.codeFn(s, lib); } catch {}
      this.firstFrame = false;
    }

    const usePolar = this.coordinates === 'POLAR';
    const uvAttr = this._geometry.attributes.uv;
    const posAttr = this._geometry.attributes.position;
    const vertCount = posAttr.count;

    for (let i = 0; i < vertCount; i++) {
      const origX = (posAttr.getX(i) + 1) / 2;
      const origY = (posAttr.getY(i) + 1) / 2;

      if (usePolar) {
        const cx = origX - 0.5;
        const cy = origY - 0.5;
        s.d = Math.sqrt(cx * cx + cy * cy) * 2;
        s.r = Math.atan2(cy, cx);
      } else {
        s.x = origX * 2 - 1;
        s.y = origY * 2 - 1;
      }

      try { this.codeFn(s, lib); } catch {}

      let newU, newV;
      if (usePolar) {
        const nd = s.d * 0.5;
        newU = Math.cos(s.r) * nd + 0.5;
        newV = Math.sin(s.r) * nd + 0.5;
      } else {
        newU = (s.x + 1) / 2;
        newV = (s.y + 1) / 2;
      }

      if (this.wrap) {
        newU = newU - Math.floor(newU);
        newV = newV - Math.floor(newV);
      } else {
        newU = Math.max(0, Math.min(1, newU));
        newV = Math.max(0, Math.min(1, newV));
      }

      uvAttr.setXY(i, newU, newV);
    }
    uvAttr.needsUpdate = true;
  }

  destroy() {
    if (this._geometry) this._geometry.dispose();
    if (this._material) this._material.dispose();
  }
}

function parseEffectName(name) {
  if (typeof name === 'number') return name;
  const names = {
    'none': 0, 'slight fuzzify': 1, 'shift rotate left': 2,
    'big swirl out': 3, 'medium swirl': 4, 'sunburster': 5,
    'squish': 6, 'chaos dwarf': 7, 'infinitely zooming shift rotate': 8,
    'tunnel': 9, 'gentle zoom in': 10, 'blocky partial out': 11,
    'swirling around both ways': 12, 'user defined': 13,
    'gentle zoom out': 14, 'swirl to center': 15, 'starfish': 16,
    'yawning rotation left': 17, 'yawning rotation right': 18,
    'mild zoom in with slight rotation': 19,
    'drain': 20, 'super drain': 21, 'hyper drain': 22, 'shift down': 23,
  };
  return names[(name || '').toLowerCase()] || 0;
}

AvsComponent.register('Movement', Movement);
