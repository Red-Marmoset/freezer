// AVS DynamicMovement component — programmable per-vertex UV displacement
// Uses EEL code to compute UV displacement across a grid mesh.
// Supports buffer source selection, blend mode, per-vertex alpha, polar/cartesian.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { compileEEL, createState } from '../eel/nseel-compiler.js';
import { createStdlib } from '../eel/nseel-stdlib.js';

// Vertex shader passes UV and per-vertex alpha to fragment
const VERT_SHADER = `
  attribute float aAlpha;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vUv = uv;
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Fragment shader samples source texture and applies per-vertex alpha blending
// When blend is enabled, mixes displaced source with the current framebuffer
const FRAG_SHADER = `
  precision mediump float;
  uniform sampler2D tSource;
  uniform sampler2D tDest;
  uniform int uBlend;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vec4 src = texture2D(tSource, vUv);
    if (uBlend == 1) {
      vec4 dst = texture2D(tDest, gl_FragCoord.xy / vec2(textureSize(tDest, 0)));
      gl_FragColor = vec4(mix(dst.rgb, src.rgb, vAlpha), 1.0);
    } else {
      gl_FragColor = src;
    }
  }
`;

// Simpler shader without textureSize (WebGL1 compat)
const FRAG_BLEND = `
  precision mediump float;
  uniform sampler2D tSource;
  uniform sampler2D tDest;
  uniform vec2 uResolution;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vec4 src = texture2D(tSource, vUv);
    vec2 screenUv = gl_FragCoord.xy / uResolution;
    vec4 dst = texture2D(tDest, screenUv);
    gl_FragColor = vec4(mix(dst.rgb, src.rgb, vAlpha), 1.0);
  }
`;

const FRAG_NOBLEND = `
  precision mediump float;
  uniform sampler2D tSource;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(tSource, vUv);
  }
`;

export class DynamicMovement extends AvsComponent {
  constructor(opts) {
    super(opts);
    const code = opts.code || {};
    this.initFn = compileEEL(code.init || '');
    this.perFrameFn = compileEEL(code.perFrame || '');
    this.onBeatFn = compileEEL(code.onBeat || '');
    this.perPointFn = compileEEL(code.perPoint || code.perPixel || '');

    this.gridW = opts.gridW || 16;
    this.gridH = opts.gridH || 16;
    this.usePolar = (opts.coord || '').toUpperCase() === 'POLAR';
    this.wrap = opts.wrap !== false;
    this.bilinear = opts.bFilter !== false;
    this.blend = opts.blend || false;
    this.buffer = opts.buffer || 0;
    this.alphaOnly = opts.alphaOnly || false;

    this.state = null;
    this.firstFrame = true;
    this._scene = null;
    this._camera = null;
    this._material = null;
    this._geometry = null;
    this._alphaAttr = null;
  }

  init(ctx) {
    this.state = createState(ctx.globalRegisters, ctx.globalMegabuf);
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Create grid mesh with per-vertex alpha attribute
    this._geometry = new THREE.PlaneGeometry(2, 2, this.gridW, this.gridH);
    const vertCount = this._geometry.attributes.position.count;
    const alphas = new Float32Array(vertCount).fill(1);
    this._alphaAttr = new THREE.BufferAttribute(alphas, 1);
    this._geometry.setAttribute('aAlpha', this._alphaAttr);

    if (this.blend || this.alphaOnly) {
      this._material = new THREE.ShaderMaterial({
        uniforms: {
          tSource: { value: null },
          tDest: { value: null },
          uResolution: { value: new THREE.Vector2(ctx.width, ctx.height) },
        },
        vertexShader: VERT_SHADER,
        fragmentShader: FRAG_BLEND,
        depthTest: false,
      });
    } else {
      this._material = new THREE.ShaderMaterial({
        uniforms: { tSource: { value: null } },
        vertexShader: VERT_SHADER,
        fragmentShader: FRAG_NOBLEND,
        depthTest: false,
      });
    }

    this._scene.add(new THREE.Mesh(this._geometry, this._material));
    this.firstFrame = true;
  }

  render(ctx, fb) {
    if (!this.enabled) return;

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
      try { this.initFn(s, lib); } catch {}
      this.firstFrame = false;
    }

    try { this.perFrameFn(s, lib); } catch {}
    if (ctx.beat) { try { this.onBeatFn(s, lib); } catch {} }

    // Determine source texture
    let srcTexture = fb.getActiveTexture();
    if (this.buffer > 0 && ctx.saveBuffers) {
      const bufIdx = this.buffer - 1;
      if (ctx.saveBuffers[bufIdx] && ctx.saveBuffers[bufIdx].texture) {
        srcTexture = ctx.saveBuffers[bufIdx].texture;
      }
    }

    // Run perPoint code for each grid vertex
    const uvAttr = this._geometry.attributes.uv;
    const posAttr = this._geometry.attributes.position;
    const alphaArr = this._alphaAttr.array;
    const vertCount = posAttr.count;

    // Polar normalization matching original AVS
    const maxD = Math.sqrt(0.5 * 0.5 + 0.5 * 0.5);

    for (let i = 0; i < vertCount; i++) {
      const origX = (posAttr.getX(i) + 1) / 2;
      const origY = (posAttr.getY(i) + 1) / 2;

      s.alpha = 1;

      if (this.usePolar) {
        const cx = origX - 0.5;
        const cy = origY - 0.5;
        s.d = Math.sqrt(cx * cx + cy * cy) / maxD;
        s.r = Math.atan2(cy, cx) + Math.PI / 2;
      }
      s.x = origX * 2 - 1;
      s.y = origY * 2 - 1;

      try { this.perPointFn(s, lib); } catch {}

      alphaArr[i] = Math.max(0, Math.min(1, s.alpha));

      let newU, newV;
      if (this.usePolar) {
        const r = s.r - Math.PI / 2;
        const nd = s.d * maxD;
        newU = Math.cos(r) * nd + 0.5;
        newV = Math.sin(r) * nd + 0.5;
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
    this._alphaAttr.needsUpdate = true;

    // Render
    this._material.uniforms.tSource.value = srcTexture;

    if (this.blend || this.alphaOnly) {
      // For blend/alpha-only: read active FB as dest, sample source via displaced UVs,
      // mix per-vertex using alpha. Write to back, swap.
      // Need to copy active to a temp first so we can read dest while writing.
      this._material.uniforms.tDest.value = fb.getActiveTexture();
      this._material.uniforms.uResolution.value.set(ctx.width, ctx.height);

      ctx.renderer.setRenderTarget(fb.getBackTarget());
      ctx.renderer.render(this._scene, this._camera);

      this._material.uniforms.tSource.value = null;
      this._material.uniforms.tDest.value = null;
      fb.swap();
    } else {
      // No blend: displaced source overwrites FB
      ctx.renderer.setRenderTarget(fb.getBackTarget());
      ctx.renderer.render(this._scene, this._camera);
      this._material.uniforms.tSource.value = null;
      fb.swap();
    }
  }

  destroy() {
    if (this._geometry) this._geometry.dispose();
    if (this._material) this._material.dispose();
  }
}

AvsComponent.register('DynamicMovement', DynamicMovement);
