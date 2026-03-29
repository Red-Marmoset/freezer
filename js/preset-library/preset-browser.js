/**
 * preset-browser.js
 *
 * Preset library browser UI: search, browse by author/pack/group, load on click.
 * Virtualised preset list for smooth scrolling with 3700+ presets.
 */

import { authors, packs, groups, presets } from './catalog.js';

// ── Lookups (fast, one pass each) ──────────────────────────────────

const authorById = Object.fromEntries(authors.map(a => [a.id, a]));
const packById = Object.fromEntries(packs.map(p => [p.id, p]));

const authorPresetCount = {};
const packPresetCount = {};
for (const p of presets) {
  authorPresetCount[p.authorId || '_unknown'] = (authorPresetCount[p.authorId || '_unknown'] || 0) + 1;
  for (const pid of p.packIds) packPresetCount[pid] = (packPresetCount[pid] || 0) + 1;
}

// ── State ───────────────────────────────────────────────────────────

let currentView = 'authors';
let filterAuthorId = null;
let filterPackId = null;
let filterGroupId = null;
let searchQuery = '';
let activePresetId = null;
let loadPresetCallback = null;

// Lazy search index — built on first search
let searchIndex = null;
function ensureSearchIndex() {
  if (searchIndex) return;
  searchIndex = presets.map(p => {
    const a = authorById[p.authorId]?.name || '';
    const pk = p.packIds.map(pid => packById[pid]?.name || '').join(' ');
    return `${p.title} ${a} ${pk}`.toLowerCase();
  });
}

// Cached filtered results
let _cachedFilter = null;
let _cacheKey = '';

function getCacheKey() {
  return `${searchQuery}|${filterAuthorId}|${filterPackId}|${filterGroupId}`;
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

// ── Virtual scroll constants ────────────────────────────────────────

const ROW_HEIGHT = 42; // px per preset row
const OVERSCAN = 8;    // extra rows above/below viewport

// ── Public API ──────────────────────────────────────────────────────

export function initPresetBrowser(loadCb) {
  loadPresetCallback = loadCb;
  backdrop.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  tabBtns.forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  searchInput.addEventListener('input', onSearchInput);
  modal.addEventListener('keydown', onKeydown);
  presetList.addEventListener('scroll', onPresetScroll);
  renderSidebar();
  renderPresetList();
}

export function open() { modal.classList.remove('hidden'); searchInput.focus(); }
export function close() { modal.classList.add('hidden'); }
export function isOpen() { return !modal.classList.contains('hidden'); }

export async function loadPresetById(id) {
  const preset = presets.find(p => p.id === id);
  if (!preset) return false;
  await loadPreset(preset);
  return true;
}

export function findPresetId(name) {
  if (!name) return null;
  const lower = name.toLowerCase().replace(/\.avs$/i, '');
  const match = presets.find(p => p.title.toLowerCase() === lower);
  return match ? match.id : null;
}

// ── View switching ──────────────────────────────────────────────────

function switchView(view) {
  currentView = view;
  filterAuthorId = null;
  filterPackId = null;
  filterGroupId = null;
  tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  renderSidebar();
  invalidateCache();
  renderPresetList();
  updateBreadcrumb();
}

// ── Search ──────────────────────────────────────────────────────────

let searchTimeout = null;
function onSearchInput() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    searchQuery = searchInput.value.trim().toLowerCase();
    invalidateCache();
    renderPresetList();
  }, 150);
}

// ── Keyboard ────────────────────────────────────────────────────────

function onKeydown(e) {
  if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
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

  // "All" item
  const allItem = makeNavItem('All Presets', presets.length, () => {
    filterAuthorId = null; filterPackId = null; filterGroupId = null;
    renderSidebar(); invalidateCache(); renderPresetList(); updateBreadcrumb();
  });
  allItem.classList.add('lib-nav-all');
  if (!filterAuthorId && !filterPackId && !filterGroupId) allItem.classList.add('active');
  navTree.appendChild(allItem);

  if (currentView === 'authors') {
    renderAuthorsSidebar();
  } else if (currentView === 'groups') {
    renderGroupsSidebar();
  } else {
    renderPacksSidebar();
  }
}

function renderAuthorsSidebar() {
  const sorted = [...authors].sort((a, b) => (authorPresetCount[b.id] || 0) - (authorPresetCount[a.id] || 0));
  for (const author of sorted) {
    const count = authorPresetCount[author.id] || 0;
    if (count === 0) continue;
    const item = makeNavItem(author.name, count, () => {
      filterAuthorId = author.id; filterPackId = null; filterGroupId = null;
      renderSidebar(); invalidateCache(); renderPresetList(); updateBreadcrumb();
    });
    if (filterAuthorId === author.id && !filterPackId) item.classList.add('active');
    navTree.appendChild(item);

    // Sub-packs when author selected
    if (filterAuthorId === author.id) {
      const authorPacks = packs.filter(p => p.authorId === author.id);
      if (authorPacks.length > 1) {
        for (const pack of authorPacks) {
          const pCount = packPresetCount[pack.id] || 0;
          const packItem = makeNavItem(pack.name, pCount, () => {
            filterPackId = pack.id;
            renderSidebar(); invalidateCache(); renderPresetList(); updateBreadcrumb();
          });
          packItem.classList.add('lib-nav-sub');
          if (filterPackId === pack.id) packItem.classList.add('active');
          navTree.appendChild(packItem);
        }
      }
    }
  }
}

