const LS_HIKES = 'pyrenees_hikes';
const LS_ACCOM = 'pyrenees_accommodations';
const LS_ATTR  = 'pyrenees_attractions';
const LS_HERO  = 'pyrenees_hero_url';

let hikes = [];
let accommodations = [];
let attractions = [];
let map, hikesLayer, accomLayer, attrLayer;
let editingContext = null; // { type: 'hike'|'accom'|'attr', index: number|null }
let currentRegion = '';    // active region tab ('' = All)

// Tabs (top nav)
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('visible'));
    document.getElementById(tab).classList.add('visible');
    if (tab === 'map') setTimeout(() => map.invalidateSize(), 200);
  });
});

// Utilities
function saveLocal() {
  localStorage.setItem(LS_HIKES, JSON.stringify(hikes));
  localStorage.setItem(LS_ACCOM, JSON.stringify(accommodations));
  localStorage.setItem(LS_ATTR,  JSON.stringify(attractions));
}
function loadLocal() {
  const h = localStorage.getItem(LS_HIKES);
  const a = localStorage.getItem(LS_ACCOM);
  const t = localStorage.getItem(LS_ATTR);
  if (h) hikes = JSON.parse(h);
  if (a) accommodations = JSON.parse(a);
  if (t) attractions = JSON.parse(t);
}
async function loadFromFile() {
  // Prefer inline bundled data so it works from file:// too
  if (Array.isArray(window.BUNDLED_HIKES)) {
    hikes = window.BUNDLED_HIKES.map(normalizeHike);
    return;
  }
  try {
    const res = await fetch('hikes.json');
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data)) {
      hikes = data.map(normalizeHike);
    }
  } catch (e) {}
}
function normalizeHike(raw) {
  const get = (obj, keys) => {
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
    }
    return null;
  };
  return {
    name: get(raw, ['name','Name','מסלול','שם המסלול','title','route']),
    region: get(raw, ['region','Region','אזור','איזור','area']),
    duration: get(raw, ['duration','Duration','משך','time']),
    difficulty: get(raw, ['difficulty','Difficulty','דרגת קושי','קושי']),
    starting_point: get(raw, ['starting_point','Starting Point','start','trailhead','נקודת התחלה']),
    link: get(raw, ['link','Link','url','details','קישור']),
    lat: raw.lat ? Number(raw.lat) : (raw.latitude ? Number(raw.latitude) : null),
    lon: raw.lon ? Number(raw.lon) : (raw.lng ? Number(raw.lng) : (raw.longitude ? Number(raw.longitude) : null)),
    notes: raw.notes || (raw.extra ? JSON.stringify(raw.extra) : ''),
  };
}

// Hero image (from localStorage URL)
function applyHeroImage() {
  const url = localStorage.getItem(LS_HERO);
  const hero = document.querySelector('.hero');
  if (!hero) return;
  const overlay = 'linear-gradient(to bottom, rgba(7,19,14,0.15), rgba(7,19,14,0.6)), ';
  if (url && url.startsWith('http')) {
    hero.style.backgroundImage = overlay + `url("${url}")`;
  } else {
    hero.style.backgroundImage = overlay + 'url("https://source.unsplash.com/1600x600/?pyrenees,mountains")';
  }
}

// Region tabs (clickable)
function getRegions() {
  return Array.from(new Set(hikes.map(h => h.region).filter(Boolean))).sort();
}
function renderRegionTabs() {
  const wrap = document.getElementById('regionTabs');
  const regions = getRegions();
  const all = [{ label: 'All', value: '' }];
  const items = all.concat(regions.map(r => ({ label: r, value: r })));
  wrap.innerHTML = items.map(r => {
    const active = r.value === currentRegion ? 'active' : '';
    return `<button class="seg-btn ${active}" data-region="${escapeAttr(r.value)}">${escapeHtml(r.label)}</button>`;
  }).join('');
  wrap.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentRegion = btn.dataset.region || '';
      wrap.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderHikeCards();  // re-filter
    });
  });
}

function renderHikeCards() {
  renderRegionTabs();
  const wrap = document.getElementById('hikeCards');
  let list = hikes;
  if (currentRegion) list = list.filter(h => (h.region || '') === currentRegion);

  wrap.innerHTML = list.map((h, idx) => {
    const i = hikes.indexOf(h);
    return cardHTML(h, i);
  }).join('');

  // Attach card events
  wrap.querySelectorAll('.flip-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      card.classList.toggle('flipped');
    });
  });
  wrap.querySelectorAll('[data-act="edit-hike"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.index);
      openHikeModal(idx);
    });
  });
  wrap.querySelectorAll('[data-act="map-hike"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.index);
      focusHikeOnMap(idx);
    });
  });
}

