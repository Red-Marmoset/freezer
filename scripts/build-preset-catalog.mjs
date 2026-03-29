/**
 * build-preset-catalog.mjs
 *
 * One-time Node.js script that:
 *  1. Copies .avs files from C:\code\avs into assets/presets/{author}/{pack}/
 *  2. Sanitises every filename for web-safe URLs
 *  3. Extracts per-preset authors from filenames in compilation packs
 *  4. Generates js/preset-library/catalog.js (lightweight metadata only)
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
  '\u00b0': '0',
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

// ── Author extraction from filenames ────────────────────────────────

// Known author name variants → canonical author id
const AUTHOR_ALIASES = {
  'jheriko': 'jheriko', 'jheriko': 'jheriko',
  'tuggummi': 'tuggummi',
  'unconed': 'unconed',
  's_kupers': 'skupers', 'skupers': 'skupers', 's kupers': 'skupers',
  'el-vis': 'el-vis', 'elvis': 'el-vis',
  'pak-9': 'pak-9', 'pak9': 'pak-9',
  'raz': 'raz',
  'grandchild': 'grandchild',
  'danjoe': 'danjoe',
  'zevensoft': 'zevensoft',
  'degnic': 'degnic',
  'mig': 'mig',
  'duo': 'duo',
  'yathosho': 'yathosho',
  'mr_nudge': 'mr-nudge', 'mr nudge': 'mr-nudge',
  'hboy': 'hboy',
  'nic01': 'nic01', 'nic': 'nic01',
  'l1quid': 'l1quid',
  'd&l': 'dl',
  'p-k': 'pk',
  'justin': 'justin',
  'avsking': 'avsking', 'avs king': 'avsking',
  'pj': 'pj',
  'fck': 'fck',
  'amphirion': 'amphirion',
  'nixa': 'nixa',
  'horse-fly': 'horse-fly',
  'j.melo': 'jmelo',
  'javs': 'javs',
  'ishan': 'ishan',
  'mysterious_w': 'mysterious-w',
  'doggy dog': 'doggy-dog',
  'wotl': 'wotl',
  'akx': 'akx',
  '^..^': 'caret',
  'visbot': 'visbot',
  'splendora': 'splendora',
  'zxe': 'zxe',
  'tomylobo': 'tomylobo',
};

// Display names for canonical author ids
const AUTHOR_DISPLAY = {
  'jheriko': 'Jheriko', 'tuggummi': 'Tuggummi', 'unconed': 'UnConeD',
  'skupers': 'S_KuPeRS', 'el-vis': 'EL-VIS', 'pak-9': 'PAK-9',
  'raz': 'Raz', 'grandchild': 'Grandchild', 'danjoe': 'danjoe',
  'zevensoft': 'Zevensoft', 'degnic': 'Degnic', 'mig': 'mig',
  'duo': 'Duo', 'yathosho': 'Yathosho', 'mr-nudge': 'Mr_Nudge',
  'hboy': 'Hboy', 'nic01': 'Nic01', 'l1quid': 'L1quid',
  'dl': 'D&L', 'pk': 'p-k', 'justin': 'Justin',
  'avsking': 'avsking', 'pj': 'PJ', 'fck': 'fck',
  'amphirion': 'amphirion', 'nixa': 'nixa', 'horse-fly': 'horse-fly',
  'jmelo': 'J.Melo', 'javs': 'JaVS', 'ishan': 'Ishan',
  'mysterious-w': 'Mysterious_w', 'doggy-dog': 'Doggy Dog', 'wotl': 'WotL',
  'akx': 'AKX', 'caret': '^..^', 'visbot': 'VISBOT',
  'splendora': 'splendora', 'zxe': 'zxe',
  // New authors
  'doggy': 'Doggy', 'earthquaker': 'Earthquaker', 'deamon': 'Deamon',
  'mykal': 'mykaL', 'zamuz': 'zamuz', 'jjcl237': 'JjcL237',
  'pottsy': 'Pottsy', 'synth-c': 'Synth-C', 'qoal': 'QOAL',
  'viskey': 'VisKey', 'cat2': 'Cat \u00b2', 'fyehroq': 'Fyehroq',
  'koqlbmusic': 'KoqlbMusic', 'pir': 'piR', 'qforce': 'qforce',
  'nemoorange': 'NemoOrange', 'andy370': 'andy370', 'fsk': 'fsk',
  'me': 'M-E', 'shreyas': 'Shreyas', 'goral': 'G\u00f3ral(VHS)',
  'disso': 'Disso', 'ddrew': 'dDrew', 'megatrox': 'Megatrox',
  'noobfusion': 'NoobFusion', 'katphude': 'Katphude', 'marco': 'Marco',
  'paolo': 'Paolo', 'runar': 'Runar', 'florin': 'Florin', 'karma': 'karma',
  'denkensiefursich': 'denkensiefursich', 'hoofprints': 'Hoofprints',
  'backtrack': 'Back on Track', 'reset': 'Re-Set',
  'framesof': 'frames.of.reality', 'mztpack': 'MZTPACK',
  'track13': 'Track 13', 'uudet': 'Uudet pressut', 'microd': 'micro.D\u00b0',
  'tomylobo': 'TomyLobo',
};

/**
 * Try to extract an author from a preset filename.
 * Common patterns:
 *   "Author - Title.avs"
 *   "Author-Title.avs"
 *   "WFC1 - 08 - Jheriko - Fractal Tunnel.avs"
 *   "08 - Author - Title.avs"
 */
