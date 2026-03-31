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

// Built-in effects — EXACT formulas from vis_avs r_trans.cpp
// Polar effects operate on r (angle, radians) and d (distance, 0..1 normalized)
// Cartesian effects operate on x,y in -1..1 range
// uses_rect flag from descriptions[] table determines coordinate mode
const BUILTIN_POLAR = {
  // 0: none (passthrough)
  // 1: slight fuzzify (special, random perturbation — approximated)
  3:  'r += 0.1 - 0.2 * d; d *= 0.96;',                                          // big swirl out
  4:  'd *= 0.99 * (1.0 - sin(r - PI*0.5) / 32.0); r += 0.03 * sin(d * PI * 4.0);', // medium swirl
  5:  'd *= 0.94 + cos((r - PI*0.5) * 32.0) * 0.06;',                            // sunburster
  6:  'd *= 1.01 + cos((r - PI*0.5) * 4.0) * 0.04; r += 0.03 * sin(d * PI * 4.0);', // swirl to center
  // 7: blocky partial out (special)
  8:  'r += 0.1 * sin(d * PI * 5.0);',                                            // swirling around both ways
  9:  'float t9 = sin(d * PI); d -= 8.0*t9*t9*t9*t9*t9 / sqrt((sw*sw+sh*sh)/4.0);', // bubbling outward
  10: 'float t10 = sin(d * PI); d -= 8.0*t10*t10*t10*t10*t10 / sqrt((sw*sw+sh*sh)/4.0); float t10b = cos(d*PI/2.0); r += 0.1*t10b*t10b*t10b;', // bubbling outward with swirl
  11: 'd *= 0.95 + cos((r - PI*0.5) * 5.0 - PI / 2.50) * 0.03;',                 // 5 pointed distro
  12: 'r += 0.04; d *= 0.96 + cos(d * PI) * 0.05;',                               // tunneling
  13: 'float t13 = cos(d * PI); r += 0.07 * t13; d *= 0.98 + t13 * 0.10;',        // bleedin
  15: 'd = 0.15;',                                                                 // psychotic beaming outward
  16: 'r = cos(r * 3.0);',                                                         // cosine radial 3-way
  17: 'd *= 1.0 - ((d - 0.35) * 0.5); r += 0.1;',                                 // spinny tube
};

// EEL-evaluated effects (uses_eval=1 in vis_avs) — compiled to GLSL
// These use d,r (polar) or x,y (rect) with sw,sh (screen size) available
const BUILTIN_EVAL_POLAR = {
  18: 'd *= 1.0 - sin((r - PI*0.5) * 7.0) * 0.03; r += cos(d * 12.0) * 0.03;',   // radial swirlies
  19: 'd *= 1.0 - sin((r - PI*0.5) * 12.0) * 0.05; r += cos(d * 18.0) * 0.05; d *= 1.0 - (d - 0.4) * 0.03; r += (d - 0.4) * 0.13;', // swill
};

const BUILTIN_EVAL_RECT = {
  2:  'x = x + 1.0/32.0;',                                                         // shift rotate left
  14: 'float d14 = sqrt(x*x+y*y); float r14 = atan(y,x); r14 += 0.1 - 0.2*d14; d14 *= 0.96; x = cos(r14)*d14 + 8.0/128.0; y = sin(r14)*d14;', // shifted big swirl out
  20: 'x += cos(y * 18.0) * 0.02; y += sin(x * 14.0) * 0.03;',                    // gridley
  21: 'x += cos(abs(y-0.5) * 8.0) * 0.02; y += sin(abs(x-0.5) * 8.0) * 0.05; x *= 0.95; y *= 0.95;', // grapevine
  22: 'x *= 1.0 + sin(atan(y,x) + PI/2.0) * 0.3; y *= 1.0 + cos(atan(y,x) + PI/2.0) * 0.3; x *= 0.995; y *= 0.995;', // quadrant
  23: 'y = (atan(y,x)*6.0)/PI; x = sqrt(x*x+y*y);',                               // 6-way kaleida
};

// Which effects use rectangular coordinates (from descriptions[].uses_rect)
const USES_RECT = { 2: true, 14: true, 20: true, 21: true, 22: true, 23: true };

