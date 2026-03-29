/**
 * preset-browser.js
 *
 * Preset library browser UI: search, browse by author/pack, load on click.
 * Imported and initialised from ui.js.
 */

import { authors, packs, groups, presets } from './catalog.js';

// ── State ───────────────────────────────────────────────────────────

let currentView = 'authors';      // 'authors' | 'packs'
let filterAuthorId = null;        // null = all
let filterPackId = null;          // null = all
let searchQuery = '';
let activePresetId = null;        // currently-loaded preset id
let loadPresetCallback = null;    // set by initPresetBrowser

// Pre-built search index: one lowercase string per preset
const searchIndex = presets.map(p => {
  const authorName = authors.find(a => a.id === p.authorId)?.name || '';
  const packNames = p.packIds.map(pid => packs.find(pk => pk.id === pid)?.name || '').join(' ');
  return `${p.title} ${authorName} ${packNames}`.toLowerCase();
});

// Build author lookup
const authorById = Object.fromEntries(authors.map(a => [a.id, a]));

// Count presets per author and per pack
const authorPresetCount = {};
const packPresetCount = {};
for (const p of presets) {
  const key = p.authorId || '_unknown';
  authorPresetCount[key] = (authorPresetCount[key] || 0) + 1;
  for (const pid of p.packIds) {
    packPresetCount[pid] = (packPresetCount[pid] || 0) + 1;
  }
}

// ── DOM refs ────────────────────────────────────────────────────────

const modal = document.getElementById('preset-library');
const backdrop = modal.querySelector('.preset-lib-backdrop');
const closeBtn = document.getElementById('btn-lib-close');
const searchInput = document.getElementById('lib-search');
const resultCount = document.getElementById('lib-result-count');
const navTree = document.getElementById('lib-nav-tree');
const breadcrumb = document.getElementById('lib-breadcrumb');
const presetList = document.getElementById('lib-preset-list');
const tabBtns = modal.querySelectorAll('.lib-tab');

// ── Public API ──────────────────────────────────────────────────────

export function initPresetBrowser(loadCb) {
  loadPresetCallback = loadCb;

  // Button/tab handlers
  backdrop.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  tabBtns.forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  searchInput.addEventListener('input', onSearchInput);
  modal.addEventListener('keydown', onKeydown);

  // Initial render
  renderSidebar();
  renderPresetList();
}

export function open() {
  modal.classList.remove('hidden');
  searchInput.focus();
}

export function close() {
  modal.classList.add('hidden');
}

export function isOpen() {
  return !modal.classList.contains('hidden');
}

// ── View switching ──────────────────────────────────────────────────

function switchView(view) {
  currentView = view;
  filterAuthorId = null;
  filterPackId = null;
  tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  renderSidebar();
  renderPresetList();
  updateBreadcrumb();
}

// ── Search ──────────────────────────────────────────────────────────

let searchTimeout = null;

function onSearchInput() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    searchQuery = searchInput.value.trim().toLowerCase();
    renderPresetList();
  }, 150);
}

// ── Keyboard ────────────────────────────────────────────────────────

function onKeydown(e) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    close();
    return;
  }

  // Arrow navigation in preset list
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const rows = [...presetList.querySelectorAll('.lib-preset-row')];
    if (!rows.length) return;
    const current = presetList.querySelector('.lib-preset-row.selected');
    let idx = current ? rows.indexOf(current) : -1;
    idx = e.key === 'ArrowDown' ? Math.min(idx + 1, rows.length - 1) : Math.max(idx - 1, 0);
    rows.forEach(r => r.classList.remove('selected'));
    rows[idx].classList.add('selected');
    rows[idx].scrollIntoView({ block: 'nearest' });
  }

  if (e.key === 'Enter') {
    const sel = presetList.querySelector('.lib-preset-row.selected');
    if (sel) sel.click();
  }
}

// ── Sidebar rendering ───────────────────────────────────────────────

