// AVS Blur component — applies a blur to the framebuffer
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Original AVS blur uses integer bit-shift division (DIV_2, DIV_8) which
// truncates the LSB each operation, causing gradual brightness loss.
// This is intentional — it makes blur fade to black over time.
// We simulate this by using the exact same weight formula.
//
// Mode 1 (enabled=1): "on (3x3)" — not in original? mapped to light
// Mode 2 (enabled=2): standard blur — center*5/8 + 4 neighbors*1/8
//   with integer truncation losing ~1.5% brightness per application
// Mode 3 (enabled=3): "on (every other line)" — blur every other row

const FRAG_LIGHT = `
  precision mediump float;
  uniform sampler2D tSource;
  uniform vec2 uTexelSize;
  varying vec2 vUv;
  void main() {
    // Simple 3x3 average with truncation loss (~1/255 per channel)
    vec4 sum = vec4(0.0);
    for (int x = -1; x <= 1; x++) {
      for (int y = -1; y <= 1; y++) {
        sum += texture2D(tSource, vUv + vec2(float(x), float(y)) * uTexelSize);
      }
    }
    // floor() simulates integer truncation, losing ~1 LSB
    gl_FragColor = vec4(floor(sum.rgb * 255.0 / 9.0) / 255.0, 1.0);
  }
`;

const FRAG_STANDARD = `
  precision mediump float;
  uniform sampler2D tSource;
  uniform vec2 uTexelSize;
  varying vec2 vUv;
  void main() {
    // Matches original: center*5/8 + left/8 + right/8 + up/8 + down/8
    // Using floor() to simulate integer bit-shift truncation
    vec3 c = texture2D(tSource, vUv).rgb * 255.0;
    vec3 l = texture2D(tSource, vUv - vec2(uTexelSize.x, 0.0)).rgb * 255.0;
    vec3 r = texture2D(tSource, vUv + vec2(uTexelSize.x, 0.0)).rgb * 255.0;
    vec3 u = texture2D(tSource, vUv - vec2(0.0, uTexelSize.y)).rgb * 255.0;
    vec3 d = texture2D(tSource, vUv + vec2(0.0, uTexelSize.y)).rgb * 255.0;
    // DIV_2(c) + DIV_8(c) + DIV_8(l) + DIV_8(r) + DIV_8(u)
    vec3 result = floor(c * 0.5) + floor(c * 0.125) + floor(l * 0.125) + floor(r * 0.125) + floor(d * 0.125);
    gl_FragColor = vec4(result / 255.0, 1.0);
  }
`;

const FRAG_HEAVY = `
  precision mediump float;
  uniform sampler2D tSource;
  uniform vec2 uTexelSize;
  varying vec2 vUv;
  void main() {
    vec4 sum = vec4(0.0);
    for (int x = -1; x <= 1; x++) {
      for (int y = -1; y <= 1; y++) {
        sum += texture2D(tSource, vUv + vec2(float(x), float(y)) * uTexelSize * 2.0);
      }
    }
    gl_FragColor = vec4(floor(sum.rgb * 255.0 / 9.0) / 255.0, 1.0);
  }
`;

export class Blur extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.mode = opts.mode || 0;
    this._scene = null;
    this._camera = null;
    this._material = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const frag = this.mode === 2 ? FRAG_HEAVY : this.mode === 1 ? FRAG_STANDARD : FRAG_STANDARD;
    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        uTexelSize: { value: new THREE.Vector2(1 / ctx.width, 1 / ctx.height) },
      },
      vertexShader: VERT,
      fragmentShader: frag,
      depthTest: false,
    });
    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material));
  }

  render(ctx, fb) {
    if (!this.enabled) return;
    this._material.uniforms.tSource.value = fb.getActiveTexture();
    this._material.uniforms.uTexelSize.value.set(1 / ctx.width, 1 / ctx.height);
    ctx.renderer.setRenderTarget(fb.getBackTarget());
    const prev = ctx.renderer.autoClear;
    ctx.renderer.autoClear = true;
    ctx.renderer.render(this._scene, this._camera);
    ctx.renderer.autoClear = prev;
    fb.swap();
    this._material.uniforms.tSource.value = null;
  }

  destroy() { if (this._material) this._material.dispose(); }
}

AvsComponent.register('Blur', Blur);
