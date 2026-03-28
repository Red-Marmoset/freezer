// AVS ColorFade component (code 0x0B) — adds per-quadrant color offsets
// Classifies each pixel by dominant channel and applies RGB fader offsets.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const FRAG = `
  uniform sampler2D tSource;
  uniform vec3 uFader1;
  uniform vec3 uFader2;
  uniform vec3 uFader3;
  varying vec2 vUv;

  void main() {
    vec4 src = texture2D(tSource, vUv);
    vec3 c = src.rgb;

    // Classify pixel by dominant channel quadrant
    // Fader1: red dominant, Fader2: green dominant, Fader3: blue dominant
    vec3 offset;
    if (c.r >= c.g && c.r >= c.b) {
      offset = uFader1;
    } else if (c.g >= c.r && c.g >= c.b) {
      offset = uFader2;
    } else {
      offset = uFader3;
    }

    gl_FragColor = vec4(clamp(c + offset, 0.0, 1.0), src.a);
  }
`;

export class ColorFade extends AvsComponent {
  constructor(opts) {
    super(opts);
    // Each fader is 3 ints (R, G, B offsets), stored as -32..32 range
    // Normalize to -1..1 for shader
    this.fader1 = normFader(opts.fader1 || [0, 0, 0]);
    this.fader2 = normFader(opts.fader2 || [0, 0, 0]);
    this.fader3 = normFader(opts.fader3 || [0, 0, 0]);
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
        uFader1: { value: new THREE.Vector3(this.fader1[0], this.fader1[1], this.fader1[2]) },
        uFader2: { value: new THREE.Vector3(this.fader2[0], this.fader2[1], this.fader2[2]) },
        uFader3: { value: new THREE.Vector3(this.fader3[0], this.fader3[1], this.fader3[2]) },
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

    ctx.renderer.setRenderTarget(fb.getBackTarget());
    const prev = ctx.renderer.autoClear;
    ctx.renderer.autoClear = true;
    ctx.renderer.render(this._scene, this._camera);
    ctx.renderer.autoClear = prev;
    fb.swap();
  }

  destroy() { if (this._material) this._material.dispose(); }
}

function normFader(arr) {
  // AVS fader values are typically small integers (-32 to 32), map to float offsets
  return [
    (arr[0] || 0) / 255,
    (arr[1] || 0) / 255,
    (arr[2] || 0) / 255,
  ];
}

AvsComponent.register('ColorFade', ColorFade);
