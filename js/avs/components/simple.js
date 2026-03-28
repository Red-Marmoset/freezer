// AVS Simple component (code 0x00) — basic oscilloscope/spectrum renderer
// Renders waveform or spectrum as lines, dots, or solid bars.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const MAX_POINTS = 1024;

export class Simple extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.audioSource = (opts.audioSource || 'WAVEFORM').toUpperCase();
    this.renderType = (opts.renderType || 'LINES').toUpperCase();
    this.audioChannel = (opts.audioChannel || 'CENTER').toUpperCase();
    this.positionY = (opts.positionY || 'CENTER').toUpperCase();
    this.colors = (opts.colors || ['#ffffff']).map(parseHexColor);

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
    const positions = new Float32Array(MAX_POINTS * 3);
    const colors = new Float32Array(MAX_POINTS * 3);
    this._geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this._geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this._geometry.setDrawRange(0, 0);

    this._updateMesh();
  }

  _updateMesh() {
    if (this._mesh) {
      this._scene.remove(this._mesh);
      this._material.dispose();
    }

    if (this.renderType === 'DOTS') {
      this._material = new THREE.PointsMaterial({
        size: 2, vertexColors: true, sizeAttenuation: false,
      });
      this._mesh = new THREE.Points(this._geometry, this._material);
    } else {
      this._material = new THREE.LineBasicMaterial({ vertexColors: true });
      this._mesh = new THREE.Line(this._geometry, this._material);
    }
    this._material.transparent = true;
    this._material.depthTest = false;
    this._material.blending = THREE.AdditiveBlending;
    this._scene.add(this._mesh);
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    const waveform = ctx.audioData.waveform;
    const spectrum = ctx.audioData.spectrum;
    const fftSize = ctx.audioData.fftSize || 2048;
    const sampleCount = fftSize / 2;

    const source = this.audioSource === 'SPECTRUM' ? spectrum : waveform;
    if (!source) return;

    const positions = this._geometry.attributes.position.array;
    const colorsBuf = this._geometry.attributes.color.array;

    // Y offset based on position
    let yOffset = 0;
    if (this.positionY === 'TOP') yOffset = 0.5;
    else if (this.positionY === 'BOTTOM') yOffset = -0.5;

    // Color (use first color, cycle if multiple)
    const color = this.colors[0] || [1, 1, 1];

    const n = Math.min(MAX_POINTS, sampleCount);
    let drawCount = 0;

    if (this.renderType === 'SOLID' && this.audioSource === 'SPECTRUM') {
      // Spectrum bars — draw two vertices per bar (top and baseline)
      for (let i = 0; i < n && drawCount < MAX_POINTS - 1; i++) {
        const x = (i / n) * 2 - 1;
        const val = spectrum ? Math.max(0, (spectrum[i] + 100) / 100) : 0;
        const y = val * 0.8 + yOffset - 0.4;

        // Bottom vertex
        positions[drawCount * 3] = x;
        positions[drawCount * 3 + 1] = yOffset - 0.4;
        positions[drawCount * 3 + 2] = 0;
        // Top vertex
        positions[(drawCount + 1) * 3] = x;
        positions[(drawCount + 1) * 3 + 1] = y;
        positions[(drawCount + 1) * 3 + 2] = 0;

        const ci = i % this.colors.length;
        const c = this.colors[ci] || color;
        for (let j = 0; j < 2; j++) {
          colorsBuf[(drawCount + j) * 3] = c[0];
          colorsBuf[(drawCount + j) * 3 + 1] = c[1];
          colorsBuf[(drawCount + j) * 3 + 2] = c[2];
        }
        drawCount += 2;
      }
    } else {
      // Lines or dots — one vertex per sample
      for (let i = 0; i < n; i++) {
        const x = (i / n) * 2 - 1;
        let y;
        if (this.audioSource === 'SPECTRUM') {
          y = spectrum ? Math.max(0, (spectrum[i] + 100) / 100) * 0.8 - 0.4 + yOffset : yOffset;
        } else {
          y = waveform ? ((waveform[i] - 128) / 128) * 0.5 + yOffset : yOffset;
        }

        positions[drawCount * 3] = x;
        positions[drawCount * 3 + 1] = y;
        positions[drawCount * 3 + 2] = 0;

        const ci = i % this.colors.length;
        const c = this.colors[ci] || color;
        colorsBuf[drawCount * 3] = c[0];
        colorsBuf[drawCount * 3 + 1] = c[1];
        colorsBuf[drawCount * 3 + 2] = c[2];
        drawCount++;
      }
    }

    this._geometry.attributes.position.needsUpdate = true;
    this._geometry.attributes.color.needsUpdate = true;
    this._geometry.setDrawRange(0, drawCount);

    ctx.renderer.setRenderTarget(fb.getActiveTarget());
    ctx.renderer.render(this._scene, this._camera);
  }

  destroy() {
    if (this._geometry) this._geometry.dispose();
    if (this._material) this._material.dispose();
  }
}

function parseHexColor(hex) {
  if (typeof hex === 'string' && hex[0] === '#') hex = hex.slice(1);
  const n = parseInt(hex, 16);
  return [(n >> 16 & 0xff) / 255, (n >> 8 & 0xff) / 255, (n & 0xff) / 255];
}

AvsComponent.register('Simple', Simple);
