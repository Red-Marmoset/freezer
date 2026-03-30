// Line blend mode utilities — applies GL blend state from SetRenderMode
// Used by SuperScope, Simple, Ring, and other components that render
// lines/dots directly onto the framebuffer.

// Map AVS line blend mode index to GL blend config
// Indices match r_linemode.cpp (SetRenderMode)
export function applyLineBlend(renderer, ctx) {
  if (!ctx.renderMode || !ctx.renderMode.enabled) return false;
  const gl = renderer.getContext();
  const cfg = getLineBlendGL(gl, ctx.renderMode.blend);
  if (!cfg) return false;
  gl.enable(gl.BLEND);
  gl.blendEquation(cfg.eq);
  gl.blendFunc(cfg.src, cfg.dst);
  if (cfg.color) gl.blendColor(...cfg.color);
  return true;
}

export function restoreLineBlend(renderer) {
  const gl = renderer.getContext();
  gl.disable(gl.BLEND);
  renderer.resetState();
}

function getLineBlendGL(gl, blendIdx) {
  switch (blendIdx) {
    case 0: return null; // Replace
    case 1: return { eq: gl.FUNC_ADD, src: gl.ONE, dst: gl.ONE }; // Additive
    case 2: return gl.MAX ? { eq: gl.MAX, src: gl.ONE, dst: gl.ONE } : null; // Maximum
    case 3: return { eq: gl.FUNC_ADD, src: gl.CONSTANT_COLOR, dst: gl.CONSTANT_COLOR, color: [0.5, 0.5, 0.5, 0.5] }; // 50/50
    case 4: return { eq: gl.FUNC_REVERSE_SUBTRACT, src: gl.ONE, dst: gl.ONE }; // Sub dst-src
    case 5: return { eq: gl.FUNC_SUBTRACT, src: gl.ONE, dst: gl.ONE }; // Sub src-dst
    case 6: return { eq: gl.FUNC_ADD, src: gl.DST_COLOR, dst: gl.ZERO }; // Multiply
    // 7 = Adjustable, 8 = XOR — no simple GL equivalent
    case 9: return gl.MIN ? { eq: gl.MIN, src: gl.ONE, dst: gl.ONE } : null; // Minimum
    default: return null;
  }
}