function renderGroupsSidebar() {
  for (const group of groups) {
    const gCount = group.packIds.reduce((sum, pid) => sum + (packPresetCount[pid] || 0), 0);
    const item = makeNavItem(group.name, gCount, () => {
      filterGroupId = group.id; filterPackId = null; filterAuthorId = null;
      renderSidebar(); invalidateCache(); renderPresetList(); updateBreadcrumb();
    });
    if (filterGroupId === group.id && !filterPackId) item.classList.add('active');
    navTree.appendChild(item);

    // Sub-packs when group selected
    if (filterGroupId === group.id) {
      for (const pid of group.packIds) {
        const pack = packById[pid];
        if (!pack) continue;
        const pCount = packPresetCount[pid] || 0;
        const packItem = makeNavItem(pack.name, pCount, () => {
          filterPackId = pid;
          renderSidebar(); invalidateCache(); renderPresetList(); updateBreadcrumb();
        });
        packItem.classList.add('lib-nav-sub');
        if (filterPackId === pid) packItem.classList.add('active');
        navTree.appendChild(packItem);
      }
    }
  }
}

function renderPacksSidebar() {
  const sorted = [...packs].sort((a, b) => a.name.localeCompare(b.name));
  for (const pack of sorted) {
    const count = packPresetCount[pack.id] || 0;
    const item = makeNavItem(pack.name, count, () => {
      filterPackId = pack.id; filterAuthorId = null; filterGroupId = null;
      renderSidebar(); invalidateCache(); renderPresetList(); updateBreadcrumb();
    });
    if (filterPackId === pack.id) item.classList.add('active');
    navTree.appendChild(item);
  }
}

function makeNavItem(label, count, onClick) {
  const el = document.createElement('div');
  el.className = 'lib-nav-item';
  el.innerHTML = `<span class="lib-nav-name">${esc(label)}</span><span class="lib-nav-count">${count}</span>`;
  el.addEventListener('click', onClick);
  return el;
}

// ── Virtualised preset list ─────────────────────────────────────────

let _vScrollHeight = null;
let _vFiltered = [];

function renderPresetList() {
  _vFiltered = getFilteredPresets();
  resultCount.textContent = `${_vFiltered.length} preset${_vFiltered.length !== 1 ? 's' : ''}`;

  // Set total scrollable height
  const totalHeight = _vFiltered.length * ROW_HEIGHT;
  if (!_vScrollHeight) {
    _vScrollHeight = document.createElement('div');
    _vScrollHeight.className = 'lib-vscroll-spacer';
    presetList.appendChild(_vScrollHeight);
  }
  _vScrollHeight.style.height = totalHeight + 'px';

  renderVisibleRows();
}

function onPresetScroll() {
  renderVisibleRows();
}

function renderVisibleRows() {
  // Remove old rows (keep spacer)
  presetList.querySelectorAll('.lib-preset-row').forEach(el => el.remove());

  const scrollTop = presetList.scrollTop;
  const viewHeight = presetList.clientHeight;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(_vFiltered.length, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + OVERSCAN);

  for (let i = startIdx; i < endIdx; i++) {
    const p = _vFiltered[i];
    const row = document.createElement('div');
    row.className = 'lib-preset-row';
    if (p.id === activePresetId) row.classList.add('active');
    row.dataset.id = p.id;
    row.style.position = 'absolute';
    row.style.top = (i * ROW_HEIGHT) + 'px';
    row.style.left = '0';
    row.style.right = '0';
    row.style.height = ROW_HEIGHT + 'px';

    const authorName = authorById[p.authorId]?.name || '';
    const packName = p.packIds.map(pid => packById[pid]?.name || '').join(', ');
    const wip = (p.packIds.includes('milkdrop') || p.packIds.includes('geiss')) ? ' \u{1F6A7}' : '';
    row.innerHTML = `<span class="lib-preset-title">${esc(p.title)}${wip}</span><span class="lib-preset-meta">${esc(authorName)} &middot; ${esc(packName)}</span>`;
    row.addEventListener('click', () => loadPreset(p));
    presetList.appendChild(row);
  }
}

// ── Filtering (cached) ─────────────────────────────────────────────

function invalidateCache() { _cacheKey = ''; _cachedFilter = null; }

function getFilteredPresets() {
  const key = getCacheKey();
  if (key === _cacheKey && _cachedFilter) return _cachedFilter;

  let result;
  if (searchQuery) {
    ensureSearchIndex();
    result = presets.filter((p, i) => searchIndex[i].includes(searchQuery));
  } else {
    result = presets;

    if (filterGroupId) {
      const group = groups.find(g => g.id === filterGroupId);
      if (group) {
        const packSet = new Set(group.packIds);
        result = result.filter(p => p.packIds.some(pid => packSet.has(pid)));
      }
    } else if (filterAuthorId) {
      result = result.filter(p => p.authorId === filterAuthorId);
    }

    if (filterPackId) {
      result = result.filter(p => p.packIds.includes(filterPackId));
    }
  }

  _cachedFilter = result;
  _cacheKey = key;
  return result;
}

// ── Breadcrumb ──────────────────────────────────────────────────────

function updateBreadcrumb() {
  const parts = ['All Presets'];
  if (filterGroupId) {
    const group = groups.find(g => g.id === filterGroupId);
    if (group) parts.push(group.name);
  } else if (filterAuthorId) {
    const author = authorById[filterAuthorId];
    if (author) parts.push(author.name);
  }
  if (filterPackId) {
    const pack = packById[filterPackId];
    if (pack) parts.push(pack.name);
  }
  breadcrumb.textContent = parts.join(' / ');
}

// ── Preset loading ──────────────────────────────────────────────────

async function loadPreset(preset) {
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
      if (loadPresetCallback) loadPresetCallback(json, null, preset.id);
    } else {
      // Binary .avs presets — pass as ArrayBuffer for parsing
      const buffer = await resp.arrayBuffer();
      if (loadPresetCallback) loadPresetCallback(buffer, preset.title + '.avs', preset.id);
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
