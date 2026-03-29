// GeissEffect — faithful port of the Geiss screensaver/Winamp plugin
//
// Based on the open-source Geiss code (github.com/geissomatik/geiss)
// by Ryan Geiss, released under 3-Clause BSD License.
//
// Implements the complete Geiss pipeline in a single component:
// 1. Apply transformation map (warp previous frame with bilinear interpolation + decay)
// 2. Draw waveform on top (with Geiss-style color cycling)
// 3. Optionally draw beat-reactive dots (nuclide particles)
//
// The transformation map defines the visual mode — each mode has specific
// zoom/rotation/distortion math from the original source code.

import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

// All-in-one fragment shader: warp + waveform + dots
const FRAG = `
precision mediump float;
uniform sampler2D tSource;
uniform sampler2D tWaveform;  // 1D texture with waveform data
uniform float uTime;
uniform float uDecay;         // 253/256 = 0.988 typical
uniform float uScale1, uScale2;
uniform float uTurn1, uTurn2;
uniform float uDamping;
uniform int uMode;
uniform vec2 uResolution;
// Color cycling frequencies (gF[0..5] in original, each ~0.02-0.03)
uniform float uGF0, uGF1, uGF2, uGF3, uGF4, uGF5;
// Waveform rendering
uniform float uWaveBase;      // brightness from audio volume
uniform int uWaveform;        // 1-6 waveform style
uniform float uIntFrame;      // frame counter for color cycling
// Beat dots
uniform float uBeatHit;       // >0 if beat detected
uniform vec2 uDotPositions[7]; // nuclide dot center positions
uniform int uDotCount;
uniform float uDotRadius;
varying vec2 vUv;

// Geiss center (0.5, 0.5 in normalized coords)
const vec2 center = vec2(0.5);

vec2 applyMode(vec2 uv, vec2 p) {
  float r = length(p);

  if (uMode == 1) {
    // Mode 1: basic zoom inward with rotation
    float cs1 = cos(uTurn1); float sn1 = sin(uTurn1);
    float cs2 = cos(uTurn2); float sn2 = sin(uTurn2);
    // Rotation dither: alternate between turn1/scale1 and turn2/scale2
    vec2 r1 = vec2(p.x*cs1 - p.y*sn1, p.x*sn1 + p.y*cs1) * (1.0/uScale1) + center;
    vec2 r2 = vec2(p.x*cs2 - p.y*sn2, p.x*sn2 + p.y*cs2) * (1.0/uScale2) + center;
    // Dither based on pixel position
    vec2 px = floor(uv * uResolution);
    float dither = mod(px.x + px.y, 2.0);
    return mix(r1, r2, dither);
  }
  else if (uMode == 2) {
    // Mode 2: spiral — outward zoom with rotation
    float cs = cos(uTurn1); float sn = sin(uTurn1);
    vec2 rotated = vec2(p.x*cs - p.y*sn, p.x*sn + p.y*cs);
    return rotated * (1.0/uScale1) + center;
  }
  else if (uMode == 3) {
    // Mode 3: terra landing — zoom in with slight rotation, wraps horizontally
    float cs = cos(uTurn1); float sn = sin(uTurn1);
    vec2 rotated = vec2(p.x*cs - p.y*sn, p.x*sn + p.y*cs);
    vec2 result = rotated * (1.0/uScale1) + center;
    result.x = fract(result.x); // horizontal wrap
    return result;
  }
  else if (uMode == 4) {
    // Mode 4: distance-dependent zoom (slower at edges)
    float scale = 0.98 - r*r*0.04;
    float cs = cos(uTurn1); float sn = sin(uTurn1);
    vec2 rotated = vec2(p.x*cs - p.y*sn, p.x*sn + p.y*cs);
    return rotated * (1.0/scale) + center;
  }
  else if (uMode == 5) {
    // Mode 5: super-perspective
    float scale = 1.0 - r * 0.15;
    float cs = cos(uTurn1); float sn = sin(uTurn1);
    vec2 rotated = vec2(p.x*cs - p.y*sn, p.x*sn + p.y*cs);
    return rotated * (1.0/scale) + center;
  }
  else if (uMode == 9) {
    // Mode 9: flower petals / crazy feedback
    float cs = cos(uTurn1); float sn = sin(uTurn1);
    vec2 rotated = vec2(p.x*cs - p.y*sn, p.x*sn + p.y*cs);
    return rotated * (1.0/uScale1) + center;
  }
  else if (uMode == 11) {
    // Mode 11: split rotation (turn1 vs turn2 with different scales)
    float cs1 = cos(uTurn1); float sn1 = sin(uTurn1);
    float cs2 = cos(uTurn2); float sn2 = sin(uTurn2);
    vec2 r1 = vec2(p.x*cs1 - p.y*sn1, p.x*sn1 + p.y*cs1) * (1.0/uScale1) + center;
    vec2 r2 = vec2(p.x*cs2 - p.y*sn2, p.x*sn2 + p.y*cs2) * (1.0/uScale2) + center;
    vec2 px = floor(uv * uResolution);
    float dither = mod(px.x + px.y, 2.0);
    return mix(r1, r2, dither);
  }
  else if (uMode == 17) {
    // Mode 17: horizontal tunnel
    float scale = 0.97 - p.y*p.y*1.6;
    float cs = cos(uTurn1); float sn = sin(uTurn1);
    vec2 rotated = vec2(p.x*cs - p.y*sn, p.x*sn + p.y*cs);
    vec2 result = rotated * (1.0/scale) + center;
    result.x = fract(result.x);
    return result;
  }
  else if (uMode == 18) {
    // Mode 18: vertical tunnel
    float scale = 0.97 - p.x*p.x*1.6;
    float cs = cos(uTurn1); float sn = sin(uTurn1);
    vec2 rotated = vec2(p.x*cs - p.y*sn, p.x*sn + p.y*cs);
    return rotated * (1.0/scale) + center;
  }
  else if (uMode == 19) {
    // Mode 19: vortex — outward zoom increasing with distance
    float scale = 1.04 - 0.5*r;
    float cs = cos(uTurn1); float sn = sin(uTurn1);
    vec2 rotated = vec2(p.x*cs - p.y*sn, p.x*sn + p.y*cs);
    return rotated * (1.0/scale) + center;
  }
  else if (uMode == 22) {
    // Mode 22: phonic rings — quantized concentric ring zoom
    float rings = floor(r * 20.0);
    float scale = 0.95 - rings * 0.008;
    float cs = cos(uTurn1); float sn = sin(uTurn1);
    vec2 rotated = vec2(p.x*cs - p.y*sn, p.x*sn + p.y*cs);
    return rotated * (1.0/scale) + center;
  }
  else if (uMode == 25) {
    // Mode 25: spherical zoom (3/(3+r) fisheye)
    float scale = 3.0 / (3.0 + r*4.0);
    float cs = cos(uTurn1); float sn = sin(uTurn1);
    vec2 rotated = vec2(p.x*cs - p.y*sn, p.x*sn + p.y*cs);
    return rotated * (1.0/scale) + center;
  }

  // Default: simple zoom
  float cs = cos(uTurn1); float sn = sin(uTurn1);
  vec2 rotated = vec2(p.x*cs - p.y*sn, p.x*sn + p.y*cs);
  return rotated * (1.0/uScale1) + center;
}

void main() {
  vec2 p = vUv - center;

  // Apply damping: blend between identity and target position
  vec2 targetUv = applyMode(vUv, p);
  vec2 warpedUv = mix(vUv, targetUv, uDamping);

  // Sample previous frame with bilinear (hardware) filtering + decay
  vec4 color = texture2D(tSource, clamp(warpedUv, 0.0, 1.0)) * uDecay;

  // Geiss color cycling: base brightness * animated sine/cosine modulation
  // gF[0..5] are ~0.02-0.03 (very slow oscillation)
  float f = 7.0*sin(uIntFrame*0.006 + 59.0) + 5.0*cos(uIntFrame*0.0077 + 17.0);
  float cr = uWaveBase/255.0 * 1.07 * (1.0 + 0.3*sin(uIntFrame*uGF0 + 10.0 - f)) * (1.0 + 0.20*cos(uIntFrame*uGF1 + 37.0 + f));
  float cg = uWaveBase/255.0 * 1.07 * (1.0 + 0.3*sin(uIntFrame*uGF2 + 32.0 + f)) * (1.0 + 0.20*cos(uIntFrame*uGF3 + 16.0 - f));
  float cb = uWaveBase/255.0 * 1.07 * (1.0 + 0.3*sin(uIntFrame*uGF4 + 87.0 - f)) * (1.0 + 0.20*cos(uIntFrame*uGF5 + 25.0 + f));
  vec3 waveColor = clamp(vec3(cr, cg, cb), 0.0, 1.0);

  // Draw waveform: sample the waveform texture at this pixel's position
  // Waveform 1: horizontal oscilloscope
  if (uWaveform == 1) {
    float waveY = texture2D(tWaveform, vec2(vUv.x, 0.5)).r; // -1..1 encoded as 0..1
    float waveSample = (waveY - 0.5) * 0.4 + 0.5; // scale and center
    float dist = abs(vUv.y - waveSample);
    float line = smoothstep(0.003, 0.0, dist);
    color.rgb = max(color.rgb, waveColor * line);
  }
  // Waveform 5: circular polar
  else if (uWaveform == 5) {
    float angle = atan(p.y, p.x);
    float idx = (angle / 6.283185 + 0.5); // 0..1
    float waveY = texture2D(tWaveform, vec2(idx, 0.5)).r;
    float baseRad = 0.1;
    float sampleRad = baseRad + (waveY - 0.5) * 0.08;
    float r = length(p);
    float dist = abs(r - sampleRad);
    float line = smoothstep(0.004, 0.0, dist);
    color.rgb = max(color.rgb, waveColor * line);
  }
  // Waveform 6: rotating circular
  else if (uWaveform == 6) {
    float ang = sin(uIntFrame * 0.01);
    float cosA = cos(ang); float sinA = sin(ang);
    vec2 rp = vec2(p.x*cosA + p.y*sinA, -p.x*sinA + p.y*cosA);
    float angle = atan(rp.y, rp.x);
    float idx = (angle / 6.283185 + 0.5);
    float waveY = texture2D(tWaveform, vec2(idx, 0.5)).r;
    float baseRad = 0.1;
    float sampleRad = baseRad + (waveY - 0.5) * 0.08;
    float r = length(rp);
    float dist = abs(r - sampleRad);
    float line = smoothstep(0.004, 0.0, dist);
    color.rgb = max(color.rgb, waveColor * line);
  }
  // Default waveform: horizontal
  else {
    float waveY = texture2D(tWaveform, vec2(vUv.x, 0.5)).r;
    float waveSample = (waveY - 0.5) * 0.35 + 0.5;
    float dist = abs(vUv.y - waveSample);
    float line = smoothstep(0.003, 0.0, dist);
    color.rgb = max(color.rgb, waveColor * line);
  }

  // Beat dots (nuclide particles) — gaussian blobs
  if (uBeatHit > 0.0 && uDotCount > 0) {
    for (int n = 0; n < 7; n++) {
      if (n >= uDotCount) break;
      vec2 dc = uDotPositions[n];
      float d = length(vUv - dc);
      float blob = max(0.0, (uDotRadius - d) * 50.0) * uBeatHit;
      // Dot color uses same cycling as waveform
      float dotF = 7.0*sin(uIntFrame*0.007 + 29.0) + 5.0*cos(uIntFrame*0.0057 + 27.0);
      float dcr = 0.58 + 0.21*sin(uIntFrame*uGF0 + 20.0 - dotF) + 0.21*cos(uIntFrame*uGF3 + 17.0 + dotF);
      float dcg = 0.58 + 0.21*sin(uIntFrame*uGF1 + 42.0 + dotF) + 0.21*cos(uIntFrame*uGF4 + 26.0 - dotF);
      float dcb = 0.58 + 0.21*sin(uIntFrame*uGF2 + 57.0 - dotF) + 0.21*cos(uIntFrame*uGF5 + 35.0 + dotF);
      color.rgb += vec3(dcr, dcg, dcb) * blob * 0.3;
    }
  }

  gl_FragColor = vec4(clamp(color.rgb, 0.0, 1.0), 1.0);
}
`;

const VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export class GeissEffect extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.mode = opts.mode || 1;
    this.waveformMode = opts.waveform || 1; // 1-6
    this._scene = null;
    this._camera = null;
    this._material = null;
    this._waveTexture = null;
    this._waveData = null;
    this._intFrame = 0;
    // Randomized per-instance parameters (like Geiss does on mode switch)
    this._scale1 = 0.985;
    this._scale2 = 0.985;
    this._turn1 = 0.015;
    this._turn2 = 0.015;
    this._damping = 0.85;
    // gF color cycling frequencies
    this._gF = new Float32Array(6);
    for (let i = 0; i < 6; i++) this._gF[i] = 0.02 + Math.random() * 0.01;
    // Volume tracking
    this._avgVol = 50;
    this._currentVol = 0;
    // Beat dots
    this._dotPositions = [];
    this._dotFade = 0;
    this._initModeParams();
  }

  _initModeParams() {
    const r = () => Math.random();
    const m = this.mode;
    if (m === 1) {
      this._scale1 = 0.985 - 0.12 * Math.pow(r(), 2);
      this._scale2 = this._scale1;
      this._turn1 = 0.01 + 0.01 * r();
      this._turn2 = this._turn1;
      if (this._scale1 > 0.97 && r() < 0.33) this._turn1 *= -1;
    } else if (m === 2) {
      this._scale1 = 1.00 + 0.02 * r();
      this._turn1 = 0.02 + 0.07 * r();
    } else if (m === 3) {
      this._scale1 = 0.85 + 0.1 * r();
      this._scale2 = this._scale1;
      this._turn1 = 0.01 + 0.015 * r();
      this._turn2 = this._turn1;
    } else if (m === 4) {
      this._turn1 = 0.007 + 0.02 * r();
      this._turn2 = this._turn1;
    } else if (m === 5) {
      this._turn1 = 0.01 + 0.03 * r();
      this._turn2 = this._turn1;
    } else if (m === 9) {
      this._scale1 = 0.8 + 0.25 * r();
      this._scale2 = this._scale1;
      this._turn1 = 0.01 + 0.03 * r();
      this._turn2 = this._turn1;
    } else if (m === 11) {
      this._scale1 = (1.008 + 0.008 * r()) * 0.99;
      this._scale2 = (1.008 + 0.008 * r()) * 1.01;
      this._turn1 = (0.12 + 0.06 * r()) * -0.6;
      this._turn2 = (0.12 + 0.06 * r()) * 0.1;
    } else {
      this._turn1 = 0.007 + 0.02 * r();
      this._turn2 = this._turn1;
    }
    // Random rotation direction
    if (r() > 0.5) { this._turn1 *= -1; this._turn2 *= -1; }
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // 1D texture for waveform data (512 samples)
    this._waveData = new Uint8Array(512);
    this._waveTexture = new THREE.DataTexture(this._waveData, 512, 1, THREE.RedFormat);
    this._waveTexture.minFilter = THREE.LinearFilter;
    this._waveTexture.magFilter = THREE.LinearFilter;
    this._waveTexture.needsUpdate = true;

    const dotPosArray = [];
    for (let i = 0; i < 7; i++) dotPosArray.push(new THREE.Vector2(0, 0));

    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        tWaveform: { value: this._waveTexture },
        uTime: { value: 0 },
        uDecay: { value: 253.0 / 256.0 },
        uScale1: { value: this._scale1 },
        uScale2: { value: this._scale2 },
        uTurn1: { value: this._turn1 },
        uTurn2: { value: this._turn2 },
        uDamping: { value: this._damping },
        uMode: { value: this.mode },
        uResolution: { value: new THREE.Vector2(ctx.width, ctx.height) },
        uGF0: { value: this._gF[0] }, uGF1: { value: this._gF[1] },
        uGF2: { value: this._gF[2] }, uGF3: { value: this._gF[3] },
        uGF4: { value: this._gF[4] }, uGF5: { value: this._gF[5] },
        uWaveBase: { value: 100 },
        uWaveform: { value: this.waveformMode },
        uIntFrame: { value: 0 },
        uBeatHit: { value: 0 },
        uDotPositions: { value: dotPosArray },
        uDotCount: { value: 0 },
        uDotRadius: { value: 0.02 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
    });

    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material));
  }

  render(ctx, fb) {
    if (!this.enabled || !this._material) return;

    this._intFrame++;
    const u = this._material.uniforms;

    // Update waveform texture from audio data
    const waveform = ctx.audioData.waveform;
    if (waveform) {
      const len = Math.min(waveform.length, 512);
      for (let i = 0; i < len; i++) {
        // Apply smoothing like Geiss: 0.8*current + 0.2*next
        const curr = waveform[i];
        const next = i < len - 1 ? waveform[i + 1] : curr;
        this._waveData[i] = Math.round(curr * 0.8 + next * 0.2);
      }
      this._waveTexture.needsUpdate = true;
    }

    // Compute volume (Geiss-style: high-low range)
    if (waveform) {
      let low = 255, high = 0;
      for (let i = 0; i < waveform.length; i += 3) {
        if (waveform[i] < low) low = waveform[i];
        if (waveform[i] > high) high = waveform[i];
      }
      this._currentVol = (high - low);
      this._avgVol = this._avgVol * 0.85 + this._currentVol * 0.15;
    }

    // Wave brightness: base = (vol*4 + avg*0.4) - 10, clamped 0-155
    let base = (this._currentVol * 0.5 + this._avgVol * 0.05) - 2;
    base = Math.max(0, Math.min(155, base));

    // Beat detection for dots
    if (this._currentVol > this._avgVol * 1.25) {
      const nodes = 3 + Math.floor(Math.random() * 5);
      const phase = Math.random() * Math.PI * 2;
      const rad = 0.06 + Math.random() * 0.04;
      this._dotPositions = [];
      for (let n = 0; n < nodes; n++) {
        this._dotPositions.push(new THREE.Vector2(
          0.5 + rad * Math.cos(n / nodes * Math.PI * 2 + phase),
          0.5 + rad * Math.sin(n / nodes * Math.PI * 2 + phase)
        ));
      }
      this._dotFade = 1.0;
    }
    this._dotFade *= 0.92;

    // Update uniforms
    u.tSource.value = fb.getActiveTexture();
    u.uTime.value = ctx.time;
    u.uIntFrame.value = this._intFrame;
    u.uWaveBase.value = base;
    u.uResolution.value.set(ctx.width, ctx.height);
    u.uBeatHit.value = this._dotFade;
    u.uDotCount.value = this._dotPositions.length;
    u.uDotRadius.value = 0.025;
    for (let i = 0; i < 7; i++) {
      u.uDotPositions.value[i] = this._dotPositions[i] || new THREE.Vector2(0, 0);
    }

    ctx.renderer.setRenderTarget(fb.getBackTarget());
    ctx.renderer.render(this._scene, this._camera);
    u.tSource.value = null;
    fb.swap();
  }

  destroy() {
    if (this._material) this._material.dispose();
    if (this._waveTexture) this._waveTexture.dispose();
  }
}

AvsComponent.register('GeissEffect', GeissEffect);
