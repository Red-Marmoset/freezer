// AVS Invert component — inverts colors
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const FRAG = `
  uniform sampler2D tSource;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tSource, vUv);
    gl_FragColor = vec4(1.0 - c.rgb, c.a);
  }
`;

export class Invert extends AvsComponent {
  constructor(opts) { super(opts); this._scene = null; this._material = null; }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._material = new THREE.ShaderMaterial({
      uniforms: { tSource: { value: null } },
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
    this._material.uniforms.tSource.value = null;
  }

  destroy() { if (this._material) this._material.dispose(); }
}

AvsComponent.register('Invert', Invert);
