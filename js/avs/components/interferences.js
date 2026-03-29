// AVS Interferences component (code 0x29) — N rotated copies of frame summed
// Fragment shader samples source at N rotated UV offsets, each with its own
// rotation angle and alpha. The samples are summed together.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const VERT_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Supports up to 8 layers (sufficient for typical AVS presets)
const MAX_LAYERS = 8;

const INTERF_FRAG = `
  uniform sampler2D tSource;
  uniform int uNumLayers;
  uniform float uRotations[${MAX_LAYERS}];
  uniform float uDistances[${MAX_LAYERS}];
  uniform float uAlphas[${MAX_LAYERS}];
  varying vec2 vUv;

  #define PI 3.14159265358979

  vec2 rotate2D(vec2 p, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  }

  void main() {
    vec3 result = vec3(0.0);
    float totalAlpha = 0.0;
    vec2 center = vec2(0.5, 0.5);

    for (int i = 0; i < ${MAX_LAYERS}; i++) {
      if (i >= uNumLayers) break;

      float angle = uRotations[i];
      float dist = uDistances[i];
      float alpha = uAlphas[i];

      // Rotate UV around center
      vec2 uv = vUv - center;
      uv = rotate2D(uv, angle);
      // Apply distance offset
      uv = uv * (1.0 + dist) + center;

      // Clamp to prevent wrapping artifacts
      uv = clamp(uv, 0.0, 1.0);

      vec4 sample = texture2D(tSource, uv);
      result += sample.rgb * alpha;
      totalAlpha += alpha;
    }

    // Normalize by total alpha to prevent over-brightening
    if (totalAlpha > 0.0) {
      result /= totalAlpha;
    }

    gl_FragColor = vec4(result, 1.0);
  }
`;

export class Interferences extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.numLayers = Math.min(opts.numLayers || opts.nPoints || 2, MAX_LAYERS);
    this.rotation = (opts.rotation || 0) / 255 * Math.PI * 2; // normalize to radians
    this.distance = (opts.distance || 0) / 255;
    this.alpha = (opts.alpha || 128) / 255;
    this.onBeatRotation = (opts.onBeatRotation || 0) / 255 * Math.PI * 2;
    this.onBeatDistance = (opts.onBeatDistance || 0) / 255;

    this._currentRotation = this.rotation;
    this._currentDistance = this.distance;

    this._scene = null;
    this._camera = null;
    this._material = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Build uniform arrays
    const rotations = new Float32Array(MAX_LAYERS);
    const distances = new Float32Array(MAX_LAYERS);
    const alphas = new Float32Array(MAX_LAYERS);

    this._updateLayers(rotations, distances, alphas);

    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        uNumLayers: { value: this.numLayers },
        uRotations: { value: rotations },
        uDistances: { value: distances },
        uAlphas: { value: alphas },
      },
      vertexShader: VERT_SHADER,
      fragmentShader: INTERF_FRAG,
      depthTest: false,
    });

    this._scene.add(new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this._material
    ));
  }

  _updateLayers(rotations, distances, alphas) {
    for (let i = 0; i < MAX_LAYERS; i++) {
      if (i < this.numLayers) {
        // Distribute rotation evenly across layers
        const layerFrac = this.numLayers > 1 ? i / (this.numLayers - 1) : 0;
        rotations[i] = this._currentRotation * (layerFrac - 0.5);
        distances[i] = this._currentDistance * (layerFrac - 0.5);
        alphas[i] = this.alpha;
      } else {
        rotations[i] = 0;
        distances[i] = 0;
        alphas[i] = 0;
      }
    }
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    // On beat: add rotation/distance offsets
    if (ctx.beat) {
      this._currentRotation += this.onBeatRotation;
      this._currentDistance += this.onBeatDistance;
    }

    // Smoothly decay back
    this._currentRotation += (this.rotation - this._currentRotation) * 0.1;
    this._currentDistance += (this.distance - this._currentDistance) * 0.1;

    // Update layer uniforms
    const rotations = this._material.uniforms.uRotations.value;
    const distances = this._material.uniforms.uDistances.value;
    const alphas = this._material.uniforms.uAlphas.value;
    this._updateLayers(rotations, distances, alphas);

    this._material.uniforms.tSource.value = fb.getActiveTexture();
    this._material.uniforms.uNumLayers.value = this.numLayers;

    // Read from active, write to back, swap
    ctx.renderer.setRenderTarget(fb.getBackTarget());
    ctx.renderer.render(this._scene, this._camera);
    fb.swap();
    this._material.uniforms.tSource.value = null;
  }

  destroy() {
    if (this._material) this._material.dispose();
  }
}

AvsComponent.register('Interferences', Interferences);
