// AVS Channel Shift component (APE) — permutes RGB channels
// 6 modes: RGB(0), RBG(1), GRB(2), GBR(3), BRG(4), BGR(5)
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const FRAG = `
  uniform sampler2D tSource;
  uniform int uMode;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tSource, vUv);
    vec3 rgb;
    if (uMode == 0) {
      rgb = c.rgb;       // RGB (no change)
    } else if (uMode == 1) {
      rgb = c.rbg;       // RBG
    } else if (uMode == 2) {
      rgb = c.grb;       // GRB
    } else if (uMode == 3) {
      rgb = c.gbr;       // GBR
    } else if (uMode == 4) {
      rgb = c.brg;       // BRG
    } else {
      rgb = c.bgr;       // BGR
    }
    gl_FragColor = vec4(rgb, c.a);
  }
`;

export class ChannelShift extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.mode = opts.mode || 0;
    this.onBeatMode = opts.onBeatMode || 0; // 0 = no change on beat, 1 = random on beat
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
        uMode: { value: this.mode },
      },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: FRAG,
      depthTest: false,
    });
    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material));
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    // On beat: optionally pick a random mode
    if (ctx.beat && this.onBeatMode) {
      this.mode = Math.floor(Math.random() * 6);
    }

    this._material.uniforms.tSource.value = fb.getActiveTexture();
    this._material.uniforms.uMode.value = this.mode;

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

AvsComponent.register('ChannelShift', ChannelShift);
