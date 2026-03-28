// AVS ColorClip component (code 0x0C) — replaces pixels matching a color condition
// 3 modes: 0 = below threshold, 1 = above threshold, 2 = near color
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const FRAG = `
  uniform sampler2D tSource;
  uniform int uMode;
  uniform vec3 uClipColor;
  uniform vec3 uOutColor;
  uniform float uDistance;
  varying vec2 vUv;

  void main() {
    vec4 src = texture2D(tSource, vUv);
    vec3 c = src.rgb;
    bool clip = false;

    if (uMode == 0) {
      // Below: clip pixels where all channels are below the clip color
      clip = (c.r <= uClipColor.r && c.g <= uClipColor.g && c.b <= uClipColor.b);
    } else if (uMode == 1) {
      // Above: clip pixels where all channels are above the clip color
      clip = (c.r >= uClipColor.r && c.g >= uClipColor.g && c.b >= uClipColor.b);
    } else {
      // Near: clip pixels within distance of the clip color
      float d = length(c - uClipColor);
      clip = (d <= uDistance);
    }

    if (clip) {
      gl_FragColor = vec4(uOutColor, src.a);
    } else {
      gl_FragColor = src;
    }
  }
`;

export class ColorClip extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.mode = opts.mode || 0;
    this.clipColor = parseColor(opts.color_clip || opts.clipColor || '#000000');
    this.outColor = parseColor(opts.color_clip_out || opts.outColor || '#000000');
    this.distance = (opts.distance || 0) / 255;
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
        uClipColor: { value: new THREE.Vector3(this.clipColor[0], this.clipColor[1], this.clipColor[2]) },
        uOutColor: { value: new THREE.Vector3(this.outColor[0], this.outColor[1], this.outColor[2]) },
        uDistance: { value: this.distance },
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

function parseColor(c) {
  if (typeof c === 'string' && c[0] === '#') c = c.slice(1);
  const n = parseInt(c, 16) || 0;
  return [(n >> 16 & 0xff) / 255, (n >> 8 & 0xff) / 255, (n & 0xff) / 255];
}

AvsComponent.register('ColorClip', ColorClip);
