// AVS Blend mode utilities
// Uses WebGL hardware blending where possible (single pass),
// falls back to 2-pass shader approach for complex modes.
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

// ── GL blend config for hardware-blendable modes ──────────────────

function getGLBlendConfig(gl, mode, alpha) {
  switch (mode) {
    case BLEND.REPLACE:
      return null; // Just render without blending (fastest)

    case BLEND.ADDITIVE:
      // src + dst (saturating)
      return { equation: gl.FUNC_ADD, srcFunc: gl.ONE, dstFunc: gl.ONE };

    case BLEND.FIFTY_FIFTY:
      // src*0.5 + dst*0.5
      return { equation: gl.FUNC_ADD, srcFunc: gl.CONSTANT_COLOR, dstFunc: gl.CONSTANT_COLOR,
               blendColor: [0.5, 0.5, 0.5, 0.5] };

    case BLEND.ALPHA:
    case BLEND.ADJUSTABLE:
      // src*alpha + dst*(1-alpha)
      return { equation: gl.FUNC_ADD, srcFunc: gl.CONSTANT_ALPHA, dstFunc: gl.ONE_MINUS_CONSTANT_ALPHA,
               blendColor: [0, 0, 0, alpha] };

    case BLEND.MULTIPLY:
      // src * dst
      return { equation: gl.FUNC_ADD, srcFunc: gl.DST_COLOR, dstFunc: gl.ZERO };

    case BLEND.SUB_DEST_SRC:
      // max(dst - src, 0)
      return { equation: gl.FUNC_REVERSE_SUBTRACT, srcFunc: gl.ONE, dstFunc: gl.ONE };

    case BLEND.SUB_SRC_DEST:
      // max(src - dst, 0)
      return { equation: gl.FUNC_SUBTRACT, srcFunc: gl.ONE, dstFunc: gl.ONE };

    case BLEND.MAXIMUM:
      // max(src, dst) — WebGL2 has gl.MAX
      if (gl.MAX) return { equation: gl.MAX, srcFunc: gl.ONE, dstFunc: gl.ONE };
      return null; // fallback to shader

    case BLEND.MINIMUM:
      // min(src, dst) — WebGL2 has gl.MIN
      if (gl.MIN) return { equation: gl.MIN, srcFunc: gl.ONE, dstFunc: gl.ONE };
      return null; // fallback to shader

    default:
      return null; // Use shader path
  }
}

// ── Resources ─────────────────────────────────────────────────────

// Simple blit material (for GL blend path — just outputs source texture)
let _simpleScene, _simpleCamera, _simpleMaterial;

// Shader blend resources (for complex modes)
let _shaderScene, _shaderCamera, _shaderMesh;
let _copyScene, _copyCamera, _copyMaterial;
let _tempTarget = null;
let _tempTargetW = 0, _tempTargetH = 0;
const _quadGeo = new THREE.PlaneGeometry(2, 2);

// Per-mode shader fragments for complex blend modes
const SHADER_FRAGS = {
  [BLEND.MAXIMUM]:           'gl_FragColor = vec4(max(src.rgb, dst.rgb), 1.0);',
  [BLEND.MINIMUM]:           'gl_FragColor = vec4(min(src.rgb, dst.rgb), 1.0);',
  [BLEND.EVERY_OTHER_LINE]:  `float line = floor(vUv.y * uResolution.y);
                               gl_FragColor = mod(line, 2.0) < 1.0 ? src : dst;`,
  [BLEND.EVERY_OTHER_PIXEL]: `float px = floor(vUv.x * uResolution.x);
                               float py = floor(vUv.y * uResolution.y);
                               gl_FragColor = mod(px + py, 2.0) < 1.0 ? src : dst;`,
  [BLEND.XOR]:               'ivec3 si=ivec3(src.rgb*255.0); ivec3 di=ivec3(dst.rgb*255.0); gl_FragColor = vec4(vec3(si^di)/255.0, 1.0);', // gl_FragColor replaced by buildShaderFrag for GLSL3
  [BLEND.BUFFER]:            'gl_FragColor = vec4((src.rgb + dst.rgb) * 0.5, 1.0);',
};

const SHADER_VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

