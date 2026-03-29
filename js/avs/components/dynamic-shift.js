// AVS DynamicShift component (code 0x2A) — EEL-computed per-frame pixel translation
// EEL code sets x, y (shift in pixels) and optionally alpha.
// Fragment shader samples at uv + vec2(x/w, y/h).
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { compileEEL, createState } from '../eel/nseel-compiler.js';
import { createStdlib } from '../eel/nseel-stdlib.js';
import { blendTexture, parseBlendMode, BLEND } from '../blend.js';

const VERT_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SHIFT_FRAG = `
  uniform sampler2D tSource;
  uniform vec2 uShift; // shift in UV space (x/w, y/h)
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv + uShift;
    uv = clamp(uv, 0.0, 1.0);
    gl_FragColor = texture2D(tSource, uv);
  }
`;

export class DynamicShift extends AvsComponent {
  constructor(opts) {
    super(opts);
    const code = opts.code || {};
    this.initFn = compileEEL(code.init || '');
    this.perFrameFn = compileEEL(code.perFrame || '');
    this.onBeatFn = compileEEL(code.onBeat || '');

    this.blendMode = parseBlendMode(opts.blendMode || 0);

    this.state = null;
    this.firstFrame = true;
    this._scene = null;
    this._camera = null;
    this._material = null;
  }

  init(ctx) {
    this.state = createState(ctx.globalRegisters, ctx.globalMegabuf);
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        uShift: { value: new THREE.Vector2(0, 0) },
      },
      vertexShader: VERT_SHADER,
      fragmentShader: SHIFT_FRAG,
      depthTest: false,
    });

    this._scene.add(new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this._material
    ));

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

    // EEL sets x, y in pixel units; convert to UV space
    const shiftX = (s.x || 0) / ctx.width;
    const shiftY = (s.y || 0) / ctx.height;

    this._material.uniforms.tSource.value = fb.getActiveTexture();
    this._material.uniforms.uShift.value.set(shiftX, shiftY);

    if (this.blendMode === BLEND.REPLACE || this.blendMode === BLEND.IGNORE) {
      // Direct: read from active, write to back, swap
      ctx.renderer.setRenderTarget(fb.getBackTarget());
      ctx.renderer.render(this._scene, this._camera);
      fb.swap();
    this._material.uniforms.tSource.value = null;
    } else {
      // Render shifted result to back, then blend onto active
      ctx.renderer.setRenderTarget(fb.getBackTarget());
      ctx.renderer.render(this._scene, this._camera);
      // Blend back texture onto active
      const alpha = (s.alpha !== undefined ? s.alpha : 0.5);
      blendTexture(ctx.renderer, fb.getBackTarget().texture, fb.getActiveTarget(), this.blendMode, alpha);
    }
  }

  destroy() {
    if (this._material) this._material.dispose();
  }
}

AvsComponent.register('DynamicShift', DynamicShift);
