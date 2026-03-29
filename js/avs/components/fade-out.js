// AVS FadeOut component — fades framebuffer toward a color (usually black)
// Creates the classic trailing/feedback effect.
// Original AVS uses a per-channel clamped step: each channel moves toward
// the target by ±speed per frame, clamped when within range.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const FRAG = `
  precision mediump float;
  uniform sampler2D tSource;
  uniform vec3 uFadeColor;
  uniform float uStep; // step per frame in 0-1 range (speed/255)
  varying vec2 vUv;
  void main() {
    vec3 src = texture2D(tSource, vUv).rgb;
    // Per-channel: step toward target color by uStep
    // If within uStep of target, snap to target
    vec3 diff = uFadeColor - src;
    vec3 step = sign(diff) * min(abs(diff), vec3(uStep));
    gl_FragColor = vec4(src + step, 1.0);
  }
`;

export class FadeOut extends AvsComponent {
  constructor(opts) {
    super(opts);
    // Speed: raw value 0-92 from AVS (fadelen), or 0-1 if already normalized
    const raw = opts.speed !== undefined ? opts.speed : 7;
    // If value > 1, treat as raw AVS speed (0-92); otherwise treat as normalized
    this.speed = raw > 1 ? raw : raw * 92;
    this.color = opts.color || '#000000';

    this._scene = null;
    this._camera = null;
    this._material = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const c = parseColor(this.color);
    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        uFadeColor: { value: new THREE.Vector3(c[0], c[1], c[2]) },
        uStep: { value: this.speed / 255 },
      },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: FRAG,
      depthTest: false,
    });
    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material));
  }

  render(ctx, fb) {
    if (!this.enabled || this.speed <= 0) return;

    // Read from active, write to back, swap (no feedback loop)
    this._material.uniforms.tSource.value = fb.getActiveTexture();
    ctx.renderer.setRenderTarget(fb.getBackTarget());
    ctx.renderer.render(this._scene, this._camera);
    fb.swap();
    this._material.uniforms.tSource.value = null;
  }

  destroy() {
    if (this._material) this._material.dispose();
  }
}

function parseColor(c) {
  if (typeof c === 'string' && c[0] === '#') c = c.slice(1);
  const n = parseInt(c, 16) || 0;
  return [(n >> 16 & 0xff) / 255, (n >> 8 & 0xff) / 255, (n & 0xff) / 255];
}

AvsComponent.register('FadeOut', FadeOut);