function extractAuthorFromFilename(filename) {
  let name = filename.replace(/\.avs$/i, '');

  // Strip WFC/FF prefixes: "WFC1 - 08 - Author - Title" → "Author - Title"
  name = name.replace(/^(?:WFC\d+|FF\s*\d+)\s*-\s*\d+\s*-\s*/i, '');
  // Strip "Original - " prefix from WFC5
  name = name.replace(/^Original\s*-\s*/i, '');
  // Strip leading track numbers: "08 - Author - Title" → "Author - Title"
  name = name.replace(/^\d+\s*-\s*/, '');

  // Try "Author - Title" pattern
  const dashMatch = name.match(/^([^-]+?)\s*-\s*/);
  if (dashMatch) {
    const candidate = dashMatch[1].trim().toLowerCase();
    // Check against known aliases
    for (const [alias, id] of Object.entries(AUTHOR_ALIASES)) {
      if (candidate === alias || candidate.replace(/[_\s]/g, '') === alias.replace(/[_\s]/g, '')) {
        return id;
      }
    }
    // If it looks like a plausible author name (short, no spaces or just one)
    if (candidate.length <= 20 && candidate.split(/\s+/).length <= 3) {
      return null; // Unknown author, don't force-assign
    }
  }
  return null;
}

// Author prefix abbreviations used in filenames
const AUTHOR_FILENAME_PREFIXES = {
  'jheriko': ['Jheriko', 'JHERiKO'],
  'tuggummi': ['Tuggummi'],
  'unconed': ['UnConeD'],
  'skupers': ['S_KuPeRS', 's_kupers', 'skupers'],
  'raz': ['Raz'],
  'pak-9': ['PAK-9', 'Pak-9'],
  'grandchild': ['GC', 'Grandchild'],
  'danjoe': ['danjoe'],
  'zevensoft': ['Zevensoft'],
  'visbot': ['VISBOT', 'Visbot'],
  'duo': ['Duo'],
  'degnic': ['Degnic'],
  'el-vis': ['EL-VIS', 'El-Vis'],
  'hboy': ['Hboy'],
  'doggy': ['Doggy', 'Marko'],
  'earthquaker': ['Earthquaker', 'Equaker'],
  'deamon': ['Deamon'],
  'mykal': ['mykaL', 'mykal'],
  'zamuz': ['zamuz'],
  'jjcl237': ['JjcL237'],
  'pottsy': ['Pottsy'],
  'cat2': ['Cat \u00b2', 'Cat,'],
  'qoal': ['QOAL'],
  'qforce': ['qforce'],
  'pir': ['piR'],
  'fsk': ['fsk'],
  'me': ['M-E'],
  'nemoorange': ['NemoOrange'],
  'goral': ['G\u00f3ral(VHS)', 'G\u00f3ral(Vhs)', 'Goral'],
  'yathosho': ['Yathosho'],
};

