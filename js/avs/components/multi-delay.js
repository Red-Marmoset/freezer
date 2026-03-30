// AVS Multi Delay — multiple independent delay buffers
// Port of r_multidelay.cpp (Holden05): 6 independent delay buffers
// with configurable frame counts and active buffer selection.

import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewPosition * vec4(position, 1.0); }
`;

const FRAG = `
  precision mediump float;
  uniform sampler2D tSource;
  varying vec2 vUv;
  void main() { gl_FragColor = texture2D(tSource, vUv); }
`;

const NUM_BUFFERS = 6;
const MAX_DELAY = 200;

export class MultiDelay extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.activeBuffer = opts.activeBuffer || 0;
    this.mode = opts.mode || 0; // 0=input, 1=output
    this.delays = [];
    for (let i = 0; i < NUM_BUFFERS; i++) {
      this.delays.push(Math.min(opts[`delay${i}`] || (i + 1) * 5, MAX_DELAY));
    }
    this._ringBuffers = [];
    this._writePositions = new Array(NUM_BUFFERS).fill(0);
    this._scene = null;
    this._camera = null;
    this._material = null;
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

    // Allocate ring buffers for each delay line
    this._ringBuffers = [];
    for (let i = 0; i < NUM_BUFFERS; i++) {
      const buf = [];
      for (let j = 0; j < this.delays[i]; j++) {
        buf.push(new THREE.WebGLRenderTarget(ctx.width, ctx.height, {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
        }));
      }
      this._ringBuffers.push(buf);
    }
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    const bufIdx = Math.max(0, Math.min(NUM_BUFFERS - 1, this.activeBuffer));
    const ring = this._ringBuffers[bufIdx];
    if (!ring || ring.length === 0) return;

    const wp = this._writePositions[bufIdx];

    // Store current frame
    const target = ring[wp % ring.length];
    this._material.uniforms.tSource.value = fb.getActiveTexture();
    ctx.renderer.setRenderTarget(target);
    ctx.renderer.render(this._scene, this._camera);

    // Read delayed frame
    const readPos = (wp - this.delays[bufIdx] + ring.length) % ring.length;
    this._material.uniforms.tSource.value = ring[readPos].texture;
    ctx.renderer.setRenderTarget(fb.getBackTarget());
    ctx.renderer.render(this._scene, this._camera);
    this._material.uniforms.tSource.value = null;
    fb.swap();

    this._writePositions[bufIdx] = (wp + 1) % ring.length;
  }

  destroy() {
    for (const ring of this._ringBuffers) {
      for (const rt of ring) rt.dispose();
    }
    this._ringBuffers = [];
    if (this._material) this._material.dispose();
  }
}

AvsComponent.register('MultiDelay', MultiDelay);