function renderSidebar() {
  navTree.innerHTML = '';

  // "All" item — always present
  const allItem = makeNavItem('All Presets', presets.length, () => {
    filterAuthorId = null;
    filterPackId = null;
    renderSidebar();
    renderPresetList();
    updateBreadcrumb();
  });
  allItem.classList.add('lib-nav-all');
  if (!filterAuthorId && !filterPackId) allItem.classList.add('active');
  navTree.appendChild(allItem);

  if (currentView === 'authors') {
    // Sort authors by preset count descending
    const sortedAuthors = [...authors].sort((a, b) =>
      (authorPresetCount[b.id] || 0) - (authorPresetCount[a.id] || 0)
    );

    for (const author of sortedAuthors) {
      const count = authorPresetCount[author.id] || 0;
      if (count === 0) continue;
      const authorItem = makeNavItem(author.name, count, () => {
        filterAuthorId = author.id;
        filterPackId = null;
        renderSidebar();
        renderPresetList();
        updateBreadcrumb();
      });
      if (filterAuthorId === author.id && !filterPackId) authorItem.classList.add('active');
      navTree.appendChild(authorItem);

      // Sub-packs for this author (show when author is selected)
      const authorPacks = packs.filter(p => p.authorId === author.id);
      if (filterAuthorId === author.id && authorPacks.length > 1) {
        for (const pack of authorPacks) {
          const pCount = packPresetCount[pack.id] || 0;
          const packItem = makeNavItem(pack.name, pCount, () => {
            filterAuthorId = author.id;
            filterPackId = pack.id;
            renderSidebar();
            renderPresetList();
            updateBreadcrumb();
          });
          packItem.classList.add('lib-nav-sub');
          if (filterPackId === pack.id) packItem.classList.add('active');
          navTree.appendChild(packItem);
        }
      }
    }

    // Compilation packs (no single author)
    const compilationPacks = packs.filter(p => p.authorId === null);
    if (compilationPacks.length > 0) {
      // Group separator
      const sep = document.createElement('div');
      sep.className = 'lib-nav-item';
      sep.innerHTML = '<span class="lib-nav-name" style="opacity:0.4;font-size:10px">COMPILATIONS</span>';
      navTree.appendChild(sep);

      for (const group of groups) {
        const gCount = group.packIds.reduce((sum, pid) => sum + (packPresetCount[pid] || 0), 0);
        const groupItem = makeNavItem(group.name, gCount, () => {
          filterAuthorId = `_group:${group.id}`;
          filterPackId = null;
          renderSidebar();
          renderPresetList();
          updateBreadcrumb();
        });
        if (filterAuthorId === `_group:${group.id}` && !filterPackId) groupItem.classList.add('active');
        navTree.appendChild(groupItem);

        // Show sub-packs when group is selected
        if (filterAuthorId === `_group:${group.id}`) {
          for (const pid of group.packIds) {
            const pack = packs.find(p => p.id === pid);
            if (!pack) continue;
            const pCount = packPresetCount[pid] || 0;
            const packItem = makeNavItem(pack.name, pCount, () => {
              filterAuthorId = `_group:${group.id}`;
              filterPackId = pid;
              renderSidebar();
              renderPresetList();
              updateBreadcrumb();
            });
            packItem.classList.add('lib-nav-sub');
            if (filterPackId === pid) packItem.classList.add('active');
            navTree.appendChild(packItem);
          }
        }
      }

      // Standalone compilation packs not in any group
      const groupedPackIds = new Set(groups.flatMap(g => g.packIds));
      const standalone = compilationPacks.filter(p => !groupedPackIds.has(p.id));
      for (const pack of standalone) {
        const pCount = packPresetCount[pack.id] || 0;
        const item = makeNavItem(pack.name, pCount, () => {
          filterPackId = pack.id;
          filterAuthorId = null;
          renderSidebar();
          renderPresetList();
          updateBreadcrumb();
        });
        if (filterPackId === pack.id) item.classList.add('active');
        navTree.appendChild(item);
      }
    }
  } else {
    // Packs view — flat list sorted alphabetically
    const sorted = [...packs].sort((a, b) => a.name.localeCompare(b.name));
    for (const pack of sorted) {
      const count = packPresetCount[pack.id] || 0;
      const item = makeNavItem(pack.name, count, () => {
        filterPackId = pack.id;
        filterAuthorId = null;
        renderSidebar();
        renderPresetList();
        updateBreadcrumb();
      });
      if (filterPackId === pack.id) item.classList.add('active');
      navTree.appendChild(item);
    }
  }
}