function cleanTitle(filename, packAuthorId) {
  let t = filename.replace(/\.avs$/i, '');

  // Strip WFC/FF prefixes
  t = t.replace(/^(?:WFC\d+|FF\s*\d+)\s*-\s*\d+\s*-\s*/i, '');
  // Strip "Original - " prefix from WFC5
  t = t.replace(/^Original\s*-\s*/i, '');
  // Strip leading track numbers like "3-01 - " or "02 - "
  t = t.replace(/^\d+-?\d*\s*-\s*/, '');

  // If pack has a known single author, strip their name prefix
  if (packAuthorId) {
    const prefixes = AUTHOR_FILENAME_PREFIXES[packAuthorId] || [];
    const displayName = AUTHOR_DISPLAY[packAuthorId];
    if (displayName) prefixes.push(displayName);
    for (const p of new Set(prefixes)) {
      const re = new RegExp(`^${escapeRegex(p)}\\s*-\\s*`, 'i');
      t = t.replace(re, '');
    }
  }

  return t.trim() || filename.replace(/\.avs$/i, '');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Source mapping ──────────────────────────────────────────────────

const SOURCE_MAP = [];

function addPack(dir, authorId, packId, packName, sub) {
  SOURCE_MAP.push({ dir, authorId, packId, packName, sub, isCompilation: false });
}

function addCompilation(dir, packId, packName, sub) {
  SOURCE_MAP.push({ dir, authorId: null, packId, packName, sub, isCompilation: true });
}

// ── Jheriko packs ───────────────────────────────────────────────────
addPack('Jheriko', 'jheriko', 'jheriko-j10', 'J10', 'J\u00b9\u00ba');
addPack('Jheriko - HiRes', 'jheriko', 'jheriko-hires', 'HiRes');
addPack('Jheriko - J7', 'jheriko', 'jheriko-j7', 'J7');
addPack('Jheriko - Pack 9', 'jheriko', 'jheriko-pack-9', 'Pack 9');
addPack('JHERiKO - Pack II - The Geometry of Light', 'jheriko', 'jheriko-pack-ii', 'Pack II - The Geometry of Light');
addPack('JHERiKO - Pack III - Redemption', 'jheriko', 'jheriko-pack-iii', 'Pack III - Redemption');
addPack('JHERiKO - Pack IV - Clarity of Vision', 'jheriko', 'jheriko-pack-iv', 'Pack IV - Clarity of Vision');
addPack('JHERiKO - Purely Platonic Minipack', 'jheriko', 'jheriko-purely-platonic', 'Purely Platonic Minipack');
addPack('JHERiKO - RePack 1 - The Atonement', 'jheriko', 'jheriko-repack-1', 'RePack 1 - The Atonement');

// ── Tuggummi packs ──────────────────────────────────────────────────
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
  addPack('Tuggummi', 'tuggummi', `tuggummi-${sanitise(sub)}`, sub, sub);
}

// ── UnConeD packs ───────────────────────────────────────────────────
addPack('UnConeD', 'unconed', 'unconed-final-whack', 'Final Whack', 'Final Whack - UnConeD');
addPack('UnConeD', 'unconed', 'unconed-whacko-i', 'Whacko AVS', 'Whacko AVS pack');
addPack('UnConeD', 'unconed', 'unconed-whacko-ii', 'Whacko AVS II', 'Whacko AVS II');
addPack('UnConeD', 'unconed', 'unconed-whacko-iii', 'Whacko AVS III', 'Whacko AVS III');
addPack('UnConeD', 'unconed', 'unconed-whacko-iv', 'Whacko AVS IV', 'Whacko AVS IV');
addPack('UnConeD', 'unconed', 'unconed-whacko-v', 'Whacko AVS V', 'Whacko AVS V');
addPack('UnConeD', 'unconed', 'unconed-whacko-vi', 'Whacko AVS VI', 'Whacko AVS VI');
addPack('UnConeD', 'unconed', 'unconed-whacko-revisited', 'Whacko Revisited', 'Whacko Revisited');

