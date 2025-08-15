/* ===========================
   Robust app.js (with hikes.ls / hikes.json fallback)
   =========================== */

// ----- Local storage keys -----
const LS_HIKES   = 'pyrenees_hikes';
const LS_ACCOM   = 'pyrenees_accommodations';
const LS_ATTR    = 'pyrenees_attractions';
const LS_HERO    = 'pyrenees_hero_url';
const LS_BACKEND = 'pyrenees_backend_url';

// ----- State -----
let hikes = [];
let accommodations = [];
let attractions = [];
let map, hikesLayer, accomLayer, attrLayer;
let editingContext = null;
let currentRegion = '';
let hikeIds = [];

// ----- Helpers: safe DOM -----
const $ = (id) => document.getElementById(id);
const on = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); };
const safe = (fn) => { try { fn(); } catch (e) { console.error(e); } };

const escapeHtml = (s) => s==null ? '' : String(s)
  .replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;')
  .replaceAll("'",'&#39;');
const escapeAttr = escapeHtml;

// ----- Utilities -----
function saveLocal() {
  localStorage.setItem(LS_HIKES, JSON.stringify(hikes));
  localStorage.setItem(LS_ACCOM, JSON.stringify(accommodations));
  localStorage.setItem(LS_ATTR,  JSON.stringify(attractions));
}
function loadLocal() {
  safe(() => { const h = localStorage.getItem(LS_HIKES); if (h) hikes = JSON.parse(h); });
  safe(() => { const a = localStorage.getItem(LS_ACCOM); if (a) accommodations = JSON.parse(a); });
  safe(() => { const t = localStorage.getItem(LS_ATTR);  if (t) attractions = JSON.parse(t); });
}
function getBackendUrl() {
  // Your Apps Script URL as a default fallback
  return localStorage.getItem(LS_BACKEND)
      || 'https://script.google.com/macros/s/AKfycbwQvaXKkgu_uusyZslagfG88WOmUy0zs5_JHsfELEvp3HUVBcI-Emv9IlhCpTb9UUvZKw/exec';
}

// ----- JSONP (no CORS preflight) -----
function jsonp(url, params = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const cbName = `_jsonp_${Math.random().toString(36).slice(2)}`;
    const cleanup = () => { try { delete window[cbName]; } catch{} if (script && script.parentNode) script.parentNode.removeChild(script); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('JSONP timeout')); }, timeoutMs);
    window[cbName] = (data) => { clearTimeout(timer); cleanup(); resolve(data); };
    const q = new URLSearchParams(params); q.set('callback', cbName);
    const script = document.createElement('script');
    script.src = `${url}?${q.toString()}`;
    script.onerror = () => { clearTimeout(timer); cleanup(); reject(new Error('JSONP error')); };
    document.body.appendChild(script);
  });
}

// ----- Normalizer -----
function normalizeHike(raw) {
  const get = (o, keys) => { for (const k of keys) if (o && o[k] != null && o[k] !== '') return o[k]; return ''; };
  const toNum = (v) => (v==='' || v==null || Number.isNaN(Number(v))) ? null : Number(v);
  return {
    id: raw.id || '',
    name: get(raw, ['name','Name','מסלול','שם המסלול','title','route']),
    region: get(raw, ['region','Region','אזור','איזור','area']),
    duration: get(raw, ['duration','Duration','משך','time']),
    difficulty: get(raw, ['difficulty','Difficulty','דרגת קושי','קושי']),
    starting_point: get(raw, ['starting_point','Starting Point','start','trailhead','נקודת התחלה']),
    link: get(raw, ['link','Link','url','details','קישור']),
    lat: toNum(raw.lat ?? raw.latitude),
    lon: toNum(raw.lon ?? raw.lng ?? raw.longitude),
    notes: raw.notes || (raw.extra ? JSON.stringify(raw.extra) : '')
  };
}

