// AVS Color Reduction — posterization/bit depth reduction
// Port of r_colorreduction.cpp: reduces color depth by masking off lower bits.
// levels: 1-8 (8=full color, 1=2 colors per channel)

import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const FRAG = `
  precision mediump float;
  uniform sampler2D tSource;
  uniform float uLevels;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tSource, vUv);
    // Quantize each channel to uLevels steps
    float steps = uLevels;
    vec3 q = floor(c.rgb * steps) / steps;
    gl_FragColor = vec4(q, 1.0);
  }
`;

const VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

export class ColorReduction extends AvsComponent {
  constructor(opts) {
    super(opts);
    // levels: 1-8 maps to 2-256 colors per channel
    // Original: levels=7 → 128 colors/channel, levels=1 → 2 colors/channel
    this.levels = opts.levels !== undefined ? opts.levels : 7;
    this._scene = null;
    this._camera = null;
    this._material = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Convert levels (1-8) to number of quantization steps
    const steps = Math.pow(2, this.levels);

    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        uLevels: { value: steps },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
    });
    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material));
  }

  render(ctx, fb) {
    if (!this.enabled) return;
    this._material.uniforms.tSource.value = fb.getActiveTexture();
    ctx.renderer.setRenderTarget(fb.getBackTarget());
    ctx.renderer.render(this._scene, this._camera);
    this._material.uniforms.tSource.value = null;
    fb.swap();
  }

  destroy() {
    if (this._material) this._material.dispose();
  }
}

AvsComponent.register('ColorReduction', ColorReduction);
