/* =======================================
   Pyrenees Trip App — duplicate tabs hard fix
   ======================================= */
(() => {
  if (window.__PYRENEES_APP_INIT__) {
    console.debug('App already initialized — skipping.');
    return;
  }
  window.__PYRENEES_APP_INIT__ = true;

  // ----- Local storage keys (cache only) -----
  const LS_HIKES   = 'pyrenees_hikes';
  const LS_ACCOM   = 'pyrenees_accommodations';
  const LS_ATTR    = 'pyrenees_attractions';
  const LS_HERO    = 'pyrenees_hero_url';
  const LS_BACKEND = 'pyrenees_backend_url';

  // ----- State -----
  let hikes = [], accommodations = [], attractions = [];
  let hikeIds = [], accomIds = [], attrIds = [];
  let map, hikesLayer, accomLayer, attrLayer;
  let editingContext = null;
  let currentRegion = '';
  let isRefreshing = false;

  // ----- Helpers -----
  const $  = (id) => document.getElementById(id);
  const on = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); };
  const escapeHtml = (s) => s==null ? '' : String(s)
    .replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
  const escapeAttr = escapeHtml;
  const trimOrEmpty = (v) => (v==null ? '' : String(v).trim());
  const toNum = (v) => (v==='' || v==null || Number.isNaN(Number(v))) ? null : Number(v);

  // ----- Backend URL (hard-coded default; UI can override) -----
  function getBackendUrl() {
    return localStorage.getItem(LS_BACKEND)
      || 'https://script.google.com/macros/s/AKfycbzg2cc47dGtXS0AkHMJOhCGPlRsucGegFS_vTbDPB-5EMEEG2Ye5emi0fD8mBlDGEBAEg/exec';
  }
  on('saveBackendBtn', 'click', () => {
    const url = $('backendUrlInput')?.value.trim();
    if (!url) return alert('Paste your Web App URL ending with /exec');
    localStorage.setItem(LS_BACKEND, url);
    alert('Backend URL saved');
    refreshAllFromCloud();
  });
  on('refreshCloudBtn','click', refreshAllFromCloud);

  // ----- JSONP (no CORS) -----
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

  // ----- Normalizers -----
  function normalizeHike(raw) {
    const get = (o, keys) => { for (const k of keys) { const v = o?.[k]; if (v != null && v !== '') return v; } return ''; };
    return {
      id: raw.id || '',
      name: trimOrEmpty(get(raw, ['name','Name','מסלול','שם המסלול','title','route'])),
      region: trimOrEmpty(get(raw, ['region','Region','אזור','איזור','area'])),
      duration: trimOrEmpty(get(raw, ['duration','Duration','משך','time'])),
      difficulty: trimOrEmpty(get(raw, ['difficulty','Difficulty','דרגת קושי','קושי'])),
      starting_point: trimOrEmpty(get(raw, ['starting_point','Starting Point','start','trailhead','נקודת התחלה'])),
      link: trimOrEmpty(get(raw, ['link','Link','url','details','קישור'])),
      lat: toNum(raw.lat ?? raw.latitude),
      lon: toNum(raw.lon ?? raw.lng ?? raw.longitude),
      notes: trimOrEmpty(raw.notes || (raw.extra ? JSON.stringify(raw.extra) : ''))
    };
  }
  function normalizeAccom(raw) {
    const get = (o, keys) => { for (const k of keys) { const v = o?.[k]; if (v != null && v !== '') return v; } return ''; };
    return {
      id: raw.id || '',
      name: trimOrEmpty(get(raw, ['name','Name'])),
      region: trimOrEmpty(get(raw, ['region','Region'])),
      checkin_date: trimOrEmpty(get(raw, ['checkin_date','checkin','date'])),
      checkin_time: trimOrEmpty(get(raw, ['checkin_time','time'])),
      link: trimOrEmpty(get(raw, ['link','Link','url'])),
      lat: toNum(raw.lat ?? raw.latitude),
      lon: toNum(raw.lon ?? raw.lng ?? raw.longitude),
      notes: trimOrEmpty(raw.notes || '')
    };
  }
  function normalizeAttr(raw) {
    const get = (o, keys) => { for (const k of keys) { const v = o?.[k]; if (v != null && v !== '') return v; } return ''; };
    return {
      id: raw.id || '',
      name: trimOrEmpty(get(raw, ['name','Name'])),
      region: trimOrEmpty(get(raw, ['region','Region'])),
      category: trimOrEmpty(get(raw, ['category','type'])),
      link: trimOrEmpty(get(raw, ['link','Link','url'])),
      lat: toNum(raw.lat ?? raw.latitude),
      lon: toNum(raw.lon ?? raw.lng ?? raw.longitude),
      notes: trimOrEmpty(raw.notes || '')
    };
  }

  // ----- Cloud API -----
  async function cloudList(entity)    { return jsonp(getBackendUrl(), { op: 'list', entity }); }
  async function cloudAdd(entity, o)  { return jsonp(getBackendUrl(), { op: 'add', entity, data: JSON.stringify(o) }); }
  async function cloudUpdate(e, o)    { return jsonp(getBackendUrl(), { op: 'update', entity: e, data: JSON.stringify(o) }); }
  async function cloudDelete(e, id)   { return jsonp(getBackendUrl(), { op: 'delete', entity: e, id }); }
  async function cloudWipe(entity)    { return jsonp(getBackendUrl(), { op: 'wipe', entity }); }

  // ----- Cloud wrappers -----
  async function loadHikesFromCloud() {
    const res = await cloudList('hikes');
    if (!res?.ok) throw new Error(res?.error || 'Hikes load failed');
    hikes = (res.rows || []).map(normalizeHike);
    hikeIds = hikes.map(h => h.id || '');
  }
  async function loadAccomFromCloud() {
    const res = await cloudList('accommodations');
    if (!res?.ok) throw new Error(res?.error || 'Accommodations load failed');
    accommodations = (res.rows || []).map(normalizeAccom);
    accomIds = accommodations.map(a => a.id || '');
  }
  async function loadAttrFromCloud() {
    const res = await cloudList('attractions');
    if (!res?.ok) throw new Error(res?.error || 'Attractions load failed');
    attractions = (res.rows || []).map(normalizeAttr);
    attrIds = attractions.map(a => a.id || '');
  }

  async function addHikeCloud(o)   { const r=await cloudAdd('hikes',o); if(!r?.ok) throw new Error(r?.error||'Add failed'); await loadHikesFromCloud(); }
  async function updHikeCloud(i,o) { o.id = hikeIds[i]; const r=await cloudUpdate('hikes',o); if(!r?.ok) throw new Error(r?.error||'Update failed'); await loadHikesFromCloud(); }
  async function delHikeCloud(i)   { const r=await cloudDelete('hikes',hikeIds[i]); if(!r?.ok) throw new Error(r?.error||'Delete failed'); await loadHikesFromCloud(); }

  async function addAccomCloud(o)  { const r=await cloudAdd('accommodations',o); if(!r?.ok) throw new Error(r?.error||'Add failed'); await loadAccomFromCloud(); }
  async function updAccomCloud(i,o){ o.id = accomIds[i]; const r=await cloudUpdate('accommodations',o); if(!r?.ok) throw new Error(r?.error||'Update failed'); await loadAccomFromCloud(); }
  async function delAccomCloud(i)  { const r=await cloudDelete('accommodations',accomIds[i]); if(!r?.ok) throw new Error(r?.error||'Delete failed'); await loadAccomFromCloud(); }

  async function addAttrCloud(o)   { const r=await cloudAdd('attractions',o); if(!r?.ok) throw new Error(r?.error||'Add failed'); await loadAttrFromCloud(); }
  async function updAttrCloud(i,o) { o.id = attrIds[i]; const r=await cloudUpdate('attractions',o); if(!r?.ok) throw new Error(r?.error||'Update failed'); await loadAttrFromCloud(); }
  async function delAttrCloud(i)   { const r=await cloudDelete('attractions',attrIds[i]); if(!r?.ok) throw new Error(r?.error||'Delete failed'); await loadAttrFromCloud(); }

  // ----- Top bar hard normalization (DESTROYS duplicates) -----
  const CANON_TABS = [
    { id: 'hikes',          label: 'Hikes' },
    { id: 'accommodations', label: 'Accommodations' },
    { id: 'attractions',    label: 'Attractions' },
    { id: 'map',            label: 'Map' },
    { id: 'data',           label: 'Data' }
  ];

  function normalizeTopbar() {
    // Keep only the first header.topbar, remove the rest.
    const headers = [...document.querySelectorAll('header.topbar')];
    headers.forEach((h, i) => { if (i > 0) h.remove(); });

    let header = headers[0] || document.querySelector('header.topbar');
    if (!header) {
      // If somehow missing, create it at the top of body to avoid duplication forever.
      header = document.createElement('header');
      header.className = 'topbar';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = 'Pyrenees Family Trip';
      const nav = document.createElement('nav');
      nav.className = 'nav';
      header.append(title, nav);
      document.body.prepend(header);
    }

    // Remove any stray navs not inside the single header.
    [...document.querySelectorAll('body .nav')].forEach(n => {
      if (!header.contains(n)) n.remove();
    });

    // Rebuild the header's nav from the canonical set.
    const nav = header.querySelector('.nav') || header.appendChild(Object.assign(document.createElement('nav'), { className: 'nav' }));
    nav.innerHTML = CANON_TABS.map((t, i) =>
      `<button class="tab-btn ${i===0?'active':''}" data-tab="${t.id}">${t.label}</button>`
    ).join('');

    // Ensure we have exactly one section per tab id; if duplicates exist, keep first and remove the rest.
    CANON_TABS.forEach(t => {
      const sections = [...document.querySelectorAll(`#${CSS.escape(t.id)}`)];
      sections.forEach((sec, i) => { if (i > 0) sec.remove(); });
    });

    // Make the first tab's section visible; hide others.
    document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('visible'));
    const first = document.getElementById(CANON_TABS[0].id);
    if (first) first.classList.add('visible');

    // Wire tab clicks (idempotent since we rebuilt the nav).
    nav.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        nav.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('visible'));
        document.getElementById(tab)?.classList.add('visible');
        if (tab === 'map') setTimeout(() => map?.invalidateSize(), 200);
      });
    });
  }

  // ----- Regions & hike cards -----
  function getRegions() {
    return Array.from(new Set(hikes
      .map(h => (h.region || '').trim())
      .filter(Boolean)
    )).sort((a,b)=>a.localeCompare(b));
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

  // ----- Lists -----
  function renderAccommodations() {
    const list = $('accommodationsList'); if (!list) return;
    if (!accommodations.length) {
      list.innerHTML = '<div class="list-item"><div>No accommodations yet. Click "+ Add Accommodation".</div></div>'; return;
    }
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
    if (!attractions.length) {
      list.innerHTML = '<div class="list-item"><div>No attractions yet. Click "+ Add Attraction".</div></div>'; return;
    }
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

  // ----- Modals & actions -----
  const backdrop = $('modalBackdrop');
  function openModal(el) {
    document.body.classList.add('no-scroll');
    backdrop?.classList.remove('hidden');
    el?.classList.remove('hidden');
  }
  function closeModals() {
    document.body.classList.remove('no-scroll');
    backdrop?.classList.add('hidden');
    $('hikeModal')?.classList.add('hidden');
    $('accomModal')?.classList.add('hidden');
    $('attrModal')?.classList.add('hidden');
    editingContext = null;
  }
  document.querySelectorAll('.close-modal').forEach(btn => btn.addEventListener('click', closeModals));
  backdrop?.addEventListener('click', closeModals);

  // Hike modal
  on('addHikeBtn','click', () => openHikeModal(null));
  function openHikeModal(index) {
    editingContext = { type: 'hike', index };
    const h = index==null ? {} : hikes[index];
    $('hikeModalTitle').textContent = index==null ? 'Add Hike' : 'Edit Hike';
    $('hikeName').value = h?.name || '';
    $('hikeRegion').value = h?.region || '';
    $('hikeDuration').value = h?.duration || '';
    $('hikeDifficulty').value = h?.difficulty || '';
    $('hikeStart').value = h?.starting_point || '';
    $('hikeLink').value = h?.link || '';
    $('hikeLat').value = h?.lat ?? '';
    $('hikeLon').value = h?.lon ?? '';
    $('hikeNotes').value = h?.notes || '';
    openModal($('hikeModal'));
  }
  on('saveHikeBtn','click', async () => {
    const obj = {
      name: $('hikeName').value.trim(),
      region: $('hikeRegion').value.trim(),
      duration: $('hikeDuration').value.trim(),
      difficulty: $('hikeDifficulty').value.trim(),
      starting_point: $('hikeStart').value.trim(),
      link: $('hikeLink').value.trim(),
      lat: parseFloat($('hikeLat').value),
      lon: parseFloat($('hikeLon').value),
      notes: $('hikeNotes').value.trim()
    };
    if (Number.isNaN(obj.lat)) obj.lat = null;
    if (Number.isNaN(obj.lon)) obj.lon = null;
    try { editingContext.index==null ? await addHikeCloud(obj) : await updHikeCloud(editingContext.index, obj); closeModals(); renderHikeCards(); renderMarkers(); }
    catch (e) { alert('Save failed: ' + e.message); }
  });
  on('deleteHikeBtn','click', async () => {
    if (editingContext?.index==null) return closeModals();
    try { await delHikeCloud(editingContext.index); closeModals(); renderHikeCards(); renderMarkers(); }
    catch (e) { alert('Delete failed: ' + e.message); }
  });

  // Accommodation modal
  on('addAccomBtn','click', () => openAccomModal(null));
  function openAccomModal(index) {
    editingContext = { type: 'accom', index };
    const a = index==null ? {} : accommodations[index];
    $('accomModalTitle').textContent = index==null ? 'Add Accommodation' : 'Edit Accommodation';
    $('accomName').value = a?.name || '';
    $('accomRegion').value = a?.region || '';
    $('accomCheckinDate').value = a?.checkin_date || '';
    $('accomCheckinTime').value = a?.checkin_time || '';
    $('accomLink').value = a?.link || '';
    $('accomLat').value = a?.lat ?? '';
    $('accomLon').value = a?.lon ?? '';
    $('accomNotes').value = a?.notes || '';
    openModal($('accomModal'));
  }
  on('saveAccomBtn','click', async () => {
    const obj = {
      name: $('accomName').value.trim(),
      region: $('accomRegion').value.trim(),
      checkin_date: $('accomCheckinDate').value,
      checkin_time: $('accomCheckinTime').value,
      link: $('accomLink').value.trim(),
      lat: parseFloat($('accomLat').value),
      lon: parseFloat($('accomLon').value),
      notes: $('accomNotes').value.trim()
    };
    if (Number.isNaN(obj.lat)) obj.lat = null;
    if (Number.isNaN(obj.lon)) obj.lon = null;
    try { editingContext.index==null ? await addAccomCloud(obj) : await updAccomCloud(editingContext.index, obj); closeModals(); renderAccommodations(); renderMarkers(); }
    catch (e) { alert('Save failed: ' + e.message); }
  });
  on('deleteAccomBtn','click', async () => {
    if (editingContext?.index==null) return closeModals();
    try { await delAccomCloud(editingContext.index); closeModals(); renderAccommodations(); renderMarkers(); }
    catch (e) { alert('Delete failed: ' + e.message); }
  });

  // Attraction modal
  on('addAttrBtn','click', () => openAttrModal(null));
  function openAttrModal(index) {
    editingContext = { type: 'attr', index };
    const t = index==null ? {} : attractions[index];
    $('attrModalTitle').textContent = index==null ? 'Add Attraction' : 'Edit Attraction';
    $('attrName').value = t?.name || '';
    $('attrRegion').value = t?.region || '';
    $('attrCategory').value = t?.category || '';
    $('attrLink').value = t?.link || '';
    $('attrLat').value = t?.lat ?? '';
    $('attrLon').value = t?.lon ?? '';
    $('attrNotes').value = t?.notes || '';
    openModal($('attrModal'));
  }
  on('saveAttrBtn','click', async () => {
    const obj = {
      name: $('attrName').value.trim(),
      region: $('attrRegion').value.trim(),
      category: $('attrCategory').value.trim(),
      link: $('attrLink').value.trim(),
      lat: parseFloat($('attrLat').value),
      lon: parseFloat($('attrLon').value),
      notes: $('attrNotes').value.trim()
    };
    if (Number.isNaN(obj.lat)) obj.lat = null;
    if (Number.isNaN(obj.lon)) obj.lon = null;
    try { editingContext.index==null ? await addAttrCloud(obj) : await updAttrCloud(editingContext.index, obj); closeModals(); renderAttractions(); renderMarkers(); }
    catch (e) { alert('Save failed: ' + e.message); }
  });
  on('deleteAttrBtn','click', async () => {
    if (editingContext?.index==null) return closeModals();
    try { await delAttrCloud(editingContext.index); closeModals(); renderAttractions(); renderMarkers(); }
    catch (e) { alert('Delete failed: ' + e.message); }
  });

  // ----- Data tab actions -----
  on('exportJsonBtn','click', () => {
    const payload = {
      hikes, accommodations, attractions,
      hero_image_url: localStorage.getItem(LS_HERO) || null,
      backend_url: getBackendUrl()
    };
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
      if (data.accommodations) accommodations = data.accommodations.map(normalizeAccom);
      if (data.attractions) attractions = data.attractions.map(normalizeAttr);
      if (typeof data.hero_image_url === 'string') { localStorage.setItem(LS_HERO, data.hero_image_url); applyHeroImage(); }
      if (typeof data.backend_url === 'string') { localStorage.setItem(LS_BACKEND, data.backend_url); $('backendUrlInput').value = data.backend_url; }
      renderHikeCards(); renderAccommodations(); renderAttractions(); renderMarkers();
      alert('Imported JSON (local cache only).');
    } catch { alert('Invalid JSON.'); }
  });

  on('importXlsxBtn','click', () => $('importXlsxInput')?.click());
  on('importXlsxInput','change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const sheetName = workbook.SheetNames[1] || workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet).map(normalizeHike);
    try {
      await cloudWipe('hikes');
      for (const h of json) { await cloudAdd('hikes', h); }
      await loadHikesFromCloud();
      renderHikeCards(); renderMarkers();
      alert('Excel imported to cloud (Hikes): ' + sheetName);
    } catch (err) {
      alert('Excel import failed: ' + err.message);
    }
  });

  on('wipeHikesBtn','click', async () => { if (!confirm('Wipe all Hikes in the cloud?')) return; await cloudWipe('hikes'); hikes=[]; hikeIds=[]; renderHikeCards(); renderMarkers(); });
  on('wipeAccomBtn','click', async () => { if (!confirm('Wipe all Accommodations in the cloud?')) return; await cloudWipe('accommodations'); accommodations=[]; accomIds=[]; renderAccommodations(); renderMarkers(); });
  on('wipeAttrBtn','click', async () => { if (!confirm('Wipe all Attractions in the cloud?')) return; await cloudWipe('attractions'); attractions=[]; attrIds=[]; renderAttractions(); renderMarkers(); });

  // ----- Map focus helpers -----
  function focusHikeOnMap(idx) { const h = hikes[idx]; if (!h || h.lat==null || h.lon==null) return; document.querySelector('[data-tab="map"]')?.click(); setTimeout(() => { map?.setView([h.lat, h.lon], 12); }, 150); }
  function focusAccomOnMap(idx) { const a = accommodations[idx]; if (!a || a.lat==null || a.lon==null) return; document.querySelector('[data-tab="map"]')?.click(); setTimeout(() => { map?.setView([a.lat, a.lon], 12); }, 150); }
  function focusAttrOnMap(idx) { const t = attractions[idx]; if (!t || t.lat==null || t.lon==null) return; document.querySelector('[data-tab="map"]')?.click(); setTimeout(() => { map?.setView([t.lat, t.lon], 12); }, 150); }

  // ----- Init & refresh -----
  async function refreshAllFromCloud() {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
      await Promise.all([loadHikesFromCloud(), loadAccomFromCloud(), loadAttrFromCloud()]);
      renderHikeCards(); renderAccommodations(); renderAttractions(); renderMarkers();
    } catch (e) {
      console.warn('Cloud refresh failed:', e);
    } finally {
      isRefreshing = false;
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    // Brutally normalize the header/nav to a single canonical set
    normalizeTopbar();

    // Prefill inputs if present
    const be = localStorage.getItem(LS_BACKEND) || getBackendUrl();
    const beInput = $('backendUrlInput'); if (beInput) beInput.value = be;
    const hero = localStorage.getItem(LS_HERO); if (hero) { const i = $('heroUrlInput'); if (i) i.value = hero; }

    // Hero & Map
    applyHeroImage();
    initMap();

    // Load from cloud
    await refreshAllFromCloud();

    // Optional: auto-refresh
    // setInterval(refreshAllFromCloud, 30000);
  });

  // Reset hikes from inline seed (optional)
  on('resetHikesBtn','click', async () => {
    if (!confirm('Overwrite all cloud Hikes with the inline seed?')) return;
    await cloudWipe('hikes');
    for (const raw of (window.BUNDLED_HIKES || [])) await cloudAdd('hikes', normalizeHike(raw));
    await loadHikesFromCloud();
    renderHikeCards(); renderMarkers();
    alert('Cloud Hikes reset from inline seed.');
  });
})();
