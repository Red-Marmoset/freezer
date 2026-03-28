# Web Audio Visualizer — Design Spec

## Context

Build a browser-based music visualizer inspired by Winamp AVS. The immediate goal is a full-screen oscilloscope that visualizes audio from the local machine. The architecture should leave room for future features (AVS/Milkdrop preset import, custom JSON preset format with GLSL shaders) without building any of that now.

## Audio Engine

Three switchable input sources, all routed through a single Web Audio `AnalyserNode`:

- **System audio**: `getDisplayMedia({ audio: true, video: true })` — video track discarded, audio feeds the analyser. Requires user permission prompt (screen share picker).
- **Microphone**: `getUserMedia({ audio: true })` — direct mic capture into the analyser.
- **File drop/upload**: `<audio>` element + `createMediaElementSource()` into the analyser. Supports drag-and-drop and file picker.

The `AnalyserNode` provides per-frame data:
- `getByteTimeDomainData()` — waveform (Uint8Array, 0-255, 128 = silence)
- `getFloatFrequencyData()` — spectrum (Float32Array, dB values)

Exposed as a simple interface:
```js
{
  waveform: Uint8Array,
  spectrum: Float32Array,
  fftSize: number,
  switchSource(type: 'system' | 'mic' | 'file'),
  loadFile(file: File)
}
```

`fftSize` defaults to 2048 (1024 waveform samples per frame).

## Renderer

- **Three.js `WebGLRenderer`** filling the full window.
- **`OrthographicCamera`** for 2D rendering (presets can switch to perspective later).
- **Animation loop**: `requestAnimationFrame` — each frame reads audio data, calls the active preset's `update()`, then renders.
- **Resize handling**: listens for `resize` events, updates renderer size and camera aspect.

### Preset Interface

Every preset is a JS object conforming to:

```js
{
  name: string,
  init(ctx): void,
  update(ctx): void,
  destroy(): void
}
```

Where `ctx` provides:
```js
{
  scene: THREE.Scene,
  camera: THREE.OrthographicCamera,
  audioData: { waveform, spectrum, fftSize },
  time: number,       // seconds since start
  dt: number,         // delta time
  width: number,      // canvas width in pixels
  height: number      // canvas height in pixels
}
```

This interface is the contract that future JSON presets will also follow. The default oscilloscope is a hardcoded JS implementation of what will eventually be a JSON-defined SuperScope.

## Default Preset: Oscilloscope (SuperScope)

- Creates a `THREE.Line` with a `BufferGeometry` containing `fftSize / 2` vertices.
- Each frame: reads the waveform array, maps each sample to a vertex position:
  - **X**: linearly distributed across the viewport width (left to right)
  - **Y**: waveform value mapped from `[0, 255]` to viewport Y range (128 = center)
- **Styling**: green line (`#00ff00`) on black background, configurable line color and width via the preset.
- Uses `THREE.LineBasicMaterial` with appropriate color.

## UI & Controls

### Two Modes

1. **Windowed mode** (default):
   - Visualizer fills the page.
   - Control panel visible at the bottom with:
     - Audio source buttons: System / Mic / File (with drop zone)
     - Fullscreen toggle button
     - (Future: preset selector, settings)

2. **Fullscreen mode**:
   - Enters via Fullscreen API (`element.requestFullscreen()`).
   - Controls become a minimal overlay that **fades out after ~3 seconds** of mouse inactivity.
   - Mouse movement fades them back in.

### Intro Tooltip

On first visit (tracked via `localStorage` key):
- A dismissible overlay appears with brief instructions:
  - "Click a source to start visualizing audio"
  - "Press F or click the button for fullscreen"
  - "Move your mouse to show/hide controls in fullscreen"
- Dismissed by click, key press, or selecting an audio source.
- Not shown again on subsequent visits.

### Keyboard Shortcuts

- **F**: Toggle fullscreen
- **1/2/3**: Switch audio source (system/mic/file)
- **Esc**: Exit fullscreen (browser default)

## File Structure

```
index.html                    — entry point, minimal HTML shell
css/style.css                 — layout, controls, fullscreen overlay styles
js/audio-engine.js            — audio source management + AnalyserNode
js/renderer.js                — Three.js setup, animation loop, preset lifecycle
js/presets/oscilloscope.js    — default SuperScope oscilloscope preset
js/ui.js                      — controls, fullscreen toggle, intro tooltip
```

- All JS as ES modules via `<script type="module">`.
- Three.js loaded from CDN (e.g., `https://esm.sh/three`).
- No build step, no bundler. Open `index.html` in a browser (or serve with any static file server for module support).

## Future Considerations (Not Built Now)

These inform architecture decisions but are not in scope:

- **Custom JSON preset format**: A JSON document describing a visualization using SuperScope-like components with embedded JS code and optional GLSL shaders.
- **AVS preset import**: Parse and render AVS presets using our own renderer.
- **Milkdrop preset import**: Parse and render Milkdrop presets using our own renderer.
- **Preset browser/selector**: UI to switch between loaded presets.

## Verification

1. Open `index.html` in a browser (serve with `npx serve .` or `python -m http.server` for module support).
2. Click "System" source — screen share picker appears, select a screen/tab, audio visualization starts.
3. Click "Mic" source — permission prompt, then mic audio visualized.
4. Drop an audio file — file plays and waveform renders.
5. Press F — enters fullscreen, controls auto-hide.
6. Move mouse — controls reappear.
7. First visit shows intro tooltip; dismissed and not shown again on reload.
