// AVS Brightness/FastBrightness component
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const FRAG = `
  uniform sampler2D tSource;
  uniform vec3 uAdjust;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tSource, vUv);
    gl_FragColor = vec4(clamp(c.rgb + uAdjust, 0.0, 1.0), c.a);
  }
`;

const FAST_FRAG = `
  uniform sampler2D tSource;
  uniform int uMode;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tSource, vUv);
    if (uMode == 0) {
      gl_FragColor = vec4(c.rgb * 2.0, c.a);           // 2x
    } else if (uMode == 1) {
      gl_FragColor = vec4(c.rgb * 0.5, c.a);           // half
    } else {
      gl_FragColor = c;
    }
  }
`;

export class Brightness extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.red = (opts.red || 0) / 4096;
    this.green = (opts.green || 0) / 4096;
    this.blue = (opts.blue || 0) / 4096;
    this._scene = null; this._material = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        uAdjust: { value: new THREE.Vector3(this.red, this.green, this.blue) },
      },
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

export class FastBrightness extends AvsComponent {
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
      fragmentShader: FAST_FRAG,
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

AvsComponent.register('Brightness', Brightness);
AvsComponent.register('FastBrightness', FastBrightness);