// ----- HERO -----
function applyHeroImage() {
  const url = localStorage.getItem(LS_HERO);
  const hero = document.querySelector('.hero');
  if (!hero || !url) return;
  const overlay = 'linear-gradient(to bottom, rgba(6,18,26,0.15), rgba(6,18,26,0.55)), ';
  hero.style.backgroundImage = overlay + `url("${url}")`;
}
function initHeroControls() {
  on('saveHeroBtn', 'click', () => {
    const v = $('heroUrlInput')?.value?.trim();
    if (!v) return;
    localStorage.setItem(LS_HERO, v);
    applyHeroImage();
    alert('Hero image updated!');
  });
  on('importHeroBtn', 'click', () => $('importHeroInput')?.click());
  on('importHeroInput', 'change', (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { localStorage.setItem(LS_HERO, reader.result); applyHeroImage(); alert('Hero image uploaded!'); };
    reader.readAsDataURL(file);
  });
}

// ----- CLOUD (Apps Script) -----
async function cloudListHikes() {
  const url = getBackendUrl();
  const res = await jsonp(url, { op: 'list' });
  if (!res || !res.ok) throw new Error(res?.error || 'Cloud list failed');
  hikes = (res.rows || []).map(normalizeHike);
  hikeIds = hikes.map(h => h.id || '');
  saveLocal();
  renderHikeCards(); renderMarkers();
}
async function cloudAddHike(obj) {
  const url = getBackendUrl();
  const res = await jsonp(url, { op: 'add', data: JSON.stringify(obj) });
  if (!res || !res.ok) throw new Error(res?.error || 'Add failed');
  await cloudListHikes();
}
async function cloudUpdateHike(index, obj) {
  const id = hikeIds[index]; if (!id) return;
  obj.id = id;
  const url = getBackendUrl();
  const res = await jsonp(url, { op: 'update', data: JSON.stringify(obj) });
  if (!res || !res.ok) throw new Error(res?.error || 'Update failed');
  await cloudListHikes();
}
async function cloudDeleteHike(index) {
  const id = hikeIds[index]; if (!id) return;
  const url = getBackendUrl();
  const res = await jsonp(url, { op: 'delete', id });
  if (!res || !res.ok) throw new Error(res?.error || 'Delete failed');
  await cloudListHikes();
}
async function cloudWipe() {
  const url = getBackendUrl();
  const res = await jsonp(url, { op: 'wipe' });
  if (!res || !res.ok) throw new Error(res?.error || 'Wipe failed');
}
async function cloudWipeAndSeedFromInline() {
  if (!confirm('This will overwrite all cloud hikes with the inline set. Continue?')) return;
  await cloudWipe();
  for (const raw of (window.BUNDLED_HIKES || [])) {
    await cloudAddHike(normalizeHike(raw));
  }
  alert('Cloud reset from inline data complete.');
}

// ----- Local FALLBACK: hikes.ls / hikes.json / BUNDLED_HIKES -----
async function tryFetchJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    // If .ls is plain text, still try JSON.parse
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return await res.json();
    const text = await res.text();
    try { return JSON.parse(text); } catch { return null; }
  } catch { return null; }
}
async function loadLocalHikesFallback() {
  if (Array.isArray(window.BUNDLED_HIKES) && window.BUNDLED_HIKES.length) {
    hikes = window.BUNDLED_HIKES.map(normalizeHike);
    return true;
  }
  let data = await tryFetchJson('hikes.ls'); // your request
  if (!data) data = await tryFetchJson('hikes.json');
  if (Array.isArray(data) && data.length) {
    hikes = data.map(normalizeHike);
    return true;
  }
  return false;
}

// ----- Tabs (guarded) -----
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('visible'));
      document.getElementById(tab)?.classList.add('visible');
      if (tab === 'map') setTimeout(() => map?.invalidateSize(), 200);
    });
  });
}