function cardHTML(h, idx) {
  const diffBadge = h.difficulty ? `<span class="badge">${escapeHtml(h.difficulty)}</span>` : '';
  const regBadge = h.region ? `<span class="badge">${escapeHtml(h.region)}</span>` : '';
  return `
  <div class="flip-card">
    <div class="flip-inner">
      <div class="flip-face">
        <div class="badge-row">${regBadge} ${diffBadge}</div>
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

function renderAccommodations() {
  const list = document.getElementById('accommodationsList');
  if (!accommodations.length) {
    list.innerHTML = '<div class="list-item"><div>No accommodations yet. Click "+ Add Accommodation" to get started.</div></div>';
    return;
  }
  list.innerHTML = accommodations.map((a, idx) => `
    <div class="list-item">
      <div>
        <div class="hike-title">${escapeHtml(a.name || 'Accommodation')}</div>
        <div class="meta">
          ${a.checkin_date ? 'Check-in: ' + escapeHtml(a.checkin_date) : ''}
          ${a.checkin_time ? ' at ' + escapeHtml(a.checkin_time) : ''}
          ${a.region ? ' — ' + escapeHtml(a.region) : ''}
        </div>
        ${a.link ? `<div class="meta"><a href="${escapeAttr(a.link)}" target="_blank">Check-in Instructions ↗</a></div>` : ''}
        ${a.notes ? `<div class="meta">Notes: ${escapeHtml(a.notes)}</div>` : ''}
        ${(a.lat!=null && a.lon!=null) ? `<div class="meta">Coords: ${a.lat.toFixed(5)}, ${a.lon.toFixed(5)}</div>` : ''}
      </div>
      <div>
        <button data-act="map-accom" data-index="${idx}">Map</button>
        <button data-act="edit-accom" data-index="${idx}">Edit</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-act="edit-accom"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      openAccomModal(idx);
    });
  });
  list.querySelectorAll('[data-act="map-accom"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      focusAccomOnMap(idx);
    });
  });
}