// ── S_KuPeRS packs ─────────────────────────────────────────────────
addPack('S_KuPeRS - LP7 - Viima', 'skupers', 'skupers-lp7-viima', 'LP7 - Viima');
addPack('s_kupers - lp8 - ætherius', 'skupers', 'skupers-lp8-aetherius', 'LP8 - Aetherius');

// ── Raz packs ───────────────────────────────────────────────────────
addPack('Raz - One', 'raz', 'raz-one', 'One');
addPack('Raz - Two', 'raz', 'raz-two', 'Two');
addPack('Raz - Three', 'raz', 'raz-three', 'Three');
addPack('Raz - Four', 'raz', 'raz-four', 'Four');

// ── PAK-9 packs ─────────────────────────────────────────────────────
addPack('PAK-9 AVS 4 SE', 'pak-9', 'pak-9-avs-4-se', 'AVS 4 SE');
addPack('PAK-9 AVS 5', 'pak-9', 'pak-9-avs-5', 'AVS 5');

// ── Grandchild ──────────────────────────────────────────────────────
addPack('Grandchild', 'grandchild', 'grandchild-vis-comica', 'Vis Comica', '3 - Vis Comica');
addPack('Grandchild', 'grandchild', 'grandchild-cambodia', 'Cambodia', 'MP02 - Cambodia');
addPack('Grandchild', 'grandchild', 'grandchild-pee-by-the-tree', 'Pee by the Tree', 'MP03 - pee by the tree');

// ── danjoe ──────────────────────────────────────────────────────────
addPack('danjoe - ONE', 'danjoe', 'danjoe-one', 'ONE');

// ── Zevensoft packs ─────────────────────────────────────────────────
addPack('Zevensoft 1', 'zevensoft', 'zevensoft-1', 'Pack 1');
addPack('Zevensoft_AVSPack2', 'zevensoft', 'zevensoft-2', 'Pack 2');
addPack('Zevensoft_AVSPack3', 'zevensoft', 'zevensoft-3', 'Pack 3');
addPack('Zevensoft_AVSPack4', 'zevensoft', 'zevensoft-4', 'Pack 4');

// ── VISBOT packs ────────────────────────────────────────────────────
addPack('VISBOT', 'visbot', 'visbot-x', 'VISBOT X', 'VC010 VISBOT X');
addPack('VISBOT', 'visbot', 'visbot-nps-vol4', 'New People Selection Vol 4', 'VISBOT New People Selection Vol 4');
addPack('VISBOT', 'visbot', 'visbot-refocused', 'Refocused', 'VISBOT Refocused');

// ── Dynamic Duo ─────────────────────────────────────────────────────
addPack('Dynamic Duo', 'duo', 'dynamic-duo', 'Dynamic Duo');

// ── Finnish Flash (compilations — per-preset author extraction) ─────
addCompilation('Finnish Flash 6', 'finnish-flash-6', 'Finnish Flash 6');
addCompilation('Finnish Flash 7', 'finnish-flash-7', 'Finnish Flash 7');
addCompilation('Finnish Flash 8', 'finnish-flash-8', 'Finnish Flash 8');

// ── Winamp Picks (compilation) ──────────────────────────────────────
addCompilation('Winamp 5 Picks', 'winamp-5-picks', 'Winamp 5 Picks');

// ── Winamp Forums Compilations ──────────────────────────────────────
addCompilation('Winamp Forums Compilation 1', 'wfc-1', 'Winamp Forums Compilation 1');
addCompilation('Winamp Forums Compilation 2', 'wfc-2', 'Winamp Forums Compilation 2');
addCompilation('Winamp Forums Compilation 3', 'wfc-3', 'Winamp Forums Compilation 3');
addCompilation('Winamp Forums Compilation 4', 'wfc-4', 'Winamp Forums Compilation 4');
addCompilation('Winamp Forums', 'wfc-5', 'Winamp Forums Compilation 5', 'Winamp Forums Compilation 5');
addCompilation('Winamp Forums Compilation 6', 'wfc-6', 'Winamp Forums Compilation 6');

// ── Grandchild (additional packs) ───────────────────────────────────
addPack('But how you\'ve grown', 'grandchild', 'grandchild-but-how-youve-grown', 'But How You\'ve Grown');
addPack('I\'ve known you since you were SO little!!!', 'grandchild', 'grandchild-ive-known-you', 'I\'ve Known You Since You Were So Little');