// ----- Regions & cards -----
function getRegions() {
  return Array.from(new Set(hikes.map(h => h.region).filter(Boolean))).sort();
}
function renderRegionTabs() {
  const wrap = $('regionTabs'); if (!wrap) return;
  const regions = getRegions();
  const items = [{ label: 'All', value: '' }].concat(regions.map(r => ({ label: r, value: r })));
  wrap.innerHTML = items.map(r => {
    const active = r.value === currentRegion ? 'active' : '';
    return `<button class="seg-btn ${active}" data-region="${escapeAttr(r.value)}">${escapeHtml(r.label)}</button>`;
  }).join('');
  wrap.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentRegion = btn.dataset.region || '';
      wrap.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderHikeCards();
    });
  });
}
function cardHTML(h, idx) {
  const diff = h.difficulty ? `<span class="badge">${escapeHtml(h.difficulty)}</span>` : '';
  const reg  = h.region ? `<span class="badge">${escapeHtml(h.region)}</span>` : '';
  return `
  <div class="flip-card">
    <div class="flip-inner">
      <div class="flip-face">
        <div class="badge-row">${reg} ${diff}</div>
        <div class="hike-title">${escapeHtml(h.name || 'Untitled Hike')}</div>
        <div class="meta">${h.duration ? 'Duration: ' + escapeHtml(h.duration) : ''}</div>
        <div class="meta">${h.starting_point ? 'Start: ' + escapeHtml(h.starting_point) : ''}</div>
        <div class="card-actions">
          <button data-act="edit-hike" data-index="${idx}">Edit</button>
          <button data-act="map-hike" data-index="${idx}">Map</button>
        </div>
      </div>
      <div class="flip-face back">
        <div class="meta">${h.link ? `<a href="${escapeAttr(h.link)}" target="_blank">More Details ↗</a>` : 'No link'}</div>
        <div class="meta">${(h.lat!=null && h.lon!=null) ? 'Coords: ' + h.lat.toFixed(5) + ', ' + h.lon.toFixed(5) : 'Coords: —'}</div>
        <div class="meta">${h.notes ? 'Notes: ' + escapeHtml(h.notes) : ''}</div>
        <div class="card-actions">
          <button data-act="edit-hike" data-index="${idx}">Edit</button>
          <button data-act="map-hike" data-index="${idx}">Map</button>
        </div>
      </div>
    </div>
  </div>`;
}
function renderHikeCards() {
  renderRegionTabs();
  const wrap = $('hikeCards'); if (!wrap) return;
  let list = hikes;
  if (currentRegion) list = list.filter(h => (h.region || '') === currentRegion);
  wrap.innerHTML = list.map((h) => cardHTML(h, hikes.indexOf(h))).join('');
  wrap.querySelectorAll('.flip-card').forEach(card => card.addEventListener('click', (e) => { if (!e.target.closest('button')) card.classList.toggle('flipped'); }));
  wrap.querySelectorAll('[data-act="edit-hike"]').forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); openHikeModal(Number(btn.dataset.index)); }));
  wrap.querySelectorAll('[data-act="map-hike"]').forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); focusHikeOnMap(Number(btn.dataset.index)); }));
}

