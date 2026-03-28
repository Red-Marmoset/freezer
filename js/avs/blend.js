// AVS Blend mode utilities
// Provides blend mode constants and a shader-based compositing helper.
import * as THREE from 'https://esm.sh/three@0.171.0';

export const BLEND = {
  IGNORE:       0,
  REPLACE:      1,
  ADDITIVE:     2,
  FIFTY_FIFTY:  3,
  MAXIMUM:      4,
  SUB_DEST_SRC: 5,
  SUB_SRC_DEST: 6,
  MULTIPLY:     7,
  MINIMUM:      8,
  ALPHA:        9,
  ADJUSTABLE:   10,
};

export function parseBlendMode(str) {
  if (typeof str === 'number') return str;
  const key = (str || 'REPLACE').toUpperCase().replace(/[^A-Z_]/g, '');
  return BLEND[key] !== undefined ? BLEND[key] : BLEND.REPLACE;
}

// Composite srcTexture onto dstTarget using the given blend mode.
// Creates a temporary helper on first use and caches it.
let _blendScene, _blendCamera, _blendMesh, _blendMaterial;

function ensureBlendResources() {
  if (_blendScene) return;
  _blendScene = new THREE.Scene();
  _blendCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  _blendMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tSrc: { value: null },
      uMode: { value: 1 },
      uAlpha: { value: 0.5 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tSrc;
      uniform int uMode;
      uniform float uAlpha;
      varying vec2 vUv;
      void main() {
        vec4 src = texture2D(tSrc, vUv);
        // Blend modes that need the dst pixel are handled differently.
        // For simple modes, just output the source with appropriate alpha.
        if (uMode == 2) {
          // ADDITIVE — will use WebGL blendFunc
          gl_FragColor = src;
        } else if (uMode == 3) {
          // FIFTY_FIFTY
          gl_FragColor = vec4(src.rgb, 0.5);
        } else if (uMode == 10) {
          // ADJUSTABLE
          gl_FragColor = vec4(src.rgb, uAlpha);
        } else {
          // REPLACE
          gl_FragColor = src;
        }
      }
    `,
    transparent: true,
    depthTest: false,
  });
  _blendMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    _blendMaterial
  );
  _blendScene.add(_blendMesh);
}

/**
 * Composite srcTexture onto dstTarget using the given blend mode.
 */
export function blendTexture(renderer, srcTexture, dstTarget, mode, alpha = 0.5) {
  if (mode === BLEND.IGNORE) return;

  ensureBlendResources();
  _blendMaterial.uniforms.tSrc.value = srcTexture;
  _blendMaterial.uniforms.uMode.value = mode;
  _blendMaterial.uniforms.uAlpha.value = alpha;

  // Set WebGL blend state based on mode
  if (mode === BLEND.ADDITIVE) {
    _blendMaterial.blending = THREE.AdditiveBlending;
  } else if (mode === BLEND.FIFTY_FIFTY || mode === BLEND.ADJUSTABLE) {
    _blendMaterial.blending = THREE.NormalBlending;
  } else if (mode === BLEND.MAXIMUM) {
    _blendMaterial.blending = THREE.AdditiveBlending; // Approximation
  } else if (mode === BLEND.SUB_DEST_SRC) {
    _blendMaterial.blending = THREE.SubtractiveBlending;
  } else {
    _blendMaterial.blending = THREE.NoBlending; // REPLACE
  }
  _blendMaterial.needsUpdate = true;

  renderer.setRenderTarget(dstTarget);
  renderer.render(_blendScene, _blendCamera);
}
