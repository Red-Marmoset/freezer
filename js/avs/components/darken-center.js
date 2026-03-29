// DarkenCenter — radial darkening to prevent center oversaturation
//
// Common in MilkDrop presets. Applies a subtle vignette that darkens
// pixels near the center of the screen, preventing feedback loops
// from creating a bright hot spot at the center.

import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// MilkDrop's darken_center: draws a few concentric dark blobs at the center
// to counteract the brightness accumulation from feedback
const FRAG = `
  precision mediump float;
  uniform sampler2D tSource;
  varying vec2 vUv;

  void main() {
    vec4 c = texture2D(tSource, vUv);
    vec2 center = vUv - 0.5;
    float dist = length(center);

    // MilkDrop-style: darken in a soft radial pattern near center
    // Three overlapping soft circles of increasing size
    float dark = 1.0;
    dark *= smoothstep(0.0, 0.06, dist);    // tight center
    dark = mix(dark, 1.0, 0.5);             // blend partial
    dark *= smoothstep(0.0, 0.12, dist);    // medium ring
    dark = mix(dark, 1.0, 0.3);
    dark *= smoothstep(0.0, 0.20, dist);    // outer ring
    dark = mix(dark, 1.0, 0.3);

    gl_FragColor = vec4(c.rgb * dark, 1.0);
  }
`;

export class DarkenCenter extends AvsComponent {
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
      uniforms: { tSource: { value: null } },
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

AvsComponent.register('DarkenCenter', DarkenCenter);