// ----- Lists (local only for now) -----
function renderAccommodations() {
  const list = $('accommodationsList'); if (!list) return;
  if (!accommodations.length) { list.innerHTML = '<div class="list-item"><div>No accommodations yet. Click "+ Add Accommodation".</div></div>'; return; }
  list.innerHTML = accommodations.map((a, idx) => `
    <div class="list-item">
      <div>
        <div class="hike-title">${escapeHtml(a.name || 'Accommodation')}</div>
        <div class="meta">
          ${a.checkin_date ? 'Check-in: ' + escapeHtml(a.checkin_date) : ''}${a.checkin_time ? ' at ' + escapeHtml(a.checkin_time) : ''}${a.region ? ' — ' + escapeHtml(a.region) : ''}
        </div>
        ${a.link ? `<div class="meta"><a href="${escapeAttr(a.link)}" target="_blank">Check-in Instructions ↗</a></div>` : ''}
        ${a.notes ? `<div class="meta">Notes: ${escapeHtml(a.notes)}</div>` : ''}
        ${(a.lat!=null && a.lon!=null) ? `<div class="meta">Coords: ${a.lat.toFixed(5)}, ${a.lon.toFixed(5)}</div>` : ''}
      </div>
      <div>
        <button data-act="map-accom" data-index="${idx}">Map</button>
        <button data-act="edit-accom" data-index="${idx}">Edit</button>
      </div>
    </div>`).join('');
  list.querySelectorAll('[data-act="edit-accom"]').forEach(btn => btn.addEventListener('click', () => openAccomModal(Number(btn.dataset.index))));
  list.querySelectorAll('[data-act="map-accom"]').forEach(btn => btn.addEventListener('click', () => focusAccomOnMap(Number(btn.dataset.index))));
}
function renderAttractions() {
  const list = $('attractionsList'); if (!list) return;
  if (!attractions.length) { list.innerHTML = '<div class="list-item"><div>No attractions yet. Click "+ Add Attraction".</div></div>'; return; }
  list.innerHTML = attractions.map((t, idx) => `
    <div class="list-item">
      <div>
        <div class="hike-title">${escapeHtml(t.name || 'Attraction')}</div>
        <div class="meta">${t.category ? escapeHtml(t.category) : ''}${t.region ? ' — ' + escapeHtml(t.region) : ''}</div>
        ${t.link ? `<div class="meta"><a href="${escapeAttr(t.link)}" target="_blank">More Info ↗</a></div>` : ''}
        ${t.notes ? `<div class="meta">Notes: ${escapeHtml(t.notes)}</div>` : ''}
        ${(t.lat!=null && t.lon!=null) ? `<div class="meta">Coords: ${t.lat.toFixed(5)}, ${t.lon.toFixed(5)}</div>` : ''}
      </div>
      <div>
        <button data-act="map-attr" data-index="${idx}">Map</button>
        <button data-act="edit-attr" data-index="${idx}">Edit</button>
      </div>
    </div>`).join('');
  list.querySelectorAll('[data-act="edit-attr"]').forEach(btn => btn.addEventListener('click', () => openAttrModal(Number(btn.dataset.index))));
  list.querySelectorAll('[data-act="map-attr"]').forEach(btn => btn.addEventListener('click', () => focusAttrOnMap(Number(btn.dataset.index))));
}

