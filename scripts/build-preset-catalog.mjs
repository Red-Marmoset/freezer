/**
 * build-preset-catalog.mjs
 *
 * One-time Node.js script that:
 *  1. Copies .avs files from C:\code\avs into assets/presets/{author}/{pack}/
 *  2. Sanitises every filename for web-safe URLs
 *  3. Generates js/preset-library/catalog.js (lightweight metadata only)
 *
 * Usage:  node scripts/build-preset-catalog.mjs
 */

import { readdir, copyFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';

const AVS_ROOT = 'C:/code/avs';
const OUT_PRESETS = 'assets/presets';
const OUT_CATALOG = 'js/preset-library/catalog.js';

// ── Sanitisation ────────────────────────────────────────────────────

const UNICODE_MAP = {
  '\u00b2': '2', '\u00b3': '3', '\u00b9': '1', '\u00ba': '0',
  '\u00e0': 'a', '\u00e1': 'a', '\u00e2': 'a', '\u00e3': 'a', '\u00e4': 'a', '\u00e5': 'a',
  '\u00e6': 'ae',
  '\u00e7': 'c',
  '\u00e8': 'e', '\u00e9': 'e', '\u00ea': 'e', '\u00eb': 'e',
  '\u00ec': 'i', '\u00ed': 'i', '\u00ee': 'i', '\u00ef': 'i',
  '\u00f0': 'd',
  '\u00f1': 'n',
  '\u00f2': 'o', '\u00f3': 'o', '\u00f4': 'o', '\u00f5': 'o', '\u00f6': 'o',
  '\u00f8': 'o',
  '\u00f9': 'u', '\u00fa': 'u', '\u00fb': 'u', '\u00fc': 'u',
  '\u00fd': 'y', '\u00ff': 'y',
};

function sanitise(name) {
  let s = name;
  for (const [from, to] of Object.entries(UNICODE_MAP)) {
    s = s.replaceAll(from, to);
  }
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9.\-]/g, '-');
  s = s.replace(/-{2,}/g, '-');
  s = s.replace(/^-+|-+$/g, '');
  return s;
}

function cleanTitle(filename) {
  let t = filename.replace(/\.avs$/i, '');
  t = t.replace(/^(?:Jheriko|JHERiKO|Tuggummi)\s*-\s*(?:\d+\s*-\s*)?/i, '');
  t = t.replace(/^\d+\s*-\s*/, '');
  return t.trim() || filename.replace(/\.avs$/i, '');
}

// ── Source mapping ──────────────────────────────────────────────────

const SOURCE_MAP = [
  // Jheriko packs
  { dir: 'Jheriko',                                  authorId: 'jheriko', packId: 'jheriko-j10',              packName: 'J10',                        sub: 'J\u00b9\u00ba' },
  { dir: 'Jheriko - HiRes',                          authorId: 'jheriko', packId: 'jheriko-hires',            packName: 'HiRes' },
  { dir: 'Jheriko - J7',                             authorId: 'jheriko', packId: 'jheriko-j7',               packName: 'J7' },
  { dir: 'Jheriko - Pack 9',                         authorId: 'jheriko', packId: 'jheriko-pack-9',           packName: 'Pack 9' },
  { dir: 'JHERiKO - Pack II - The Geometry of Light', authorId: 'jheriko', packId: 'jheriko-pack-ii',         packName: 'Pack II - The Geometry of Light' },
  { dir: 'JHERiKO - Pack III - Redemption',          authorId: 'jheriko', packId: 'jheriko-pack-iii',         packName: 'Pack III - Redemption' },
  { dir: 'JHERiKO - Pack IV - Clarity of Vision',    authorId: 'jheriko', packId: 'jheriko-pack-iv',          packName: 'Pack IV - Clarity of Vision' },
  { dir: 'JHERiKO - Purely Platonic Minipack',       authorId: 'jheriko', packId: 'jheriko-purely-platonic',  packName: 'Purely Platonic Minipack' },
  { dir: 'JHERiKO - RePack 1 - The Atonement',      authorId: 'jheriko', packId: 'jheriko-repack-1',         packName: 'RePack 1 - The Atonement' },

  // Winamp 5 Picks
  { dir: 'Winamp 5 Picks', authorId: 'various', packId: 'winamp-5-picks', packName: 'Winamp 5 Picks' },
];

// Tuggummi — each subdirectory becomes its own pack
const TUGGUMMI_SUBS = [
  '## - Singles 2004 EP',
  '01 - 1st Shot', '02 - Basic Blocks', '03 - RIP OFF', '04 - Progression',
  '05 - New Age', '06 - strobotonic', '07 - A Very Small PARTY', '08 - Bitmapped',
  '09 - Response', '10 - Generation X', '11 - strobotonic II', '12 - Again Very Small PARTY',
  '13 - Innovation!', '14 - Technically Incorrect', '15 - Bitmapped II',
  '16 - Another Very Small PARTY', '17 - Breaking Myself', '18 - strobotonic III',
  '19 - Extra Dimension', '20 - Functions',
  'AA - Misc', 'AB - Original Singles', 'AC - Remix Singles',
];

