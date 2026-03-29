// MilkDropMotion — combined per-frame motion + per-vertex mesh warp + feedback
//
// This single component replaces what would be BlitterFeedback + RotoBlitter +
// DynamicMovement + FadeOut for a MilkDrop preset. It implements MilkDrop's
// core rendering model: read from the PREVIOUS frame, apply mesh distortion,
// and write the warped result as the new frame.
//
// Per-frame EEL code sets: zoom, rot, dx, dy, sx, sy, warp, cx, cy, decay
// Per-vertex EEL code receives: x, y, rad, ang (and per-frame vars), outputs: x, y
//
// The component samples the previous frame through a deformed mesh grid,
// creating the characteristic MilkDrop flowing feedback motion.

import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { compileEEL, createState } from '../eel/nseel-compiler.js';
import { createStdlib } from '../eel/nseel-stdlib.js';

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
  uniform float uDecay;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tSource, vUv);
    gl_FragColor = vec4(c.rgb * uDecay, 1.0);
  }
`;

export class MilkDropMotion extends AvsComponent {
  constructor(opts) {
    super(opts);
    const code = opts.code || {};
    this.initFn = compileEEL(code.init || '');
    this.perFrameFn = compileEEL(code.perFrame || '');
    this.perVertexFn = compileEEL(code.perVertex || '');

    this.gridSize = opts.gridSize || 48;
    this.state = null;
    this.firstFrame = true;
    this._scene = null;
    this._camera = null;
    this._material = null;
    this._geometry = null;
  }

  init(ctx) {
    this.state = createState(ctx.globalRegisters, ctx.globalMegabuf);

    // Set MilkDrop default variable values
    const s = this.state;
    s.zoom = 1.0;
    s.rot = 0.0;
    s.dx = 0.0;
    s.dy = 0.0;
    s.sx = 1.0;
    s.sy = 1.0;
    s.warp = 1.0;
    s.cx = 0.5;
    s.cy = 0.5;
    s.decay = 0.98;

    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this._geometry = new THREE.PlaneGeometry(2, 2, this.gridSize, this.gridSize);
    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        uDecay: { value: 0.98 },
      },
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

    // Compute bass/mid/treb from spectrum for MilkDrop compatibility
    // MilkDrop: bass=0-1/6, mid=1/6-2/6, treb=2/6-1 of spectrum
    const specLen = ctx.audioData.spectrum.length;
    const spec = ctx.audioData.spectrum;
    let bassSum = 0, midSum = 0, trebSum = 0;
    const bassEnd = Math.floor(specLen / 6);
    const midEnd = Math.floor(specLen / 3);
    for (let i = 0; i < specLen; i++) {
      // Convert dB to linear, clamp to 0-1
      const lin = Math.max(0, Math.min(1, Math.pow(10, spec[i] / 20)));
      if (i < bassEnd) bassSum += lin;
      else if (i < midEnd) midSum += lin;
      else trebSum += lin;
    }
    s.bass = bassEnd > 0 ? (bassSum / bassEnd) * 3 + 0.7 : 0.7;
    s.mid = (midEnd - bassEnd) > 0 ? (midSum / (midEnd - bassEnd)) * 3 + 0.7 : 0.7;
    s.treb = (specLen - midEnd) > 0 ? (trebSum / (specLen - midEnd)) * 3 + 0.7 : 0.7;

    // Time and frame info
    s.time = ctx.time;
    s.fps = 1 / Math.max(ctx.dt, 0.001);
    s.frame = (s.frame || 0) + 1;
    s.b = ctx.beat ? 1 : 0;

    // Reset motion vars to defaults each frame (MilkDrop behavior)
    s.zoom = 1.0;
    s.rot = 0.0;
    s.dx = 0.0;
    s.dy = 0.0;
    s.sx = 1.0;
    s.sy = 1.0;
    s.warp = 1.0;
    s.cx = 0.5;
    s.cy = 0.5;
    // decay is sticky (not reset per frame)

    if (this.firstFrame) {
      try { this.initFn(s, lib); } catch (e) { console.warn('MilkDropMotion init error:', e); }
      this.firstFrame = false;
    }

    try { this.perFrameFn(s, lib); } catch (e) { console.warn('MilkDropMotion perFrame error:', e); }

    // Now compute per-vertex mesh distortion
    const uvAttr = this._geometry.attributes.uv;
    const posAttr = this._geometry.attributes.position;
    const vertCount = posAttr.count;

    const zoom = s.zoom;
    const rot = s.rot;
    const dxVal = s.dx;
    const dyVal = s.dy;
    const sxVal = s.sx;
    const syVal = s.sy;
    const warpAmount = s.warp;
    const cxVal = s.cx;
    const cyVal = s.cy;

    for (let i = 0; i < vertCount; i++) {
      // Original mesh position in 0..1 space
      const origX = (posAttr.getX(i) + 1) / 2;
      const origY = (posAttr.getY(i) + 1) / 2;

      // MilkDrop coordinate system: x,y in 0..1
      s.x = origX;
      s.y = origY;

      // Distance and angle from center
      const dcx = origX - cxVal;
      const dcy = origY - cyVal;
      s.rad = Math.sqrt(dcx * dcx + dcy * dcy);
      s.ang = Math.atan2(dcy, dcx);

      // Run per-vertex code (if any)
      if (this.perVertexFn) {
        try { this.perVertexFn(s, lib); } catch {}
      }

      // Apply MilkDrop default motion if no per-vertex code overwrites x,y:
      // The per-vertex code may have modified x,y directly.
      // If not, we compute the default MilkDrop motion from per-frame vars.
      // We detect this by checking if perVertex code was empty.
      let u, v;
      if (!this.perVertexFn || this.perVertexFn.toString().includes('return')) {
        // No per-vertex code — apply default MilkDrop motion
        // 1. Zoom toward center
        let nx = (origX - cxVal) / zoom + cxVal;
        let ny = (origY - cyVal) / zoom + cyVal;

        // 2. Scale x,y
        nx = (nx - cxVal) / sxVal + cxVal;
        ny = (ny - cyVal) / syVal + cyVal;

        // 3. Rotate around center
        if (rot !== 0) {
          const dx2 = nx - cxVal;
          const dy2 = ny - cyVal;
          const cosR = Math.cos(rot);
          const sinR = Math.sin(rot);
          nx = dx2 * cosR - dy2 * sinR + cxVal;
          ny = dx2 * sinR + dy2 * cosR + cyVal;
        }

        // 4. Translate
        nx -= dxVal;
        ny -= dyVal;

        u = nx;
        v = ny;
      } else {
        u = s.x;
        v = s.y;
      }

      // Clamp UVs
      u = Math.max(0, Math.min(1, u));
      v = Math.max(0, Math.min(1, v));

      uvAttr.setXY(i, u, v);
    }
    uvAttr.needsUpdate = true;

    // Read from current frame (feedback), write to back buffer
    this._material.uniforms.tSource.value = fb.getActiveTexture();
    this._material.uniforms.uDecay.value = Math.max(0, Math.min(1, s.decay));

    ctx.renderer.setRenderTarget(fb.getBackTarget());
    ctx.renderer.render(this._scene, this._camera);
    this._material.uniforms.tSource.value = null;
    fb.swap();
  }

  destroy() {
    if (this._geometry) this._geometry.dispose();
    if (this._material) this._material.dispose();
  }
}

AvsComponent.register('MilkDropMotion', MilkDropMotion);
