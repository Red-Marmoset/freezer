/**
 * convert-milkdrop.mjs
 *
 * Converts MilkDrop .milk preset files to Freezer preset JSON.
 * Parses the INI-like .milk format, extracts equations and parameters,
 * and maps them to Freezer's native component system.
 *
 * Usage:
 *   node scripts/convert-milkdrop.mjs <input.milk> [output.json]
 *   node scripts/convert-milkdrop.mjs --batch <input-dir> <output-dir>
 */

import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';

// ── .milk file parser ───────────────────────────────────────────────

function parseMilk(text) {
  const result = {
    params: {},
    perFrame: '',
    perVertex: '',
    waves: [],       // custom waves (up to 4)
    shapes: [],      // custom shapes (up to 4)
    warpShader: '',
    compShader: '',
  };

  const lines = text.split(/\r?\n/);
  const perFrameLines = [];
  const perVertexLines = [];
  const waveCode = { 0: { init: [], perFrame: [], perPoint: [] },
                     1: { init: [], perFrame: [], perPoint: [] },
                     2: { init: [], perFrame: [], perPoint: [] },
                     3: { init: [], perFrame: [], perPoint: [] } };
  const shapeCode = { 0: { init: [], perFrame: [] },
                      1: { init: [], perFrame: [] },
                      2: { init: [], perFrame: [] },
                      3: { init: [], perFrame: [] } };
  let inWarpShader = false;
  let inCompShader = false;
  const warpLines = [];
  const compLines = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip section headers
    if (trimmed.startsWith('[')) continue;

    // Shader blocks
    if (trimmed === 'warp_1{') { inWarpShader = true; continue; }
    if (trimmed === 'comp_1{') { inCompShader = true; continue; }
    if (inWarpShader) {
      if (trimmed === '}') { inWarpShader = false; continue; }
      warpLines.push(line);
      continue;
    }
    if (inCompShader) {
      if (trimmed === '}') { inCompShader = false; continue; }
      compLines.push(line);
      continue;
    }

    // Key=value pairs
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();

    // Numbered per-frame code
    const pfMatch = key.match(/^per_frame_(\d+)$/);
    if (pfMatch) {
      if (val) perFrameLines.push(val);
      continue;
    }

    // Numbered per-pixel/per-vertex code
    const ppMatch = key.match(/^per_pixel_(\d+)$/);
    if (ppMatch) {
      if (val) perVertexLines.push(val);
      continue;
    }

    // Custom wave code
    const waveInitMatch = key.match(/^wavecode_(\d+)_init_(\d+)$/);
    if (waveInitMatch) {
      const wi = parseInt(waveInitMatch[1]);
      if (waveCode[wi] && val) waveCode[wi].init.push(val);
      continue;
    }
    const wavePfMatch = key.match(/^wavecode_(\d+)_per_frame_(\d+)$/);
    if (wavePfMatch) {
      const wi = parseInt(wavePfMatch[1]);
      if (waveCode[wi] && val) waveCode[wi].perFrame.push(val);
      continue;
    }
    const wavePpMatch = key.match(/^wavecode_(\d+)_per_point_(\d+)$/);
    if (wavePpMatch) {
      const wi = parseInt(wavePpMatch[1]);
      if (waveCode[wi] && val) waveCode[wi].perPoint.push(val);
      continue;
    }

    // Custom shape code
    const shapeInitMatch = key.match(/^shapecode_(\d+)_init_(\d+)$/);
    if (shapeInitMatch) {
      const si = parseInt(shapeInitMatch[1]);
      if (shapeCode[si] && val) shapeCode[si].init.push(val);
      continue;
    }
    const shapePfMatch = key.match(/^shapecode_(\d+)_per_frame_(\d+)$/);
    if (shapePfMatch) {
      const si = parseInt(shapePfMatch[1]);
      if (shapeCode[si] && val) shapeCode[si].perFrame.push(val);
      continue;
    }

    // Wave/shape parameter keys (wavecode_N_xxx, shapecode_N_xxx)
    const waveParamMatch = key.match(/^wavecode_(\d+)_(.+)$/);
    if (waveParamMatch) {
      const wi = parseInt(waveParamMatch[1]);
      if (!result.waves[wi]) result.waves[wi] = {};
      result.waves[wi][waveParamMatch[2]] = parseValue(val);
      continue;
    }
    const shapeParamMatch = key.match(/^shapecode_(\d+)_(.+)$/);
    if (shapeParamMatch) {
      const si = parseInt(shapeParamMatch[1]);
      if (!result.shapes[si]) result.shapes[si] = {};
      result.shapes[si][shapeParamMatch[2]] = parseValue(val);
      continue;
    }

    // Regular parameter
    result.params[key] = parseValue(val);
  }

  result.perFrame = perFrameLines.join(';\n');
  result.perVertex = perVertexLines.join(';\n');
  result.warpShader = warpLines.join('\n');
  result.compShader = compLines.join('\n');

  // Attach code to waves/shapes
  for (let i = 0; i < 4; i++) {
    if (result.waves[i]) {
      result.waves[i].code = {
        init: waveCode[i].init.join(';\n'),
        perFrame: waveCode[i].perFrame.join(';\n'),
        perPoint: waveCode[i].perPoint.join(';\n'),
      };
    }
    if (result.shapes[i]) {
      result.shapes[i].code = {
        init: shapeCode[i].init.join(';\n'),
        perFrame: shapeCode[i].perFrame.join(';\n'),
      };
    }
  }

  return result;
}

