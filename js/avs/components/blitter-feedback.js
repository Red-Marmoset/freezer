// AVS BlitterFeedback component (code 0x04) — zoom previous frame by scale factor
// Renders the source texture onto a scaled quad to create a zoom-in or zoom-out effect.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { blendTexture, parseBlendMode, BLEND } from '../blend.js';

const FRAG = `
  uniform sampler2D tSource;
  uniform float uZoom;
  varying vec2 vUv;

  void main() {
    // Zoom by scaling UV around center
    vec2 uv = (vUv - 0.5) / uZoom + 0.5;

    // Clamp to edges (out-of-bounds shows black)
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    } else {
      gl_FragColor = texture2D(tSource, uv);
    }
  }
`;

export class BlitterFeedback extends AvsComponent {
  constructor(opts) {
    super(opts);
    // Zoom value from AVS: 0-63, where 32 = 1.0x (no zoom)
    // < 32 = zoom in (frame gets bigger), > 32 = zoom out (frame shrinks)
    const rawZoom = opts.scale !== undefined ? opts.scale : 32;
    const rawOnBeat = opts.onBeatScale !== undefined ? opts.onBeatScale : rawZoom;
    this.scale = rawZoom / 32;
    this.onBeatScale = rawOnBeat / 32;
    this.blendMode = parseBlendMode(opts.blendMode || 0);

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
        uZoom: { value: this.scale },
      },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: FRAG,
      depthTest: false,
    });
    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material));
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    if (ctx.beat) this._beatActive = true;

    const zoom = this._beatActive ? this.onBeatScale : this.scale;
    if (this._beatActive) this._beatActive = false;

    // Render zoomed frame to back target
    this._material.uniforms.tSource.value = fb.getActiveTexture();
    this._material.uniforms.uZoom.value = zoom;

    if (this.blendMode === BLEND.REPLACE || this.blendMode === 0) {
      // Simple replace — write directly to back, swap
      ctx.renderer.setRenderTarget(fb.getBackTarget());
      const prev = ctx.renderer.autoClear;
      ctx.renderer.autoClear = true;
      ctx.renderer.render(this._scene, this._camera);
      ctx.renderer.autoClear = prev;
      fb.swap();
    } else {
      // Blend mode — render to back, then blend back onto active
      ctx.renderer.setRenderTarget(fb.getBackTarget());
      const prev = ctx.renderer.autoClear;
      ctx.renderer.autoClear = true;
      ctx.renderer.render(this._scene, this._camera);
      ctx.renderer.autoClear = prev;
      // Blend the zoomed result onto the active framebuffer
      blendTexture(ctx.renderer, fb.getBackTarget().texture, fb.getActiveTarget(), this.blendMode);
    }
    this._material.uniforms.tSource.value = null;
  }

  destroy() { if (this._material) this._material.dispose(); }
}

AvsComponent.register('BlitterFeedback', BlitterFeedback);
