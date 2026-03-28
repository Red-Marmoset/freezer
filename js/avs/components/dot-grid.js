// AVS DotGrid component (code 0x11) — r_dotgrid.cpp
// 2D grid of colored dots that scrolls/animates with cycling colors.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const MAX_POINTS = 16384; // generous upper bound for dense grids

export class DotGrid extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.numColors = opts.numColors || 1;
    this.colors = (opts.colors || ['#ffffff']).map(parseHexColor);
    this.spacing = opts.spacing || 8;
    this.xSpeed = opts.xSpeed || 0;
    this.ySpeed = opts.ySpeed || 0;
    this.blendMode = opts.blendMode || 0;

    // Runtime state
    this._xOffset = 0;
    this._yOffset = 0;
    this._colorStep = 0; // 0..numColors*64 continuous counter for transitions
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

    this._geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_POINTS * 3);
    const colors = new Float32Array(MAX_POINTS * 3);
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
    if (!this.enabled) return;

    const w = ctx.width;
    const h = ctx.height;
    const spacing = Math.max(2, this.spacing);

    // Advance scroll offsets (speeds are in pixels per frame, map to NDC)
    this._xOffset += (this.xSpeed / 128) * 0.01;
    this._yOffset += (this.ySpeed / 128) * 0.01;

    // Wrap offsets into spacing range in NDC
    const spacingNDC = (spacing / w) * 2;
    if (spacingNDC > 0) {
      this._xOffset = this._xOffset % spacingNDC;
      this._yOffset = this._yOffset % spacingNDC;
    }

    // Advance color cycling — 64 steps between each color
    const totalSteps = Math.max(1, this.colors.length) * 64;
    this._colorStep = (this._colorStep + 1) % totalSteps;

    // Compute current blended color
    const color = this._getCurrentColor();

    const positions = this._geometry.attributes.position.array;
    const colorsBuf = this._geometry.attributes.color.array;
    let drawCount = 0;

    // Generate grid in NDC [-1, 1] space
    const xStep = (spacing / w) * 2;
    const yStep = (spacing / h) * 2;

    for (let y = -1 + this._yOffset; y <= 1; y += yStep) {
      for (let x = -1 + this._xOffset; x <= 1; x += xStep) {
        if (drawCount >= MAX_POINTS) break;

        positions[drawCount * 3] = x;
        positions[drawCount * 3 + 1] = y;
        positions[drawCount * 3 + 2] = 0;

        colorsBuf[drawCount * 3] = color[0];
        colorsBuf[drawCount * 3 + 1] = color[1];
        colorsBuf[drawCount * 3 + 2] = color[2];

        drawCount++;
      }
      if (drawCount >= MAX_POINTS) break;
    }

    this._geometry.attributes.position.needsUpdate = true;
    this._geometry.attributes.color.needsUpdate = true;
    this._geometry.setDrawRange(0, drawCount);

    ctx.renderer.setRenderTarget(fb.getActiveTarget());
    ctx.renderer.render(this._scene, this._camera);
  }

  _getCurrentColor() {
    if (this.colors.length === 0) return [1, 1, 1];
    if (this.colors.length === 1) return this.colors[0];

    // 64 steps per color transition
    const colorIdx = Math.floor(this._colorStep / 64);
    const frac = (this._colorStep % 64) / 64;
    const c1 = this.colors[colorIdx % this.colors.length];
    const c2 = this.colors[(colorIdx + 1) % this.colors.length];

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

AvsComponent.register('DotGrid', DotGrid);