function buildBuiltinFrag(effectIdx, wrap, width, height) {
  const wrapCode = wrap
    ? 'uv = fract(uv);'
    : 'uv = clamp(uv, 0.0, 1.0);';

  // Check for rectangular coordinate effects first
  const rectCode = BUILTIN_EVAL_RECT[effectIdx];
  if (rectCode || USES_RECT[effectIdx]) {
    const code = rectCode || '';
    return `
      precision mediump float;
      uniform sampler2D tSource;
      varying vec2 vUv;
      #define PI 3.14159265358979
      void main() {
        vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
        float x = uv.x * 2.0 - 1.0;
        float y = uv.y * 2.0 - 1.0;
        float sw = ${(width || 640).toFixed(1)};
        float sh = ${(height || 480).toFixed(1)};
        ${code}
        uv = vec2((x + 1.0) * 0.5, 1.0 - (y + 1.0) * 0.5);
        ${wrapCode}
        gl_FragColor = texture2D(tSource, uv);
      }
    `;
  }

  // Polar coordinate effects
  const polarCode = BUILTIN_POLAR[effectIdx] || BUILTIN_EVAL_POLAR[effectIdx];
  if (polarCode) {
    return `
      precision mediump float;
      uniform sampler2D tSource;
      varying vec2 vUv;
      #define PI 3.14159265358979
      void main() {
        vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
        vec2 c = uv - 0.5;
        float maxD = sqrt(0.5 * 0.5 + 0.5 * 0.5);
        float d = length(c) / maxD;
        float r = atan(c.y, c.x) + PI * 0.5;
        float sw = ${(width || 640).toFixed(1)};
        float sh = ${(height || 480).toFixed(1)};
        ${polarCode}
        r -= PI * 0.5;
        uv = vec2(cos(r) * d * maxD + 0.5, 1.0 - (sin(r) * d * maxD + 0.5));
        ${wrapCode}
        gl_FragColor = texture2D(tSource, uv);
      }
    `;
  }

  // Special effects
  if (effectIdx === 1) {
    // Slight fuzzify: random ±1px perturbation (approximated with noise)
    return `
      precision mediump float;
      uniform sampler2D tSource;
      varying vec2 vUv;
      uniform float uTime;
      void main() {
        vec2 uv = vUv;
        float n1 = fract(sin(dot(uv + uTime, vec2(12.9898, 78.233))) * 43758.5453);
        float n2 = fract(sin(dot(uv + uTime + 0.5, vec2(12.9898, 78.233))) * 43758.5453);
        uv += (vec2(n1, n2) - 0.5) * 0.003;
        gl_FragColor = texture2D(tSource, uv);
      }
    `;
  }
  if (effectIdx === 7) {
    // Blocky partial out: quantize to 8x8 grid
    return `
      precision mediump float;
      uniform sampler2D tSource;
      varying vec2 vUv;
      void main() {
        vec2 uv = floor(vUv * 8.0) / 8.0 * 0.98 + 0.01;
        gl_FragColor = texture2D(tSource, uv);
      }
    `;
  }

  // Fallback: passthrough (mode 0)
  return `
    precision mediump float;
    uniform sampler2D tSource;
    varying vec2 vUv;
    void main() { gl_FragColor = texture2D(tSource, vUv); }
  `;
}

// User-defined shader: lookup displaced UVs from a precomputed displacement texture
const USER_FRAG = `
  precision mediump float;
  uniform sampler2D tSource;
  uniform sampler2D tDispMap;
  uniform bool uWrap;
  varying vec2 vUv;
  void main() {
    vec2 uv = texture2D(tDispMap, vUv).rg;
    if (uWrap) { uv = fract(uv); }
    else { uv = clamp(uv, 0.0, 1.0); }
    gl_FragColor = texture2D(tSource, uv);
  }
`;

const DISP_SIZE = 128; // displacement map resolution (fallback for complex code)

/**
 * Try to transpile simple EEL movement code to GLSL for pixel-perfect rendering.
 * Returns a GLSL fragment shader string, or null if the code is too complex.
 * Handles expressions like: d=d*0.9, r=0, r=r+0.01, d=d*(0.96+sin(r)*0.04), etc.
 */
