import * as THREE from 'https://esm.sh/three@0.171.0';

export default {
  name: 'Oscilloscope',

  _line: null,
  _geometry: null,
  _material: null,

  init(ctx) {
    const sampleCount = ctx.audioData.fftSize / 2;

    this._geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(sampleCount * 3);
    this._geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this._material = new THREE.LineBasicMaterial({ color: 0x00ff00 });

    this._line = new THREE.Line(this._geometry, this._material);
    ctx.scene.add(this._line);

    ctx.scene.background = new THREE.Color(0x000000);
  },

  update(ctx) {
    const waveform = ctx.audioData.waveform;
    if (!waveform) return;

    const positions = this._geometry.attributes.position.array;
    const sampleCount = waveform.length;
    const w = ctx.width;
    const h = ctx.height;

    for (let i = 0; i < sampleCount; i++) {
      const x = (i / sampleCount) * w - w / 2;
      const y = ((waveform[i] - 128) / 128) * (h / 2);
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = 0;
    }

    this._geometry.attributes.position.needsUpdate = true;
  },

  destroy(ctx) {
    if (this._line) {
      ctx.scene.remove(this._line);
    }
    if (this._geometry) {
      this._geometry.dispose();
    }
    if (this._material) {
      this._material.dispose();
    }
    this._line = null;
    this._geometry = null;
    this._material = null;
  }
};