function renderAttractions() {
  const list = document.getElementById('attractionsList');
  if (!attractions.length) {
    list.innerHTML = '<div class="list-item"><div>No attractions yet. Click "+ Add Attraction" to get started.</div></div>';
    return;
  }
  list.innerHTML = attractions.map((t, idx) => `
    <div class="list-item">
      <div>
        <div class="hike-title">${escapeHtml(t.name || 'Attraction')}</div>
        <div class="meta">
          ${t.category ? escapeHtml(t.category) : ''}
          ${t.region ? ' — ' + escapeHtml(t.region) : ''}
        </div>
        ${t.link ? `<div class="meta"><a href="${escapeAttr(t.link)}" target="_blank">More Info ↗</a></div>` : ''}
        ${t.notes ? `<div class="meta">Notes: ${escapeHtml(t.notes)}</div>` : ''}
        ${(t.lat!=null && t.lon!=null) ? `<div class="meta">Coords: ${t.lat.toFixed(5)}, ${t.lon.toFixed(5)}</div>` : ''}
      </div>
      <div>
        <button data-act="map-attr" data-index="${idx}">Map</button>
        <button data-act="edit-attr" data-index="${idx}">Edit</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-act="edit-attr"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      openAttrModal(idx);
    });
  });
  list.querySelectorAll('[data-act="map-attr"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      focusAttrOnMap(idx);
    });
  });
}

// Map
function initMap() {
  map = L.map('mapContainer').setView([42.7, 0.5], 8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  hikesLayer = L.layerGroup().addTo(map);
  accomLayer = L.layerGroup().addTo(map);
  attrLayer  = L.layerGroup().addTo(map);

  map.on('click', (e) => {
    if (!editingContext) return;
    const { type } = editingContext;
    if (type === 'hike') {
      document.getElementById('hikeLat').value = e.latlng.lat.toFixed(6);
      document.getElementById('hikeLon').value = e.latlng.lng.toFixed(6);
    } else if (type === 'accom') {
      document.getElementById('accomLat').value = e.latlng.lat.toFixed(6);
      document.getElementById('accomLon').value = e.latlng.lng.toFixed(6);
    } else if (type === 'attr') {
      document.getElementById('attrLat').value = e.latlng.lat.toFixed(6);
      document.getElementById('attrLon').value = e.latlng.lng.toFixed(6);
    }
  });

  renderMarkers();
}

function renderMarkers() {
  hikesLayer.clearLayers();
  accomLayer.clearLayers();
  attrLayer.clearLayers();

  hikes.forEach((h) => {
    if (h.lat == null || h.lon == null) return;
    const m = L.circleMarker([h.lat, h.lon], {
      radius: 8, weight: 2, color: '#46c083', fillColor: '#46c083', fillOpacity: 0.25
    }).addTo(hikesLayer);
    m.bindPopup(`<strong>${escapeHtml(h.name || 'Hike')}</strong><br>${h.region ? escapeHtml(h.region) + '<br>' : ''}${h.duration ? escapeHtml(h.duration) + '<br>' : ''}${h.link ? '<a target=_blank href=' + escapeAttr(h.link) + '>More ↗</a>' : ''}`);
  });

  accommodations.forEach((a) => {
    if (a.lat == null || a.lon == null) return;
    const m = L.circleMarker([a.lat, a.lon], {
      radius: 8, weight: 2, color: '#c2a878', fillColor: '#c2a878', fillOpacity: 0.25
    }).addTo(accomLayer);
    m.bindPopup(`<strong>${escapeHtml(a.name || 'Accommodation')}</strong><br>${a.region ? escapeHtml(a.region) + '<br>' : ''}${a.checkin_date ? 'Check-in: ' + escapeHtml(a.checkin_date) + (a.checkin_time ? ' ' + escapeHtml(a.checkin_time) : '') + '<br>' : ''}${a.link ? '<a target=_blank href=' + escapeAttr(a.link) + '>Instructions ↗</a>' : ''}`);
  });

  attractions.forEach((t) => {
    if (t.lat == null || t.lon == null) return;
    const m = L.circleMarker([t.lat, t.lon], {
      radius: 8, weight: 2, color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.25
    }).addTo(attrLayer);
    m.bindPopup(`<strong>${escapeHtml(t.name || 'Attraction')}</strong><br>${t.region ? escapeHtml(t.region) + '<br>' : ''}${t.category ? escapeHtml(t.category) + '<br>' : ''}${t.link ? '<a target=_blank href=' + escapeAttr(t.link) + '>More ↗</a>' : ''}`);
  });
}

function fitAll() {
  const bounds = [];
  hikes.forEach(h => { if (h.lat!=null && h.lon!=null) bounds.push([h.lat, h.lon]); });
  accommodations.forEach(a => { if (a.lat!=null && a.lon!=null) bounds.push([a.lat, a.lon]); });
  attractions.forEach(t => { if (t.lat!=null && t.lon!=null) bounds.push([t.lat, t.lon]); });
  if (!bounds.length) return;
  map.fitBounds(bounds, { padding: [24,24] });
}

function focusHikeOnMap(idx) {
  const h = hikes[idx];
  if (!h || h.lat==null || h.lon==null) return;
  document.querySelector('[data-tab="map"]').click();
  setTimeout(() => { map.setView([h.lat, h.lon], 12); }, 200);
}
function focusAccomOnMap(idx) {
  const a = accommodations[idx];
  if (!a || a.lat==null || a.lon==null) return;
  document.querySelector('[data-tab="map"]').click();
  setTimeout(() => { map.setView([a.lat, a.lon], 12); }, 200);
}
function focusAttrOnMap(idx) {
  const t = attractions[idx];
  if (!t || t.lat==null || t.lon==null) return;
  document.querySelector('[data-tab="map"]').click();
  setTimeout(() => { map.setView([t.lat, t.lon], 12); }, 200);
}

// Modals
const backdrop = document.getElementById('modalBackdrop');
const hikeModal = document.getElementById('hikeModal');
const accomModal = document.getElementById('accomModal');
const attrModal  = document.getElementById('attrModal');

function openModal(el) { backdrop.classList.remove('hidden'); el.classList.remove('hidden'); }
function closeModals() {
  backdrop.classList.add('hidden');
  hikeModal.classList.add('hidden');
  accomModal.classList.add('hidden');
  attrModal.classList.add('hidden');
  editingContext = null;
}
document.querySelectorAll('.close-modal').forEach(btn => btn.addEventListener('click', closeModals));
backdrop.addEventListener('click', closeModals);

// Openers
document.getElementById('addHikeBtn').addEventListener('click', () => openHikeModal(null));
document.getElementById('addAccomBtn').addEventListener('click', () => openAccomModal(null));
document.getElementById('addAttrBtn').addEventListener('click', () => openAttrModal(null));

// Hike modal
function openHikeModal(index) {
  editingContext = { type: 'hike', index };
  document.getElementById('hikeModalTitle').textContent = index==null ? 'Add Hike' : 'Edit Hike';
  const h = index==null ? {} : hikes[index];
  document.getElementById('hikeName').value = h?.name || '';
  document.getElementById('hikeRegion').value = h?.region || '';
  document.getElementById('hikeDuration').value = h?.duration || '';
  document.getElementById('hikeDifficulty').value = h?.difficulty || '';
  document.getElementById('hikeStart').value = h?.starting_point || '';
  document.getElementById('hikeLink').value = h?.link || '';
  document.getElementById('hikeLat').value = (h?.lat ?? '') === null ? '' : (h?.lat ?? '');
  document.getElementById('hikeLon').value = (h?.lon ?? '') === null ? '' : (h?.lon ?? '');
  document.getElementById('hikeNotes').value = h?.notes || '';
  openModal(hikeModal);
}
document.getElementById('saveHikeBtn').addEventListener('click', () => {
  const obj = {
    name: document.getElementById('hikeName').value.trim(),
    region: document.getElementById('hikeRegion').value.trim(),
    duration: document.getElementById('hikeDuration').value.trim(),
    difficulty: document.getElementById('hikeDifficulty').value.trim(),
    starting_point: document.getElementById('hikeStart').value.trim(),
    link: document.getElementById('hikeLink').value.trim(),
    lat: parseFloat(document.getElementById('hikeLat').value),
    lon: parseFloat(document.getElementById('hikeLon').value),
    notes: document.getElementById('hikeNotes').value.trim()
  };
  if (Number.isNaN(obj.lat)) obj.lat = null;
  if (Number.isNaN(obj.lon)) obj.lon = null;
  if (editingContext.index==null) hikes.push(obj); else hikes[editingContext.index] = obj;
  saveLocal(); renderHikeCards(); renderMarkers(); closeModals();
});
document.getElementById('deleteHikeBtn').addEventListener('click', () => {
  if (editingContext?.index==null) return closeModals();
  hikes.splice(editingContext.index, 1);
  saveLocal(); renderHikeCards(); renderMarkers(); closeModals();
});

// Accom modal
function openAccomModal(index) {
  editingContext = { type: 'accom', index };
  document.getElementById('accomModalTitle').textContent = index==null ? 'Add Accommodation' : 'Edit Accommodation';
  const a = index==null ? {} : accommodations[index];
  document.getElementById('accomName').value = a?.name || '';
  document.getElementById('accomRegion').value = a?.region || '';
  document.getElementById('accomCheckinDate').value = a?.checkin_date || '';
  document.getElementById('accomCheckinTime').value = a?.checkin_time || '';
  document.getElementById('accomLink').value = a?.link || '';
  document.getElementById('accomLat').value = (a?.lat ?? '') === null ? '' : (a?.lat ?? '');
  document.getElementById('accomLon').value = (a?.lon ?? '') === null ? '' : (a?.lon ?? '');
  document.getElementById('accomNotes').value = a?.notes || '';
  openModal(accomModal);
}
document.getElementById('saveAccomBtn').addEventListener('click', () => {
  const obj = {
    name: document.getElementById('accomName').value.trim(),
    region: document.getElementById('accomRegion').value.trim(),
    checkin_date: document.getElementById('accomCheckinDate').value,
    checkin_time: document.getElementById('accomCheckinTime').value,
    link: document.getElementById('accomLink').value.trim(),
    lat: parseFloat(document.getElementById('accomLat').value),
    lon: parseFloat(document.getElementById('accomLon').value),
    notes: document.getElementById('accomNotes').value.trim()
  };
  if (Number.isNaN(obj.lat)) obj.lat = null;
  if (Number.isNaN(obj.lon)) obj.lon = null;
  if (editingContext.index==null) accommodations.push(obj); else accommodations[editingContext.index] = obj;
  saveLocal(); renderAccommodations(); renderMarkers(); closeModals();
});
document.getElementById('deleteAccomBtn').addEventListener('click', () => {
  if (editingContext?.index==null) return closeModals();
  accommodations.splice(editingContext.index, 1);
  saveLocal(); renderAccommodations(); renderMarkers(); closeModals();
});

// Attraction modal
function openAttrModal(index) {
  editingContext = { type: 'attr', index };
  document.getElementById('attrModalTitle').textContent = index==null ? 'Add Attraction' : 'Edit Attraction';
  const t = index==null ? {} : attractions[index];
  document.getElementById('attrName').value = t?.name || '';
  document.getElementById('attrRegion').value = t?.region || '';
  document.getElementById('attrCategory').value = t?.category || '';
  document.getElementById('attrLink').value = t?.link || '';
  document.getElementById('attrLat').value = (t?.lat ?? '') === null ? '' : (t?.lat ?? '');
  document.getElementById('attrLon').value = (t?.lon ?? '') === null ? '' : (t?.lon ?? '');
  document.getElementById('attrNotes').value = t?.notes || '';
  openModal(attrModal);
}
document.getElementById('saveAttrBtn').addEventListener('click', () => {
  const obj = {
    name: document.getElementById('attrName').value.trim(),
    region: document.getElementById('attrRegion').value.trim(),
    category: document.getElementById('attrCategory').value.trim(),
    link: document.getElementById('attrLink').value.trim(),
    lat: parseFloat(document.getElementById('attrLat').value),
    lon: parseFloat(document.getElementById('attrLon').value),
    notes: document.getElementById('attrNotes').value.trim()
  };
  if (Number.isNaN(obj.lat)) obj.lat = null;
  if (Number.isNaN(obj.lon)) obj.lon = null;
  if (editingContext.index==null) attractions.push(obj); else attractions[editingContext.index] = obj;
  saveLocal(); renderAttractions(); renderMarkers(); closeModals();
});
document.getElementById('deleteAttrBtn').addEventListener('click', () => {
  if (editingContext?.index==null) return closeModals();
  attractions.splice(editingContext.index, 1);
  saveLocal(); renderAttractions(); renderMarkers(); closeModals();
});

// Data tab buttons
document.getElementById('saveLocalBtn').addEventListener('click', saveLocal);
document.getElementById('clearLocalBtn').addEventListener('click', () => {
  if (!confirm('Clear all locally saved data?')) return;
  localStorage.removeItem(LS_HIKES);
  localStorage.removeItem(LS_ACCOM);
  localStorage.removeItem(LS_ATTR);
  localStorage.removeItem(LS_HERO);
  location.reload();
});

document.getElementById('exportJsonBtn').addEventListener('click', () => {
  const payload = { hikes, accommodations, attractions, hero_image_url: localStorage.getItem(LS_HERO) || null };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pyrenees-data.json';
  a.click();
});
document.getElementById('importJsonBtn').addEventListener('click', () => document.getElementById('importJsonInput').click());
document.getElementById('importJsonInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const data = JSON.parse(text);
    if (data.hikes) hikes = data.hikes.map(normalizeHike);
    if (data.accommodations) accommodations = data.accommodations;
    if (data.attractions) attractions = data.attractions;
    if (typeof data.hero_image_url === 'string') {
      localStorage.setItem(LS_HERO, data.hero_image_url);
      applyHeroImage();
    }
    saveLocal();
    renderHikeCards(); renderAccommodations(); renderAttractions(); renderMarkers();
    alert('Imported JSON successfully.');
  } catch (err) {
    alert('Invalid JSON file.');
  }
});

// Excel import (Sheet 2 -> hikes)
document.getElementById('importXlsxBtn').addEventListener('click', () => document.getElementById('importXlsxInput').click());
document.getElementById('importXlsxInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data);
  const sheetName = workbook.SheetNames[1] || workbook.SheetNames[0]; // Sheet 2 by default
  const sheet = workbook.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json(sheet);
  hikes = json.map(normalizeHike);
  saveLocal();
  renderHikeCards(); renderMarkers();
  alert('Imported Excel sheet: ' + sheetName);
});

// Hero image URL controls
document.getElementById('saveHeroBtn').addEventListener('click', () => {
  const url = document.getElementById('heroUrlInput').value.trim();
  if (!url) return;
  localStorage.setItem(LS_HERO, url);
  applyHeroImage();
  alert('Hero image updated!');
});

// Fit all markers
document.getElementById('fitBoundsBtn').addEventListener('click', fitAll);

// Escape helpers
function escapeHtml(s) {
  if (s==null) return '';
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }

// Init
(async function init() {
  loadLocal();
  await loadFromFile();
  applyHeroImage(); // set hero image (GitHub URL or default)
  // Pre-fill hero URL input if stored
  const input = document.getElementById('heroUrlInput');
  const storedHero = localStorage.getItem(LS_HERO);
  if (input && storedHero) input.value = storedHero;

  renderHikeCards();
  renderAccommodations();
  renderAttractions();
  initMap();
})();
