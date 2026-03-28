// AVS Timescope component (code 0x27) — r_timescope.cpp
// Scrolling spectrogram: one vertical column of spectrum data per frame,
// shifting the entire image left by 1 pixel each frame.
// Uses a persistent DataTexture updated each frame, rendered onto a fullscreen quad.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

export class Timescope extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.color = opts.color ? parseHexColor(opts.color) : [1, 1, 1];
    this.blendMode = opts.blendMode || 0;
    this.bands = opts.bands || 576;

    this._scene = null;
    this._camera = null;
    this._texture = null;
    this._texData = null;
    this._texWidth = 0;
    this._texHeight = 0;
    this._material = null;
    this._quad = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    this._camera.position.z = 1;

    // Texture dimensions match the viewport
    this._texWidth = ctx.width;
    this._texHeight = ctx.height;

    // RGBA data buffer
    this._texData = new Uint8Array(this._texWidth * this._texHeight * 4);
    this._texData.fill(0);

    this._texture = new THREE.DataTexture(
      this._texData,
      this._texWidth,
      this._texHeight,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    this._texture.minFilter = THREE.LinearFilter;
    this._texture.magFilter = THREE.LinearFilter;
    this._texture.needsUpdate = true;

    this._material = new THREE.MeshBasicMaterial({
      map: this._texture,
      depthTest: false,
      transparent: true,
    });

    const geom = new THREE.PlaneGeometry(2, 2);
    this._quad = new THREE.Mesh(geom, this._material);
    this._scene.add(this._quad);
  }

  render(ctx, fb) {
    if (!this.enabled || !this._texData) return;

    const spectrum = ctx.audioData.spectrum;
    if (!spectrum) return;

    const w = this._texWidth;
    const h = this._texHeight;
    const data = this._texData;
    const bands = Math.min(this.bands, spectrum.length);

    // Shift all existing content left by 1 pixel
    for (let y = 0; y < h; y++) {
      const rowStart = y * w * 4;
      // Copy pixel (x+1) into pixel (x) for each row
      for (let x = 0; x < (w - 1); x++) {
        const dst = rowStart + x * 4;
        const src = rowStart + (x + 1) * 4;
        data[dst] = data[src];
        data[dst + 1] = data[src + 1];
        data[dst + 2] = data[src + 2];
        data[dst + 3] = data[src + 3];
      }
    }

    // Write new column at the rightmost edge (x = w-1)
    // Map spectrum bands across the height of the image
    // Bottom = low frequency, top = high frequency
    for (let y = 0; y < h; y++) {
      const bandIdx = Math.floor((y / h) * bands);

      // spectrum is Float32Array in dB, typically -100 to 0
      const dB = spectrum[bandIdx] || -100;
      const magnitude = Math.max(0, Math.min(1, (dB + 100) / 100));

      // Tint by the configured color
      const r = Math.floor(this.color[0] * magnitude * 255);
      const g = Math.floor(this.color[1] * magnitude * 255);
      const b = Math.floor(this.color[2] * magnitude * 255);

      const pixelIdx = (y * w + (w - 1)) * 4;
      data[pixelIdx] = r;
      data[pixelIdx + 1] = g;
      data[pixelIdx + 2] = b;
      data[pixelIdx + 3] = 255;
    }

    // Upload updated texture
    this._texture.needsUpdate = true;

    ctx.renderer.setRenderTarget(fb.getActiveTarget());
    ctx.renderer.render(this._scene, this._camera);
  }

  destroy() {
    if (this._texture) this._texture.dispose();
    if (this._material) this._material.dispose();
    this._texData = null;
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

AvsComponent.register('Timescope', Timescope);
