// AVS Video Delay — delays the frame by N frames
// Port of r_videodelay.cpp (Holden04): stores frames in a ring buffer
// and outputs the frame from N frames ago.

import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const FRAG = `
  precision mediump float;
  uniform sampler2D tSource;
  varying vec2 vUv;
  void main() { gl_FragColor = texture2D(tSource, vUv); }
`;

const MAX_DELAY = 200; // max frames of delay

export class VideoDelay extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.delay = Math.min(opts.delay || 10, MAX_DELAY);
    this.useBeats = opts.useBeats || false;
    this._ringBuffer = [];
    this._writePos = 0;
    this._scene = null;
    this._camera = null;
    this._material = null;
    this._framesSinceBeat = 0;
    this._beatDelay = 0;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._material = new THREE.ShaderMaterial({
      uniforms: { tSource: { value: null } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
    });
    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material));

    // Pre-allocate ring buffer with render targets
    const bufSize = this.useBeats ? Math.min(this.delay, 16) : this.delay;
    this._ringBuffer = [];
    for (let i = 0; i < bufSize; i++) {
      this._ringBuffer.push(new THREE.WebGLRenderTarget(ctx.width, ctx.height, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      }));
    }
    this._writePos = 0;
  }

  render(ctx, fb) {
    if (!this.enabled || this._ringBuffer.length === 0) return;

    let effectiveDelay;
    if (this.useBeats) {
      this._framesSinceBeat++;
      if (ctx.beat) {
        this._beatDelay = Math.min(this._framesSinceBeat, this._ringBuffer.length);
        this._framesSinceBeat = 0;
      }
      effectiveDelay = this._beatDelay || 1;
    } else {
      effectiveDelay = Math.min(this.delay, this._ringBuffer.length);
    }

    // Store current frame into ring buffer
    const currentTarget = this._ringBuffer[this._writePos % this._ringBuffer.length];
    this._material.uniforms.tSource.value = fb.getActiveTexture();
    ctx.renderer.setRenderTarget(currentTarget);
    ctx.renderer.render(this._scene, this._camera);

    // Read from the delayed position
    const readPos = (this._writePos - effectiveDelay + this._ringBuffer.length) % this._ringBuffer.length;
    const delayedTarget = this._ringBuffer[readPos];

    // Write delayed frame to the framebuffer
    this._material.uniforms.tSource.value = delayedTarget.texture;
    ctx.renderer.setRenderTarget(fb.getBackTarget());
    ctx.renderer.render(this._scene, this._camera);
    this._material.uniforms.tSource.value = null;
    fb.swap();

    this._writePos = (this._writePos + 1) % this._ringBuffer.length;
  }

  destroy() {
    for (const rt of this._ringBuffer) rt.dispose();
    this._ringBuffer = [];
    if (this._material) this._material.dispose();
  }
}

AvsComponent.register('VideoDelay', VideoDelay);
