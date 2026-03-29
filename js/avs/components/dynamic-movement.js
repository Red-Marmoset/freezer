// AVS DynamicMovement component — programmable per-vertex UV displacement
// Uses EEL code to compute UV displacement across a grid mesh.
// Supports buffer source selection, blend mode, alpha per vertex, polar/cartesian.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { compileEEL, createState } from '../eel/nseel-compiler.js';
import { createStdlib } from '../eel/nseel-stdlib.js';
import { blendTexture, BLEND } from '../blend.js';

const VERT_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG_SHADER = `
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
    this.buffer = opts.buffer || 0; // 0=framebuffer, 1-8=save buffer
    this.alphaOnly = opts.alphaOnly || false;

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

    // Create grid mesh
    this._geometry = new THREE.PlaneGeometry(2, 2, this.gridW, this.gridH);

    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
      },
      vertexShader: VERT_SHADER,
      fragmentShader: FRAG_SHADER,
      depthTest: false,
    });

    const mesh = new THREE.Mesh(this._geometry, this._material);
    this._scene.add(mesh);

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

    // Set built-in variables
    s.w = ctx.width;
    s.h = ctx.height;
    s.b = ctx.beat ? 1 : 0;

    // Run init on first frame
    if (this.firstFrame) {
      try { this.initFn(s, lib); } catch {}
      this.firstFrame = false;
    }

    // Run perFrame
    try { this.perFrameFn(s, lib); } catch {}

    // Run onBeat
    if (ctx.beat) {
      try { this.onBeatFn(s, lib); } catch {}
    }

    // Determine source texture: active framebuffer or a save buffer
    let srcTexture = fb.getActiveTexture();
    if (this.buffer > 0 && ctx.saveBuffers) {
      const bufIdx = this.buffer - 1;
      if (ctx.saveBuffers[bufIdx] && ctx.saveBuffers[bufIdx].texture) {
        srcTexture = ctx.saveBuffers[bufIdx].texture;
      }
    }

    // Run perPoint code for each grid vertex and update UVs
    const uvAttr = this._geometry.attributes.uv;
    const posAttr = this._geometry.attributes.position;
    const vertCount = posAttr.count;

    // Polar normalization: max distance from center in UV space
    // Original: max_screen_d = sqrt(w² + h²) * 0.5, then d is normalized to 0..~1
    // In UV space (0..1), center is (0.5, 0.5), max distance to corner = sqrt(0.5² + 0.5²) = ~0.707
    const maxD = Math.sqrt(0.5 * 0.5 + 0.5 * 0.5);

    let alphaSum = 0;

    for (let i = 0; i < vertCount; i++) {
      // Get the original UV for this vertex (position is -1..1, map to 0..1)
      const origX = (posAttr.getX(i) + 1) / 2;
      const origY = (posAttr.getY(i) + 1) / 2;

      // Set alpha default
      s.alpha = 1;

      if (this.usePolar) {
        // Convert to polar coords matching original AVS:
        // d = distance / maxDiagonal (0 at center, ~1 at corner)
        // r = atan2(y, x) + π/2 (rotation offset to match AVS convention)
        const cx = origX - 0.5;
        const cy = origY - 0.5;
        s.d = Math.sqrt(cx * cx + cy * cy) / maxD;
        s.r = Math.atan2(cy, cx) + Math.PI / 2;
      }
      // Always set x, y (both modes use them in original)
      s.x = origX * 2 - 1; // -1 to 1
      s.y = origY * 2 - 1;

      // Run perPoint code
      try { this.perPointFn(s, lib); } catch {}

      alphaSum += Math.max(0, Math.min(1, s.alpha));

      // Get output UV
      let newU, newV;
      if (this.usePolar) {
        // Convert back from polar (undo the π/2 offset)
        const r = s.r - Math.PI / 2;
        const nd = s.d * maxD;
        newU = Math.cos(r) * nd + 0.5;
        newV = Math.sin(r) * nd + 0.5;
      } else {
        newU = (s.x + 1) / 2;
        newV = (s.y + 1) / 2;
      }

      // Wrap or clamp
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

    // Set source texture
    this._material.uniforms.tSource.value = srcTexture;

    if (this.blend && !this.alphaOnly) {
      // Blend mode: render displaced to back, then blend onto active
      ctx.renderer.setRenderTarget(fb.getBackTarget());
      ctx.renderer.render(this._scene, this._camera);
      this._material.uniforms.tSource.value = null;

      // Use average alpha from grid points for blend amount
      const avgAlpha = vertCount > 0 ? alphaSum / vertCount : 1;
      blendTexture(ctx.renderer, fb.getBackTarget().texture, fb.getActiveTarget(),
        BLEND.ADJUSTABLE, avgAlpha);
    } else if (this.alphaOnly) {
      // Alpha-only: darken the existing framebuffer based on alpha values
      const avgAlpha = vertCount > 0 ? alphaSum / vertCount : 1;
      // Blend active with black using (1-alpha) as the mix factor
      if (avgAlpha < 0.999) {
        blendTexture(ctx.renderer, fb.getActiveTexture(), fb.getActiveTarget(),
          BLEND.ADJUSTABLE, avgAlpha);
      }
      this._material.uniforms.tSource.value = null;
    } else {
      // No blend: write displaced result directly, swap
      ctx.renderer.setRenderTarget(fb.getBackTarget());
      ctx.renderer.render(this._scene, this._camera);
      fb.swap();
      this._material.uniforms.tSource.value = null;
    }
  }

  destroy() {
    if (this._geometry) this._geometry.dispose();
    if (this._material) this._material.dispose();
  }
}

AvsComponent.register('DynamicMovement', DynamicMovement);