// ── Hboy packs ──────────────────────────────────────────────────────
addPack('Hboy', 'hboy', 'hboy-reminiscence', 'Reminiscence', 'Reminiscence');
addPack('Hboy', 'hboy', 'hboy-technology', 'Technology', 'Technology');
addPack('Hboy', 'hboy', 'hboy-mindscapes', 'Mindscapes', 'mindscapes');
addPack('Hboy', 'hboy', 'hboy-visualove', 'Visualove', 'visualove');

// ── Doggy (Marko's Preset Packs) ────────────────────────────────────
addPack('Doggy', 'doggy', 'doggy-3d-scope-3', '3D Scope 3 Minipack', '3d Scope 3 Minipack');
addPack('Doggy', 'doggy', 'doggy-pack-1', 'Marko\'s Preset Pack', 'Marko\'s Preset Pack');
addPack('Doggy', 'doggy', 'doggy-pack-2', 'Marko\'s Preset Pack 2', 'Marko\'s Preset Pack 2');
addPack('Doggy', 'doggy', 'doggy-pack-3', 'Marko\'s Preset Pack 3', 'Marko\'s Preset Pack 3');
addPack('Doggy', 'doggy', 'doggy-pack-4', 'Marko\'s Preset Pack 4', 'Marko\'s Preset Pack 4');
addPack('Doggy', 'doggy', 'doggy-pack-5-rmx', 'Marko\'s Preset Pack 5 - RMX', 'Marko\'s Preset Pack 5 - RMX');

// ── Mr_Nudge ────────────────────────────────────────────────────────
addPack('Mr_Nudge Volume 8', 'mr-nudge', 'mr-nudge-vol-8', 'Volume 8');
addPack('Mr_Nudge Volume 9', 'mr-nudge', 'mr-nudge-vol-9', 'Volume 9');

// ── Earthquaker ─────────────────────────────────────────────────────
addPack('Earthquaker', 'earthquaker', 'earthquaker-main', 'Earthquaker');
addPack('Earthquaker', 'earthquaker', 'earthquaker-chromatic', 'Chromatic', 'Chromatic');
addPack('Earthquaker', 'earthquaker', 'earthquaker-history', 'History of the House', 'History of the House');

// ── Deamon ──────────────────────────────────────────────────────────
addPack('Deamon - HyperNation', 'deamon', 'deamon-hypernation', 'HyperNation');

// ── amphirion ───────────────────────────────────────────────────────
addPack('incipience iii', 'amphirion', 'amphirion-incipience-iii', 'Incipience III');

// ── mykaL ───────────────────────────────────────────────────────────
addPack('mykaL  05 opus IV', 'mykal', 'mykal-opus-iv', 'Opus IV');

// ── zamuz ───────────────────────────────────────────────────────────
addPack('zamuz - remix collection', 'zamuz', 'zamuz-remix-collection', 'Remix Collection');

// ── JjcL237 ─────────────────────────────────────────────────────────
addPack('JjcL237 - Coloring2', 'jjcl237', 'jjcl237-coloring2', 'Coloring 2');

// ── Pottsy ──────────────────────────────────────────────────────────
addPack('Pottsy - Sceptre', 'pottsy', 'pottsy-sceptre', 'Sceptre');
addPack('Pottsy - Heretics Anonymous', 'pottsy', 'pottsy-heretics-anonymous', 'Heretics Anonymous');

// ── denkensiefursich ────────────────────────────────────────────────
addPack('denkensiefursich', 'denkensiefursich', 'denkensiefursich-main', 'denkensiefursich');

// ── M-E ─────────────────────────────────────────────────────────────
addPack('BEHOLD', 'me', 'me-behold', 'BEHOLD');

// ── fsk / Pickin dim ────────────────────────────────────────────────
addPack('Pickin dim 3', 'fsk', 'fsk-pickin-dim-3', 'Pickin dim 3');

// ── Cat ² ───────────────────────────────────────────────────────────
addPack('Cat \u00b2 - Deviant', 'cat2', 'cat2-deviant', 'Deviant');