function makeNavItem(label, count, onClick) {
  const el = document.createElement('div');
  el.className = 'lib-nav-item';
  el.innerHTML = `<span class="lib-nav-name">${esc(label)}</span><span class="lib-nav-count">${count}</span>`;
  el.addEventListener('click', onClick);
  return el;
}

// ── Preset list rendering ───────────────────────────────────────────

function renderPresetList() {
  const filtered = getFilteredPresets();
  resultCount.textContent = `${filtered.length} preset${filtered.length !== 1 ? 's' : ''}`;

  presetList.innerHTML = '';
  for (const p of filtered) {
    const row = document.createElement('div');
    row.className = 'lib-preset-row';
    if (p.id === activePresetId) row.classList.add('active');
    row.dataset.id = p.id;

    const authorName = authorById[p.authorId]?.name || '';
    const packName = p.packIds.map(pid => packs.find(pk => pk.id === pid)?.name || '').join(', ');

    row.innerHTML = `<span class="lib-preset-title">${esc(p.title)}</span><span class="lib-preset-meta">${esc(authorName)} &middot; ${esc(packName)}</span>`;
    row.addEventListener('click', () => loadPreset(p));
    presetList.appendChild(row);
  }
}

function getFilteredPresets() {
  // When searching, ignore sidebar filters — search across everything
  if (searchQuery) {
    return presets.filter((p, i) => searchIndex[i].includes(searchQuery));
  }

  let result = presets;

  if (filterAuthorId) {
    if (filterAuthorId.startsWith('_group:')) {
      // Filter by group: show presets in any of the group's packs
      const groupId = filterAuthorId.slice(7);
      const group = groups.find(g => g.id === groupId);
      if (group) {
        const packSet = new Set(group.packIds);
        result = result.filter(p => p.packIds.some(pid => packSet.has(pid)));
      }
    } else {
      result = result.filter(p => p.authorId === filterAuthorId);
    }
  }

  if (filterPackId) {
    result = result.filter(p => p.packIds.includes(filterPackId));
  }

  return result;
}

// ── Breadcrumb ──────────────────────────────────────────────────────

function updateBreadcrumb() {
  const parts = ['All Presets'];
  if (filterAuthorId) {
    if (filterAuthorId.startsWith('_group:')) {
      const groupId = filterAuthorId.slice(7);
      const group = groups.find(g => g.id === groupId);
      if (group) parts.push(group.name);
    } else {
      const author = authorById[filterAuthorId];
      if (author) parts.push(author.name);
    }
  }
  if (filterPackId) {
    const pack = packs.find(p => p.id === filterPackId);
    if (pack) parts.push(pack.name);
  }
  breadcrumb.textContent = parts.join(' / ');
}

// ── Preset loading ──────────────────────────────────────────────────

/**
 * Load a preset by its catalog ID. Returns true if found and loaded.
 */
export async function loadPresetById(id) {
  const preset = presets.find(p => p.id === id);
  if (!preset) return false;
  await loadPreset(preset);
  return true;
}

/**
 * Get a preset's catalog ID by matching name against the catalog.
 * Returns the ID or null if not found.
 */
export function findPresetId(name) {
  if (!name) return null;
  const lower = name.toLowerCase().replace(/\.avs$/i, '');
  const match = presets.find(p => p.title.toLowerCase() === lower);
  return match ? match.id : null;
}

async function loadPreset(preset) {
  // Highlight in list
  presetList.querySelectorAll('.lib-preset-row').forEach(r => r.classList.remove('active'));
  const row = presetList.querySelector(`[data-id="${preset.id}"]`);
  if (row) row.classList.add('active');
  activePresetId = preset.id;

  try {
    const url = `assets/presets/${preset.file}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    if (preset.format === 'json' || preset.file.endsWith('.json')) {
      // JSON presets (MilkDrop conversions, Geiss, etc.) — load directly
      const json = await resp.json();
      if (loadPresetCallback) {
        loadPresetCallback(json, null, preset.id);
      }
    } else {
      // Binary .avs presets — pass as ArrayBuffer for parsing
      const buffer = await resp.arrayBuffer();
      if (loadPresetCallback) {
        loadPresetCallback(buffer, preset.title + '.avs', preset.id);
      }
    }
  } catch (err) {
    console.error(`Failed to load preset ${preset.title}:`, err);
  }
}

// ── Utilities ───────────────────────────────────────────────────────

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
