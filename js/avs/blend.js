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
// All blending is done in a fragment shader reading both src and dst textures.
// We render to a temporary target, then copy to dstTarget to avoid
// read-write hazard (can't sample and render to same target).
let _blendScene, _blendCamera, _blendMesh, _blendMaterial;
let _copyScene, _copyCamera, _copyMesh, _copyMaterial;
let _tempTarget = null;
let _tempTargetW = 0, _tempTargetH = 0;

function ensureBlendResources() {
  if (_blendScene) return;

  // ---- Blend pass: reads src + dst, writes blended result ----
  _blendScene = new THREE.Scene();
  _blendCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  _blendMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tSrc: { value: null },
      tDst: { value: null },
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
      uniform sampler2D tDst;
      uniform int uMode;
      uniform float uAlpha;
      varying vec2 vUv;

      void main() {
        vec4 src = texture2D(tSrc, vUv);
        vec4 dst = texture2D(tDst, vUv);

        if (uMode == 1) {
          gl_FragColor = src; // REPLACE
        } else if (uMode == 2) {
          gl_FragColor = vec4(min(src.rgb + dst.rgb, 1.0), 1.0); // ADDITIVE
        } else if (uMode == 3) {
          gl_FragColor = vec4(mix(dst.rgb, src.rgb, 0.5), 1.0); // FIFTY_FIFTY
        } else if (uMode == 4) {
          gl_FragColor = vec4(max(src.rgb, dst.rgb), 1.0); // MAXIMUM
        } else if (uMode == 5) {
          gl_FragColor = vec4(max(dst.rgb - src.rgb, 0.0), 1.0); // SUB_DEST_SRC
        } else if (uMode == 6) {
          gl_FragColor = vec4(max(src.rgb - dst.rgb, 0.0), 1.0); // SUB_SRC_DEST
        } else if (uMode == 7) {
          gl_FragColor = vec4(src.rgb * dst.rgb, 1.0); // MULTIPLY
        } else if (uMode == 8) {
          gl_FragColor = vec4(min(src.rgb, dst.rgb), 1.0); // MINIMUM
        } else if (uMode == 9) {
          gl_FragColor = vec4(mix(dst.rgb, src.rgb, uAlpha), 1.0); // ALPHA / ADJUSTABLE
        } else if (uMode == 10) {
          gl_FragColor = vec4(mix(dst.rgb, src.rgb, uAlpha), 1.0); // ADJUSTABLE (same)
        } else {
          gl_FragColor = src; // default REPLACE
        }
      }
    `,
    depthTest: false,
  });
  _blendMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    _blendMaterial
  );
  _blendScene.add(_blendMesh);

  // ---- Copy pass: simple blit from temp to actual dst ----
  _copyScene = new THREE.Scene();
  _copyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  _copyMaterial = new THREE.MeshBasicMaterial({ map: null, depthTest: false });
  _copyMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    _copyMaterial
  );
  _copyScene.add(_copyMesh);
}

function ensureTempTarget(width, height) {
  if (_tempTarget && _tempTargetW === width && _tempTargetH === height) return;
  if (_tempTarget) _tempTarget.dispose();
  _tempTarget = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  });
  _tempTargetW = width;
  _tempTargetH = height;
}

/**
 * Composite srcTexture onto dstTarget using the given blend mode.
 * All modes are handled purely in a fragment shader (no WebGL blend state).
 * Uses a temporary render target to avoid read-write hazard on dstTarget.
 */
export function blendTexture(renderer, srcTexture, dstTarget, mode, alpha = 0.5) {
  if (mode === BLEND.IGNORE) return;

  ensureBlendResources();

  const w = dstTarget.width;
  const h = dstTarget.height;
  ensureTempTarget(w, h);

  // Unbind ALL textures before setting new ones to avoid feedback loops
  const gl = renderer.getContext();
  for (let i = 0; i < 8; i++) {
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
  renderer.resetState();

  // Set uniforms
  _blendMaterial.uniforms.tSrc.value = srcTexture;
  _blendMaterial.uniforms.tDst.value = dstTarget.texture;
  _blendMaterial.uniforms.uMode.value = mode;
  _blendMaterial.uniforms.uAlpha.value = alpha;

  // Pass 1: render blended result to temp target
  renderer.setRenderTarget(_tempTarget);
  renderer.render(_blendScene, _blendCamera);

  // Pass 2: copy temp result back to dstTarget
  _copyMaterial.map = _tempTarget.texture;
  renderer.setRenderTarget(dstTarget);
  renderer.render(_copyScene, _copyCamera);

  // Null out texture refs to prevent feedback loops in subsequent renders
  _blendMaterial.uniforms.tSrc.value = null;
  _blendMaterial.uniforms.tDst.value = null;
  _copyMaterial.map = null;
  renderer.setRenderTarget(null);
}
