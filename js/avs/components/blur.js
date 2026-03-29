// AVS Blur component — applies a blur to the framebuffer
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = `
  uniform sampler2D tSource;
  uniform vec2 uTexelSize;
  uniform int uMode;
  varying vec2 vUv;

  void main() {
    if (uMode == 0) {
      // Light blur — 3x3 box blur
      vec4 sum = vec4(0.0);
      for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
          sum += texture2D(tSource, vUv + vec2(float(x), float(y)) * uTexelSize);
        }
      }
      gl_FragColor = sum / 9.0;
    } else if (uMode == 1) {
      // Medium blur — 5-tap cross
      vec4 c = texture2D(tSource, vUv);
      vec4 sum = c * 4.0;
      sum += texture2D(tSource, vUv + vec2(uTexelSize.x, 0.0));
      sum += texture2D(tSource, vUv - vec2(uTexelSize.x, 0.0));
      sum += texture2D(tSource, vUv + vec2(0.0, uTexelSize.y));
      sum += texture2D(tSource, vUv - vec2(0.0, uTexelSize.y));
      gl_FragColor = sum / 8.0;
    } else {
      // Heavy blur — wider 3x3
      vec4 sum = vec4(0.0);
      for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
          sum += texture2D(tSource, vUv + vec2(float(x), float(y)) * uTexelSize * 2.0);
        }
      }
      gl_FragColor = sum / 9.0;
    }
  }
`;

export class Blur extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.mode = opts.mode || 0;
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
        uTexelSize: { value: new THREE.Vector2(1 / ctx.width, 1 / ctx.height) },
        uMode: { value: this.mode },
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
    this._material.uniforms.uTexelSize.value.set(1 / ctx.width, 1 / ctx.height);
    ctx.renderer.setRenderTarget(fb.getBackTarget());
    const prev = ctx.renderer.autoClear;
    ctx.renderer.autoClear = true;
    ctx.renderer.render(this._scene, this._camera);
    ctx.renderer.autoClear = prev;
    fb.swap();
    this._material.uniforms.tSource.value = null;
  }

  destroy() { if (this._material) this._material.dispose(); }
}

AvsComponent.register('Blur', Blur);