// ── Synth-C ─────────────────────────────────────────────────────────
addPack('Synth-C', 'synth-c', 'synth-c-main', 'Synth-C');

// ── QOAL ────────────────────────────────────────────────────────────
addPack('QOAL', 'qoal', 'qoal-main', 'QOAL');

// ── VisKey ──────────────────────────────────────────────────────────
addPack('VisKey_Pack 4', 'viskey', 'viskey-pack-4', 'Pack 4');

// ── Hoofprints ──────────────────────────────────────────────────────
addPack('Hoofprints', 'hoofprints', 'hoofprints-main', 'Hoofprints');

// ── Fyehroq ─────────────────────────────────────────────────────────
addPack('Fyehroq\'s Fugue', 'fyehroq', 'fyehroq-fugue', 'Fyehroq\'s Fugue');

// ── Back on track ───────────────────────────────────────────────────
addPack('Back on track', 'backtrack', 'backtrack-main', 'Back on Track');

// ── Re-Set ──────────────────────────────────────────────────────────
addPack('Re-Set', 'reset', 'reset-main', 'Re-Set');

// ── KoqlbMusic ──────────────────────────────────────────────────────
addPack('KoqlbMusic-Version2', 'koqlbmusic', 'koqlbmusic-v2', 'Version 2');

// ── The Snail Remixes ───────────────────────────────────────────────
addCompilation('The Snail Remixes', 'snail-remixes', 'The Snail Remixes');

// ── frames.of.reality ───────────────────────────────────────────────
addPack('frames.of.reality', 'framesof', 'framesof-main', 'frames.of.reality');
addPack('framesofreality vs. duo - reVISIONed', 'framesof', 'framesof-revisioned', 'reVISIONed');

// ── piR ─────────────────────────────────────────────────────────────
addPack('pir', 'pir', 'pir-main', 'piR');

// ── qforce ──────────────────────────────────────────────────────────
addPack('qforce - quake avs', 'qforce', 'qforce-quake-avs', 'Quake AVS');

// ── Yathosho / whyEye.org ───────────────────────────────────────────
addPack('whyEye.org', 'yathosho', 'yathosho-whyeye-remixes', 'whyEye.org Remixes');
addPack('whyEye.org einzelst\u00fccke', 'yathosho', 'yathosho-whyeye-originals', 'whyEye.org Originals');

// ── MZTPACK ─────────────────────────────────────────────────────────
addPack('MZTPACK.5', 'mztpack', 'mztpack-5', 'MZTPACK 5');

// ── NemoOrange ──────────────────────────────────────────────────────
addPack('NemoOrange', 'nemoorange', 'nemoorange-main', 'NemoOrange');

// ── andy370 ─────────────────────────────────────────────────────────
addPack('andy370', 'andy370', 'andy370-main', 'andy370');

// ── drew and megatrox ───────────────────────────────────────────────
addCompilation('drew and megatrox', 'drew-megatrox', 'drew and megatrox');

// ── les Noobiens ────────────────────────────────────────────────────
addCompilation('les Noobiens', 'les-noobiens', 'les Noobiens DIY', 'les Noobiens DIY');

// ── TomyLobo ────────────────────────────────────────────────────────
// Preset from DeviantArt, not in C:\code\avs — manually placed in assets
// addPack handled manually; the file is already in assets/presets/tomylobo/

// ── Track 13 ────────────────────────────────────────────────────────
addPack('Track 13', 'track13', 'track13-main', 'Track 13');

// ── Uudet pressut 2022 ─────────────────────────────────────────────
addPack('Uudet pressut 2022', 'uudet', 'uudet-2022', 'Uudet pressut 2022');

// ── micro.D° ────────────────────────────────────────────────────────
addPack('micro.D\u00b0', 'microd', 'microd-main', 'micro.D\u00b0');

// ── Extra Chunky ────────────────────────────────────────────────────
addCompilation('Extra Chunky', 'extra-chunky', 'Extra Chunky');

// ── WF Tournament (compilation) ─────────────────────────────────────
addCompilation('WF Tournament', 'wf-tournament-1', 'WF Tournament 1', 'Tournament 1');
addCompilation('WF Tournament', 'wf-tournament-2', 'WF Tournament 2', 'Tournament 2');

