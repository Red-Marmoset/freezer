// AVS Grain component (code 0x18) — adds random noise to the framebuffer
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const FRAG = `
  uniform sampler2D tSource;
  uniform float uAmount;
  uniform float uTime;
  uniform int uBlendMode;
  varying vec2 vUv;

  // Simple hash-based noise
  float rand(vec2 co) {
    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec4 src = texture2D(tSource, vUv);
    float n = rand(vUv + vec2(uTime)) * 2.0 - 1.0;
    vec3 noise = vec3(n) * uAmount;

    vec3 result;
    if (uBlendMode == 0) {
      // Replace
      result = vec3(noise * 0.5 + 0.5);
    } else if (uBlendMode == 1) {
      // Additive
      result = src.rgb + noise;
    } else {
      // 50/50
      result = mix(src.rgb, vec3(noise * 0.5 + 0.5), 0.5);
    }

    gl_FragColor = vec4(clamp(result, 0.0, 1.0), src.a);
  }
`;

export class Grain extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.amount = opts.amount !== undefined ? opts.amount / 100 : 0.5;
    this.blendMode = opts.blendMode || 1; // default additive
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
        uAmount: { value: this.amount },
        uTime: { value: 0 },
        uBlendMode: { value: this.blendMode },
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
    this._material.uniforms.uTime.value = ctx.time;

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

AvsComponent.register('Grain', Grain);
