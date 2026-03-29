// AVS BlitterFeedback component (code 0x04) — zoom previous frame
// Port of r_blit.cpp: zooms the frame in or out each frame
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { blendTexture, parseBlendMode, BLEND } from '../blend.js';

const FRAG = `
  uniform sampler2D tSource;
  uniform float uScale;
  varying vec2 vUv;

  void main() {
    vec2 uv = (vUv - 0.5) * uScale + 0.5;
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
    // AVS f_val: 0-63, center=32 (no change)
    // < 32 = zoom in (blitter_normal: enlarge), > 32 = zoom out (blitter_out: shrink)
    // We convert to a UV scale factor:
    //   f_val=32 → scale=1.0 (no change)
    //   f_val=16 → scale=0.5 (zoom in: sample inner 50%)
    //   f_val=48 → scale=1.5 (zoom out: sample 150%, edges clamp to black)
    const raw = opts.scale !== undefined ? opts.scale : (opts.zoom !== undefined ? opts.zoom : 32);
    const rawOB = opts.onBeatScale !== undefined ? opts.onBeatScale : (opts.onBeatZoom !== undefined ? opts.onBeatZoom : raw);
    this.zoom = raw;
    this.onBeatZoom = rawOB;
    this.blendMode = parseBlendMode(opts.blendMode || 0);
    this.onBeat = opts.onBeat !== undefined ? opts.onBeat : false;

    this._beatFrames = 0;
    this._scene = null;
    this._camera = null;
    this._material = null;
  }

  _zoomToScale(val) {
    // f_val < 32: zoom in → UV scale < 1 (sample inner region)
    // f_val > 32: zoom out → UV scale > 1 (sample wider region)
    if (val <= 0) return 0.01;
    return val / 32;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        uScale: { value: 1.0 },
      },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: FRAG,
      depthTest: false,
    });
    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material));
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    let zoomVal = this.zoom;
    if (this.onBeat && ctx.beat) {
      this._beatFrames = 4;
    }
    if (this._beatFrames > 0) {
      zoomVal = this.onBeatZoom;
      this._beatFrames--;
    }

    const scale = this._zoomToScale(zoomVal);
    this._material.uniforms.tSource.value = fb.getActiveTexture();
    this._material.uniforms.uScale.value = scale;

    ctx.renderer.setRenderTarget(fb.getBackTarget());
    const prev = ctx.renderer.autoClear;
    ctx.renderer.autoClear = true;
    ctx.renderer.render(this._scene, this._camera);
    ctx.renderer.autoClear = prev;

    if (this.blendMode === BLEND.REPLACE || this.blendMode <= 1) {
      fb.swap();
    } else {
      blendTexture(ctx.renderer, fb.getBackTarget().texture, fb.getActiveTarget(), this.blendMode);
    }
    this._material.uniforms.tSource.value = null;
  }

  destroy() { if (this._material) this._material.dispose(); }
}

AvsComponent.register('BlitterFeedback', BlitterFeedback);