for (const sub of TUGGUMMI_SUBS) {
  const packSlug = sanitise(sub);
  SOURCE_MAP.push({
    dir: 'Tuggummi',
    sub,
    authorId: 'tuggummi',
    packId: `tuggummi-${packSlug}`,
    packName: sub,
  });
}

// ── Authors ─────────────────────────────────────────────────────────

const AUTHORS = [
  { id: 'jheriko',  name: 'Jheriko' },
  { id: 'tuggummi', name: 'Tuggummi' },
  { id: 'various',  name: 'Various Artists' },
];

// ── Main ────────────────────────────────────────────────────────────

const packs = [];
const presets = [];
const seenPackIds = new Set();
let presetCounter = 0;

for (const entry of SOURCE_MAP) {
  const srcDir = entry.sub
    ? join(AVS_ROOT, entry.dir, entry.sub)
    : join(AVS_ROOT, entry.dir);

  // Check directory exists
  try {
    await stat(srcDir);
  } catch {
    console.warn(`SKIP: ${srcDir} not found`);
    continue;
  }

  // Register pack (deduplicate)
  if (!seenPackIds.has(entry.packId)) {
    seenPackIds.add(entry.packId);
    packs.push({ id: entry.packId, name: entry.packName, authorId: entry.authorId });
  }

  // Determine output directory
  const packSlug = entry.packId.replace(`${entry.authorId}-`, '');
  const outDir = join(OUT_PRESETS, entry.authorId, packSlug);
  await mkdir(outDir, { recursive: true });

  // List .avs files
  let files;
  try {
    files = (await readdir(srcDir)).filter(f => f.toLowerCase().endsWith('.avs'));
  } catch {
    console.warn(`SKIP: cannot read ${srcDir}`);
    continue;
  }

  for (const file of files.sort()) {
    const sanitisedName = sanitise(basename(file, extname(file))) + '.avs';
    const outPath = join(outDir, sanitisedName);
    const relPath = join(entry.authorId, packSlug, sanitisedName).replace(/\\/g, '/');

    // Copy file
    try {
      await copyFile(join(srcDir, file), outPath);
    } catch (e) {
      console.warn(`COPY FAIL: ${file} → ${outPath}: ${e.message}`);
      continue;
    }

    // Check if this preset already exists (for multi-pack membership)
    const existing = presets.find(p => p.file === relPath);
    if (existing) {
      if (!existing.packIds.includes(entry.packId)) {
        existing.packIds.push(entry.packId);
      }
      continue;
    }

    // Also check if same sanitised name exists under a different pack for same author
    // (for Winamp Picks containing presets from known authors)
    const title = cleanTitle(file);
    presetCounter++;

    presets.push({
      id: `${entry.packId}-${String(presetCounter).padStart(4, '0')}`,
      title,
      authorId: entry.authorId,
      packIds: [entry.packId],
      file: relPath,
    });
  }
}

// ── Detect Winamp Picks presets that belong to known authors ─────────

for (const preset of presets) {
  if (preset.packIds.includes('winamp-5-picks')) {
    const lowerTitle = preset.title.toLowerCase();
    const lowerFile = preset.file.toLowerCase();
    // Check if title suggests a known author
    if (lowerFile.includes('tuggummi') || lowerTitle.startsWith('tuggummi')) {
      // Don't change authorId — leave in "various" for Winamp Picks
      // The pack membership already handles discoverability
    }
  }
}

// ── Sort presets by title ───────────────────────────────────────────

presets.sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));

// ── Generate catalog.js ─────────────────────────────────────────────

const catalogSource = `// Auto-generated by scripts/build-preset-catalog.mjs — do not edit manually
// Generated: ${new Date().toISOString()}
// Total: ${presets.length} presets, ${packs.length} packs, ${AUTHORS.length} authors

export const authors = ${JSON.stringify(AUTHORS, null, 2)};

export const packs = ${JSON.stringify(packs, null, 2)};

export const presets = ${JSON.stringify(presets, null, 2)};
`;

await mkdir('js/preset-library', { recursive: true });
await writeFile(OUT_CATALOG, catalogSource, 'utf-8');

// ── Summary ─────────────────────────────────────────────────────────

const byAuthor = {};
for (const p of presets) {
  byAuthor[p.authorId] = (byAuthor[p.authorId] || 0) + 1;
}

console.log(`\n✓ Preset catalog built successfully`);
console.log(`  ${presets.length} presets across ${packs.length} packs`);
for (const [author, count] of Object.entries(byAuthor)) {
  console.log(`  ${author}: ${count}`);
}
console.log(`  Output: ${OUT_CATALOG}`);
console.log(`  Assets: ${OUT_PRESETS}/`);
