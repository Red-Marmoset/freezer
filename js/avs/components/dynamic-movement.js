// AVS DynamicMovement component — programmable per-vertex UV displacement
// Uses EEL code to compute UV displacement across a grid mesh.
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

export class DynamicMovement extends AvsComponent {
  constructor(opts) {
    super(opts);
    const code = opts.code || {};
    this.initFn = compileEEL(code.init || '');
    this.perFrameFn = compileEEL(code.perFrame || '');
    this.onBeatFn = compileEEL(code.onBeat || '');
    this.perPointFn = compileEEL(code.perPoint || code.perPixel || '');

    this.gridW = opts.gridW || opts.rectcoords || 16;
    this.gridH = opts.gridH || 16;
    this.usePolar = (opts.coord || '').toUpperCase() === 'POLAR';
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
    this.state = createState(ctx.globalRegisters);
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
      this.initFn(s, lib);
      this.firstFrame = false;
    }

    // Run perFrame
    this.perFrameFn(s, lib);

    // Run onBeat
    if (ctx.beat) {
      this.onBeatFn(s, lib);
    }

    // Run perPoint code for each grid vertex and update UVs
    const uvAttr = this._geometry.attributes.uv;
    const posAttr = this._geometry.attributes.position;
    const vertCount = posAttr.count;

    for (let i = 0; i < vertCount; i++) {
      // Get the original UV for this vertex (0-1 range)
      // Position is in [-1, 1] range, map to [0, 1] for UV
      const origX = (posAttr.getX(i) + 1) / 2;
      const origY = (posAttr.getY(i) + 1) / 2;

      if (this.usePolar) {
        // Convert to polar coords
        const cx = origX - 0.5;
        const cy = origY - 0.5;
        s.d = Math.sqrt(cx * cx + cy * cy) * 2;
        s.r = Math.atan2(cy, cx);
      } else {
        s.x = origX * 2 - 1; // -1 to 1
        s.y = origY * 2 - 1;
      }

      // Run perPoint code
      this.perPointFn(s, lib);

      // Get output UV
      let newU, newV;
      if (this.usePolar) {
        // Convert back from polar
        const nd = s.d * 0.5;
        newU = Math.cos(s.r) * nd + 0.5;
        newV = Math.sin(s.r) * nd + 0.5;
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

    // Read from active, write to back, swap
    this._material.uniforms.tSource.value = fb.getActiveTexture();

    ctx.renderer.setRenderTarget(fb.getBackTarget());
    const prevAutoClear = ctx.renderer.autoClear;
    ctx.renderer.autoClear = true;
    ctx.renderer.render(this._scene, this._camera);
    ctx.renderer.autoClear = prevAutoClear;
    fb.swap();
  }

  destroy() {
    if (this._geometry) this._geometry.dispose();
    if (this._material) this._material.dispose();
  }
}

AvsComponent.register('DynamicMovement', DynamicMovement);
