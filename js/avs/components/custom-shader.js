// CustomShader — arbitrary GLSL fragment shader component
//
// Represents MilkDrop's warp and composite shaders as Freezer components.
// Takes a GLSL fragment shader string and provides standard uniforms:
// tSource, uTime, uResolution, uBass, uMid, uTreb, and q1-q32 bridge vars.
// Per-frame EEL code sets q1-q32 which become shader uniforms uQ[1-32].

import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { compileEEL, createState } from '../eel/nseel-compiler.js';
import { createStdlib } from '../eel/nseel-stdlib.js';

const DEFAULT_FRAG = `
  precision mediump float;
  uniform sampler2D tSource;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(tSource, vUv);
  }
`;

const VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Number of q bridge variables (MilkDrop uses q1-q32)
const Q_COUNT = 32;

export class CustomShader extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.shaderSource = opts.shader || DEFAULT_FRAG;
    const code = opts.code || {};
    this.initFn = compileEEL(code.init || '');
    this.perFrameFn = compileEEL(code.perFrame || '');

    this.state = null;
    this.firstFrame = true;
    this._scene = null;
    this._camera = null;
    this._material = null;
    this._compileError = false;
  }

  init(ctx) {
    this.state = createState(ctx.globalRegisters, ctx.globalMegabuf);
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Build uniforms: standard set + q1-q32
    const uniforms = {
      tSource: { value: null },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(ctx.width, ctx.height) },
      uBass: { value: 0.7 },
      uMid: { value: 0.7 },
      uTreb: { value: 0.7 },
    };
    for (let i = 1; i <= Q_COUNT; i++) {
      uniforms[`uQ${i}`] = { value: 0 };
    }

    // Prepend uniform declarations to user shader if they're not already there
    let fragSource = this.shaderSource;
    if (!fragSource.includes('uniform sampler2D tSource')) {
      const prefix = `
precision mediump float;
uniform sampler2D tSource;
uniform float uTime;
uniform vec2 uResolution;
uniform float uBass, uMid, uTreb;
${Array.from({ length: Q_COUNT }, (_, i) => `uniform float uQ${i + 1};`).join('\n')}
varying vec2 vUv;
`;
      fragSource = prefix + fragSource;
    }

    try {
      this._material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: VERT,
        fragmentShader: fragSource,
        depthTest: false,
      });
      this._compileError = false;
    } catch (e) {
      console.warn('CustomShader compile error:', e);
      this._compileError = true;
      return;
    }

    const geo = new THREE.PlaneGeometry(2, 2);
    this._scene.add(new THREE.Mesh(geo, this._material));
    this.firstFrame = true;
  }

  render(ctx, fb) {
    if (!this.enabled || this._compileError || !this._material) return;

    const s = this.state;
    const lib = createStdlib({
      waveform: ctx.audioData.waveform,
      spectrum: ctx.audioData.spectrum,
      fftSize: ctx.audioData.fftSize,
      time: ctx.time,
    });

    // Compute bass/mid/treb
    const specLen = ctx.audioData.spectrum.length;
    const spec = ctx.audioData.spectrum;
    let bassSum = 0, midSum = 0, trebSum = 0;
    const bassEnd = Math.floor(specLen / 6);
    const midEnd = Math.floor(specLen / 3);
    for (let i = 0; i < specLen; i++) {
      const lin = Math.max(0, Math.min(1, Math.pow(10, spec[i] / 20)));
      if (i < bassEnd) bassSum += lin;
      else if (i < midEnd) midSum += lin;
      else trebSum += lin;
    }
    const bass = bassEnd > 0 ? (bassSum / bassEnd) * 3 + 0.7 : 0.7;
    const mid = (midEnd - bassEnd) > 0 ? (midSum / (midEnd - bassEnd)) * 3 + 0.7 : 0.7;
    const treb = (specLen - midEnd) > 0 ? (trebSum / (specLen - midEnd)) * 3 + 0.7 : 0.7;

    s.time = ctx.time;
    s.bass = bass;
    s.mid = mid;
    s.treb = treb;
    s.b = ctx.beat ? 1 : 0;

    if (this.firstFrame) {
      try { this.initFn(s, lib); } catch {}
      this.firstFrame = false;
    }

    try { this.perFrameFn(s, lib); } catch {}

    // Update uniforms
    const u = this._material.uniforms;
    u.tSource.value = fb.getActiveTexture();
    u.uTime.value = ctx.time;
    u.uResolution.value.set(ctx.width, ctx.height);
    u.uBass.value = bass;
    u.uMid.value = mid;
    u.uTreb.value = treb;

    // Pass q1-q32 bridge variables from EEL state to shader
    for (let i = 1; i <= Q_COUNT; i++) {
      u[`uQ${i}`].value = s[`q${i}`] || 0;
    }

    ctx.renderer.setRenderTarget(fb.getBackTarget());
    ctx.renderer.render(this._scene, this._camera);
    u.tSource.value = null;
    fb.swap();
  }

  destroy() {
    if (this._material) this._material.dispose();
  }
}

AvsComponent.register('CustomShader', CustomShader);
