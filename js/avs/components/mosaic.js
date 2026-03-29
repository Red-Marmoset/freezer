// AVS Mosaic component — pixelates the framebuffer
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const FRAG = `
  uniform sampler2D tSource;
  uniform vec2 uBlockSize;
  varying vec2 vUv;
  void main() {
    vec2 block = floor(vUv / uBlockSize) * uBlockSize + uBlockSize * 0.5;
    gl_FragColor = texture2D(tSource, block);
  }
`;

export class Mosaic extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.squareSize = opts.squareSize || 8;
    this.onBeatSquareSize = opts.onBeatSquareSize || 8;
    this.onBeatDuration = opts.onBeatDuration || 1;
    this._beatFrames = 0;
    this._scene = null;
    this._material = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        uBlockSize: { value: new THREE.Vector2() },
      },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: FRAG,
      depthTest: false,
    });
    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material));
  }

  render(ctx, fb) {
    if (!this.enabled) return;
    if (ctx.beat) this._beatFrames = this.onBeatDuration;
    const sz = this._beatFrames > 0 ? this.onBeatSquareSize : this.squareSize;
    if (this._beatFrames > 0) this._beatFrames--;

    this._material.uniforms.tSource.value = fb.getActiveTexture();
    this._material.uniforms.uBlockSize.value.set(sz / ctx.width, sz / ctx.height);

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

AvsComponent.register('Mosaic', Mosaic);
