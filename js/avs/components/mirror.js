// AVS Mirror component — mirrors the framebuffer
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const FRAG = `
  uniform sampler2D tSource;
  uniform int uMode;
  varying vec2 vUv;
  void main() {
    vec2 uv = vUv;
    if (uMode == 0) {
      // Left to right
      if (uv.x > 0.5) uv.x = 1.0 - uv.x;
    } else if (uMode == 1) {
      // Right to left
      if (uv.x < 0.5) uv.x = 1.0 - uv.x;
    } else if (uMode == 2) {
      // Top to bottom
      if (uv.y < 0.5) uv.y = 1.0 - uv.y;
    } else if (uMode == 3) {
      // Bottom to top
      if (uv.y > 0.5) uv.y = 1.0 - uv.y;
    }
    gl_FragColor = texture2D(tSource, uv);
  }
`;

export class Mirror extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.mode = opts.mode || 0;
    this._scene = null; this._material = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._material = new THREE.ShaderMaterial({
      uniforms: { tSource: { value: null }, uMode: { value: this.mode } },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: FRAG,
      depthTest: false,
    });
    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material));
  }

  render(ctx, fb) {
    if (!this.enabled) return;
    this._material.uniforms.tSource.value = fb.getActiveTexture();
    ctx.renderer.setRenderTarget(fb.getBackTarget());
    const prev = ctx.renderer.autoClear;
    ctx.renderer.autoClear = true;
    ctx.renderer.render(this._scene, this._camera);
    ctx.renderer.autoClear = prev;
    fb.swap();
  }

  destroy() { if (this._material) this._material.dispose(); }
}

AvsComponent.register('Mirror', Mirror);
