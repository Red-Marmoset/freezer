// AVS Blend mode utilities
// Provides blend mode constants and per-mode shader compositing.
import * as THREE from 'https://esm.sh/three@0.171.0';

export const BLEND = {
  IGNORE:             0,
  REPLACE:            1,
  ADDITIVE:           2,
  FIFTY_FIFTY:        3,
  MAXIMUM:            4,
  SUB_DEST_SRC:       5,
  SUB_SRC_DEST:       6,
  MULTIPLY:           7,
  MINIMUM:            8,
  ALPHA:              9,
  ADJUSTABLE:         10,
  EVERY_OTHER_LINE:   11,
  EVERY_OTHER_PIXEL:  12,
  XOR:                13,
  BUFFER:             14,
};

export function parseBlendMode(str) {
  if (typeof str === 'number') return str;
  const key = (str || 'REPLACE').toUpperCase().replace(/[^A-Z_0-9]/g, '');
  if (key === '5050' || key === 'FIFTYFIFTY') return BLEND.FIFTY_FIFTY;
  if (key === 'EVERYOTHERLINE' || key === 'EVERY_OTHER_LINE') return BLEND.EVERY_OTHER_LINE;
  if (key === 'EVERYOTHERPIXEL' || key === 'EVERY_OTHER_PIXEL') return BLEND.EVERY_OTHER_PIXEL;
  return BLEND[key] !== undefined ? BLEND[key] : BLEND.REPLACE;
}

// Per-mode fragment shader bodies (just the blend expression)
const BLEND_FRAGS = {
  [BLEND.REPLACE]:           'gl_FragColor = src;',
  [BLEND.ADDITIVE]:          'gl_FragColor = vec4(min(src.rgb + dst.rgb, 1.0), 1.0);',
  [BLEND.FIFTY_FIFTY]:       'gl_FragColor = vec4((src.rgb + dst.rgb) * 0.5, 1.0);',
  [BLEND.MAXIMUM]:           'gl_FragColor = vec4(max(src.rgb, dst.rgb), 1.0);',
  [BLEND.SUB_DEST_SRC]:      'gl_FragColor = vec4(max(dst.rgb - src.rgb, 0.0), 1.0);',
  [BLEND.SUB_SRC_DEST]:      'gl_FragColor = vec4(max(src.rgb - dst.rgb, 0.0), 1.0);',
  [BLEND.MULTIPLY]:          'gl_FragColor = vec4(src.rgb * dst.rgb, 1.0);',
  [BLEND.MINIMUM]:           'gl_FragColor = vec4(min(src.rgb, dst.rgb), 1.0);',
  [BLEND.ALPHA]:             'gl_FragColor = vec4(mix(dst.rgb, src.rgb, uAlpha), 1.0);',
  [BLEND.ADJUSTABLE]:        'gl_FragColor = vec4(mix(dst.rgb, src.rgb, uAlpha), 1.0);',
  [BLEND.EVERY_OTHER_LINE]:  `float line = floor(vUv.y * uResolution.y);
                               gl_FragColor = mod(line, 2.0) < 1.0 ? src : dst;`,
  [BLEND.EVERY_OTHER_PIXEL]: `float px = floor(vUv.x * uResolution.x);
                               float py = floor(vUv.y * uResolution.y);
                               gl_FragColor = mod(px + py, 2.0) < 1.0 ? src : dst;`,
  [BLEND.XOR]:               'gl_FragColor = vec4(abs(src.rgb - dst.rgb), 1.0);',
  [BLEND.BUFFER]:            'gl_FragColor = vec4((src.rgb + dst.rgb) * 0.5, 1.0);',
};

const BLEND_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

function buildBlendFrag(blendExpr) {
  return `
    precision mediump float;
    uniform sampler2D tSrc;
    uniform sampler2D tDst;
    uniform float uAlpha;
    uniform vec2 uResolution;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tSrc, vUv);
      vec4 dst = texture2D(tDst, vUv);
      ${blendExpr}
    }
  `;
}

// Cache of compiled blend materials per mode
const _blendMaterials = {};
let _blendScene, _blendCamera, _blendMesh;
let _copyScene, _copyCamera, _copyMesh, _copyMaterial;
let _tempTarget = null;
let _tempTargetW = 0, _tempTargetH = 0;
const _quadGeo = new THREE.PlaneGeometry(2, 2);

function getBlendMaterial(mode) {
  if (_blendMaterials[mode]) return _blendMaterials[mode];

  const expr = BLEND_FRAGS[mode] || BLEND_FRAGS[BLEND.REPLACE];
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tSrc: { value: null },
      tDst: { value: null },
      uAlpha: { value: 0.5 },
      uResolution: { value: new THREE.Vector2(640, 480) },
    },
    vertexShader: BLEND_VERT,
    fragmentShader: buildBlendFrag(expr),
    depthTest: false,
  });
  _blendMaterials[mode] = mat;
  return mat;
}

function ensureBlendResources() {
  if (_blendScene) return;

  _blendScene = new THREE.Scene();
  _blendCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  _blendMesh = new THREE.Mesh(_quadGeo);
  _blendScene.add(_blendMesh);

  _copyScene = new THREE.Scene();
  _copyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  _copyMaterial = new THREE.MeshBasicMaterial({ map: null, depthTest: false });
  _copyMesh = new THREE.Mesh(_quadGeo, _copyMaterial);
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
 * Each mode has its own compiled shader — no runtime branching.
 */
export function blendTexture(renderer, srcTexture, dstTarget, mode, alpha = 0.5) {
  if (mode === BLEND.IGNORE) return;

  ensureBlendResources();

  const w = dstTarget.width;
  const h = dstTarget.height;
  ensureTempTarget(w, h);

  // Unbind textures to avoid feedback loops
  const gl = renderer.getContext();
  for (let i = 0; i < 8; i++) {
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
  renderer.resetState();

  // Select the right material for this blend mode
  const mat = getBlendMaterial(mode);
  mat.uniforms.tSrc.value = srcTexture;
  mat.uniforms.tDst.value = dstTarget.texture;
  mat.uniforms.uAlpha.value = alpha;
  mat.uniforms.uResolution.value.set(w, h);
  _blendMesh.material = mat;

  // Pass 1: render blended result to temp target
  renderer.setRenderTarget(_tempTarget);
  renderer.render(_blendScene, _blendCamera);

  // Pass 2: copy temp result back to dstTarget
  _copyMaterial.map = _tempTarget.texture;
  renderer.setRenderTarget(dstTarget);
  renderer.render(_copyScene, _copyCamera);

  // Null out texture refs
  mat.uniforms.tSrc.value = null;
  mat.uniforms.tDst.value = null;
  _copyMaterial.map = null;
  renderer.setRenderTarget(null);
}