function parseValue(val) {
  const num = parseFloat(val);
  if (!isNaN(num) && val.match(/^-?\d*\.?\d+$/)) return num;
  return val;
}

// ── MilkDrop EEL → Freezer EEL translation ─────────────────────────

function translateEEL(code) {
  if (!code) return '';
  let s = code;

  // MilkDrop uses above(a,b) → Freezer can use (a > b)
  s = s.replace(/\babove\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, '(($1) > ($2))');
  // below(a,b) → (a < b)
  s = s.replace(/\bbelow\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, '(($1) < ($2))');
  // equal(a,b) → (a == b)
  s = s.replace(/\bequal\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, '(($1) == ($2))');

  return s;
}

// ── HLSL → GLSL basic conversion ────────────────────────────────────

function hlslToGlsl(hlsl) {
  if (!hlsl) return '';
  let s = hlsl;

  // Type conversions
  s = s.replace(/\bfloat2\b/g, 'vec2');
  s = s.replace(/\bfloat3\b/g, 'vec3');
  s = s.replace(/\bfloat4\b/g, 'vec4');
  s = s.replace(/\bfloat2x2\b/g, 'mat2');
  s = s.replace(/\bfloat3x3\b/g, 'mat3');
  s = s.replace(/\bfloat4x4\b/g, 'mat4');

  // tex2D → texture2D
  s = s.replace(/\btex2D\s*\(/g, 'texture2D(');
  // tex3D → texture (WebGL2, but rare in MilkDrop)
  s = s.replace(/\btex3D\s*\(/g, 'texture(');

  // saturate(x) → clamp(x, 0.0, 1.0)
  s = s.replace(/\bsaturate\s*\(\s*([^)]+)\s*\)/g, 'clamp($1, 0.0, 1.0)');

  // lerp → mix
  s = s.replace(/\blerp\s*\(/g, 'mix(');

  // frac → fract
  s = s.replace(/\bfrac\s*\(/g, 'fract(');

  // mul(a, b) → (a * b) — matrix multiply
  s = s.replace(/\bmul\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, '(($1) * ($2))');

  // atan2 → atan in GLSL (same signature)
  // (GLSL atan(y,x) is the same as HLSL atan2(y,x) — already compatible)

  // rsqrt → inversesqrt
  s = s.replace(/\brsqrt\s*\(/g, 'inversesqrt(');

  // ddx/ddy → dFdx/dFdy
  s = s.replace(/\bddx\s*\(/g, 'dFdx(');
  s = s.replace(/\bddy\s*\(/g, 'dFdy(');

  // clip() → discard pattern (approximation)
  // MilkDrop rarely uses clip, skip for now

  return s;
}

// ── Convert parsed .milk → Freezer preset JSON ─────────────────────

function milkToFreezer(parsed, name) {
  const p = parsed.params;
  const components = [];

  // 1. MilkDropMotion — the core feedback+warp engine
  const motionPerFrame = buildMotionPerFrame(p, parsed.perFrame);
  const motionPerVertex = translateEEL(parsed.perVertex);

  components.push({
    type: 'MilkDropMotion',
    enabled: true,
    code: {
      init: buildMotionInit(p),
      perFrame: motionPerFrame,
      perVertex: motionPerVertex,
    },
    gridSize: 48,
  });

  // 2. DarkenCenter (if enabled)
  if (p.bDarkenCenter) {
    components.push({ type: 'DarkenCenter', enabled: true });
  }

  // 3. Warp shader (if present)
  if (parsed.warpShader) {
    const glsl = hlslToGlsl(parsed.warpShader);
    components.push({
      type: 'CustomShader',
      enabled: true,
      shader: wrapGlslFragment(glsl, 'warp'),
      code: { init: '', perFrame: extractQVarCode(parsed.perFrame) },
    });
  }

  // 4. Custom waveforms → SuperScope
  for (let i = 0; i < 4; i++) {
    const wave = parsed.waves[i];
    if (!wave || !wave.enabled) continue;
    const sc = waveToSuperScope(wave, i);
    if (sc) components.push(sc);
  }

  // 5. Built-in waveform (if wave alpha > 0 and no custom waves replace it)
  const hasCustomWaves = parsed.waves.some(w => w && w.enabled);
  if (!hasCustomWaves && (p.fWaveAlpha || 0) > 0.01) {
    components.push(buildBuiltinWave(p));
  }

  // 6. Composite shader (if present)
  if (parsed.compShader) {
    const glsl = hlslToGlsl(parsed.compShader);
    components.push({
      type: 'CustomShader',
      enabled: true,
      shader: wrapGlslFragment(glsl, 'comp'),
      code: { init: '', perFrame: extractQVarCode(parsed.perFrame) },
    });
  }

  // 7. Echo (if enabled)
  if ((p.fVideoEchoAlpha || 0) > 0.01) {
    components.push({
      type: 'Echo',
      enabled: true,
      zoom: p.fVideoEchoZoom || 1.0,
      alpha: p.fVideoEchoAlpha || 0.5,
      orient: p.nVideoEchoOrientation || 0,
    });
  }

  // 8. Post-processing (brighten, darken, solarize, invert)
  if (p.bInvert) {
    components.push({ type: 'Invert', enabled: true });
  }

  return {
    name: name || 'MilkDrop Preset',
    clearFrame: false,
    components,
  };
}

function buildMotionInit(p) {
  const lines = [];
  lines.push(`decay = ${p.fDecay || 0.98}`);
  return lines.join(';\n');
}

function buildMotionPerFrame(p, perFrameCode) {
  const lines = [];

  // Set default values from .milk parameters
  lines.push(`zoom = ${p.zoom || 1.0}`);
  lines.push(`rot = ${p.rot || 0.0}`);
  lines.push(`dx = ${p.dx || 0.0}`);
  lines.push(`dy = ${p.dy || 0.0}`);
  lines.push(`sx = ${p.sx || 1.0}`);
  lines.push(`sy = ${p.sy || 1.0}`);
  lines.push(`warp = ${p.warp || 0.0}`);
  lines.push(`cx = ${p.cx || 0.5}`);
  lines.push(`cy = ${p.cy || 0.5}`);

  // Append the preset's per-frame code (which may modify these values)
  if (perFrameCode) {
    lines.push(translateEEL(perFrameCode));
  }

  return lines.join(';\n');
}

function extractQVarCode(perFrameCode) {
  if (!perFrameCode) return '';
  // Extract only lines that set q1-q32 variables (bridge vars for shaders)
  return translateEEL(perFrameCode);
}

function wrapGlslFragment(glsl, type) {
  // Wrap user GLSL in a complete fragment shader
  // MilkDrop shaders receive: sampler_main (framebuffer), uv, uv_orig, rad, ang, time, etc.
  return `
// MilkDrop ${type} shader (auto-converted from HLSL)
void main() {
  vec2 uv = vUv;
  vec2 uv_orig = vUv;
  float rad = length(uv - 0.5) * 2.0;
  float ang = atan(uv.y - 0.5, uv.x - 0.5);

  // Aliases for MilkDrop sampler names
  #define sampler_main tSource
  #define sampler_fw_main tSource
  #define texsize uResolution
  #define GetMain(uv) texture2D(tSource, uv)
  #define GetPixel(uv) texture2D(tSource, uv)
  #define GetBlur1(uv) texture2D(tSource, uv)
  #define GetBlur2(uv) texture2D(tSource, uv)
  #define GetBlur3(uv) texture2D(tSource, uv)

  ${glsl}
}
`;
}

function waveToSuperScope(wave, idx) {
  // Convert MilkDrop custom wave to SuperScope
  const code = wave.code || {};
  if (!code.perPoint && !code.perFrame) return null;

  const colors = [];
  const r = wave.r !== undefined ? wave.r : 1;
  const g = wave.g !== undefined ? wave.g : 1;
  const b = wave.b !== undefined ? wave.b : 1;
  colors.push(rgbToHex(r, g, b));

  return {
    type: 'SuperScope',
    enabled: true,
    drawMode: wave.bUseDots ? 'DOTS' : 'LINES',
    audioSource: 'WAVEFORM',
    audioChannel: 'CENTER',
    colors,
    code: {
      init: translateEEL(code.init || `n=${wave.samples || 512}`),
      perFrame: translateEEL(code.perFrame || ''),
      onBeat: '',
      perPoint: translateEEL(code.perPoint || 'x = (i*2-1)*0.9; y = v*0.5'),
    },
  };
}

function buildBuiltinWave(p) {
  // Map MilkDrop's nWaveMode to a simple waveform SuperScope
  const mode = p.nWaveMode || 0;
  const wr = p.wave_r || 0.65;
  const wg = p.wave_g || 0.65;
  const wb = p.wave_b || 0.65;

  let perPoint;
  switch (mode) {
    case 0: // Circle
      perPoint = 'r=0.3+v*0.15; a=i*$PI*2; x=cos(a)*r; y=sin(a)*r';
      break;
    case 1: // X-Y oscilloscope
      perPoint = 'x=(i*2-1)*0.8; y=v*0.5';
      break;
    case 2: // Spectrum
      perPoint = 'x=(i*2-1)*0.9; y=-0.5+v*0.8';
      break;
    case 3: // Spectrum dots
      perPoint = 'x=(i*2-1)*0.9; y=-0.5+v*0.8';
      break;
    case 5: // Centered waveform
      perPoint = 'x=v*0.5; y=(i*2-1)*0.8';
      break;
    case 6: case 7: default: // Simple scope
      perPoint = 'x=(i*2-1)*0.9; y=v*0.4';
      break;
  }

  return {
    type: 'SuperScope',
    enabled: true,
    drawMode: (mode === 3 || p.bWaveDots) ? 'DOTS' : 'LINES',
    audioSource: mode >= 2 ? 'SPECTRUM' : 'WAVEFORM',
    audioChannel: 'CENTER',
    colors: [rgbToHex(wr, wg, wb)],
    code: {
      init: 'n=256',
      perFrame: '',
      onBeat: '',
      perPoint,
    },
  };
}

function rgbToHex(r, g, b) {
  const clamp = v => Math.max(0, Math.min(255, Math.round(v * 255)));
  return '#' + [r, g, b].map(v => clamp(v).toString(16).padStart(2, '0')).join('');
}

// ── CLI ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args[0] === '--batch') {
  const inputDir = args[1];
  const outputDir = args[2];
  if (!inputDir || !outputDir) {
    console.error('Usage: node convert-milkdrop.mjs --batch <input-dir> <output-dir>');
    process.exit(1);
  }

  await mkdir(outputDir, { recursive: true });

  const files = await findMilkFiles(inputDir);
  let converted = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const text = await readFile(file, 'utf-8');
      const parsed = parseMilk(text);
      const name = basename(file, '.milk');
      const preset = milkToFreezer(parsed, name);
      const outName = sanitiseFilename(name) + '.json';
      await writeFile(join(outputDir, outName), JSON.stringify(preset, null, 2), 'utf-8');
      converted++;
    } catch (e) {
      console.warn(`FAIL: ${basename(file)}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n✓ Converted ${converted} presets (${failed} failed)`);
} else if (args[0]) {
  const file = args[0];
  const text = await readFile(file, 'utf-8');
  const parsed = parseMilk(text);
  const name = basename(file, '.milk');
  const preset = milkToFreezer(parsed, name);

  const outFile = args[1] || name.replace(/\.milk$/, '') + '.json';
  await writeFile(outFile, JSON.stringify(preset, null, 2), 'utf-8');
  console.log(`✓ Converted: ${name} → ${outFile}`);
  console.log(`  Components: ${preset.components.map(c => c.type).join(', ')}`);
} else {
  console.log('Usage:');
  console.log('  node scripts/convert-milkdrop.mjs <input.milk> [output.json]');
  console.log('  node scripts/convert-milkdrop.mjs --batch <input-dir> <output-dir>');
}

// ── Helpers ─────────────────────────────────────────────────────────

async function findMilkFiles(dir) {
  const results = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...await findMilkFiles(full));
    } else if (e.name.toLowerCase().endsWith('.milk')) {
      results.push(full);
    }
  }
  return results;
}

function sanitiseFilename(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9.\-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}
