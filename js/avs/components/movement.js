// AVS Movement component — 24 built-in UV transform presets
// Warps the framebuffer using polar/cartesian UV displacement on a full-screen quad.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

// Fragment shader that implements the 24 built-in movement effects
const VERT_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG_SHADER = `
  uniform sampler2D tSource;
  uniform int uEffect;
  uniform bool uBilinear;
  uniform bool uWrap;
  varying vec2 vUv;

  #define PI 3.14159265358979

  vec2 toPolar(vec2 uv) {
    vec2 c = uv - 0.5;
    float d = length(c) * 2.0;
    float r = atan(c.y, c.x);
    return vec2(d, r);
  }

  vec2 toCart(vec2 dr) {
    return vec2(cos(dr.y), sin(dr.y)) * dr.x * 0.5 + 0.5;
  }

  vec2 wrapUV(vec2 uv) {
    return fract(uv);
  }

  void main() {
    vec2 uv = vUv;
    vec2 polar = toPolar(uv);
    float d = polar.x;
    float r = polar.y;

    // Apply the selected built-in effect
    if (uEffect == 0) {
      // None
    } else if (uEffect == 1) {
      // Slight fuzzify
      uv = uv * 0.99 + 0.005;
    } else if (uEffect == 2) {
      // Shift rotate left
      d = d * 0.98;
      r = r + 0.04;
      uv = toCart(vec2(d, r));
    } else if (uEffect == 3) {
      // Big swirl out
      d = d * 1.01;
      r = r + 0.05 * (1.0 - d);
      uv = toCart(vec2(d, r));
    } else if (uEffect == 4) {
      // Medium swirl
      r = r + 0.03;
      uv = toCart(vec2(d, r));
    } else if (uEffect == 5) {
      // Sunburster
      d = d * 1.02;
      r = r + 0.01;
      uv = toCart(vec2(d, r));
    } else if (uEffect == 6) {
      // Squish
      d = d * 0.9;
      uv = toCart(vec2(d, r));
    } else if (uEffect == 7) {
      // Chaos dwarf
      uv = uv + vec2(sin(uv.y * PI * 4.0) * 0.01, cos(uv.x * PI * 4.0) * 0.01);
    } else if (uEffect == 8) {
      // Infinitely zooming shift rotate
      d = d * 0.96;
      r = r + 0.02;
      uv = toCart(vec2(d, r));
    } else if (uEffect == 9) {
      // Tunnel
      d = 0.8 / (d + 0.01);
      uv = toCart(vec2(d, r));
    } else if (uEffect == 10) {
      // Gentle zoom in
      d = d * 0.98;
      uv = toCart(vec2(d, r));
    } else if (uEffect == 11) {
      // Blocky partial out
      uv = floor(uv * 8.0) / 8.0 * 0.98 + 0.01;
    } else if (uEffect == 12) {
      // Swirling around both ways
      r = r + 0.1 * sin(d * PI * 2.0);
      uv = toCart(vec2(d, r));
    } else if (uEffect == 13) {
      // User defined (handled via code property, skip here)
      // No-op
    } else if (uEffect == 14) {
      // Gentle zoom out
      d = d * 1.02;
      uv = toCart(vec2(d, r));
    } else if (uEffect == 15) {
      // Swirl to center
      d = d * 0.95;
      r = r + 0.1 * d;
      uv = toCart(vec2(d, r));
    } else if (uEffect == 16) {
      // Starfish
      d = d * (0.96 + 0.04 * sin(r * 5.0));
      r = r + 0.02;
      uv = toCart(vec2(d, r));
    } else if (uEffect == 17) {
      // Yawning rotation left
      r = r + 0.1 * (1.0 - d);
      uv = toCart(vec2(d, r));
    } else if (uEffect == 18) {
      // Yawning rotation right
      r = r - 0.1 * (1.0 - d);
      uv = toCart(vec2(d, r));
    } else if (uEffect == 19) {
      // Mild zoom in with slight rotation
      d = d * 0.99;
      r = r + 0.01;
      uv = toCart(vec2(d, r));
    } else if (uEffect == 20) {
      // Drain
      d = d * 0.98;
      r = r + 0.06 * (1.0 - d);
      uv = toCart(vec2(d, r));
    } else if (uEffect == 21) {
      // Super drain
      d = d * 0.96;
      r = r + 0.1 * (1.0 - d);
      uv = toCart(vec2(d, r));
    } else if (uEffect == 22) {
      // Hyper drain
      d = d * 0.94;
      r = r + 0.15 * (1.0 - d);
      uv = toCart(vec2(d, r));
    } else if (uEffect == 23) {
      // Shift down
      uv.y = uv.y + 0.02;
    }

    // Clamp or wrap UVs
    if (uWrap) {
      uv = fract(uv);
    } else {
      uv = clamp(uv, 0.0, 1.0);
    }

    gl_FragColor = texture2D(tSource, uv);
  }
`;

export class Movement extends AvsComponent {
  constructor(opts) {
    super(opts);
    // builtinEffect can be a number (0-23) or a string name
    this.effectIndex = typeof opts.builtinEffect === 'number'
      ? opts.builtinEffect
      : parseEffectName(opts.builtinEffect || opts.preset || 0);
    this.bilinear = opts.bilinear !== false;
    this.wrap = opts.wrap || false;
    this.onBeatReverse = opts.onBeatReverse || false;
    this._reversed = false;

    this._scene = null;
    this._camera = null;
    this._material = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        uEffect: { value: this.effectIndex },
        uBilinear: { value: this.bilinear },
        uWrap: { value: this.wrap },
      },
      vertexShader: VERT_SHADER,
      fragmentShader: FRAG_SHADER,
      depthTest: false,
    });

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this._material
    );
    this._scene.add(mesh);
  }

  render(ctx, fb) {
    if (!this.enabled || this.effectIndex === 0) return;

    if (this.onBeatReverse && ctx.beat) {
      this._reversed = !this._reversed;
    }

    // Read from active, write to back, swap
    this._material.uniforms.tSource.value = fb.getActiveTexture();
    this._material.uniforms.uEffect.value = this.effectIndex;

    ctx.renderer.setRenderTarget(fb.getBackTarget());
    const prevAutoClear = ctx.renderer.autoClear;
    ctx.renderer.autoClear = true;
    ctx.renderer.render(this._scene, this._camera);
    ctx.renderer.autoClear = prevAutoClear;
    fb.swap();
  }

  destroy() {
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
