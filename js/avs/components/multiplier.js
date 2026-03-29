// AVS Multiplier APE — multiplies framebuffer pixel values by a constant
// Ported from vis_avs e_multiplier.cpp
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

// Mode fragment shader expressions (no branching — one shader per mode)
const MODE_FRAGS = [
  'c = min(c * 8.0, 1.0);',               // 0: x8
  'c = min(c * 4.0, 1.0);',               // 1: x4
  'c = min(c * 2.0, 1.0);',               // 2: x2
  'c = c * 0.5;',                          // 3: x0.5
  'c = c * 0.25;',                         // 4: x0.25
  'c = c * 0.125;',                        // 5: x0.125
  // 6: Inf Root — only white stays, everything else → black
  'c = vec3(step(0.999, c.r) * step(0.999, c.g) * step(0.999, c.b));',
  // 7: Inf Square — any non-black → white
  'c = vec3(step(0.001, max(c.r, max(c.g, c.b))));',
];

const MODE_NAMES = [
  'x8', 'x4', 'x2', 'x0.5', 'x0.25', 'x0.125', 'Inf Root', 'Inf Square',
];

const VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

function buildFrag(modeExpr) {
  return `
    precision mediump float;
    uniform sampler2D tSource;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tSource, vUv).rgb;
      ${modeExpr}
      gl_FragColor = vec4(c, 1.0);
    }
  `;
}

export class Multiplier extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.mode = opts.mode || 0;
    this._scene = null;
    this._camera = null;
    this._material = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    this._camera.position.z = 1;

    const modeIdx = Math.max(0, Math.min(MODE_FRAGS.length - 1, this.mode));
    this._material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: buildFrag(MODE_FRAGS[modeIdx]),
      uniforms: {
        tSource: { value: null },
      },
      depthTest: false,
    });

    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material));
  }

  render(ctx, fb) {
    if (!this.enabled || !this._material) return;

    this._material.uniforms.tSource.value = fb.getActiveTexture();
    ctx.renderer.setRenderTarget(fb.getBackTarget());
    ctx.renderer.render(this._scene, this._camera);
    this._material.uniforms.tSource.value = null;
    fb.swap();
  }

  destroy() {
    if (this._material) this._material.dispose();
  }
}

AvsComponent.register('Multiplier', Multiplier);
