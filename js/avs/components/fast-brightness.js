// AVS Fast Brightness — quick 2x or 0.5x brightness
// Port of r_fastbright.cpp: simple brightness doubling/halving via bit shift.
// dir=0: 2x brighter (shift left), dir=1: 0.5x darker (shift right)

import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const FRAG = `
  precision mediump float;
  uniform sampler2D tSource;
  uniform int uDir;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tSource, vUv);
    if (uDir == 0) {
      // 2x brightness (clamp to 1.0)
      gl_FragColor = vec4(min(c.rgb * 2.0, 1.0), 1.0);
    } else {
      // 0.5x brightness
      gl_FragColor = vec4(c.rgb * 0.5, 1.0);
    }
  }
`;

const VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

export class FastBrightness extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.dir = opts.dir || 0; // 0=2x, 1=0.5x
    this._scene = null;
    this._camera = null;
    this._material = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        uDir: { value: this.dir },
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
    this._material.uniforms.uDir.value = this.dir;
    ctx.renderer.setRenderTarget(fb.getBackTarget());
    ctx.renderer.render(this._scene, this._camera);
    this._material.uniforms.tSource.value = null;
    fb.swap();
  }

  destroy() {
    if (this._material) this._material.dispose();
  }
}

AvsComponent.register('FastBrightness', FastBrightness);
