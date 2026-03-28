// AVS RotatingStars component (code 0x0D) — r_rotstar.cpp
// 5-pointed star shape whose size is driven by audio, rotating over time.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

// A 5-pointed star has 10 vertices alternating between outer and inner radii
const STAR_POINTS = 5;
const STAR_VERTS = STAR_POINTS * 2;
const INNER_RATIO = 0.38; // inner radius as fraction of outer (classic star shape)

export class RotatingStars extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.numStars = opts.numStars || 1;
    this.color = opts.color ? parseHexColor(opts.color) : [1, 1, 1];

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

    // Each star: STAR_VERTS edges, each edge = 2 vertices for LineSegments
    // Plus closing edge back to first point
    const maxVerts = this.numStars * (STAR_VERTS + 1) * 2;
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

    const waveform = ctx.audioData.waveform;
    if (!waveform) return;

    // Compute audio-driven size — average waveform energy
    let energy = 0;
    for (let i = 0; i < waveform.length; i++) {
      energy += Math.abs(waveform[i] - 128);
    }
    energy /= waveform.length;
    const audioSize = 0.1 + (energy / 128) * 0.6; // range [0.1, 0.7]

    // Advance rotation
    this._rotation += 0.02;

    const positions = this._geometry.attributes.position.array;
    const colorsBuf = this._geometry.attributes.color.array;
    let drawCount = 0;

    for (let s = 0; s < this.numStars; s++) {
      // Multiple stars spread across screen
      const cx = this.numStars === 1 ? 0 :
        ((s / (this.numStars - 1)) * 2 - 1) * 0.6;
      const cy = 0;
      const rot = this._rotation + (s * Math.PI / this.numStars);
      const size = audioSize;

      // Generate star vertices
      const verts = [];
      for (let i = 0; i < STAR_VERTS; i++) {
        const angle = rot + (i * Math.PI) / STAR_POINTS - Math.PI / 2;
        const isOuter = (i % 2 === 0);
        const r = isOuter ? size : size * INNER_RATIO;
        verts.push([
          cx + Math.cos(angle) * r,
          cy + Math.sin(angle) * r,
        ]);
      }

      // Draw edges as line segments (pairs of vertices)
      for (let i = 0; i < STAR_VERTS; i++) {
        const j = (i + 1) % STAR_VERTS;

        positions[drawCount * 3] = verts[i][0];
        positions[drawCount * 3 + 1] = verts[i][1];
        positions[drawCount * 3 + 2] = 0;
        colorsBuf[drawCount * 3] = this.color[0];
        colorsBuf[drawCount * 3 + 1] = this.color[1];
        colorsBuf[drawCount * 3 + 2] = this.color[2];
        drawCount++;

        positions[drawCount * 3] = verts[j][0];
        positions[drawCount * 3 + 1] = verts[j][1];
        positions[drawCount * 3 + 2] = 0;
        colorsBuf[drawCount * 3] = this.color[0];
        colorsBuf[drawCount * 3 + 1] = this.color[1];
        colorsBuf[drawCount * 3 + 2] = this.color[2];
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

AvsComponent.register('RotatingStars', RotatingStars);