function tryTranspileToGLSL(code, isPolar, wrap) {
  if (!code || !code.trim()) return null;

  // Strip comments
  let clean = code.replace(/\/\/[^\n]*/g, '').trim();
  if (!clean) return null;

  // Split into statements
  const stmts = clean.split(/[;\n\r]+/).map(s => s.trim()).filter(Boolean);
  const glslLines = [];

  for (const stmt of stmts) {
    // Parse simple assignment: var = expr
    const match = stmt.match(/^([a-z_]\w*)\s*=\s*(.+)$/i);
    if (!match) return null; // Can't handle non-assignment statements

    const varName = match[1].toLowerCase();
    let expr = match[2].trim();

    // Only allow d, r (polar) or x, y (cartesian) assignments
    if (isPolar && varName !== 'd' && varName !== 'r') return null;
    if (!isPolar && varName !== 'x' && varName !== 'y') return null;

    // Transpile expression to GLSL
    const glsl = eelExprToGLSL(expr);
    if (glsl === null) return null;

    glslLines.push(`${varName} = ${glsl};`);
  }

  if (glslLines.length === 0) return null;

  const wrapCode = wrap ? 'uv = fract(uv);' : 'uv = clamp(uv, 0.0, 1.0);';

  if (isPolar) {
    return `
      precision mediump float;
      uniform sampler2D tSource;
      varying vec2 vUv;
      #define PI 3.14159265358979
      void main() {
        vec2 c = vec2(vUv.x - 0.5, 0.5 - vUv.y);
        float d = length(c) * 2.0;
        float r = atan(c.y, c.x) + PI * 0.5;
        ${glslLines.join('\n        ')}
        r -= PI * 0.5;
        vec2 uv = vec2(cos(r) * d * 0.5 + 0.5, 1.0 - (sin(r) * d * 0.5 + 0.5));
        ${wrapCode}
        gl_FragColor = texture2D(tSource, uv);
      }
    `;
  } else {
    return `
      precision mediump float;
      uniform sampler2D tSource;
      varying vec2 vUv;
      #define PI 3.14159265358979
      void main() {
        float x = vUv.x * 2.0 - 1.0;
        float y = 1.0 - vUv.y * 2.0;
        ${glslLines.join('\n        ')}
        vec2 uv = vec2((x + 1.0) * 0.5, 1.0 - (y + 1.0) * 0.5);
        ${wrapCode}
        gl_FragColor = texture2D(tSource, uv);
      }
    `;
  }
}

/**
 * Convert a simple EEL math expression to GLSL.
 * Supports: +, -, *, /, parentheses, numeric literals, sin, cos, tan, sqrt, abs,
 * and variables d, r, x, y, $PI.
 * Returns null if the expression uses features we can't transpile.
 */
