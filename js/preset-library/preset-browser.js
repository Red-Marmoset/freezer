/**
 * preset-browser.js
 *
 * Preset library browser UI: search, browse by author/pack, load on click.
 * Imported and initialised from ui.js.
 */

import { authors, packs, presets } from './catalog.js';

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

// Count presets per author and per pack
const authorPresetCount = {};
const packPresetCount = {};
for (const p of presets) {
  authorPresetCount[p.authorId] = (authorPresetCount[p.authorId] || 0) + 1;
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

  if (currentView === 'authors') {
    // "All" item
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

    for (const author of authors) {
      const count = authorPresetCount[author.id] || 0;
      const authorItem = makeNavItem(author.name, count, () => {
        filterAuthorId = author.id;
        filterPackId = null;
        renderSidebar();
        renderPresetList();
        updateBreadcrumb();
      });
      if (filterAuthorId === author.id && !filterPackId) authorItem.classList.add('active');
      navTree.appendChild(authorItem);

      // Sub-packs for this author
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
  } else {
    // Packs view — flat list sorted alphabetically
    const allItem = makeNavItem('All Presets', presets.length, () => {
      filterAuthorId = null;
      filterPackId = null;
      renderSidebar();
      renderPresetList();
      updateBreadcrumb();
    });
    allItem.classList.add('lib-nav-all');
    if (!filterPackId) allItem.classList.add('active');
    navTree.appendChild(allItem);

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

    const authorName = authors.find(a => a.id === p.authorId)?.name || '';
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
    result = result.filter(p => p.authorId === filterAuthorId);
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
    const author = authors.find(a => a.id === filterAuthorId);
    if (author) parts.push(author.name);
  }
  if (filterPackId) {
    const pack = packs.find(p => p.id === filterPackId);
    if (pack) parts.push(pack.name);
  }
  breadcrumb.textContent = parts.join(' / ');
}

// ── Preset loading ──────────────────────────────────────────────────

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
    const buffer = await resp.arrayBuffer();
    if (loadPresetCallback) {
      loadPresetCallback(buffer, preset.title + '.avs');
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
