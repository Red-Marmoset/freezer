// AVS BassSpin component (code 0x07) — r_bspin.cpp
// Spinning triangle/line indicators driven by bass frequencies for L/R channels.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const BASS_BINS = 44;  // number of low-frequency bins to sum

export class BassSpin extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.enabledLeft = opts.enabledLeft !== 0;
    this.enabledRight = opts.enabledRight !== 0;
    this.colors = [
      opts.colors && opts.colors[0] ? parseHexColor(opts.colors[0]) : [1, 1, 1],
      opts.colors && opts.colors[1] ? parseHexColor(opts.colors[1]) : [1, 1, 1],
    ];
    this.mode = opts.mode || 0; // 0=lines, 1=triangles

    // Runtime state — smoothed bass values per channel
    this._vLeft = 0;
    this._vRight = 0;
    this._angleLeft = 0;
    this._angleRight = 0;

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

    // Max verts: 2 indicators * (triangle=4 verts or line=2 verts) = up to 8
    const maxVerts = 16;
    this._geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(maxVerts * 3);
    const colors = new Float32Array(maxVerts * 3);
    this._geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this._geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this._geometry.setDrawRange(0, 0);

    this._material = new THREE.LineBasicMaterial({ vertexColors: true });
    this._material.depthTest = false;
    this._mesh = new THREE.LineSegments(this._geometry, this._material);
    this._scene.add(this._mesh);
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    const spectrum = ctx.audioData.spectrum;
    if (!spectrum) return;

    // Sum 44 bass frequency bins
    let bassSum = 0;
    for (let i = 0; i < BASS_BINS && i < spectrum.length; i++) {
      // spectrum is Float32Array in dB, convert to a positive magnitude
      bassSum += Math.max(0, spectrum[i] + 100);
    }

    // Normalize: AVS sums raw byte values; we map dB-based sum to ~0-255
    const avgBass = bassSum / BASS_BINS;

    // Smooth: v = 0.7 * max(a - 104, 12) / 96 + 0.3 * v
    const a = avgBass;
    const clamped = Math.max(a - 104, 12) / 96;
    this._vLeft = 0.7 * clamped + 0.3 * this._vLeft;
    this._vRight = 0.7 * clamped + 0.3 * this._vRight;

    // Advance rotation — speed proportional to bass level
    this._angleLeft += this._vLeft * 0.1;
    this._angleRight -= this._vRight * 0.1;

    const positions = this._geometry.attributes.position.array;
    const colorsBuf = this._geometry.attributes.color.array;
    let drawCount = 0;

    // Draw left channel indicator
    if (this.enabledLeft) {
      drawCount = this._drawIndicator(
        positions, colorsBuf, drawCount,
        -0.5, 0, this._angleLeft, this._vLeft * 0.4,
        this.colors[0]
      );
    }

    // Draw right channel indicator
    if (this.enabledRight) {
      drawCount = this._drawIndicator(
        positions, colorsBuf, drawCount,
        0.5, 0, this._angleRight, this._vRight * 0.4,
        this.colors[1]
      );
    }

    this._geometry.attributes.position.needsUpdate = true;
    this._geometry.attributes.color.needsUpdate = true;
    this._geometry.setDrawRange(0, drawCount);

    ctx.renderer.setRenderTarget(fb.getActiveTarget());
    ctx.renderer.render(this._scene, this._camera);
  }

  _drawIndicator(positions, colorsBuf, offset, cx, cy, angle, size, color) {
    size = Math.max(0.05, size);

    if (this.mode === 1) {
      // Triangle — 3 line segments (6 vertices)
      const verts = [];
      for (let i = 0; i < 3; i++) {
        const a = angle + (i * Math.PI * 2) / 3;
        verts.push([cx + Math.cos(a) * size, cy + Math.sin(a) * size]);
      }
      // 3 edges: 0-1, 1-2, 2-0
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        positions[offset * 3] = verts[i][0];
        positions[offset * 3 + 1] = verts[i][1];
        positions[offset * 3 + 2] = 0;
        colorsBuf[offset * 3] = color[0];
        colorsBuf[offset * 3 + 1] = color[1];
        colorsBuf[offset * 3 + 2] = color[2];
        offset++;
        positions[offset * 3] = verts[j][0];
        positions[offset * 3 + 1] = verts[j][1];
        positions[offset * 3 + 2] = 0;
        colorsBuf[offset * 3] = color[0];
        colorsBuf[offset * 3 + 1] = color[1];
        colorsBuf[offset * 3 + 2] = color[2];
        offset++;
      }
    } else {
      // Simple line — 1 line segment (2 vertices)
      const x1 = cx + Math.cos(angle) * size;
      const y1 = cy + Math.sin(angle) * size;
      const x2 = cx - Math.cos(angle) * size;
      const y2 = cy - Math.sin(angle) * size;

      positions[offset * 3] = x1;
      positions[offset * 3 + 1] = y1;
      positions[offset * 3 + 2] = 0;
      colorsBuf[offset * 3] = color[0];
      colorsBuf[offset * 3 + 1] = color[1];
      colorsBuf[offset * 3 + 2] = color[2];
      offset++;

      positions[offset * 3] = x2;
      positions[offset * 3 + 1] = y2;
      positions[offset * 3 + 2] = 0;
      colorsBuf[offset * 3] = color[0];
      colorsBuf[offset * 3 + 1] = color[1];
      colorsBuf[offset * 3 + 2] = color[2];
      offset++;
    }

    return offset;
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
  if (typeof hex === 'number') {
    return [(hex >> 16 & 0xff) / 255, (hex >> 8 & 0xff) / 255, (hex & 0xff) / 255];
  }
  const n = parseInt(hex, 16);
  return [(n >> 16 & 0xff) / 255, (n >> 8 & 0xff) / 255, (n & 0xff) / 255];
}

AvsComponent.register('BassSpin', BassSpin);