function eelExprToGLSL(expr) {
  // Replace $PI with PI
  let s = expr.replace(/\$PI/gi, 'PI');

  // Check for unsupported constructs (function calls we don't know, etc.)
  // Allow: digits, operators, parens, d, r, x, y, PI, sin, cos, tan, sqrt, abs, atan2, pow, log
  const allowed = /^[\s\d\.\+\-\*\/\(\)\,]+$|^[drxy]$/;
  const tokens = s.match(/[a-zA-Z_]\w*|\d+\.?\d*|\.\d+|[+\-*/().,]|\s+/g);
  if (!tokens) return null;

  const knownVars = new Set(['d', 'r', 'x', 'y', 'PI']);
  const knownFuncs = new Set(['sin', 'cos', 'tan', 'sqrt', 'abs', 'atan2', 'pow', 'log', 'asin', 'acos', 'atan', 'min', 'max']);

  const result = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].trim();
    if (!t) continue;

    if (/^\d/.test(t) || /^\.\d/.test(t)) {
      // Number — GLSL requires float literals to have a decimal point
      // .01 → .01 (already has dot), 5 → 5.0, 3.14 → 3.14
      if (t.includes('.')) {
        result.push(t);
      } else {
        result.push(t + '.0');
      }
    } else if (/^[+\-*/().,]$/.test(t)) {
      result.push(t);
    } else if (knownVars.has(t)) {
      result.push(t);
    } else if (knownFuncs.has(t)) {
      result.push(t);
    } else {
      // Unknown identifier — can't transpile
      return null;
    }
  }

  return result.join('');
}

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
      // User-defined: try GLSL transpile first (pixel-perfect), fall back to displacement map
      const isPolar = this.coordinates === 'POLAR';
      const glslFrag = tryTranspileToGLSL(this.code, isPolar, this.wrap);

      this._useDispMap = !glslFrag;

      if (glslFrag) {
        // Pixel-perfect GLSL path
        this._geometry = new THREE.PlaneGeometry(2, 2);
        this._material = new THREE.ShaderMaterial({
          uniforms: { tSource: { value: null } },
          vertexShader: VERT_SHADER,
          fragmentShader: glslFrag,
          depthTest: false,
        });
      } else {
        // Complex code: fall back to displacement map
        this.codeFn = compileEEL(this.code);
        this._dispData = new Float32Array(DISP_SIZE * DISP_SIZE * 4);
        this._dispTex = new THREE.DataTexture(
          this._dispData, DISP_SIZE, DISP_SIZE, THREE.RGBAFormat, THREE.FloatType
        );
        this._dispTex.minFilter = THREE.LinearFilter;
        this._dispTex.magFilter = THREE.LinearFilter;
        this._dispTex.needsUpdate = true;

        this._geometry = new THREE.PlaneGeometry(2, 2);
        this._material = new THREE.ShaderMaterial({
          uniforms: {
            tSource: { value: null },
            tDispMap: { value: this._dispTex },
            uWrap: { value: this.wrap },
          },
          vertexShader: VERT_SHADER,
          fragmentShader: USER_FRAG,
          depthTest: false,
        });
      }
    } else {
      // Built-in effect: full-screen quad with per-pixel shader
      this._geometry = new THREE.PlaneGeometry(2, 2);
      this._material = new THREE.ShaderMaterial({
        uniforms: { tSource: { value: null } },
        vertexShader: VERT_SHADER,
        fragmentShader: buildBuiltinFrag(this.effectIndex, this.wrap, ctx.width, ctx.height),
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

    // User-defined with displacement map fallback: compute disp map once
    if (this.effectIndex === 13 && this._useDispMap && this.codeFn && !this._dispComputed) {
      this._computeDispMap(ctx);
      this._dispComputed = true;
    }

    // Read from active, write to back, swap
    this._material.uniforms.tSource.value = fb.getActiveTexture();
    ctx.renderer.setRenderTarget(fb.getBackTarget());
    ctx.renderer.render(this._scene, this._camera);
    fb.swap();
    this._material.uniforms.tSource.value = null;
  }

  _computeDispMap(ctx) {
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
      this.firstFrame = false;
      this._dispDirty = true;
    }

    // Movement displacement is typically static (doesn't depend on time),
    // but recompute if beat or if code references time-varying variables.
    // For safety, recompute every frame (128x128 = 16K points is fast).
    const usePolar = this.coordinates === 'POLAR';
    const data = this._dispData;
    const sz = DISP_SIZE;

    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const origX = (x + 0.5) / sz;
        const origY = (y + 0.5) / sz;

        if (usePolar) {
          const cx = origX - 0.5;
          const cy = 0.5 - origY; // vis_avs Y convention (y-down)
          s.d = Math.sqrt(cx * cx + cy * cy) * 2;
          s.r = Math.atan2(cy, cx) + Math.PI * 0.5;
        } else {
          s.x = origX * 2 - 1;
          s.y = 1 - origY * 2; // vis_avs Y convention (y-down)
        }

        try { this.codeFn(s, lib); } catch {}

        let newU, newV;
        if (usePolar) {
          const nd = s.d * 0.5;
          const rOut = s.r - Math.PI * 0.5;
          newU = Math.cos(rOut) * nd + 0.5;
          newV = 1 - (Math.sin(rOut) * nd + 0.5); // flip back to WebGL
        } else {
          newU = (s.x + 1) / 2;
          newV = 1 - (s.y + 1) / 2; // flip back to WebGL
        }

        const idx = (y * sz + x) * 4;
        data[idx] = newU;
        data[idx + 1] = newV;
        data[idx + 2] = 0;
        data[idx + 3] = 1;
      }
    }

    this._dispTex.needsUpdate = true;
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
