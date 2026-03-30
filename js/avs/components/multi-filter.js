// AVS MultiFilter — Jheriko : MULTIFILTER APE
// Chrome effect: triangle-wave brightness mapping (mid-tones brightest)
// Modes: single/double/triple chrome, infinite root + border convolution
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// Chrome: chan < 128 ? chan*2 : 510 - chan*2
// GLSL equivalent using saturated math: out = 2 * (min(2*c, 1) - c)
// Single pass = chrome, applied 2x = double chrome, 3x = triple chrome
const FRAG_CHROME = `
  precision mediump float;
  uniform sampler2D tSource;
  uniform int uPasses;
  varying vec2 vUv;
  vec3 chromePass(vec3 c) {
    // Replicate integer arithmetic: chan < 128 ? chan*2 : 510 - chan*2
    // In [0,1] space: c < 0.5 ? c*2 : 2*(1-c)  →  2*min(2c, 1) - 2c
    vec3 doubled = min(c * 2.0, vec3(1.0));
    return 2.0 * (doubled - c);
  }
  void main() {
    vec3 c = texture2D(tSource, vUv).rgb;
    c = chromePass(c);
    if (uPasses >= 2) c = chromePass(c);
    if (uPasses >= 3) c = chromePass(c);
    gl_FragColor = vec4(c, 1.0);
  }
`;

// Infinite root + small border convolution
// Any non-black pixel → white; also marks left and above neighbors white
// Note: the original scans sequentially and modifies in-place, so earlier pixels
// affect later ones. A single-pass shader can't replicate this exactly, but we
// approximate by checking the 3-pixel neighborhood.
const FRAG_INFROOT = `
  precision mediump float;
  uniform sampler2D tSource;
  uniform vec2 uTexelSize;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tSource, vUv).rgb;
    vec3 r = texture2D(tSource, vUv + vec2(uTexelSize.x, 0.0)).rgb;
    vec3 d = texture2D(tSource, vUv + vec2(0.0, uTexelSize.y)).rgb;
    // If this pixel or its right/below neighbors have any color → white
    float any = step(0.004, dot(c, vec3(1.0))) + step(0.004, dot(r, vec3(1.0))) + step(0.004, dot(d, vec3(1.0)));
    gl_FragColor = vec4(vec3(step(0.5, any)), 1.0);
  }
`;

export class MultiFilter extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.effect = opts.effect || 0; // 0=chrome, 1=double, 2=triple, 3=infroot
    this.toggleOnBeat = opts.toggleOnBeat || false;
    this._toggleState = false;
    this._scene = null;
    this._camera = null;
    this._material = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const isInfroot = this.effect === 3;
    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        uPasses: { value: Math.min(this.effect + 1, 3) },
        uTexelSize: { value: new THREE.Vector2(1 / ctx.width, 1 / ctx.height) },
      },
      vertexShader: VERT,
      fragmentShader: isInfroot ? FRAG_INFROOT : FRAG_CHROME,
      depthTest: false,
    });
    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material));
  }

  render(ctx, fb) {
    if (!this.enabled) return;
    if (this.toggleOnBeat) {
      if (ctx.beat) this._toggleState = !this._toggleState;
      if (!this._toggleState) return;
    }
    this._material.uniforms.tSource.value = fb.getActiveTexture();
    if (this.effect === 3) {
      this._material.uniforms.uTexelSize.value.set(1 / ctx.width, 1 / ctx.height);
    }
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

AvsComponent.register('MultiFilter', MultiFilter);