// ── TV compilations ─────────────────────────────────────────────────
addCompilation('Tv 12', 'tv-12', 'TV 12');
addCompilation('TV 13', 'tv-13', 'TV 13');

// ── Community Picks ─────────────────────────────────────────────────
addCompilation('Community Picks', 'community-picks', 'Community Picks');

// ── Ultimate Favorites ──────────────────────────────────────────────
addCompilation('Ultimate Favorites', 'ultimate-favorites', 'Ultimate Favorites');

// ── Birthday Pack 2 ─────────────────────────────────────────────────
addCompilation('Birthday Pack 2', 'birthday-pack-2', 'Birthday Pack 2');

// ── IRTOPRESSUT (large Finnish compilation with sub-packs) ──────────
addCompilation('IRTOPRESSUT', 'irtopressut-main', 'IRTOPRESSUT');
// Sub-packs
const IRTO_SUBS = [
  'ASD5A', 'DeviantART AVS Presets', 'dudepack', 'Earthquake Pack 1 initial release',
  'emanations', 'Flash', 'Florin', 'giko', 'Illusion', 'karma',
  'Katphude - The first you will never see', 'Metabot v.1', 'noobfusion',
  'pak-9 convo kernels', 'Paolo', 'QOAL - Inflamed Sickness', 'Sonique Ex',
  'Tuggummi - 21 Re-n00b', 'USGroup1', 'WotL - The Worst Of The Worst',
];
for (const sub of IRTO_SUBS) {
  addCompilation('IRTOPRESSUT', `irtopressut-${sanitise(sub)}`, sub, sub);
}

// ── Group IDs for compilations/series ───────────────────────────────
const GROUPS = [
  { id: 'winamp-forums', name: 'Winamp Forums', packIds: ['wfc-1', 'wfc-2', 'wfc-3', 'wfc-4', 'wfc-5', 'wfc-6'] },
  { id: 'finnish-flash', name: 'Finnish Flash', packIds: ['finnish-flash-6', 'finnish-flash-7', 'finnish-flash-8'] },
  { id: 'wf-tournament', name: 'WF Tournament', packIds: ['wf-tournament-1', 'wf-tournament-2'] },
  { id: 'tv-series', name: 'TV Series', packIds: ['tv-12', 'tv-13'] },
  { id: 'irtopressut', name: 'IRTOPRESSUT', packIds: [
    'irtopressut-main', ...IRTO_SUBS.map(s => `irtopressut-${sanitise(s)}`)
  ]},
];

// ── Helpers ─────────────────────────────────────────────────────────

async function findAvsFiles(dir) {
  const results = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...await findAvsFiles(full));
    } else if (e.name.toLowerCase().endsWith('.avs')) {
      results.push(full);
    }
  }
  return results;
}

// ── Main ────────────────────────────────────────────────────────────

const authorsMap = new Map(); // id → { id, name }
const packsArr = [];
const presets = [];
const seenPackIds = new Set();
let presetCounter = 0;

function ensureAuthor(id) {
  if (!authorsMap.has(id)) {
    authorsMap.set(id, { id, name: AUTHOR_DISPLAY[id] || id });
  }
}

