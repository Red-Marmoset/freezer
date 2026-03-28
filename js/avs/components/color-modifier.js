// AVS ColorModifier component — EEL-driven per-channel color remapping via LUT
// Port of r_dcolormod.cpp. Runs EEL code for x=0..1 to build a 256x1 RGB LUT,
// then applies it in a fragment shader.
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
  uniform sampler2D tSource;
  uniform sampler2D tLUT;
  varying vec2 vUv;
  void main() {
    vec4 src = texture2D(tSource, vUv);
    float r = texture2D(tLUT, vec2(src.r, 0.5)).r;
    float g = texture2D(tLUT, vec2(src.g, 0.5)).g;
    float b = texture2D(tLUT, vec2(src.b, 0.5)).b;
    gl_FragColor = vec4(r, g, b, src.a);
  }
`;

export class ColorModifier extends AvsComponent {
  constructor(opts) {
    super(opts);
    const code = opts.code || {};
    this.initFn = compileEEL(code.init || '');
    this.perFrameFn = compileEEL(code.perFrame || '');
    this.onBeatFn = compileEEL(code.onBeat || '');

    this.state = null;
    this.firstFrame = true;
    this._scene = null;
    this._camera = null;
    this._material = null;
    this._lutTexture = null;
    this._lutData = null;
  }

  init(ctx) {
    this.state = createState(ctx.globalRegisters, ctx.globalMegabuf);
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Create the 256x1 RGB LUT texture
    this._lutData = new Uint8Array(256 * 4);
    this._lutTexture = new THREE.DataTexture(this._lutData, 256, 1, THREE.RGBAFormat);
    this._lutTexture.minFilter = THREE.LinearFilter;
    this._lutTexture.magFilter = THREE.LinearFilter;
    this._lutTexture.wrapS = THREE.ClampToEdgeWrapping;
    this._lutTexture.needsUpdate = true;

    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        tLUT: { value: this._lutTexture },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
    });

    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material));
    this.firstFrame = true;
  }

  _buildLUT(ctx) {
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

    // Run init code on first frame
    if (this.firstFrame) {
      try { this.initFn(s, lib); } catch {}
      this.firstFrame = false;
    }

    // Run perFrame code
    try { this.perFrameFn(s, lib); } catch {}

    // Run onBeat code
    if (ctx.beat) {
      try { this.onBeatFn(s, lib); } catch {}
    }

    // Build the LUT by running perPoint-style evaluation for each of 256 input values
    const data = this._lutData;
    for (let i = 0; i < 256; i++) {
      s.x = i / 255;
      s.red = s.x;
      s.green = s.x;
      s.blue = s.x;

      // The perFrame code already ran and may have set up tables/variables.
      // The actual color mapping is done by the perFrame code setting red/green/blue
      // based on x. In AVS, the "perFrame" code of ColorModifier is actually
      // evaluated per-value (per x from 0..1).
      // Re-run perFrame for each x value to compute the mapping.
      try { this.perFrameFn(s, lib); } catch {}

      data[i * 4]     = Math.max(0, Math.min(255, Math.round(s.red * 255)));
      data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(s.green * 255)));
      data[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(s.blue * 255)));
      data[i * 4 + 3] = 255;
    }
    this._lutTexture.needsUpdate = true;
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    this._buildLUT(ctx);

    this._material.uniforms.tSource.value = fb.getActiveTexture();
    ctx.renderer.setRenderTarget(fb.getBackTarget());
    const prev = ctx.renderer.autoClear;
    ctx.renderer.autoClear = true;
    ctx.renderer.render(this._scene, this._camera);
    ctx.renderer.autoClear = prev;
    fb.swap();
  }

  destroy() {
    if (this._material) this._material.dispose();
    if (this._lutTexture) this._lutTexture.dispose();
  }
}

AvsComponent.register('ColorModifier', ColorModifier);
