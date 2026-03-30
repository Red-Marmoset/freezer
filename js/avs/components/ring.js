// AVS Ring component (code 0x0E) — oscilloscope ring / r_oscring.cpp
// Draws an 80-segment circle where radius is driven by audio sample values.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { applyLineBlend, restoreLineBlend } from '../line-blend.js';

const NUM_SEGMENTS = 80;
// +1 to close the loop (first vertex duplicated at end)
const NUM_VERTS = NUM_SEGMENTS + 1;

export class Ring extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.audioSource = (opts.audioSource || 'WAVEFORM').toUpperCase();
    this.size = opts.size != null ? opts.size : 0.5;
    this.colors = (opts.colors || ['#ffffff']).map(parseHexColor);
    this.colorPos = 0;

    this._scene = null;
    this._camera = null;
    this._geometry = null;
    this._material = null;
    this._mesh = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    this._camera.position.z = 1;

    this._geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(NUM_VERTS * 3);
    const colors = new Float32Array(NUM_VERTS * 3);
    this._geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this._geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this._geometry.setDrawRange(0, NUM_VERTS);

    this._material = new THREE.LineBasicMaterial({ vertexColors: true });
    this._material.depthTest = false;
    this._mesh = new THREE.LineLoop(this._geometry, this._material);
    this._scene.add(this._mesh);
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    const waveform = ctx.audioData.waveform;
    const spectrum = ctx.audioData.spectrum;
    const source = this.audioSource === 'SPECTRUM' ? spectrum : waveform;
    if (!source) return;

    const positions = this._geometry.attributes.position.array;
    const colorsBuf = this._geometry.attributes.color.array;

    // Cycle palette color
    const color = this._getCurrentColor();

    const sourceLen = source.length;

    for (let i = 0; i < NUM_SEGMENTS; i++) {
      const angle = (i / NUM_SEGMENTS) * Math.PI * 2;

      // Sample audio — map 80 segments across 576 samples (AVS convention)
      const sampleIdx = Math.floor(i * 576 / NUM_SEGMENTS) % sourceLen;
      let sampleVal;
      if (this.audioSource === 'SPECTRUM') {
        // spectrum is Float32Array dB, normalize to 0-255 range
        sampleVal = Math.max(0, Math.min(255, (source[sampleIdx] + 100) * 2.55));
      } else {
        sampleVal = source[sampleIdx]; // already 0-255 Uint8Array
      }

      // Radius: base + audio-driven component, scaled by size
      const radius = (0.1 + (sampleVal / 255) * 0.9) * this.size;

      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = Math.sin(angle) * radius;
      positions[i * 3 + 2] = 0;

      colorsBuf[i * 3] = color[0];
      colorsBuf[i * 3 + 1] = color[1];
      colorsBuf[i * 3 + 2] = color[2];
    }

    // Close the loop — duplicate first vertex
    positions[NUM_SEGMENTS * 3] = positions[0];
    positions[NUM_SEGMENTS * 3 + 1] = positions[1];
    positions[NUM_SEGMENTS * 3 + 2] = 0;
    colorsBuf[NUM_SEGMENTS * 3] = color[0];
    colorsBuf[NUM_SEGMENTS * 3 + 1] = color[1];
    colorsBuf[NUM_SEGMENTS * 3 + 2] = color[2];

    this._geometry.attributes.position.needsUpdate = true;
    this._geometry.attributes.color.needsUpdate = true;
    this._geometry.setDrawRange(0, NUM_VERTS);

    ctx.renderer.setRenderTarget(fb.getActiveTarget());
    const blended = applyLineBlend(ctx.renderer, ctx);
    ctx.renderer.render(this._scene, this._camera);
    if (blended) restoreLineBlend(ctx.renderer);
  }

  _getCurrentColor() {
    if (this.colors.length === 0) return [1, 1, 1];
    if (this.colors.length === 1) return this.colors[0];

    this.colorPos = (this.colorPos + 0.01) % this.colors.length;
    const idx = Math.floor(this.colorPos);
    const frac = this.colorPos - idx;
    const c1 = this.colors[idx];
    const c2 = this.colors[(idx + 1) % this.colors.length];
    return [
      c1[0] + (c2[0] - c1[0]) * frac,
      c1[1] + (c2[1] - c1[1]) * frac,
      c1[2] + (c2[2] - c1[2]) * frac,
    ];
  }

  destroy() {
    if (this._geometry) this._geometry.dispose();
    if (this._material) this._material.dispose();
    this._scene = null;
    this._camera = null;
  }
}

function parseHexColor(hex) {
  if (typeof hex === 'string' && hex[0] === '#') hex = hex.slice(1);
  const n = parseInt(hex, 16);
  return [(n >> 16 & 0xff) / 255, (n >> 8 & 0xff) / 255, (n & 0xff) / 255];
}

AvsComponent.register('Ring', Ring);
