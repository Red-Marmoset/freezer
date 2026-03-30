// AVS DynamicMovement component — programmable per-vertex UV displacement
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { compileEEL, createState } from '../eel/nseel-compiler.js';
import { createStdlib } from '../eel/nseel-stdlib.js';
import { blendTexture, BLEND } from '../blend.js';

const VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = `
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

    this._geometry = new THREE.PlaneGeometry(2, 2, this.gridW, this.gridH);

    this._material = new THREE.ShaderMaterial({
      uniforms: { tSource: { value: null } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
    });

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
    const vertCount = posAttr.count;

    // Polar normalization matching r_dmove.cpp:
    // max_screen_d = sqrt(w² + h²) * 0.5
    // d = sqrt(xd² + yd²) / max_screen_d  where xd,yd are pixel offsets from center
    const w = ctx.width, h = ctx.height;
    const maxD = Math.sqrt(w * w + h * h) * 0.5;
    const hw = w * 0.5, hh = h * 0.5;

    let alphaSum = 0;
    for (let i = 0; i < vertCount; i++) {
      // Grid point position → UV (0..1)
      const origX = (posAttr.getX(i) + 1) / 2; // 0..1
      const origY = (posAttr.getY(i) + 1) / 2;

      // Pixel offset from center (matching original xd, yd)
      // Original AVS: Y=0 at top, Y=h at bottom. Three.js: Y=+1 at top.
      // Negate yd to match original's Y-down convention.
      const xd = (origX - 0.5) * w;
      const yd = (0.5 - origY) * h;

      s.alpha = 1;

      if (this.usePolar) {
        s.d = Math.sqrt(xd * xd + yd * yd) / maxD;
        s.r = Math.atan2(yd, xd) + Math.PI * 0.5;
      }
      // Always set x,y: original uses xd * (2/w) and yd * (2/h) = normalized -1..1
      s.x = xd / hw; // equivalent to (origX - 0.5) * 2
      s.y = yd / hh;

      try { this.perPointFn(s, lib); } catch {}

      alphaSum += Math.max(0, Math.min(1, s.alpha));

      let newU, newV;
      if (this.usePolar) {
        // Convert back from polar to pixel coords, then to UV
        // sin(r) gives screen-Y (positive = down in original), negate for UV (positive = up)
        const r = s.r - Math.PI * 0.5;
        const nd = s.d * maxD;
        newU = (Math.cos(r) * nd + hw) / w;
        newV = 1 - (Math.sin(r) * nd + hh) / h;
      } else {
        // Cartesian: x,y in -1..1 → UV 0..1
        // y is negated: original y positive = down, our UV y positive = up
        newU = (s.x + 1) * 0.5;
        newV = 1 - (s.y + 1) * 0.5;
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

    this._material.uniforms.tSource.value = srcTexture;

    if (this.blend) {
      // Render displaced content to back target
      ctx.renderer.setRenderTarget(fb.getBackTarget());
      ctx.renderer.clear();
      ctx.renderer.render(this._scene, this._camera);
      this._material.uniforms.tSource.value = null;

      // Average alpha across grid for blend amount
      const avgAlpha = vertCount > 0 ? alphaSum / vertCount : 1;
      if (avgAlpha >= 0.999) {
        // Full replacement — just swap (faster than blending)
        fb.swap();
      } else {
        // Partial blend: composite displaced content onto active FB
        blendTexture(ctx.renderer, fb.getBackTarget().texture, fb.getActiveTarget(), BLEND.ADJUSTABLE, avgAlpha);
      }
    } else {
      // No blend: displaced content replaces FB entirely
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
