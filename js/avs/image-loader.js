// AVS Image Loader — loads BMP/JPG/PNG images for Texer, Texer II, Picture
// Includes a minimal BMP parser since Three.js doesn't support BMP natively.
import * as THREE from 'https://esm.sh/three@0.171.0';

const IMAGE_BASE = 'assets/avs-images/';
const cache = new Map();

// Fallback gaussian blob (reused across components)
let _fallbackTexture = null;

export function getFallbackTexture() {
  if (_fallbackTexture) return _fallbackTexture;
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  const center = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center + 0.5;
      const dy = y - center + 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) / center;
      const a = Math.max(0, 1 - d * d) * 255;
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a);
    }
  }
  _fallbackTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  _fallbackTexture.needsUpdate = true;
  return _fallbackTexture;
}

/**
 * Load an AVS image by filename. Returns a Promise<THREE.Texture>.
 * Handles BMP, JPG, PNG. Falls back to gaussian blob on failure.
 * Results are cached.
 */
export async function loadAvsImage(filename) {
  if (!filename) return getFallbackTexture();

  // Normalize: strip path, lowercase for cache key
  const basename = filename.replace(/.*[/\\]/, '');
  const key = basename.toLowerCase();

  if (cache.has(key)) return cache.get(key);

  const url = IMAGE_BASE + basename;

  try {
    let texture;
    if (key.endsWith('.bmp')) {
      texture = await loadBMP(url);
    } else {
      texture = await loadWithThree(url);
    }
    cache.set(key, texture);
    return texture;
  } catch (e) {
    console.warn('Failed to load AVS image:', basename, e);
    const fallback = getFallbackTexture();
    cache.set(key, fallback);
    return fallback;
  }
}

/**
 * Get a list of available image filenames (for the editor picker).
 * Returns a cached list fetched once from the server.
 */
let _imageList = null;
export async function getAvailableImages() {
  if (_imageList) return _imageList;
  try {
    // Try fetching a directory listing — this works with some static servers
    const resp = await fetch(IMAGE_BASE);
    if (resp.ok) {
      const html = await resp.text();
      // Parse filenames from HTML directory listing
      const matches = html.match(/href="([^"]+\.(bmp|jpg|png|gif))"/gi) || [];
      _imageList = matches.map(m => m.match(/href="([^"]+)"/i)[1]).sort();
      if (_imageList.length > 0) return _imageList;
    }
  } catch {}
  // Fallback: return empty list (editor will show text input instead)
  _imageList = [];
  return _imageList;
}

// --- BMP Parser ---

async function loadBMP(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const buffer = await resp.arrayBuffer();
  const { width, height, data } = parseBMP(buffer);
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

function parseBMP(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // BITMAPFILEHEADER (14 bytes)
  const magic = String.fromCharCode(bytes[0], bytes[1]);
  if (magic !== 'BM') throw new Error('Not a BMP file');
  const dataOffset = view.getUint32(10, true);

  // BITMAPINFOHEADER (40 bytes, starting at offset 14)
  const headerSize = view.getUint32(14, true);
  const width = view.getInt32(18, true);
  let height = view.getInt32(22, true);
  const bitsPerPixel = view.getUint16(28, true);
  const compression = view.getUint32(30, true);

  // Handle top-down vs bottom-up
  const topDown = height < 0;
  height = Math.abs(height);

  if (compression !== 0 && compression !== 3) {
    throw new Error('Compressed BMP not supported');
  }

  const out = new Uint8Array(width * height * 4);

  if (bitsPerPixel === 24) {
    const rowSize = Math.ceil((width * 3) / 4) * 4; // rows padded to 4 bytes
    for (let y = 0; y < height; y++) {
      const srcY = topDown ? y : (height - 1 - y);
      const srcRowStart = dataOffset + srcY * rowSize;
      for (let x = 0; x < width; x++) {
        const srcIdx = srcRowStart + x * 3;
        const dstIdx = (y * width + x) * 4;
        out[dstIdx] = bytes[srcIdx + 2];     // R (BMP stores BGR)
        out[dstIdx + 1] = bytes[srcIdx + 1]; // G
        out[dstIdx + 2] = bytes[srcIdx];     // B
        out[dstIdx + 3] = 255;               // A
      }
    }
  } else if (bitsPerPixel === 32) {
    const rowSize = width * 4;
    for (let y = 0; y < height; y++) {
      const srcY = topDown ? y : (height - 1 - y);
      const srcRowStart = dataOffset + srcY * rowSize;
      for (let x = 0; x < width; x++) {
        const srcIdx = srcRowStart + x * 4;
        const dstIdx = (y * width + x) * 4;
        out[dstIdx] = bytes[srcIdx + 2];     // R
        out[dstIdx + 1] = bytes[srcIdx + 1]; // G
        out[dstIdx + 2] = bytes[srcIdx];     // B
        out[dstIdx + 3] = bytes[srcIdx + 3]; // A
      }
    }
  } else if (bitsPerPixel === 8) {
    // 8-bit indexed — read palette from header
    const paletteOffset = 14 + headerSize;
    const numColors = view.getUint32(46, true) || 256;
    const palette = new Uint8Array(numColors * 4);
    for (let i = 0; i < numColors; i++) {
      const po = paletteOffset + i * 4;
      palette[i * 4] = bytes[po + 2];     // R
      palette[i * 4 + 1] = bytes[po + 1]; // G
      palette[i * 4 + 2] = bytes[po];     // B
      palette[i * 4 + 3] = 255;           // A
    }
    const rowSize = Math.ceil(width / 4) * 4;
    for (let y = 0; y < height; y++) {
      const srcY = topDown ? y : (height - 1 - y);
      const srcRowStart = dataOffset + srcY * rowSize;
      for (let x = 0; x < width; x++) {
        const idx = bytes[srcRowStart + x];
        const dstIdx = (y * width + x) * 4;
        out[dstIdx] = palette[idx * 4];
        out[dstIdx + 1] = palette[idx * 4 + 1];
        out[dstIdx + 2] = palette[idx * 4 + 2];
        out[dstIdx + 3] = palette[idx * 4 + 3];
      }
    }
  } else {
    throw new Error(`Unsupported BMP depth: ${bitsPerPixel}`);
  }

  return { width, height, data: out };
}

// --- JPG/PNG via Three.js TextureLoader ---

function loadWithThree(url) {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(url, resolve, undefined, reject);
  });
}