function buildShaderFrag(expr, glsl3) {
  if (glsl3) {
    // GLSL3: use texture() not texture2D(), output to fragColor
    return `
    precision mediump float;
    uniform sampler2D tSrc;
    uniform sampler2D tDst;
    uniform float uAlpha;
    uniform vec2 uResolution;
    in vec2 vUv;
    out vec4 fragColor;
    void main() {
      vec4 src = texture(tSrc, vUv);
      vec4 dst = texture(tDst, vUv);
      ${expr.replace(/gl_FragColor/g, 'fragColor').replace(/texture2D/g, 'texture')}
    }`;
  }
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
      ${expr}
    }
  `;
}

const _shaderMaterials = {};

const NEEDS_INTEGERS = new Set([BLEND.XOR]);

function getShaderMaterial(mode) {
  if (_shaderMaterials[mode]) return _shaderMaterials[mode];
  const expr = SHADER_FRAGS[mode];
  if (!expr) return null;
  const needsInt = NEEDS_INTEGERS.has(mode);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tSrc: { value: null }, tDst: { value: null },
      uAlpha: { value: 0.5 }, uResolution: { value: new THREE.Vector2(640, 480) },
    },
    vertexShader: needsInt ? SHADER_VERT.replace('varying vec2 vUv;', 'out vec2 vUv;') : SHADER_VERT,
    fragmentShader: buildShaderFrag(expr, needsInt),
    depthTest: false,
    glslVersion: needsInt ? THREE.GLSL3 : null,
  });
  _shaderMaterials[mode] = mat;
  return mat;
}

function ensureSimpleResources() {
  if (_simpleScene) return;
  _simpleScene = new THREE.Scene();
  _simpleCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  _simpleMaterial = new THREE.MeshBasicMaterial({ map: null, depthTest: false });
  _simpleScene.add(new THREE.Mesh(_quadGeo, _simpleMaterial));
}

function ensureShaderResources() {
  if (_shaderScene) return;
  _shaderScene = new THREE.Scene();
  _shaderCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  _shaderMesh = new THREE.Mesh(_quadGeo);
  _shaderScene.add(_shaderMesh);

  _copyScene = new THREE.Scene();
  _copyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  _copyMaterial = new THREE.MeshBasicMaterial({ map: null, depthTest: false });
  _copyScene.add(new THREE.Mesh(_quadGeo, _copyMaterial));
}

function ensureTempTarget(w, h) {
  if (_tempTarget && _tempTargetW === w && _tempTargetH === h) return;
  if (_tempTarget) _tempTarget.dispose();
  _tempTarget = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
  });
  _tempTargetW = w; _tempTargetH = h;
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Composite srcTexture onto dstTarget using the given blend mode.
 * Uses GL hardware blending for simple modes, shader for complex ones.
 */
export function blendTexture(renderer, srcTexture, dstTarget, mode, alpha = 0.5) {
  if (mode === BLEND.IGNORE) return;

  const gl = renderer.getContext();
  const glConfig = getGLBlendConfig(gl, mode, alpha);

  if (mode === BLEND.REPLACE) {
    // Fastest: just blit src onto dst with no blending
    ensureSimpleResources();
    _simpleMaterial.map = srcTexture;
    renderer.setRenderTarget(dstTarget);
    renderer.render(_simpleScene, _simpleCamera);
    _simpleMaterial.map = null;
    renderer.setRenderTarget(null);
  } else if (glConfig) {
    // Single-pass GL hardware blending
    renderWithGLBlend(renderer, gl, srcTexture, dstTarget, glConfig);
  } else {
    // 2-pass shader fallback for complex modes
    renderWithShaderBlend(renderer, srcTexture, dstTarget, mode, alpha);
  }
}

function renderWithGLBlend(renderer, gl, srcTexture, dstTarget, config) {
  ensureSimpleResources();

  // Unbind textures to prevent feedback
  for (let i = 0; i < 8; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, null); }
  renderer.resetState();

  _simpleMaterial.map = srcTexture;
  renderer.setRenderTarget(dstTarget);

  // Set GL blend state directly
  gl.enable(gl.BLEND);
  gl.blendEquation(config.equation);
  gl.blendFunc(config.srcFunc, config.dstFunc);
  if (config.blendColor) gl.blendColor(...config.blendColor);

  renderer.render(_simpleScene, _simpleCamera);

  // Restore
  gl.disable(gl.BLEND);
  renderer.resetState();
  _simpleMaterial.map = null;
  renderer.setRenderTarget(null);
}

function renderWithShaderBlend(renderer, srcTexture, dstTarget, mode, alpha) {
  ensureShaderResources();
  const w = dstTarget.width, h = dstTarget.height;
  ensureTempTarget(w, h);

  const gl = renderer.getContext();
  for (let i = 0; i < 8; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, null); }
  renderer.resetState();

  const mat = getShaderMaterial(mode);
  if (!mat) return; // Unknown mode
  mat.uniforms.tSrc.value = srcTexture;
  mat.uniforms.tDst.value = dstTarget.texture;
  mat.uniforms.uAlpha.value = alpha;
  mat.uniforms.uResolution.value.set(w, h);
  _shaderMesh.material = mat;

  // Pass 1: render blended result to temp
  renderer.setRenderTarget(_tempTarget);
  renderer.render(_shaderScene, _shaderCamera);

  // Pass 2: copy to dst
  _copyMaterial.map = _tempTarget.texture;
  renderer.setRenderTarget(dstTarget);
  renderer.render(_copyScene, _copyCamera);

  mat.uniforms.tSrc.value = null;
  mat.uniforms.tDst.value = null;
  _copyMaterial.map = null;
  renderer.setRenderTarget(null);
}
