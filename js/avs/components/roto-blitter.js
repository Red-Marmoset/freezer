// AVS RotoBlitter component (code 0x09) — rotate + zoom previous frame
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const FRAG = `
  uniform sampler2D tSource;
  uniform float uZoom;
  uniform float uRotate;
  uniform int uBilinear;
  varying vec2 vUv;

  void main() {
    // Rotate and zoom UV around center
    vec2 centered = vUv - 0.5;
    float s = sin(uRotate);
    float c = cos(uRotate);

    vec2 rotated = vec2(
      centered.x * c - centered.y * s,
      centered.x * s + centered.y * c
    );

    vec2 uv = rotated / uZoom + 0.5;

    // Wrap UVs
    uv = fract(uv);

    gl_FragColor = texture2D(tSource, uv);
  }
`;

export class RotoBlitter extends AvsComponent {
  constructor(opts) {
    super(opts);
    // Zoom: 256 = 1.0 (no zoom)
    this.zoom = opts.zoom !== undefined ? opts.zoom / 256 : 1.0;
    // Rotate: stored as units where 256 = one full revolution
    this.rotate = opts.rotate !== undefined ? (opts.rotate / 256) * Math.PI * 2 : 0;
    this.blendMode = opts.blendMode || 0;
    this.onBeatZoom = opts.onBeatZoom !== undefined ? opts.onBeatZoom / 256 : this.zoom;
    this.onBeatRotate = opts.onBeatRotate !== undefined ? (opts.onBeatRotate / 256) * Math.PI * 2 : this.rotate;
    this.bilinear = opts.bilinear !== undefined ? opts.bilinear : 1;

    this._beatActive = false;
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
        uZoom: { value: this.zoom },
        uRotate: { value: this.rotate },
        uBilinear: { value: this.bilinear },
      },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: FRAG,
      depthTest: false,
    });
    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material));
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    if (ctx.beat) {
      this._beatActive = true;
    }

    const zoom = this._beatActive ? this.onBeatZoom : this.zoom;
    const rotate = this._beatActive ? this.onBeatRotate : this.rotate;
    if (this._beatActive) this._beatActive = false;

    this._material.uniforms.tSource.value = fb.getActiveTexture();
    this._material.uniforms.uZoom.value = zoom;
    this._material.uniforms.uRotate.value = rotate;

    // Set texture filtering based on bilinear flag
    const tex = fb.getActiveTexture();
    if (tex) {
      if (this.bilinear) {
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
      } else {
        tex.minFilter = THREE.NearestFilter;
        tex.magFilter = THREE.NearestFilter;
      }
    }

    ctx.renderer.setRenderTarget(fb.getBackTarget());
    const prev = ctx.renderer.autoClear;
    ctx.renderer.autoClear = true;
    ctx.renderer.render(this._scene, this._camera);
    ctx.renderer.autoClear = prev;
    fb.swap();
  }

  destroy() { if (this._material) this._material.dispose(); }
}

AvsComponent.register('RotoBlitter', RotoBlitter);
