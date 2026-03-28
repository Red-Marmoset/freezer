// AVS DotFountain component (code 0x13) — r_dotfnt.cpp
// 256x30 particle grid with 3D projection, gravity, and radial expansion.
// New particles spawn from audio data each frame.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const GRID_W = 256;
const GRID_H = 30;
const MAX_PARTICLES = GRID_W * GRID_H;
const GRADIENT_SIZE = 64;

export class DotFountain extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.rotSpeed = opts.rotSpeed != null ? opts.rotSpeed : 16;
    this.color = opts.color ? parseHexColor(opts.color) :
                 (opts.colors ? parseHexColor(opts.colors) : [1, 0.5, 0]);
    this.angle = opts.angle || 0;
    this.style = opts.style || 0;

    // Particle state arrays
    this._heights = null;  // current height of each column in each ring
    this._dh = null;       // vertical velocity (gravity accumulates here)
    this._rotation = 0;
    this._gradient = null;

    this._scene = null;
    this._camera = null;
    this._geometry = null;
    this._material = null;
    this._points = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    this._camera.position.z = 1;

    // Initialize particle arrays
    this._heights = new Float32Array(MAX_PARTICLES);
    this._dh = new Float32Array(MAX_PARTICLES);
    this._heights.fill(0);
    this._dh.fill(0);

    // Build 64-entry color gradient from base color to black
    this._gradient = new Array(GRADIENT_SIZE);
    for (let i = 0; i < GRADIENT_SIZE; i++) {
      const t = i / (GRADIENT_SIZE - 1);
      this._gradient[i] = [
        this.color[0] * (1 - t),
        this.color[1] * (1 - t),
        this.color[2] * (1 - t),
      ];
    }

    // Geometry
    this._geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_PARTICLES * 3);
    const colors = new Float32Array(MAX_PARTICLES * 3);
    this._geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this._geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this._geometry.setDrawRange(0, 0);

    this._material = new THREE.PointsMaterial({
      size: 2,
      vertexColors: true,
      sizeAttenuation: false,
    });
    this._material.depthTest = false;

    this._points = new THREE.Points(this._geometry, this._material);
    this._scene.add(this._points);
  }

  render(ctx, fb) {
    if (!this.enabled || !this._heights) return;

    const waveform = ctx.audioData.waveform;
    if (!waveform) return;

    // Shift all particle rings down by one row (age them)
    // Row 0 = newest, Row GRID_H-1 = oldest
    for (let row = GRID_H - 1; row > 0; row--) {
      for (let col = 0; col < GRID_W; col++) {
        const dst = row * GRID_W + col;
        const src = (row - 1) * GRID_W + col;
        this._heights[dst] = this._heights[src];
        this._dh[dst] = this._dh[src];
      }
    }

    // Spawn new ring (row 0) from waveform data
    for (let col = 0; col < GRID_W; col++) {
      const sampleIdx = Math.floor(col * waveform.length / GRID_W);
      const val = ((waveform[sampleIdx] || 128) - 128) / 128;
      this._heights[col] = val * 0.5;
      this._dh[col] = 0;
    }

    // Apply gravity to all particles
    for (let i = GRID_W; i < MAX_PARTICLES; i++) {
      this._dh[i] += 0.05;
      this._heights[i] -= this._dh[i] * 0.01;
    }

    // Advance rotation
    this._rotation += (this.rotSpeed / 256) * 0.02;
    const cosR = Math.cos(this._rotation);
    const sinR = Math.sin(this._rotation);

    // Tilt
    const tiltAngle = 0.4 + (this.angle / 256) * 0.6;
    const cosT = Math.cos(tiltAngle);
    const sinT = Math.sin(tiltAngle);

    const positions = this._geometry.attributes.position.array;
    const colorsBuf = this._geometry.attributes.color.array;
    let drawCount = 0;

    const viewDist = 5.0;

    for (let row = 0; row < GRID_H; row++) {
      // Radial expansion — older rings expand outward
      const ringRadius = 0.1 + (row / GRID_H) * 0.8;

      // Gradient index based on ring age
      const gradIdx = Math.min(GRADIENT_SIZE - 1, Math.floor((row / GRID_H) * GRADIENT_SIZE));
      const gc = this._gradient[gradIdx];

      for (let col = 0; col < GRID_W; col++) {
        const idx = row * GRID_W + col;
        const angle = (col / GRID_W) * Math.PI * 2;

        // 3D position — radial ring with height
        const px = Math.cos(angle) * ringRadius;
        const pz = Math.sin(angle) * ringRadius;
        const py = this._heights[idx];

        // Rotate around Y
        const rx = px * cosR - pz * sinR;
        const rz = px * sinR + pz * cosR;

        // Tilt around X
        const ry = py * cosT - rz * sinT;
        const rz2 = py * sinT + rz * cosT;

        // Perspective
        const depth = viewDist + rz2;
        if (depth <= 0.1) continue;

        const projScale = 2.0 / depth;
        const screenX = rx * projScale;
        const screenY = ry * projScale;

        if (screenX < -1.2 || screenX > 1.2 || screenY < -1.2 || screenY > 1.2) continue;

        positions[drawCount * 3] = screenX;
        positions[drawCount * 3 + 1] = screenY;
        positions[drawCount * 3 + 2] = 0;

        colorsBuf[drawCount * 3] = gc[0];
        colorsBuf[drawCount * 3 + 1] = gc[1];
        colorsBuf[drawCount * 3 + 2] = gc[2];

        drawCount++;
        if (drawCount >= MAX_PARTICLES) break;
      }
      if (drawCount >= MAX_PARTICLES) break;
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
    this._heights = null;
    this._dh = null;
    this._gradient = null;
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

AvsComponent.register('DotFountain', DotFountain);
