// AVS UniqueTone component (code 0x26) — maps max(R,G,B) through a target color
// Output = targetColor * max(r, g, b) for each pixel.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const FRAG = `
  uniform sampler2D tSource;
  uniform vec3 uColor;
  uniform int uBlendMode;
  varying vec2 vUv;

  void main() {
    vec4 src = texture2D(tSource, vUv);
    float key = max(src.r, max(src.g, src.b));
    vec3 toned = uColor * key;

    vec3 result;
    if (uBlendMode == 0) {
      // Replace
      result = toned;
    } else if (uBlendMode == 1) {
      // Additive
      result = src.rgb + toned;
    } else if (uBlendMode == 2) {
      // 50/50
      result = mix(src.rgb, toned, 0.5);
    } else {
      result = toned;
    }

    gl_FragColor = vec4(clamp(result, 0.0, 1.0), src.a);
  }
`;

export class UniqueTone extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.blendMode = opts.blendMode || 0;
    this.color = parseColor(opts.color || '#ffffff');
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
        uColor: { value: new THREE.Vector3(this.color[0], this.color[1], this.color[2]) },
        uBlendMode: { value: this.blendMode },
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
    this._material.uniforms.tSource.value = null;
  }

  destroy() { if (this._material) this._material.dispose(); }
}

function parseColor(c) {
  if (typeof c === 'string' && c[0] === '#') c = c.slice(1);
  const n = parseInt(c, 16) || 0;
  return [(n >> 16 & 0xff) / 255, (n >> 8 & 0xff) / 255, (n & 0xff) / 255];
}

AvsComponent.register('UniqueTone', UniqueTone);