for (const entry of SOURCE_MAP) {
  const srcDir = entry.sub
    ? join(AVS_ROOT, entry.dir, entry.sub)
    : join(AVS_ROOT, entry.dir);

  try {
    await stat(srcDir);
  } catch {
    console.warn(`SKIP: ${srcDir} not found`);
    continue;
  }

  // Register pack
  if (!seenPackIds.has(entry.packId)) {
    seenPackIds.add(entry.packId);
    packsArr.push({
      id: entry.packId,
      name: entry.packName,
      authorId: entry.authorId,   // null for compilations
    });
  }

  // Register pack author
  if (entry.authorId) {
    ensureAuthor(entry.authorId);
  }

  // Determine output directory
  const outBase = entry.authorId || 'compilations';
  const packSlug = entry.packId;
  const outDir = join(OUT_PRESETS, outBase, packSlug);
  await mkdir(outDir, { recursive: true });

  // List .avs files (recursively to handle nested Round dirs, etc.)
  let files;
  try {
    files = await findAvsFiles(srcDir);
  } catch {
    console.warn(`SKIP: cannot read ${srcDir}`);
    continue;
  }

  for (const filePath of files.sort()) {
    const file = basename(filePath);
    const sanitisedName = sanitise(basename(file, extname(file))) + '.avs';
    const outPath = join(outDir, sanitisedName);
    const relPath = join(outBase, packSlug, sanitisedName).replace(/\\/g, '/');

    // Copy file
    try {
      await copyFile(filePath, outPath);
    } catch (e) {
      console.warn(`COPY FAIL: ${file} → ${outPath}: ${e.message}`);
      continue;
    }

    // Check for duplicate file path
    const existing = presets.find(p => p.file === relPath);
    if (existing) {
      if (!existing.packIds.includes(entry.packId)) {
        existing.packIds.push(entry.packId);
      }
      continue;
    }

    // Determine per-preset author
    let presetAuthorId = entry.authorId;
    if (entry.isCompilation) {
      presetAuthorId = extractAuthorFromFilename(file);
      if (presetAuthorId) {
        ensureAuthor(presetAuthorId);
      }
    }

    const title = cleanTitle(file, entry.authorId);
    presetCounter++;

    presets.push({
      id: `${entry.packId}-${String(presetCounter).padStart(4, '0')}`,
      title,
      authorId: presetAuthorId || null,
      packIds: [entry.packId],
      file: relPath,
    });
  }
}

// ── Manual presets (not in C:\code\avs) ─────────────────────────────
// These are presets sourced individually (e.g. DeviantArt downloads)
// Their files must be pre-placed in assets/presets/ before running this script.

const MANUAL_PRESETS = [
  {
    title: 'Home of the Dragons - Optimized',
    authorId: 'tomylobo',
    packId: 'tomylobo-main',
    packName: 'TomyLobo',
    file: 'tomylobo/tomylobo-main/tomylobo-home-of-the-dragons-optimized.avs',
  },
];

for (const mp of MANUAL_PRESETS) {
  ensureAuthor(mp.authorId);
  if (!seenPackIds.has(mp.packId)) {
    seenPackIds.add(mp.packId);
    packsArr.push({ id: mp.packId, name: mp.packName, authorId: mp.authorId });
  }
  presetCounter++;
  presets.push({
    id: `${mp.packId}-${String(presetCounter).padStart(4, '0')}`,
    title: mp.title,
    authorId: mp.authorId,
    packIds: [mp.packId],
    file: mp.file,
  });
}

// ── Sort presets by title ───────────────────────────────────────────

presets.sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));

// ── Build final authors array ───────────────────────────────────────

const authorsArr = [...authorsMap.values()].sort((a, b) => a.name.localeCompare(b.name));

// ── Generate catalog.js ─────────────────────────────────────────────

const catalogSource = `// Auto-generated by scripts/build-preset-catalog.mjs — do not edit manually
// Generated: ${new Date().toISOString()}
// Total: ${presets.length} presets, ${packsArr.length} packs, ${authorsArr.length} authors

export const authors = ${JSON.stringify(authorsArr, null, 2)};

export const packs = ${JSON.stringify(packsArr, null, 2)};

export const groups = ${JSON.stringify(GROUPS, null, 2)};

export const presets = ${JSON.stringify(presets, null, 2)};
`;

await mkdir('js/preset-library', { recursive: true });
await writeFile(OUT_CATALOG, catalogSource, 'utf-8');

// ── Summary ─────────────────────────────────────────────────────────

const byAuthor = {};
for (const p of presets) {
  const key = p.authorId || '(unknown)';
  byAuthor[key] = (byAuthor[key] || 0) + 1;
}

console.log(`\n✓ Preset catalog built successfully`);
console.log(`  ${presets.length} presets across ${packsArr.length} packs by ${authorsArr.length} authors`);
for (const [author, count] of Object.entries(byAuthor).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${author}: ${count}`);
}
console.log(`  Output: ${OUT_CATALOG}`);
console.log(`  Assets: ${OUT_PRESETS}/`);
