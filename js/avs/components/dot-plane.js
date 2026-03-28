// AVS DotPlane component (code 0x01) — r_dotpln.cpp
// 64x64 grid where height = audio waveform amplitude with spring physics
// and 3D rotation + perspective projection.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const GRID_SIZE = 64;
const GRID_POINTS = GRID_SIZE * GRID_SIZE;

export class DotPlane extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.rotSpeed = opts.rotSpeed != null ? opts.rotSpeed : 16;
    this.color = opts.color ? parseHexColor(opts.color) :
                 (opts.colors ? parseHexColor(opts.colors) : [1, 1, 1]);
    this.angle = opts.angle || 0;
    this.style = opts.style || 0; // 0=dots, 1=lines

    // Spring physics state — each column has an amplitude and velocity
    this._amplitudes = new Float32Array(GRID_SIZE);
    this._velocities = new Float32Array(GRID_SIZE);
    this._rotation = 0;

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
    const positions = new Float32Array(GRID_POINTS * 3);
    const colors = new Float32Array(GRID_POINTS * 3);
    this._geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this._geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this._geometry.setDrawRange(0, 0);

    if (this.style === 1) {
      this._material = new THREE.LineBasicMaterial({ vertexColors: true });
      this._mesh = new THREE.LineSegments(this._geometry, this._material);
    } else {
      this._material = new THREE.PointsMaterial({
        size: 2,
        vertexColors: true,
        sizeAttenuation: false,
      });
      this._mesh = new THREE.Points(this._geometry, this._material);
    }
    this._material.depthTest = false;
    this._scene.add(this._mesh);

    // Initialize amplitudes
    this._amplitudes.fill(0);
    this._velocities.fill(0);
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    const waveform = ctx.audioData.waveform;
    if (!waveform) return;

    // Update spring physics from waveform
    for (let i = 0; i < GRID_SIZE; i++) {
      const sampleIdx = Math.floor(i * waveform.length / GRID_SIZE);
      const target = ((waveform[sampleIdx] || 128) - 128) / 128;

      // Spring toward target
      const diff = target - this._amplitudes[i];
      this._velocities[i] += diff * 0.2;
      this._velocities[i] *= 0.85; // damping
      this._amplitudes[i] += this._velocities[i];
    }

    // Advance rotation
    this._rotation += (this.rotSpeed / 256) * 0.03;

    // 3D rotation matrix (rotate around Y axis, tilt around X)
    const cosR = Math.cos(this._rotation);
    const sinR = Math.sin(this._rotation);
    const tiltAngle = 0.6 + (this.angle / 256) * 0.5; // tilt range
    const cosT = Math.cos(tiltAngle);
    const sinT = Math.sin(tiltAngle);

    const positions = this._geometry.attributes.position.array;
    const colorsBuf = this._geometry.attributes.color.array;
    let drawCount = 0;

    // Perspective distance
    const viewDist = 4.0;

    for (let gy = 0; gy < GRID_SIZE; gy++) {
      for (let gx = 0; gx < GRID_SIZE; gx++) {
        // Grid position centered at origin, range [-1, 1]
        const px = (gx / (GRID_SIZE - 1)) * 2 - 1;
        const pz = (gy / (GRID_SIZE - 1)) * 2 - 1;
        const py = this._amplitudes[gx] * 0.5; // height from audio

        // Rotate around Y axis
        const rx = px * cosR - pz * sinR;
        const rz = px * sinR + pz * cosR;

        // Tilt around X axis
        const ry = py * cosT - rz * sinT;
        const rz2 = py * sinT + rz * cosT;

        // Perspective projection
        const depth = viewDist + rz2;
        if (depth <= 0.1) continue;

        const projScale = 2.0 / depth;
        const screenX = rx * projScale;
        const screenY = ry * projScale;

        // Depth-based brightness
        const brightness = Math.max(0.1, Math.min(1.0, (viewDist - rz2) / (viewDist * 2)));

        positions[drawCount * 3] = screenX;
        positions[drawCount * 3 + 1] = screenY;
        positions[drawCount * 3 + 2] = 0;

        colorsBuf[drawCount * 3] = this.color[0] * brightness;
        colorsBuf[drawCount * 3 + 1] = this.color[1] * brightness;
        colorsBuf[drawCount * 3 + 2] = this.color[2] * brightness;

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

AvsComponent.register('DotPlane', DotPlane);
