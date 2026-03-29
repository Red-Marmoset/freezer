// AVS Scatter component (code 0x10) — random UV displacement per pixel
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const FRAG = `
  uniform sampler2D tSource;
  uniform vec2 uTexelSize;
  uniform float uTime;
  varying vec2 vUv;

  // Hash-based pseudo-random noise
  float rand(vec2 co) {
    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    // Generate a random offset based on pixel position and time
    vec2 seed = gl_FragCoord.xy + vec2(uTime * 137.0, uTime * 241.0);
    float rx = rand(seed) * 2.0 - 1.0;
    float ry = rand(seed + vec2(1.0, 0.0)) * 2.0 - 1.0;

    // Scatter by a few pixels
    vec2 offset = vec2(rx, ry) * uTexelSize * 4.0;
    vec2 uv = clamp(vUv + offset, 0.0, 1.0);

    gl_FragColor = texture2D(tSource, uv);
  }
`;

export class Scatter extends AvsComponent {
  constructor(opts) {
    super(opts);
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
        uTime: { value: 0 },
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
    this._material.uniforms.uTexelSize.value.set(1 / ctx.width, 1 / ctx.height);
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

AvsComponent.register('Scatter', Scatter);