// ----- Map -----
function initMap() {
  const el = $('mapContainer'); if (!el) return;
  map = L.map('mapContainer').setView([42.7, 0.5], 8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  hikesLayer = L.layerGroup().addTo(map);
  accomLayer = L.layerGroup().addTo(map);
  attrLayer  = L.layerGroup().addTo(map);
  map.on('click', (e) => {
    if (!editingContext) return;
    const set = (latId, lonId) => { $(latId).value = e.latlng.lat.toFixed(6); $(lonId).value = e.latlng.lng.toFixed(6); };
    if (editingContext.type === 'hike') set('hikeLat','hikeLon');
    if (editingContext.type === 'accom') set('accomLat','accomLon');
    if (editingContext.type === 'attr')  set('attrLat','attrLon');
  });
  renderMarkers();
}
function renderMarkers() {
  if (!hikesLayer || !accomLayer || !attrLayer) return;
  hikesLayer.clearLayers(); accomLayer.clearLayers(); attrLayer.clearLayers();
  hikes.forEach(h => {
    if (h.lat==null || h.lon==null) return;
    const m = L.circleMarker([h.lat, h.lon], { radius: 8, weight: 2, color: '#4ea3d9', fillColor: '#4ea3d9', fillOpacity: 0.25 }).addTo(hikesLayer);
    m.bindPopup(`<strong>${escapeHtml(h.name||'Hike')}</strong><br>${h.region ? escapeHtml(h.region)+'<br>' : ''}${h.duration ? escapeHtml(h.duration)+'<br>' : ''}${h.link ? '<a target=_blank href='+escapeAttr(h.link)+'>More ↗</a>' : ''}`);
  });
  accommodations.forEach(a => {
    if (a.lat==null || a.lon==null) return;
    const m = L.circleMarker([a.lat, a.lon], { radius: 8, weight: 2, color: '#efc36f', fillColor: '#efc36f', fillOpacity: 0.25 }).addTo(accomLayer);
    m.bindPopup(`<strong>${escapeHtml(a.name||'Accommodation')}</strong>`);
  });
  attractions.forEach(t => {
    if (t.lat==null || t.lon==null) return;
    const m = L.circleMarker([t.lat, t.lon], { radius: 8, weight: 2, color: '#d9822b', fillColor: '#d9822b', fillOpacity: 0.25 }).addTo(attrLayer);
    m.bindPopup(`<strong>${escapeHtml(t.name||'Attraction')}</strong>`);
  });
}
on('fitBoundsBtn','click',() => {
  if (!map) return;
  const bounds = [];
  hikes.forEach(h => { if (h.lat!=null && h.lon!=null) bounds.push([h.lat, h.lon]); });
  accommodations.forEach(a => { if (a.lat!=null && a.lon!=null) bounds.push([a.lat, a.lon]); });
  attractions.forEach(t => { if (t.lat!=null && t.lon!=null) bounds.push([t.lat, t.lon]); });
  if (!bounds.length) return;
  map.fitBounds(bounds, { padding: [24,24] });
});

// ----- Modals -----
const closeModals = () => {
  document.getElementById('modalBackdrop')?.classList.add('hidden');
  document.getElementById('hikeModal')?.classList.add('hidden');
  document.getElementById('accomModal')?.classList.add('hidden');
  document.getElementById('attrModal')?.classList.add('hidden');
  editingContext = null;
};
function openModal(el) {
  $('modalBackdrop')?.classList.remove('hidden');
  el?.classList.remove('hidden');
}
function openHikeModal(index) {
  editingContext = { type: 'hike', index };
  const h = index==null ? {} : hikes[index];
  $('hikeModalTitle') && ($('hikeModalTitle').textContent = index==null ? 'Add Hike' : 'Edit Hike');
  $('hikeName')?.setAttribute('value',''); // clear ghost autofill
  $('hikeName').value = h?.name || '';
  $('hikeRegion').value = h?.region || '';
  $('hikeDuration').value = h?.duration || '';
  $('hikeDifficulty').value = h?.difficulty || '';
  $('hikeStart').value = h?.starting_point || '';
  $('hikeLink').value = h?.link || '';
  $('hikeLat').value = (h?.lat ?? '') === null ? '' : (h?.lat ?? '');
  $('hikeLon').value = (h?.lon ?? '') === null ? '' : (h?.lon ?? '');
  $('hikeNotes').value = h?.notes || '';
  openModal($('hikeModal'));
}
on('saveHikeBtn','click', async () => {
  const obj = {
    name: $('hikeName')?.value.trim(),
    region: $('hikeRegion')?.value.trim(),
    duration: $('hikeDuration')?.value.trim(),
    difficulty: $('hikeDifficulty')?.value.trim(),
    starting_point: $('hikeStart')?.value.trim(),
    link: $('hikeLink')?.value.trim(),
    lat: parseFloat($('hikeLat')?.value),
    lon: parseFloat($('hikeLon')?.value),
    notes: $('hikeNotes')?.value.trim()
  };
  if (Number.isNaN(obj.lat)) obj.lat = null;
  if (Number.isNaN(obj.lon)) obj.lon = null;
  try {
    if (editingContext?.index==null) await cloudAddHike(obj);
    else await cloudUpdateHike(editingContext.index, obj);
    closeModals();
  } catch (e) {
    alert('Save failed: ' + e.message);
  }
});
on('deleteHikeBtn','click', async () => {
  if (editingContext?.index==null) return closeModals();
  try { await cloudDeleteHike(editingContext.index); closeModals(); }
  catch (e) { alert('Delete failed: ' + e.message); }
});
on('addHikeBtn','click', () => openHikeModal(null));
document.querySelectorAll('.close-modal').forEach(btn => btn.addEventListener('click', closeModals));
$('modalBackdrop')?.addEventListener('click', closeModals);

// Accom
function openAccomModal(index) {
  editingContext = { type: 'accom', index };
  const a = index==null ? {} : accommodations[index];
  $('accomModalTitle') && ($('accomModalTitle').textContent = index==null ? 'Add Accommodation' : 'Edit Accommodation');
  $('accomName').value = a?.name || '';
  $('accomRegion').value = a?.region || '';
  $('accomCheckinDate').value = a?.checkin_date || '';
  $('accomCheckinTime').value = a?.checkin_time || '';
  $('accomLink').value = a?.link || '';
  $('accomLat').value = (a?.lat ?? '') === null ? '' : (a?.lat ?? '');
  $('accomLon').value = (a?.lon ?? '') === null ? '' : (a?.lon ?? '');
  $('accomNotes').value = a?.notes || '';
  openModal($('accomModal'));
}
on('saveAccomBtn','click', () => {
  const obj = {
    name: $('accomName')?.value.trim(),
    region: $('accomRegion')?.value.trim(),
    checkin_date: $('accomCheckinDate')?.value,
    checkin_time: $('accomCheckinTime')?.value,
    link: $('accomLink')?.value.trim(),
    lat: parseFloat($('accomLat')?.value),
    lon: parseFloat($('accomLon')?.value),
    notes: $('accomNotes')?.value.trim()
  };
  if (Number.isNaN(obj.lat)) obj.lat = null;
  if (Number.isNaN(obj.lon)) obj.lon = null;
  if (editingContext?.index==null) accommodations.push(obj); else accommodations[editingContext.index] = obj;
  saveLocal(); renderAccommodations(); renderMarkers(); closeModals();
});
on('deleteAccomBtn','click', () => {
  if (editingContext?.index==null) return closeModals();
  accommodations.splice(editingContext.index, 1);
  saveLocal(); renderAccommodations(); renderMarkers(); closeModals();
});
on('addAccomBtn','click', () => openAccomModal(null));

// Attr
function openAttrModal(index) {
  editingContext = { type: 'attr', index };
  const t = index==null ? {} : attractions[index];
  $('attrModalTitle') && ($('attrModalTitle').textContent = index==null ? 'Add Attraction' : 'Edit Attraction');
  $('attrName').value = t?.name || '';
  $('attrRegion').value = t?.region || '';
  $('attrCategory').value = t?.category || '';
  $('attrLink').value = t?.link || '';
  $('attrLat').value = (t?.lat ?? '') === null ? '' : (t?.lat ?? '');
  $('attrLon').value = (t?.lon ?? '') === null ? '' : (t?.lon ?? '');
  $('attrNotes').value = t?.notes || '';
  openModal($('attrModal'));
}
on('saveAttrBtn','click', () => {
  const obj = {
    name: $('attrName')?.value.trim(),
    region: $('attrRegion')?.value.trim(),
    category: $('attrCategory')?.value.trim(),
    link: $('attrLink')?.value.trim(),
    lat: parseFloat($('attrLat')?.value),
    lon: parseFloat($('attrLon')?.value),
    notes: $('attrNotes')?.value.trim()
  };
  if (Number.isNaN(obj.lat)) obj.lat = null;
  if (Number.isNaN(obj.lon)) obj.lon = null;
  if (editingContext?.index==null) attractions.push(obj); else attractions[editingContext.index] = obj;
  saveLocal(); renderAttractions(); renderMarkers(); closeModals();
});
on('deleteAttrBtn','click', () => {
  if (editingContext?.index==null) return closeModals();
  attractions.splice(editingContext.index, 1);
  saveLocal(); renderAttractions(); renderMarkers(); closeModals();
});
on('addAttrBtn','click', () => openAttrModal(null));

// Data tab
on('saveLocalBtn','click', saveLocal);
on('clearLocalBtn','click', () => {
  if (!confirm('Clear all locally saved data?')) return;
  [LS_HIKES, LS_ACCOM, LS_ATTR, LS_HERO, LS_BACKEND].forEach(k => localStorage.removeItem(k));
  location.reload();
});
on('exportJsonBtn','click', () => {
  const payload = { hikes, accommodations, attractions, hero_image_url: localStorage.getItem(LS_HERO) || null, backend_url: getBackendUrl() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'pyrenees-data.json'; a.click();
});
on('importJsonBtn','click', () => $('importJsonInput')?.click());
on('importJsonInput','change', async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  const text = await file.text();
  try {
    const data = JSON.parse(text);
    if (data.hikes) hikes = data.hikes.map(normalizeHike);
    if (data.accommodations) accommodations = data.accommodations;
    if (data.attractions) attractions = data.attractions;
    if (typeof data.hero_image_url === 'string') { localStorage.setItem(LS_HERO, data.hero_image_url); applyHeroImage(); }
    if (typeof data.backend_url === 'string') { localStorage.setItem(LS_BACKEND, data.backend_url); }
    saveLocal(); renderHikeCards(); renderAccommodations(); renderAttractions(); renderMarkers();
    alert('Imported JSON.');
  } catch { alert('Invalid JSON.'); }
});

// Excel → Cloud
on('importXlsxBtn','click', () => $('importXlsxInput')?.click());
on('importXlsxInput','change', async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data);
  const sheetName = workbook.SheetNames[1] || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json(sheet).map(normalizeHike);
  try {
    await cloudWipe();
    for (const h of json) { await cloudAddHike(h); }
    alert('Excel imported to cloud: ' + sheetName);
  } catch (err) {
    alert('Excel import failed: ' + err.message);
  }
});

