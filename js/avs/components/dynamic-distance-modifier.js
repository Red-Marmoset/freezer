// AVS DynamicDistanceModifier component (code 0x23) — distance-based EEL UV displacement
// Similar to DynamicMovement but with a simpler distance-based approach.
// EEL code operates on d (distance from center) and other variables per-vertex
// in a grid mesh to produce UV displacement.
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

const FRAG_SHADER = `
  uniform sampler2D tSource;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(tSource, vUv);
  }
`;

export class DynamicDistanceModifier extends AvsComponent {
  constructor(opts) {
    super(opts);
    const code = opts.code || {};
    this.initFn = compileEEL(code.init || '');
    this.perFrameFn = compileEEL(code.perFrame || '');
    this.onBeatFn = compileEEL(code.onBeat || '');
    this.perPointFn = compileEEL(code.perPoint || code.perPixel || '');

    this.gridW = opts.gridW || 16;
    this.gridH = opts.gridH || 16;
    this.wrap = opts.wrap !== false;
    this.bilinear = opts.bFilter !== false;
    this.blend = opts.blend || false;

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

    // Create grid mesh for per-vertex UV displacement
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

    s.w = ctx.width;
    s.h = ctx.height;
    s.b = ctx.beat ? 1 : 0;

    if (this.firstFrame) {
      try { this.initFn(s, lib); } catch {}
      this.firstFrame = false;
    }

    try { this.perFrameFn(s, lib); } catch {}

    if (ctx.beat) {
      try { this.onBeatFn(s, lib); } catch {}
    }

    // Run perPoint code for each grid vertex
    const uvAttr = this._geometry.attributes.uv;
    const posAttr = this._geometry.attributes.position;
    const vertCount = posAttr.count;

    for (let i = 0; i < vertCount; i++) {
      // Map position from [-1,1] to [0,1] for UV
      const origX = (posAttr.getX(i) + 1) / 2;
      const origY = (posAttr.getY(i) + 1) / 2;

      // Compute distance from center and angle (polar coords)
      const cx = origX - 0.5;
      const cy = origY - 0.5;
      s.d = Math.sqrt(cx * cx + cy * cy) * 2;
      s.r = Math.atan2(cy, cx);
      s.x = origX * 2 - 1; // -1 to 1
      s.y = origY * 2 - 1;

      // Run perPoint code — modifies d (and possibly r, x, y)
      try { this.perPointFn(s, lib); } catch {}

      // Convert back from polar using the (possibly modified) d and r
      const nd = s.d * 0.5;
      let newU = Math.cos(s.r) * nd + 0.5;
      let newV = Math.sin(s.r) * nd + 0.5;

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

    // Read from active, write to back, swap
    this._material.uniforms.tSource.value = fb.getActiveTexture();

    ctx.renderer.setRenderTarget(fb.getBackTarget());
    const prevAutoClear = ctx.renderer.autoClear;
    ctx.renderer.autoClear = true;
    ctx.renderer.render(this._scene, this._camera);
    ctx.renderer.autoClear = prevAutoClear;
    fb.swap();
    this._material.uniforms.tSource.value = null;
  }

  destroy() {
    if (this._geometry) this._geometry.dispose();
    if (this._material) this._material.dispose();
  }
}

AvsComponent.register('DynamicDistanceModifier', DynamicDistanceModifier);
