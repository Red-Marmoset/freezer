// AVS Picture component (code 0x22) — composites an image onto the framebuffer
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { loadAvsImage, getFallbackTexture } from '../image-loader.js';
import { blendTexture, parseBlendMode, BLEND } from '../blend.js';

const FRAG = `
  uniform sampler2D tSource;
  uniform sampler2D tImage;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    vec4 src = texture2D(tSource, vUv);
    vec4 img = texture2D(tImage, vUv);
    gl_FragColor = vec4(mix(src.rgb, img.rgb, img.a * uAlpha), 1.0);
  }
`;

export class Picture extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.imageSrc = opts.imageSrc || opts.image || '';
    this.blendMode = parseBlendMode(opts.blendMode || 'REPLACE');
    this.onBeatBlendMode = parseBlendMode(opts.onBeatBlendMode || this.blendMode);
    this.ratio = opts.ratio !== undefined ? opts.ratio : 0; // 0=stretch, 1=aspect

    this._scene = null;
    this._camera = null;
    this._material = null;
    this._imageTexture = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this._imageTexture = getFallbackTexture();

    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        tImage: { value: this._imageTexture },
        uAlpha: { value: 1.0 },
      },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: FRAG,
      depthTest: false,
    });
    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material));

    // Load the actual image
    if (this.imageSrc) {
      loadAvsImage(this.imageSrc).then(tex => {
        this._imageTexture = tex;
        this._material.uniforms.tImage.value = tex;
      });
    }
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    const mode = ctx.beat ? this.onBeatBlendMode : this.blendMode;

    if (mode === BLEND.REPLACE) {
      // Simple replace: composite image onto active FB
      this._material.uniforms.tSource.value = fb.getActiveTexture();
      ctx.renderer.setRenderTarget(fb.getBackTarget());
      ctx.renderer.render(this._scene, this._camera);
      fb.swap();
      this._material.uniforms.tSource.value = null;
    } else {
      // Use blend: render image to back, then blend onto active
      this._material.uniforms.tSource.value = fb.getActiveTexture();
      ctx.renderer.setRenderTarget(fb.getBackTarget());
      ctx.renderer.render(this._scene, this._camera);
      blendTexture(ctx.renderer, fb.getBackTarget().texture, fb.getActiveTarget(), mode);
      this._material.uniforms.tSource.value = null;
    }
  }

  destroy() {
    if (this._material) this._material.dispose();
  }
}

AvsComponent.register('Picture', Picture);