// Reset to inline -> Cloud
on('resetHikesBtn','click', cloudWipeAndSeedFromInline);

// Map focus helpers
function focusHikeOnMap(idx) { const h = hikes[idx]; if (!h || h.lat==null || h.lon==null) return; document.querySelector('[data-tab="map"]')?.click(); setTimeout(() => { map?.setView([h.lat, h.lon], 12); }, 200); }
function focusAccomOnMap(idx) { const a = accommodations[idx]; if (!a || a.lat==null || a.lon==null) return; document.querySelector('[data-tab="map"]')?.click(); setTimeout(() => { map?.setView([a.lat, a.lon], 12); }, 200); }
function focusAttrOnMap(idx) { const t = attractions[idx]; if (!t || t.lat==null || t.lon==null) return; document.querySelector('[data-tab="map"]')?.click(); setTimeout(() => { map?.setView([t.lat, t.lon], 12); }, 200); }

// ----- Init -----
document.addEventListener('DOMContentLoaded', async () => {
  // Prefill optional inputs if present
  safe(() => { const be = localStorage.getItem(LS_BACKEND) || getBackendUrl(); const i = $('backendUrlInput'); if (i) i.value = be; });
  safe(() => { const hero = localStorage.getItem(LS_HERO); const i = $('heroUrlInput'); if (i && hero) i.value = hero; });

  initTabs();
  loadLocal();
  initHeroControls();
  applyHeroImage();
  renderAccommodations();
  renderAttractions();
  initMap();

  // Try cloud first; if it fails or returns empty, fall back to local files (hikes.ls → hikes.json → bundled)
  let loadedCloud = false;
  try {
    await cloudListHikes();
    loadedCloud = hikes.length > 0;
  } catch (e) {
    console.warn('Cloud load failed:', e);
  }
  if (!loadedCloud) {
    const ok = await loadLocalHikesFallback();
    if (!ok) console.warn('No hikes found in cloud or local files.');
    renderHikeCards(); renderMarkers();
  }
});
