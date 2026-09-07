'use strict';
/* ═══════════════════════════════════════════════════════════
   SEARCH — Arama, öneriler, YouTube/Spotify playlist
   ═══════════════════════════════════════════════════════════ */

// ── Recent Searches ───────────────────────────────────────────
const RECENT_KEY = 'lcc_recent_searches';
const RECENT_MAX = 8;

function getRecentSearches() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}

function saveRecentSearch(query) {
  if (!query || query.length < 2) return;
  let recents = getRecentSearches().filter(q => q !== query);
  recents.unshift(query);
  if (recents.length > RECENT_MAX) recents = recents.slice(0, RECENT_MAX);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recents));
}

function deleteRecentSearch(query, event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  const recents = getRecentSearches().filter(q => q !== query);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recents));
  renderRecentSearches();

  const dropdown = $('recent-searches-dropdown');
  const input = $('search-input');
  if (recents.length > 0) {
    if (dropdown) dropdown.classList.add('visible');
    if (input) input.focus();
  } else {
    if (dropdown) dropdown.classList.remove('visible');
  }
}

window.clearRecentSearches = function(event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  localStorage.removeItem(RECENT_KEY);
  renderRecentSearches();
  const dropdown = $('recent-searches-dropdown');
  if (dropdown) dropdown.classList.remove('visible');
};

function renderRecentSearches() {
  const list = $('recent-searches-list');
  const dropdown = $('recent-searches-dropdown');
  if (!list || !dropdown) return;

  const recents = getRecentSearches();
  if (!recents.length) {
    dropdown.classList.remove('visible');
    return;
  }

  list.innerHTML = recents.map(q => {
    const qJson = JSON.stringify(q).replace(/"/g, '&quot;');
    return `
    <div class="recent-search-item" onclick="recentSearchClick(${qJson})">
      <div class="recent-search-icon">
        <span class="material-symbols-outlined">schedule</span>
      </div>
      <span class="recent-search-text">${escHtml(q)}</span>
      <button class="recent-search-delete" onmousedown="event.preventDefault();event.stopPropagation();" onclick="event.stopPropagation();event.preventDefault();deleteRecentSearch(${qJson}, event)" title="Kaldır">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>`;
  }).join('');
}

function showRecentDropdown() {
  const dropdown = $('recent-searches-dropdown');
  const input = $('search-input');
  if (!dropdown || !input || input.value.trim()) return;
  const recents = getRecentSearches();
  if (!recents.length) return;
  renderRecentSearches();
  dropdown.classList.add('visible');
}

function hideRecentDropdown() {
  setTimeout(() => {
    // If activeElement is still inside search input or dropdown, don't hide
    const active = document.activeElement;
    if (active && (active.id === 'search-input' || active.closest?.('#recent-searches-dropdown'))) return;
    const dropdown = $('recent-searches-dropdown');
    if (dropdown) dropdown.classList.remove('visible');
  }, 150);
}

window.recentSearchClick = function(query) {
  const input = $('search-input');
  if (input) input.value = query;
  const clear = $('search-clear');
  if (clear) clear.style.display = '';
  const dropdown = $('recent-searches-dropdown');
  if (dropdown) dropdown.classList.remove('visible');
  doSearch(query);
};

window.deleteRecentSearch = deleteRecentSearch;

// ── Setup ─────────────────────────────────────────────────────
function setupSearch() {
  const input = $('search-input');
  const clear = $('search-clear');
  const spinner = $('search-spinner');
  const dropdown = $('recent-searches-dropdown');
  
  if (dropdown) {
    // Prevent mouse down inside dropdown from causing search-input to blur
    dropdown.addEventListener('mousedown', e => {
      if (e.target.closest('.recent-search-delete') || e.target.closest('.recent-clear-all')) {
        e.preventDefault();
      }
    });
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clear.style.display = q ? '' : 'none';
    // Arama yazılınca dropdown gizlenir
    if (dropdown && q) dropdown.classList.remove('visible');
    clearTimeout(searchDebounce);
    if (!q) { if (State.currentView === 'search') loadView('discover'); return; }

    // Intercept lumina:// links or LUMINA- codes immediately on paste/type
    if (q.toLowerCase().startsWith('lumina://') || q.startsWith('LUMINA-')) {
      input.value = '';
      clear.style.display = 'none';
      processSharedLink(q);
      return;
    }

    // Intercept YouTube playlist link or Spotify playlist link directly
    if (q.includes('youtube.com/playlist?list=') || q.includes('music.youtube.com/playlist?list=') || q.includes('spotify.com/playlist/') || q.includes('spotify.com/album/')) {
      clearTimeout(searchDebounce);
      doSearch(q);
      return;
    }

    searchDebounce = setTimeout(() => doSearch(q), 400);
  });
  
  input.addEventListener('focus', () => showRecentDropdown());
  input.addEventListener('blur', () => hideRecentDropdown());
  
  clear.onclick = () => {
    input.value = '';
    clear.style.display = 'none';
    if (dropdown) dropdown.classList.remove('visible');
    if (State.currentView === 'search') loadView('discover');
  };
  
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && input.value.trim()) {
      const dropdown = $('recent-searches-dropdown');
      if (dropdown) dropdown.classList.remove('visible');
      doSearch(input.value.trim());
    }
    if (e.key === 'Escape') {
      hideRecentDropdown();
      input.blur();
    }
  });
}

let searchDebounce;
State.searchFilter = State.searchFilter || 'all';
State.searchViewMode = localStorage.getItem('lcc_search_view_mode') || 'hybrid';

async function doSearch(query) {
  const lq = query.toLowerCase().trim();

  // 1) Intercept lumina links immediately in doSearch (NO MODAL)
  if (lq.startsWith('lumina://') || query.startsWith('LUMINA-')) {
    const spinner = $('search-spinner');
    if (spinner) spinner.style.display = 'none';
    const input = $('search-input');
    if (input) input.value = '';
    const clear = $('search-clear');
    if (clear) clear.style.display = 'none';
    processSharedLink(query);
    return;
  }

  // 2) Intercept YouTube playlist links directly into search view (NO MODAL)
  if (query.includes('youtube.com/playlist?list=') || query.includes('music.youtube.com/playlist?list=')) {
    try {
      const url = new URL(query);
      const plId = url.searchParams.get('list');
      if (plId) {
        const spinner = $('search-spinner');
        if (spinner) spinner.style.display = 'none';
        State.isSearching = false;
        openYoutubePlaylist(plId);
        return;
      }
    } catch (_) {}
  }

  // 3) Intercept Spotify playlist/album links directly into search view (NO MODAL)
  if (query.includes('spotify.com/playlist/') || query.includes('spotify.com/album/')) {
    const spinner = $('search-spinner');
    if (spinner) spinner.style.display = 'block';
    State.currentView = 'search';
    State.searchQuery = query;
    State.searchToken = null;
    State.isSearching = true;
    showView('search');
    setActiveNav(null);

    try {
      const sp = await window.lumina.resolveSpotify(query);
      if (spinner) spinner.style.display = 'none';
      State.isSearching = false;

      if (sp && sp.tracks && sp.tracks.length > 0) {
        renderSharedPlaylistInSearch({
          name: sp.title || 'Spotify Çalma Listesi',
          customCover: sp.cover || null,
          tracks: sp.tracks.map(t => ({
            id: 'spotify:' + (t.query || (t.title + ' ' + t.artist)),
            title: t.title,
            author: t.artist || '',
            duration: t.duration || '',
            thumbnail: t.thumbnail || sp.cover || ''
          }))
        }, query, false, null, 'Spotify Çalma Listesi');
        return;
      }
    } catch (err) {
      if (spinner) spinner.style.display = 'none';
      State.isSearching = false;
    }
  }

  // 4) Intercept Spotify/YouTube channel or user profiles ONLY (if not playlist)
  const isSpotify = lq.includes('spotify.com/');
  const isYoutube = lq.includes('youtube.com/') || lq.includes('youtu.be/');
  const isProfileOnly = lq.includes('/user/') || lq.includes('@') || lq.includes('/channel/');
  
  if ((isSpotify || isYoutube) && isProfileOnly) {
    // Hide spinner & clear search bar
    const spinner = $('search-spinner');
    if (spinner) spinner.style.display = 'none';
    const input = $('search-input');
    if (input) input.value = '';
    
    // Trigger the import modal and resolve it
    if (window.showImportProfileModal) {
      await window.showImportProfileModal();
      const modalInput = $('profile-url-input');
      if (modalInput) {
        modalInput.value = query;
        if (window._resolveProfileFromInput) {
          window._resolveProfileFromInput();
        }
      }
    }
    return;
  }

  const spinner = $('search-spinner');
  spinner.style.display = 'block';
  State.currentView = 'search';
  State.searchQuery = query;
  State.searchToken = null;
  State.isSearching = true;
  showView('search');
  setActiveNav(null);

  const view = $('view-search');
  view.innerHTML = `
    <div class="search-header-container">
      <div class="search-header-top">
        <div class="search-query-info">
          <span class="search-title-text">Arama: "${escHtml(query)}"</span>
        </div>
      </div>
    </div>
    <div class="search-skeleton-hero"></div>
    <div class="search-track-list">
      ${Array(6).fill(0).map(() => `<div class="search-skeleton-row"></div>`).join('')}
    </div>`;
  
  let results;
  if (query.includes('spotify.com/')) {
    const sp = await window.lumina.resolveSpotify(query);
    if (sp && sp.tracks) {
      view.innerHTML = `
        <div class="section-header">
          <span class="section-title" style="display:flex;align-items:center;gap:8px">
            <svg style="color:#1DB954;width:20px;height:20px" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.6 14.4c-.2.32-.6.42-.92.2-2.52-1.54-5.68-1.88-9.42-1.04-.36.08-.72-.14-.8-.5-.08-.36.14-.72.5-.8 4.12-.9 7.64-.52 10.42 1.18.32.2.42.6.22.92zm1.26-2.84c-.24.4-.76.54-1.16.3-2.88-1.76-7.3-2.32-10.82-1.28-.46.14-.94-.12-1.08-.58-.14-.46.12-.94.58-1.08 4.02-1.2 8.94-.58 12.2 1.44.4.24.54.74.28 1.14zM18.12 9.3c-3.46-2.06-9.18-2.24-12.48-1.24-.54.16-1.12-.14-1.28-.68-.16-.54.14-1.12.68-1.28 3.86-1.14 10.18-.94 14.18 1.44.5.3.66.92.36 1.42-.28.48-.9.64-1.42.34z"/></svg>
            Spotify: ${escHtml(sp.title)}
          </span>
          <div style="display:flex;gap:12px">
            <button class="btn-secondary" id="btn-follow-spotify" onclick="followSpotifyPlaylist(${JSON.stringify({title: sp.title, cover: sp.cover, url: query}).replace(/"/g,'&quot;')})" style="font-size:12px;padding:7px 14px;display:flex;align-items:center;gap:6px">
              <span class="material-symbols-outlined" style="font-size:14px">favorite</span>
              Kütüphaneye Ekle
            </button>
            <button class="btn-primary" onclick="playSpotifyAll()" style="font-size:12px;padding:7px 14px">Tümünü Çal</button>
          </div>
        </div>
        <div class="search-track-list" id="search-container"></div>`;
      
      results = sp.tracks.map(t => ({
        id: 'spotify:' + t.query,
        title: t.title,
        author: t.artist,
        thumbnail: t.thumbnail,
        duration: t.duration || ''
      }));
      window.__lastSpotifyTracks = results;
      State.searchToken = null;
      State.searchResults = results;
      spinner.style.display = 'none';
      State.isSearching = false;
      renderSearchListOnly($('search-container'), results);
      return;
    } else {
      results = [];
      State.searchToken = null;
    }
  } else if (query.includes('youtube.com/playlist?list=') || query.includes('music.youtube.com/playlist?list=')) {
    const url = new URL(query);
    const plId = url.searchParams.get('list');
    if (plId) {
      spinner.style.display = 'none';
      State.isSearching = false;
      openYoutubePlaylist(plId);
      return;
    }
  } else {
    const res = await window.lumina.search(query);
    results = res.items || [];
    State.searchToken = res.token || null;
  }

  State.searchResults = results;
  spinner.style.display = 'none';
  State.isSearching = false;
  renderSearchPage();
}

// ── Render Search Page (Full Modern Experience) ───────────────
function renderSearchPage() {
  const view = $('view-search');
  if (!view || State.currentView !== 'search') return;

  const query = State.searchQuery || '';
  const results = State.searchResults || [];
  const activeFilter = State.searchFilter || 'all';
  const viewMode = State.searchViewMode || 'hybrid';

  if (!results.length) {
    view.innerHTML = `
      <div class="search-header-container">
        <div class="search-header-top">
          <div class="search-query-info">
            <span class="search-title-text">Arama: "${escHtml(query)}"</span>
          </div>
        </div>
      </div>
      <div class="empty-state" style="margin-top: 40px;">
        <span class="material-symbols-outlined" style="font-size:56px;opacity:0.35;margin-bottom:14px;color:var(--c-accent)">search_off</span>
        <div class="empty-state-title">Sonuç Bulunamadı</div>
        <div class="empty-state-sub" style="font-size:13.5px;color:rgba(255,255,255,0.45);margin-top:6px;">Farklı bir şarkı adı, sanatçı veya albüm arayabilirsiniz.</div>
      </div>`;
    return;
  }

  // Filter items based on active filter pill
  let filtered = [...results];
  if (activeFilter === 'tracks') {
    filtered = results.filter(t => t.type !== 'playlist');
  } else if (activeFilter === 'playlists') {
    filtered = results.filter(t => t.type === 'playlist');
  }

  const tracksOnly = results.filter(t => t.type !== 'playlist');
  const playlistsOnly = results.filter(t => t.type === 'playlist');

  // Build Filter Pills and Header HTML
  const headerHtml = `
    <div class="search-header-container">
      <div class="search-header-top">
        <div class="search-query-info">
          <span class="search-title-text">Arama: "${escHtml(query)}"</span>
          <span class="search-count-badge">${filtered.length} sonuç</span>
        </div>
        <div class="search-view-switcher">
          <button class="search-view-btn ${viewMode === 'hybrid' || viewMode === 'list' ? 'active' : ''}" onclick="setSearchViewMode('list')" title="Liste Görünümü">
            <span class="material-symbols-outlined">format_list_bulleted</span>
            <span>Liste</span>
          </button>
          <button class="search-view-btn ${viewMode === 'grid' ? 'active' : ''}" onclick="setSearchViewMode('grid')" title="Izgara Kartlar">
            <span class="material-symbols-outlined">grid_view</span>
            <span>Izgara</span>
          </button>
        </div>
      </div>
      <div class="search-filter-pills">
        <button class="search-filter-pill ${activeFilter === 'all' ? 'active' : ''}" onclick="setSearchFilter('all')">
          <span class="material-symbols-outlined" style="font-size:15px">explore</span> Tümü
        </button>
        <button class="search-filter-pill ${activeFilter === 'tracks' ? 'active' : ''}" onclick="setSearchFilter('tracks')">
          <span class="material-symbols-outlined" style="font-size:15px">music_note</span> Şarkılar (${tracksOnly.length})
        </button>
        <button class="search-filter-pill ${activeFilter === 'playlists' ? 'active' : ''}" onclick="setSearchFilter('playlists')">
          <span class="material-symbols-outlined" style="font-size:15px">queue_music</span> Çalma Listeleri (${playlistsOnly.length})
        </button>
      </div>
    </div>`;

  let contentHtml = '';

  if (viewMode === 'grid') {
    // Pure Grid Mode
    contentHtml = `<div class="tracks-grid" id="search-grid"></div>`;
    view.innerHTML = headerHtml + contentHtml;
    renderTrackGrid($('search-grid'), filtered);
  } else if (activeFilter === 'all') {
    // Hybrid Mode: Top Result Spotlight + Songs List + Other Matches
    const topTrack = filtered[0];
    const topSongs = filtered.slice(1, 6);
    const otherResults = filtered.slice(6);

    let heroHtml = '';
    if (topTrack) {
      const isTopPl = topTrack.type === 'playlist';
      const topJson = JSON.stringify(topTrack).replace(/"/g, '&quot;');
      const isPlaying = State.currentTrack?.id === topTrack.id;
      const isLiked = State.liked?.has(topTrack.id);
      const topClickHandler = `onCardClick(${topJson})`;
      const topPlayHandler = isTopPl ? `event.stopPropagation();playYoutubePlaylistAll('${topTrack.id}')` : `event.stopPropagation();playTrackFromGrid(${topJson})`;

      heroHtml = `
        <div class="search-top-result-wrap">
          <div class="search-top-result-card ${isPlaying ? 'playing' : ''}" onclick="${topClickHandler}" oncontextmenu="showTrackContextMenu(event, ${topJson}, 'global')">
            <div class="search-hero-left">
              <div class="search-hero-thumb-wrap">
                <img class="search-hero-thumb" src="${escHtml(topTrack.thumbnail || '')}" onerror="this.src=''" loading="lazy" />
              </div>
              <div class="search-hero-info">
                <div class="search-hero-badge">
                  <span class="material-symbols-outlined">${isTopPl ? 'queue_music' : 'star'}</span>
                  ${isTopPl ? 'EN İYİ ÇALMA LİSTESİ' : 'EN İYİ EŞLEŞME'}
                </div>
                <div class="search-hero-title" title="${escHtml(topTrack.title)}">${escHtml(topTrack.title)}</div>
                <div class="search-hero-meta">
                  <span>${escHtml(topTrack.author || 'LCC Music')}</span>
                  <span class="bullet">•</span>
                  <span>${isTopPl ? (topTrack.videoCount || 'Çalma Listesi') : (topTrack.duration || 'Şarkı')}</span>
                </div>
              </div>
            </div>
            <div class="search-hero-right">
              ${!isTopPl ? `
                <button class="search-hero-action-btn ${isLiked ? 'liked' : ''}" onclick="event.stopPropagation();toggleLike(${topJson});renderSearchPage();" title="${isLiked ? 'Beğenilerden Çıkar' : 'Beğen'}">
                  <span class="material-symbols-outlined" style="font-size:20px">${isLiked ? 'favorite' : 'favorite_border'}</span>
                </button>
                <button class="search-hero-action-btn" onclick="event.stopPropagation();downloadTrack(${topJson})" title="İndir">
                  <span class="material-symbols-outlined" style="font-size:20px">download</span>
                </button>
                <button class="search-hero-action-btn" onclick="event.stopPropagation();addToQueue(${topJson});showToast('Sıraya eklendi', 'success');" title="Sıraya Ekle">
                  <span class="material-symbols-outlined" style="font-size:20px">playlist_add</span>
                </button>
              ` : ''}
              <button class="search-hero-play-btn" onclick="${topPlayHandler}" title="Çal">
                <span class="material-symbols-outlined" style="font-size:26px">${isPlaying && !window.audio?.paused ? 'pause' : 'play_arrow'}</span>
              </button>
            </div>
          </div>
        </div>`;
    }

    let topSongsHtml = '';
    if (topSongs.length) {
      topSongsHtml = `
        <div class="search-section-title-wrap">
          <span class="search-section-title">Şarkılar</span>
        </div>
        <div class="search-track-list">
          ${topSongs.map((t, idx) => renderSearchTrackRow(t, idx + 1, filtered)).join('')}
        </div>`;
    }

    let otherHtml = '';
    if (otherResults.length) {
      otherHtml = `
        <div class="search-section-title-wrap">
          <span class="search-section-title">Diğer Sonuçlar & Alternatifler</span>
        </div>
        <div class="tracks-grid" id="search-grid"></div>`;
    }

    view.innerHTML = headerHtml + heroHtml + topSongsHtml + otherHtml;
    if (otherResults.length) {
      renderTrackGrid($('search-grid'), otherResults);
    }
  } else {
    // Pure List Mode
    contentHtml = `
      <div class="search-track-list" id="search-track-list">
        ${filtered.map((t, idx) => renderSearchTrackRow(t, idx, filtered)).join('')}
      </div>`;
    view.innerHTML = headerHtml + contentHtml;
  }

  // Update Audio Cache badges
  if (window.AudioCacheManager) {
    results.forEach(t => {
      if (window.AudioCacheManager.isCached(t.id)) {
        window.markTrackCached(t.id, true);
      }
    });
  }
}

// ── Search Track Row (Spotify Style) ─────────────────────────
function renderSearchTrackRow(t, index, allTracks) {
  const isPlaylist = t.type === 'playlist';
  const jsonStr = JSON.stringify(t).replace(/"/g, '&quot;');
  const isPlaying = State.currentTrack?.id === t.id;
  const isLiked = State.liked?.has(t.id);
  const clickHandler = `onCardClick(${jsonStr})`;
  const playBtnHandler = isPlaylist ? `event.stopPropagation();playYoutubePlaylistAll('${t.id}')` : `event.stopPropagation();playTrackFromGrid(${jsonStr})`;

  return `
    <div class="search-track-row ${isPlaying ? 'playing' : ''}"
      data-id="${t.id}"
      draggable="true"
      ondragstart="window.onTrackDragStart(event, ${jsonStr})"
      onclick="${clickHandler}"
      oncontextmenu="showTrackContextMenu(event, ${jsonStr}, 'global')">
      
      <div class="row-num-col">
        <span class="track-index-num">${index !== undefined ? index + 1 : ''}</span>
        <span class="material-symbols-outlined row-play-icon" onclick="${playBtnHandler}">play_arrow</span>
        <div class="row-eq-icon"><span></span><span></span><span></span></div>
      </div>

      <div class="search-row-thumb-wrap">
        <img class="search-row-thumb" src="${escHtml(t.thumbnail || '')}" onerror="this.src=''" loading="lazy" />
      </div>

      <div class="search-row-info">
        <div class="search-row-title" title="${escHtml(t.title)}">${escHtml(t.title)}</div>
        <div class="search-row-artist">
          <span class="search-type-pill">${isPlaylist ? 'Çalma Listesi' : 'Şarkı'}</span>
          <span>${escHtml(t.author || 'Bilinmeyen')}</span>
        </div>
      </div>

      <span class="search-row-duration">${escHtml(t.videoCount || t.duration || '')}</span>

      <div class="search-row-actions">
        ${!isPlaylist ? `
          <button class="search-action-btn ${isLiked ? 'liked' : ''}" onclick="event.stopPropagation();toggleLike(${jsonStr});this.classList.toggle('liked');" title="${isLiked ? 'Beğenilerden Çıkar' : 'Beğen'}">
            <span class="material-symbols-outlined">${isLiked ? 'favorite' : 'favorite_border'}</span>
          </button>
          <button class="search-action-btn" onclick="event.stopPropagation();downloadTrack(${jsonStr})" title="İndir">
            <span class="material-symbols-outlined">download</span>
          </button>
          <button class="search-action-btn" onclick="event.stopPropagation();addToQueue(${jsonStr});showToast('Sıraya eklendi', 'success');" title="Sıraya Ekle">
            <span class="material-symbols-outlined">playlist_add</span>
          </button>
        ` : ''}
        <button class="search-action-btn" onclick="event.stopPropagation();showTrackContextMenu(event, ${jsonStr}, 'global')" title="Daha Fazla">
          <span class="material-symbols-outlined">more_vert</span>
        </button>
      </div>
    </div>`;
}

function renderSearchListOnly(container, tracks) {
  if (!container) return;
  container.innerHTML = tracks.map((t, idx) => renderSearchTrackRow(t, idx, tracks)).join('');
}

window.setSearchFilter = function(filterKey) {
  State.searchFilter = filterKey;
  renderSearchPage();
};

window.setSearchViewMode = function(mode) {
  State.searchViewMode = mode;
  try { localStorage.setItem('lcc_search_view_mode', mode); } catch {}
  renderSearchPage();
};

async function loadMoreSearch() {
  if (State.currentView !== 'search' || State.isSearching || !State.searchToken || !State.searchQuery) return;
  State.isSearching = true;
  
  const targetContainer = $('search-track-list') || $('search-grid');
  if (targetContainer) {
    const loader = document.createElement('div');
    loader.id = 'search-more-loader';
    loader.style = 'grid-column: 1/-1; padding: 20px; text-align: center; display: flex; justify-content: center; width: 100%;';
    loader.innerHTML = '<div class="search-spinner" style="display:block;width:24px;height:24px;border-color:rgba(201,160,107,0.2);border-top-color:var(--c-accent)"></div>';
    targetContainer.appendChild(loader);
  }

  try {
    const res = await window.lumina.search(State.searchQuery, State.searchToken);
    State.searchToken = res.token || null;
    
    if (res.items && res.items.length) {
      const startIndex = State.searchResults.length;
      State.searchResults.push(...res.items);
      
      const loader = $('search-more-loader');
      if (loader) loader.remove();

      if (State.searchViewMode === 'grid' && $('search-grid')) {
        const newHtml = res.items.map(t => createTrackCardHtml(t)).join('');
        $('search-grid').insertAdjacentHTML('beforeend', newHtml);
      } else if ($('search-track-list')) {
        const newRowsHtml = res.items.map((t, i) => renderSearchTrackRow(t, startIndex + i, State.searchResults)).join('');
        $('search-track-list').insertAdjacentHTML('beforeend', newRowsHtml);
      } else if ($('search-grid')) {
        const newHtml = res.items.map(t => createTrackCardHtml(t)).join('');
        $('search-grid').insertAdjacentHTML('beforeend', newHtml);
      }
    }
  } catch (e) {
    console.warn("Load more failed", e);
  } finally {
    State.isSearching = false;
    const loader = $('search-more-loader');
    if (loader) loader.remove();
  }
}

// ── Track Card Helper ─────────────────────────────────────────
function createTrackCardHtml(t) {
  const isPlaylist = t.type === 'playlist';
  const jsonStr = JSON.stringify(t).replace(/"/g,'&quot;');
  const clickHandler = `onCardClick(${jsonStr})`;
  const playBtnHandler = isPlaylist ? `event.stopPropagation();playYoutubePlaylistAll('${t.id}')` : `event.stopPropagation();playTrackFromGrid(${jsonStr})`;
  
  return `
    <div class="track-card ${isPlaylist ? 'playlist-card' : ''} ${State.currentTrack?.id === t.id ? 'playing' : ''}"
      data-id="${t.id}"
      draggable="true"
      ondragstart="window.onTrackDragStart(event, ${jsonStr})"
      onclick="${clickHandler}"
      oncontextmenu="showTrackContextMenu(event, ${jsonStr}, 'global')">
      <div class="card-thumb-wrap">
        ${t.thumbnail
          ? `<img class="card-thumb" src="${escHtml(t.thumbnail)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=card-thumb-placeholder><span class=\\'material-symbols-outlined\\' style=\\'font-size:36px;opacity:0.4\\'>music_note</span></div>'">`
          : `<div class="card-thumb-placeholder"><span class="material-symbols-outlined" style="font-size:36px;opacity:0.4">music_note</span></div>`}
        ${isPlaylist ? `<div class="card-badge-pill"><span class="material-symbols-outlined">queue_music</span> Playlist</div>` : ''}
        <div class="card-play-overlay">
          <button class="card-play-btn" onclick="${playBtnHandler}" title="Çal">
            <span class="material-symbols-outlined">play_arrow</span>
          </button>
        </div>
        <div class="card-playing-indicator">
          <div class="eq-bar"></div><div class="eq-bar"></div><div class="eq-bar"></div>
        </div>
      </div>
      <div class="card-info">
        <div class="card-title" title="${escHtml(t.title)}">${escHtml(t.title)}</div>
        <div class="card-artist">${escHtml(isPlaylist ? (t.author ? t.author + ' · Liste' : 'Çalma Listesi') : (t.author || 'Bilinmeyen'))}</div>
        <div class="card-meta-row">
          ${isPlaylist 
            ? `<span class="card-duration" style="color:var(--c-accent);font-weight:700">${escHtml(t.videoCount || '')}</span>` 
            : `<span class="search-type-pill">Şarkı</span><span class="card-duration">${escHtml(t.duration || '')}</span>`}
        </div>
      </div>
    </div>`;
}

// ── Track Grid Renderer ───────────────────────────────────────
function renderTrackGrid(container, tracks) {
  if (!container) return;
  if (!tracks || !tracks.length) {
    container.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <span class="material-symbols-outlined" style="font-size:48px;opacity:0.3;margin-bottom:12px">search_off</span>
      <div class="empty-state-title">Sonuç Bulunamadı</div>
    </div>`;
    return;
  }
  container.innerHTML = tracks.map(t => createTrackCardHtml(t)).join('');

  // Önbellek badge'lerini ekle
  if (window.AudioCacheManager) {
    tracks.forEach(t => {
      if (window.AudioCacheManager.isCached(t.id)) {
        window.markTrackCached(t.id, true);
      }
    });
  }
}

function onCardClick(track) {
  if (!track) return;
  if (track.type === 'playlist') {
    openYoutubePlaylist(track.id, track.title);
    return;
  }
  const gridTracks = getGridTracks();
  playTrackFromGrid(track, gridTracks);
}

function getGridTracks() {
  const grid = document.querySelector('.tracks-grid');
  if (!grid) return [];
  return State.searchResults.length ? State.searchResults : [];
}

function playTrackFromGrid(track, queueTracks) {
  // Çalınan şarkıyı son aramalara kaydet
  if (track && track.title) saveRecentSearch(track.title);
  if (State.isRadioMode) {
    window.startRadio(track);
    return;
  }
  const q = queueTracks || getGridTracks();
  State.queue = q.length ? [...q] : [track];
  State.queueIndex = State.queue.findIndex(t => t.id === track.id);
  if (State.queueIndex === -1) { State.queue.unshift(track); State.queueIndex = 0; }
  playTrack(track, State.queue);
}

window.playYoutubePlaylistAll = async function(playlistId) {
  const result = await window.lumina.resolveYoutubePlaylist(playlistId);
  if (result && result.tracks.length) {
    if (State.isRadioMode) {
      window.startRadio(result.tracks[0]);
      return;
    }
    State.queue = [...result.tracks];
    State.queueIndex = 0;
    playTrack(State.queue[0], State.queue);
  } else {
    showToast('Liste yüklenemedi');
  }
};

// ── Return to Search Results Navigation ───────────────────────
window.returnToSearchResults = function() {
  State.currentView = 'search';
  showView('search');
  if (State.searchResults && State.searchResults.length > 0) {
    renderSearchPage(State.searchResults, State.searchQuery, State.searchFilter, State.searchViewMode);
  } else {
    loadView('search');
  }
};

window.__currentYtPlaylistData = null;
window.__currentYtPlaylistViewMode = 'list';

function computePlaylistTotalDuration(tracks) {
  let totalSec = 0;
  for (const t of tracks) {
    if (!t.duration) continue;
    const parts = t.duration.split(':').map(Number);
    if (parts.length === 3) totalSec += (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
    else if (parts.length === 2) totalSec += (parts[0] || 0) * 60 + (parts[1] || 0);
  }
  if (totalSec <= 0) return '';
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `~${h} sa. ${m > 0 ? m + ' dk.' : ''}`;
  return `${m} dk.`;
}

window.openYoutubePlaylist = async function(playlistId, titleHint) {
  window.__currentYtPlaylistId = playlistId;
  window.__currentYtPlaylistTitleHint = titleHint || '';
  State.currentView = 'yt-playlist';
  showView('search');
  const view = $('view-search');

  // Loading skeleton screen with Spotify-style Hero & table rows
  view.innerHTML = `
    <div class="search-pl-detail-container">
      <div class="search-pl-top-nav">
        <button class="search-pl-back-btn" onclick="window.returnToSearchResults()" title="Aramaya Geri Dön">
          <span class="material-symbols-outlined">arrow_back</span>
        </button>
        <div class="search-pl-breadcrumb" onclick="window.returnToSearchResults()">
          <span>Arama Sonuçları</span>
          <span class="material-symbols-outlined" style="font-size:14px;opacity:0.5">chevron_right</span>
          <span class="active">${escHtml(titleHint || 'Çalma Listesi')}</span>
        </div>
      </div>

      <div class="search-skeleton-hero" style="height:210px;border-radius:20px;"></div>
      <div class="search-skeleton-row"></div>
      <div class="search-skeleton-row"></div>
      <div class="search-skeleton-row"></div>
      <div class="search-skeleton-row"></div>
      <div class="search-skeleton-row"></div>
    </div>`;

  try {
    const res = await window.lumina.resolveYoutubePlaylist(playlistId);
    if (res && res.tracks && res.tracks.length > 0) {
      window.__currentYtPlaylistData = { ...res, id: playlistId };
      renderYoutubePlaylistDetail(window.__currentYtPlaylistData);
    } else {
      view.innerHTML = `
        <div class="search-pl-detail-container">
          <div class="search-pl-top-nav">
            <button class="search-pl-back-btn" onclick="window.returnToSearchResults()" title="Aramaya Geri Dön">
              <span class="material-symbols-outlined">arrow_back</span>
            </button>
            <div class="search-pl-breadcrumb" onclick="window.returnToSearchResults()">
              <span>Arama Sonuçları</span>
            </div>
          </div>
          <div class="empty-state" style="margin-top:40px">
            <span class="material-symbols-outlined" style="font-size:52px;opacity:0.3;margin-bottom:12px">sync_problem</span>
            <div class="empty-state-title">Çalma Listesi Çözülemedi</div>
            <div class="empty-state-sub" style="font-size:13px;opacity:0.6;margin-bottom:18px">Bu liste gizli veya YouTube tarafından kısıtlanmış olabilir.</div>
            <button class="btn-primary" onclick="openYoutubePlaylist(window.__currentYtPlaylistId, window.__currentYtPlaylistTitleHint)">
              <span class="material-symbols-outlined" style="font-size:16px">refresh</span> Tekrar Dene
            </button>
          </div>
        </div>`;
      showToast('YouTube listesi çözülemedi.', 'error');
    }
  } catch (err) {
    console.error('Playlist resolve error:', err);
    view.innerHTML = `
      <div class="search-pl-detail-container">
        <div class="search-pl-top-nav">
          <button class="search-pl-back-btn" onclick="window.returnToSearchResults()" title="Aramaya Geri Dön">
            <span class="material-symbols-outlined">arrow_back</span>
          </button>
        </div>
        <div class="empty-state" style="margin-top:40px">
          <span class="material-symbols-outlined" style="font-size:52px;opacity:0.3;margin-bottom:12px">error_outline</span>
          <div class="empty-state-title">Bağlantı Hatası</div>
          <div class="empty-state-sub" style="font-size:13px;opacity:0.6;margin-bottom:18px">İnternet bağlantınızı kontrol edip tekrar deneyin.</div>
          <button class="btn-primary" onclick="openYoutubePlaylist(window.__currentYtPlaylistId, window.__currentYtPlaylistTitleHint)">
            <span class="material-symbols-outlined" style="font-size:16px">refresh</span> Tekrar Dene
          </button>
        </div>
      </div>`;
    showToast('Bağlantı hatası oluştu.', 'error');
  }
};

function renderYoutubePlaylistDetail(data) {
  const view = $('view-search');
  if (!view) return;

  const isMix = data.id.startsWith('RD');
  const typeLabel = isMix ? 'YouTube Sanatçı Miksi' : 'YouTube Çalma Listesi';
  const firstCover = data.tracks[0]?.thumbnail || '';
  const totalDurationStr = computePlaylistTotalDuration(data.tracks);
  const authorName = data.tracks[0]?.author || 'YouTube';
  const viewMode = window.__currentYtPlaylistViewMode || 'list';

  const html = `
    <div class="search-pl-detail-container">
      <!-- Top Navigation & Back Button -->
      <div class="search-pl-top-nav">
        <button class="search-pl-back-btn" onclick="window.returnToSearchResults()" title="Aramaya Geri Dön">
          <span class="material-symbols-outlined">arrow_back</span>
        </button>
        <div class="search-pl-breadcrumb" onclick="window.returnToSearchResults()">
          <span>Arama Sonuçları</span>
          <span class="material-symbols-outlined" style="font-size:14px;opacity:0.5">chevron_right</span>
          <span class="active">${escHtml(data.title)}</span>
        </div>
      </div>

      <!-- Spotify-Style Hero Header -->
      <div class="search-pl-hero">
        <div class="search-pl-cover-wrap">
          <img class="search-pl-cover" src="${escHtml(firstCover)}" onerror="this.src=''" alt="Kapak" />
        </div>
        <div class="search-pl-hero-info">
          <div class="search-pl-type-pill">
            <span class="material-symbols-outlined" style="font-size:15px">${isMix ? 'auto_awesome' : 'queue_music'}</span>
            ${typeLabel}
          </div>
          <h1 class="search-pl-title" title="${escHtml(data.title)}">${escHtml(data.title)}</h1>
          <div class="search-pl-meta">
            <span class="author-badge">${escHtml(authorName)}</span>
            <span class="bullet">•</span>
            <span>${data.tracks.length} şarkı</span>
            ${totalDurationStr ? `<span class="bullet">•</span><span>${escHtml(totalDurationStr)}</span>` : ''}
          </div>
        </div>
      </div>

      <!-- Action Bar -->
      <div class="search-pl-action-bar">
        <div class="search-pl-actions-left">
          <button class="search-pl-play-btn" onclick="window.playYoutubePlaylistAll('${data.id}')" title="Tümünü Çal">
            <span class="material-symbols-outlined">play_arrow</span>
          </button>
          <button class="search-pl-shuffle-btn" onclick="window.playYoutubePlaylistShuffled()" title="Karışık Çal">
            <span class="material-symbols-outlined" style="font-size:18px">shuffle</span>
            <span>Karışık</span>
          </button>
          <button class="search-pl-follow-btn" id="btn-follow-yt" onclick="window.followYoutubePlaylist(window.__currentYtPlaylistData)">
            <span class="material-symbols-outlined" style="font-size:17px">favorite</span>
            <span>Kütüphaneye Ekle</span>
          </button>
          <div class="search-pl-dl-group">
            <button class="search-pl-dl-btn" onclick="window.downloadCurrentPlTracks('mp3')" title="Tümünü MP3 İndir">
              <span class="material-symbols-outlined" style="font-size:15px">download</span> MP3
            </button>
            <button class="search-pl-dl-btn" onclick="window.downloadCurrentPlTracks('wav')" title="Tümünü WAV İndir">
              <span class="material-symbols-outlined" style="font-size:15px">download</span> WAV
            </button>
            <button class="search-pl-dl-btn" onclick="window.downloadCurrentPlTracks('mp4')" title="Tümünü MP4 İndir">
              <span class="material-symbols-outlined" style="font-size:15px">download</span> MP4
            </button>
          </div>
        </div>

        <div class="search-view-switcher">
          <button class="search-view-btn ${viewMode === 'list' ? 'active' : ''}" onclick="window.setYoutubePlaylistViewMode('list')" title="Liste Görünümü">
            <span class="material-symbols-outlined">format_list_bulleted</span>
            <span>Liste</span>
          </button>
          <button class="search-view-btn ${viewMode === 'grid' ? 'active' : ''}" onclick="window.setYoutubePlaylistViewMode('grid')" title="Izgara Kartlar">
            <span class="material-symbols-outlined">grid_view</span>
            <span>Izgara</span>
          </button>
        </div>
      </div>

      <!-- Playlist Content (Table or Grid) -->
      <div id="yt-pl-content-container"></div>
    </div>`;

  view.innerHTML = html;
  renderYoutubePlaylistDetailContent(data, viewMode);
}

function renderYoutubePlaylistDetailContent(data, viewMode) {
  const container = $('yt-pl-content-container');
  if (!container) return;

  if (viewMode === 'grid') {
    container.innerHTML = `<div class="tracks-grid" id="yt-pl-grid"></div>`;
    renderTrackGrid($('yt-pl-grid'), data.tracks);
  } else {
    // Spotify Style Table View
    const tableHeaderHtml = `
      <div class="search-pl-table-header">
        <div style="text-align:center">#</div>
        <div></div>
        <div>BAŞLIK</div>
        <div class="search-pl-col-channel">SANATÇI / KANAL</div>
        <div style="text-align:right">SÜRE</div>
        <div style="text-align:right">İŞLEMLER</div>
      </div>`;

    const rowsHtml = data.tracks.map((t, idx) => {
      const isPlaying = State.currentTrack?.id === t.id;
      const isLiked = State.liked && State.liked.has(t.id);
      const jsonStr = JSON.stringify(t).replace(/"/g, '&quot;');
      const playHandler = `playTrackFromGrid(${jsonStr}, window.__currentYtPlaylistData.tracks)`;

      return `
        <div class="search-pl-table-row ${isPlaying ? 'playing' : ''}" 
             data-id="${t.id}"
             draggable="true"
             ondragstart="window.onTrackDragStart(event, ${jsonStr})"
             onclick="${playHandler}"
             oncontextmenu="showTrackContextMenu(event, ${jsonStr}, 'global')">
          <div class="row-num-col">
            <span class="track-index-num">${idx + 1}</span>
            <span class="material-symbols-outlined row-play-icon">play_arrow</span>
            <div class="row-eq-icon"><span></span><span></span><span></span></div>
          </div>
          <div class="search-row-thumb-wrap">
            <img class="search-row-thumb" src="${escHtml(t.thumbnail || '')}" loading="lazy" onerror="this.src=''" />
          </div>
          <div class="search-row-info">
            <span class="search-row-title" title="${escHtml(t.title)}">${escHtml(t.title)}</span>
          </div>
          <div class="search-pl-col-channel" title="${escHtml(t.author || '')}">
            ${escHtml(t.author || 'Bilinmeyen')}
          </div>
          <div class="search-row-duration" style="text-align:right">
            ${escHtml(t.duration || '')}
          </div>
          <div class="search-row-actions" style="justify-content:flex-end">
            <button class="search-action-btn ${isLiked ? 'liked' : ''}" onclick="event.stopPropagation();toggleLike(${jsonStr})" title="Beğen">
              <span class="material-symbols-outlined" style="${isLiked ? 'color:#f87171' : ''}">${isLiked ? 'favorite' : 'favorite_border'}</span>
            </button>
            <button class="search-action-btn" onclick="event.stopPropagation();downloadTrack(${jsonStr}, 'mp3')" title="İndir (MP3)">
              <span class="material-symbols-outlined">download</span>
            </button>
            <button class="search-action-btn" onclick="event.stopPropagation();addToQueue(${jsonStr})" title="Sıraya Ekle">
              <span class="material-symbols-outlined">queue_music</span>
            </button>
            <button class="search-action-btn" onclick="event.stopPropagation();showTrackContextMenu(event, ${jsonStr}, 'global')" title="Diğer Seçenekler">
              <span class="material-symbols-outlined">more_vert</span>
            </button>
          </div>
        </div>`;
    }).join('');

    container.innerHTML = `
      <div class="search-track-list">
        ${tableHeaderHtml}
        ${rowsHtml}
      </div>`;
  }
}

window.setYoutubePlaylistViewMode = function(mode) {
  window.__currentYtPlaylistViewMode = mode;
  if (window.__currentYtPlaylistData) {
    // Update view buttons active state
    document.querySelectorAll('.search-view-switcher .search-view-btn').forEach((b, idx) => {
      if (idx === 0) b.classList.toggle('active', mode === 'list');
      if (idx === 1) b.classList.toggle('active', mode === 'grid');
    });
    renderYoutubePlaylistDetailContent(window.__currentYtPlaylistData, mode);
  }
};

window.playYoutubePlaylistShuffled = function() {
  const tracks = window.__currentYtPlaylistData?.tracks;
  if (!tracks || !tracks.length) return;
  const shuffled = [...tracks];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  State.queue = shuffled;
  State.queueIndex = 0;
  playTrack(shuffled[0], State.queue);
  showToast('Karışık çalma başlatıldı', 'info');
};

window.downloadCurrentPlTracks = function(format) {
  const tracks = window.__currentYtPlaylistData?.tracks;
  if (!tracks || !tracks.length) return;
  tracks.forEach(t => downloadTrack(t, format));
  showToast(`${tracks.length} şarkı ${format.toUpperCase()} indirme sırasına eklendi.`, 'success');
};

window.followYoutubePlaylist = async function(data) {
  const btn = $('btn-follow-yt');
  if (btn) btn.disabled = true;
  
  const cleanTitle = data.title.replace(/^YT:\s*/i, '').replace(/^Playlist:\s*/i, '').trim();
  const plName = `YT: ${cleanTitle}`;
  
  const pl = await window.lumina.createPlaylist(plName);
  if (pl) {
    await window.lumina.saveSpotifyImport({ id: pl.id, tracks: data.tracks, sourceUrl: `https://www.youtube.com/playlist?list=${data.id}` });
    
    const existing = State.playlists.find(p => p.id === pl.id);
    if (!existing) {
      pl.tracks = data.tracks;
      pl.sourceUrl = `https://www.youtube.com/playlist?list=${data.id}`;
      State.playlists.push(pl);
    } else {
      existing.tracks = data.tracks;
      existing.sourceUrl = `https://www.youtube.com/playlist?list=${data.id}`;
    }
    renderSidebarPlaylists();
    showToast('Kütüphaneye başarıyla eklendi', 'success');
  } else {
    if (btn) btn.disabled = false;
    showToast('Liste eklenemedi', 'error');
  }
};

// ── Spotify Helpers ───────────────────────────────────────────
window.playSpotifyAll = function() {
  if (!window.__lastSpotifyTracks || !window.__lastSpotifyTracks.length) return;
  
  if (State.isRadioMode) {
    window.startRadio(window.__lastSpotifyTracks[0]);
    return;
  }
  
  State.queue = [...window.__lastSpotifyTracks];
  State.queueIndex = 0;
  playTrack(State.queue[0], State.queue);
};

window.followSpotifyPlaylist = async function(data) {
  const btn = $('btn-follow-spotify');
  if (btn) btn.disabled = true;
  
  const spTracks = window.__lastSpotifyTracks.map(t => ({
    id: t.id,
    title: t.title,
    author: t.author,
    thumbnail: t.thumbnail,
    duration: ''
  }));

  const pl = await window.lumina.createPlaylist(`Spotify: ${data.title}`);
  if (pl) {
    await window.lumina.saveSpotifyImport({ id: pl.id, tracks: spTracks, sourceUrl: data.url });
    const existing = State.playlists.find(p => p.id === pl.id);
    if (!existing) {
      pl.tracks = spTracks;
      pl.sourceUrl = data.url;
      State.playlists.push(pl);
    } else {
      existing.tracks = spTracks;
      existing.sourceUrl = data.url;
    }
    renderSidebarPlaylists();
    showToast('Kütüphaneye başarıyla eklendi', 'success');
    
    const savedPl = State.playlists.find(p => p.id === pl.id);
    if (savedPl && window.prefetchPlaylistTracks) {
      window.prefetchPlaylistTracks(savedPl);
    }
  }
};

window.__relatedTracks = [];

// ── Serverless Lumina Share Recognition in Search View (Zero Modal) ──
async function processSharedLink(linkStr) {
  const clean = (linkStr || '').trim();
  if (clean.toLowerCase().startsWith('lumina://track/')) {
    if (typeof window.handleLuminaDeepLink === 'function') {
      window.handleLuminaDeepLink(clean);
    }
    return;
  }

  const spinner = $('search-spinner');
  if (spinner) spinner.style.display = 'block';
  State.currentView = 'search';
  showView('search');
  setActiveNav(null);

  const res = await window.lumina.decompressShareData(clean);
  if (spinner) spinner.style.display = 'none';

  if (!res || !res.success || !res.data) {
    showToast('Geçersiz veya bozuk Lumina paylaşım bağlantısı.', 'error');
    return;
  }

  const data = res.data;
  if (data.type === 'playlist' || (Array.isArray(data.tracks) && !data.playlists)) {
    renderSharedPlaylistInSearch(data, clean);
  } else if (data.type === 'setup' || Array.isArray(data.playlists) || Array.isArray(data.likedTracks)) {
    renderSharedSetupInSearch(data, clean);
  } else {
    showToast('Bilinmeyen paylaşım bağlantısı formatı.', 'warning');
  }
}

function renderSharedPlaylistInSearch(data, rawLink, isSubView, backFn, typeLabelOverride) {
  const view = $('view-search');
  if (!view) return;

  const spinner = $('search-spinner');
  if (spinner) spinner.style.display = 'none';

  State.currentView = 'search';
  showView('search');
  setActiveNav(null);

  const tracks = Array.isArray(data.tracks) ? data.tracks : [];
  State.searchResults = tracks;
  State.isSearching = false;

  const plName = data.name || 'Paylaşılan Çalma Listesi';
  const cover = data.customCover || (tracks[0]?.thumbnail || '');
  const typeLabel = typeLabelOverride || 'Lumina Çalma Listesi';

  const input = $('search-input');
  if (input) {
    input.value = plName;
    const clear = $('search-clear');
    if (clear) clear.style.display = '';
  }

  view.innerHTML = `
    <div class="search-pl-detail-container">
      <div class="search-pl-top-nav">
        <button class="search-pl-back-btn" id="btn-shared-pl-back" title="Geri">
          <span class="material-symbols-outlined">arrow_back</span>
        </button>
        <div class="search-pl-breadcrumb" id="breadcrumb-shared-pl">
          <span>${isSubView ? 'Kurulum Paketi' : 'Arama'}</span>
          <span class="material-symbols-outlined" style="font-size:14px;opacity:0.5">chevron_right</span>
          <span class="active">${escHtml(plName)}</span>
        </div>
      </div>

      <div class="search-pl-hero" style="background: linear-gradient(135deg, rgba(201, 160, 107, 0.12) 0%, rgba(20, 20, 25, 0.7) 100%); border: 1px solid rgba(201, 160, 107, 0.2); border-radius: 20px; padding: 24px; margin-bottom: 24px;">
        <div class="search-pl-cover-wrap" style="width: 140px; height: 140px; min-width: 140px; border-radius: 16px; overflow: hidden; box-shadow: 0 12px 32px rgba(0,0,0,0.5); background: #18181c; display: flex; align-items: center; justify-content: center;">
          ${cover ? `<img class="search-pl-cover" src="${escHtml(cover)}" onerror="this.src=''" alt="" style="width:100%;height:100%;object-fit:cover;" />` : `<span class="material-symbols-outlined" style="font-size:56px;color:var(--c-accent)">playlist_play</span>`}
        </div>
        <div class="search-pl-hero-info">
          <div class="search-pl-type-pill" style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;background:rgba(201,160,107,0.18);color:var(--c-accent);font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">
            <span class="material-symbols-outlined" style="font-size:14px">share</span>
            ${escHtml(typeLabel)}
          </div>
          <h1 class="search-pl-title" style="font-size:28px;font-weight:800;margin:10px 0 6px 0;color:var(--c-text-1);">${escHtml(plName)}</h1>
          <div class="search-pl-meta" style="font-size:13px;color:var(--c-text-muted);display:flex;align-items:center;gap:8px;">
            <span class="author-badge">Paylaşılan Liste</span>
            <span class="bullet">•</span>
            <span>${tracks.length} şarkı</span>
          </div>
        </div>
      </div>

      <div class="search-pl-action-bar" style="margin-bottom: 20px;">
        <div class="search-pl-actions-left" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <button class="search-pl-play-btn" id="btn-shared-pl-play" title="Tümünü Çal">
            <span class="material-symbols-outlined">play_arrow</span>
          </button>
          <button class="search-pl-shuffle-btn" id="btn-shared-pl-shuffle" title="Karışık Çal">
            <span class="material-symbols-outlined" style="font-size:18px">shuffle</span>
            <span>Karışık</span>
          </button>
          <button class="search-pl-follow-btn" id="btn-shared-pl-import" title="Kütüphaneye Ekle">
            <span class="material-symbols-outlined" style="font-size:18px">playlist_add</span>
            <span id="btn-shared-pl-import-text">Kütüphaneye Ekle</span>
          </button>
        </div>
      </div>

      <div class="search-track-list" id="search-track-list">
        ${tracks.length ? tracks.map((t, idx) => renderSearchTrackRow(t, idx, tracks)).join('') : `
          <div class="empty-state" style="margin-top:30px;">
            <span class="material-symbols-outlined" style="font-size:48px;opacity:0.3;color:var(--c-accent)">music_off</span>
            <div class="empty-state-title">Bu listede henüz şarkı yok</div>
          </div>
        `}
      </div>
    </div>
  `;

  // Bind Back
  const backBtn = $('btn-shared-pl-back');
  const breadcrumb = $('breadcrumb-shared-pl');
  const goBack = () => {
    if (typeof backFn === 'function') {
      backFn();
    } else {
      loadView('discover');
    }
  };
  if (backBtn) backBtn.onclick = goBack;
  if (breadcrumb) breadcrumb.onclick = goBack;

  // Bind Play All
  const playBtn = $('btn-shared-pl-play');
  if (playBtn) {
    playBtn.onclick = () => {
      if (tracks.length && typeof playTrack === 'function') {
        playTrack(tracks[0], tracks);
        showToast(`"${plName}" çalınıyor`, 'success');
      }
    };
  }

  // Bind Shuffle
  const shuffleBtn = $('btn-shared-pl-shuffle');
  if (shuffleBtn) {
    shuffleBtn.onclick = () => {
      if (tracks.length && typeof playTrack === 'function') {
        const shuffled = [...tracks].sort(() => Math.random() - 0.5);
        playTrack(shuffled[0], shuffled);
        showToast(`"${plName}" karışık çalınıyor`, 'success');
      }
    };
  }

  // Bind Import
  const importBtn = $('btn-shared-pl-import');
  if (importBtn) {
    importBtn.onclick = async () => {
      importBtn.disabled = true;
      const res = await window.lumina.importSinglePlaylist({
        name: plName,
        tracks: tracks,
        customCover: data.customCover || null
      });
      if (res && res.success) {
        importBtn.style.background = 'rgba(34, 197, 94, 0.18)';
        importBtn.style.borderColor = 'rgba(34, 197, 94, 0.4)';
        importBtn.style.color = '#22c55e';
        importBtn.innerHTML = `
          <span class="material-symbols-outlined" style="font-size:18px">check_circle</span>
          <span>Kütüphaneye Eklendi</span>
        `;
        showToast(`"${plName}" kütüphanenize eklendi!`, 'success');
        if (typeof window.loadPlaylists === 'function') await window.loadPlaylists();
        if (typeof window.renderSidebarPlaylists === 'function') window.renderSidebarPlaylists();
      } else {
        importBtn.disabled = false;
        showToast('Playlist eklenemedi: ' + (res?.error || ''), 'error');
      }
    };
  }
}

function renderSharedSetupInSearch(data, rawLink) {
  const view = $('view-search');
  if (!view) return;

  const spinner = $('search-spinner');
  if (spinner) spinner.style.display = 'none';

  State.currentView = 'search';
  showView('search');
  setActiveNav(null);

  const playlists = Array.isArray(data.playlists) ? data.playlists : [];
  const likedTracks = Array.isArray(data.likedTracks) ? data.likedTracks : [];
  const totalSongs = playlists.reduce((acc, p) => acc + (p.tracks?.length || 0), 0) + likedTracks.length;

  const input = $('search-input');
  if (input) {
    input.value = 'Lumina Kurulum Paketi';
    const clear = $('search-clear');
    if (clear) clear.style.display = '';
  }

  window._sharedSetupData = data;
  window._sharedSetupRawLink = rawLink;

  const previewCovers = [];
  for (const p of playlists) {
    const cov = p.customCover || p.tracks?.[0]?.thumbnail;
    if (cov && !previewCovers.includes(cov)) previewCovers.push(cov);
    if (previewCovers.length >= 4) break;
  }
  if (previewCovers.length < 4 && likedTracks.length) {
    for (const t of likedTracks) {
      if (t.thumbnail && !previewCovers.includes(t.thumbnail)) previewCovers.push(t.thumbnail);
      if (previewCovers.length >= 4) break;
    }
  }

  let coverHtml = '';
  if (previewCovers.length >= 4) {
    coverHtml = `
      <div style="width: 130px; height: 130px; min-width: 130px; border-radius: 18px; overflow: hidden; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 2px; background: #141318; box-shadow: 0 16px 36px rgba(0,0,0,0.6), 0 0 24px rgba(201, 160, 107, 0.15); border: 1px solid rgba(255,255,255,0.1); flex-shrink: 0;">
        ${previewCovers.slice(0, 4).map(c => `<img src="${escHtml(c)}" onerror="this.src=''" style="width:100%;height:100%;object-fit:cover;" />`).join('')}
      </div>
    `;
  } else if (previewCovers.length > 0) {
    coverHtml = `
      <div style="position: relative; width: 130px; height: 130px; min-width: 130px; border-radius: 18px; overflow: hidden; background: #141318; box-shadow: 0 16px 36px rgba(0,0,0,0.6), 0 0 24px rgba(201, 160, 107, 0.15); border: 1px solid rgba(255,255,255,0.1); flex-shrink: 0;">
        <img src="${escHtml(previewCovers[0])}" onerror="this.src=''" style="width:100%;height:100%;object-fit:cover;" />
        <div style="position: absolute; bottom: 8px; right: 8px; width: 30px; height: 30px; border-radius: 50%; background: rgba(18,17,23,0.85); backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.15); display: flex; align-items: center; justify-content: center;">
          <span class="material-symbols-outlined" style="font-size:16px;color:var(--c-accent)">folder_special</span>
        </div>
      </div>
    `;
  } else {
    coverHtml = `
      <div style="width: 130px; height: 130px; min-width: 130px; border-radius: 18px; background: linear-gradient(135deg, rgba(201, 160, 107, 0.22) 0%, rgba(26, 24, 34, 0.9) 100%); border: 1px solid rgba(201, 160, 107, 0.35); display: flex; align-items: center; justify-content: center; box-shadow: 0 16px 36px rgba(0,0,0,0.6), 0 0 28px rgba(201, 160, 107, 0.18); position: relative; overflow: hidden; flex-shrink: 0;">
        <div style="position: absolute; width: 70px; height: 70px; background: radial-gradient(circle, rgba(var(--c-accent-rgb), 0.35), transparent 70%); filter: blur(16px); pointer-events: none;"></div>
        <span class="material-symbols-outlined" style="font-size:54px; color:var(--c-accent); filter: drop-shadow(0 4px 10px rgba(0,0,0,0.5));">library_music</span>
      </div>
    `;
  }

  view.innerHTML = `
    <div class="search-pl-detail-container">
      <div class="search-pl-top-nav">
        <button class="search-pl-back-btn" id="btn-setup-back" title="Geri">
          <span class="material-symbols-outlined">arrow_back</span>
        </button>
        <div class="search-pl-breadcrumb" id="breadcrumb-setup">
          <span>Arama</span>
          <span class="material-symbols-outlined" style="font-size:14px;opacity:0.5">chevron_right</span>
          <span class="active">Lumina Kurulum Paketi</span>
        </div>
      </div>

      <!-- Hero Header -->
      <div class="search-pl-hero" style="position: relative; overflow: hidden; background: radial-gradient(circle at 12% 25%, rgba(201, 160, 107, 0.18), transparent 55%), radial-gradient(circle at 88% 85%, rgba(138, 92, 246, 0.12), transparent 50%), rgba(20, 19, 26, 0.75); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 24px; padding: 28px 32px; margin-bottom: 26px; backdrop-filter: blur(24px); box-shadow: 0 20px 48px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.12); display: flex; align-items: center; gap: 28px;">
        ${coverHtml}
        <div class="search-pl-hero-info" style="display: flex; flex-direction: column; gap: 10px; min-width: 0; flex: 1;">
          <div style="display: inline-flex; align-items: center; gap: 7px; padding: 5px 14px; border-radius: 100px; background: rgba(201, 160, 107, 0.14); border: 1px solid rgba(201, 160, 107, 0.32); color: var(--c-accent); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; width: fit-content; box-shadow: 0 2px 8px rgba(0,0,0,0.25);">
            <span class="material-symbols-outlined" style="font-size: 14px; color: var(--c-accent);">inventory_2</span>
            <span>LUMINA TOPLU KURULUM PAKETİ</span>
          </div>

          <h1 style="font-family: 'Outfit', 'Urbanist', -apple-system, sans-serif; font-size: 32px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em; line-height: 1.15; margin: 0; text-shadow: 0 2px 10px rgba(0,0,0,0.4);">
            Lumina Kütüphane Kurulumu
          </h1>

          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 2px;">
            <div style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 100px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); font-size: 12.5px; color: rgba(255, 255, 255, 0.85); backdrop-filter: blur(8px);">
              <span class="material-symbols-outlined" style="font-size: 16px; color: var(--c-accent);">queue_music</span>
              <strong style="color:#fff;">${playlists.length}</strong>
              <span style="color: rgba(255, 255, 255, 0.55); font-size: 12px;">Çalma Listesi</span>
            </div>

            <div style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 100px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); font-size: 12.5px; color: rgba(255, 255, 255, 0.85); backdrop-filter: blur(8px);">
              <span class="material-symbols-outlined" style="font-size: 16px; color: #f43f5e;">favorite</span>
              <strong style="color:#fff;">${likedTracks.length}</strong>
              <span style="color: rgba(255, 255, 255, 0.55); font-size: 12px;">Beğenilen Şarkı</span>
            </div>

            <div style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 100px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); font-size: 12.5px; color: rgba(255, 255, 255, 0.85); backdrop-filter: blur(8px);">
              <span class="material-symbols-outlined" style="font-size: 16px; color: #38bdf8;">graphic_eq</span>
              <strong style="color:#fff;">${totalSongs}</strong>
              <span style="color: rgba(255, 255, 255, 0.55); font-size: 12px;">Toplam Parça</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Action Box for Batch Setup -->
      <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 18px 22px; margin-bottom: 28px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px;">
        <div>
          <div style="font-size:14.5px;font-weight:700;color:var(--c-text-1);margin-bottom:3px;">Kurulumu Uygula</div>
          <div style="font-size:12.5px;color:var(--c-text-muted);">Paketteki tüm çalma listelerini ve şarkıları tek tıkla kütüphanenize dahil edin.</div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <button class="btn-primary" id="btn-setup-merge" style="padding:10px 22px;display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;border-radius:30px;">
            <span class="material-symbols-outlined" style="font-size:18px">library_add</span>
            <span id="btn-setup-merge-text">Kütüphaneme Ekle (Mevcutların Üzerine)</span>
          </button>
          <button class="btn-secondary" id="btn-setup-replace" style="padding:10px 18px;display:flex;align-items:center;gap:8px;font-size:13px;border-radius:30px;color:#ef4444;border-color:rgba(239,68,68,0.3);">
            <span class="material-symbols-outlined" style="font-size:18px">restart_alt</span>
            <span>Sıfırdan Kur (Değiştir)</span>
          </button>
        </div>
      </div>

      <!-- Playlists Section -->
      <div style="margin-bottom: 32px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <div style="font-size:18px;font-weight:800;color:var(--c-text-1);display:flex;align-items:center;gap:8px;">
            <span class="material-symbols-outlined" style="color:var(--c-accent);font-size:22px;">queue_music</span>
            <span>Paketteki Çalma Listeleri (${playlists.length})</span>
          </div>
        </div>
        <div class="playlists-grid" id="setup-playlists-grid" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(220px, 1fr));gap:16px;">
          ${playlists.map((pl, idx) => {
            const plCover = pl.customCover || pl.tracks?.[0]?.thumbnail || '';
            const tCount = pl.tracks?.length || 0;
            return `
              <div class="pl-card" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:12px;transition:all 0.25s cubic-bezier(0.2,0,0,1);">
                <div style="position:relative;width:100%;aspect-ratio:1;border-radius:12px;overflow:hidden;background:#18181c;display:flex;align-items:center;justify-content:center;">
                  ${plCover ? `<img src="${escHtml(plCover)}" onerror="this.src=''" style="width:100%;height:100%;object-fit:cover;" />` : `<span class="material-symbols-outlined" style="font-size:48px;color:rgba(255,255,255,0.2);">playlist_play</span>`}
                  <button class="play-overlay-btn" onclick="window.playSharedPlByIndex(${idx})" style="position:absolute;bottom:10px;right:10px;width:40px;height:40px;border-radius:50%;background:var(--c-accent);border:none;color:#000;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,0.5);cursor:pointer;" title="Çal">
                    <span class="material-symbols-outlined" style="font-size:24px;">play_arrow</span>
                  </button>
                </div>
                <div style="flex:1;">
                  <div style="font-weight:700;font-size:15px;color:var(--c-text-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escHtml(pl.name)}">${escHtml(pl.name)}</div>
                  <div style="font-size:12px;color:var(--c-text-muted);margin-top:2px;">${tCount} şarkı</div>
                </div>
                <div style="display:flex;gap:8px;">
                  <button class="btn-secondary" id="btn-import-pl-${idx}" onclick="window.importSingleSharedPlFromSetup(${idx}, this)" style="flex:1;padding:7px 10px;font-size:11.5px;border-radius:10px;display:flex;align-items:center;justify-content:center;gap:4px;">
                    <span class="material-symbols-outlined" style="font-size:14px;">playlist_add</span>
                    <span>Kütüphaneye Ekle</span>
                  </button>
                  <button class="btn-secondary" onclick="window.previewSharedPlFromSetup(${idx})" style="padding:7px 10px;font-size:11.5px;border-radius:10px;display:flex;align-items:center;justify-content:center;" title="Şarkıları Gör">
                    <span class="material-symbols-outlined" style="font-size:16px;">visibility</span>
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Liked Tracks Section (if any) -->
      ${likedTracks.length ? `
        <div style="margin-bottom: 32px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
            <div style="font-size:18px;font-weight:800;color:var(--c-text-1);display:flex;align-items:center;gap:8px;">
              <span class="material-symbols-outlined" style="color:#ef4444;font-size:22px;">favorite</span>
              <span>Paketteki Beğenilen Şarkılar (${likedTracks.length})</span>
            </div>
            <button class="btn-secondary" id="btn-play-setup-liked" style="padding:7px 16px;font-size:12px;border-radius:20px;display:flex;align-items:center;gap:6px;">
              <span class="material-symbols-outlined" style="font-size:16px">play_arrow</span>
              <span>Beğenilenleri Çal</span>
            </button>
          </div>
          <div class="search-track-list">
            ${likedTracks.map((t, idx) => renderSearchTrackRow(t, idx, likedTracks)).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;

  // Back
  const backBtn = $('btn-setup-back');
  const breadcrumb = $('breadcrumb-setup');
  const goBack = () => loadView('discover');
  if (backBtn) backBtn.onclick = goBack;
  if (breadcrumb) breadcrumb.onclick = goBack;

  // Merge Button
  const mergeBtn = $('btn-setup-merge');
  if (mergeBtn) {
    mergeBtn.onclick = async () => {
      mergeBtn.disabled = true;
      const res = await window.lumina.importFullSetup(data, 'merge');
      if (res && res.success) {
        mergeBtn.style.background = 'rgba(34, 197, 94, 0.2)';
        mergeBtn.style.borderColor = '#22c55e';
        mergeBtn.style.color = '#22c55e';
        mergeBtn.innerHTML = `
          <span class="material-symbols-outlined" style="font-size:18px">check_circle</span>
          <span>Kurulum Tamamlandı!</span>
        `;
        showToast(`${res.countPlaylists} playlist ve ${res.countLiked} şarkı kütüphanenize eklendi!`, 'success');
        if (typeof window.loadPlaylists === 'function') await window.loadPlaylists();
        if (typeof window.renderSidebarPlaylists === 'function') window.renderSidebarPlaylists();
        if (typeof window.loadSettings === 'function') await window.loadSettings();
      } else {
        mergeBtn.disabled = false;
        showToast('Kurulum başarısız: ' + (res?.error || ''), 'error');
      }
    };
  }

  // Replace Button
  const replaceBtn = $('btn-setup-replace');
  if (replaceBtn) {
    replaceBtn.onclick = async () => {
      if (!confirm('DİKKAT: Mevcut kütüphaneniz (tüm playlistler ve beğeniler) silinerek bu kurulum paketi kurulacak. Onaylıyor musunuz?')) {
        return;
      }
      replaceBtn.disabled = true;
      const res = await window.lumina.importFullSetup(data, 'replace');
      if (res && res.success) {
        replaceBtn.style.background = 'rgba(34, 197, 94, 0.2)';
        replaceBtn.style.borderColor = '#22c55e';
        replaceBtn.style.color = '#22c55e';
        replaceBtn.innerHTML = `
          <span class="material-symbols-outlined" style="font-size:18px">check_circle</span>
          <span>Sıfırdan Kuruldu!</span>
        `;
        showToast('Kütüphane sıfırdan kuruldu!', 'success');
        if (typeof window.loadPlaylists === 'function') await window.loadPlaylists();
        if (typeof window.renderSidebarPlaylists === 'function') window.renderSidebarPlaylists();
        if (typeof window.loadSettings === 'function') await window.loadSettings();
      } else {
        replaceBtn.disabled = false;
        showToast('Kurulum başarısız: ' + (res?.error || ''), 'error');
      }
    };
  }

  // Play Liked Button
  const playLikedBtn = $('btn-play-setup-liked');
  if (playLikedBtn) {
    playLikedBtn.onclick = () => {
      if (likedTracks.length && typeof playTrack === 'function') {
        playTrack(likedTracks[0], likedTracks);
        showToast('Beğenilen şarkılar çalınıyor', 'info');
      }
    };
  }
}

window.playSharedPlByIndex = function(idx) {
  const setupData = window._sharedSetupData;
  if (!setupData || !setupData.playlists || !setupData.playlists[idx]) return;
  const pl = setupData.playlists[idx];
  if (pl.tracks && pl.tracks.length && typeof playTrack === 'function') {
    playTrack(pl.tracks[0], pl.tracks);
    showToast(`"${pl.name}" çalınıyor`, 'info');
  }
};

window.importSingleSharedPlFromSetup = async function(idx, btn) {
  const setupData = window._sharedSetupData;
  if (!setupData || !setupData.playlists || !setupData.playlists[idx]) return;
  const pl = setupData.playlists[idx];
  if (btn) btn.disabled = true;
  const res = await window.lumina.importSinglePlaylist({
    name: pl.name,
    tracks: pl.tracks || [],
    customCover: pl.customCover || null
  });
  if (res && res.success) {
    if (btn) {
      btn.style.color = '#22c55e';
      btn.style.borderColor = 'rgba(34, 197, 94, 0.4)';
      btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:14px">check</span><span>Eklendi</span>`;
    }
    showToast(`"${pl.name}" kütüphanenize eklendi!`, 'success');
    if (typeof window.loadPlaylists === 'function') await window.loadPlaylists();
    if (typeof window.renderSidebarPlaylists === 'function') window.renderSidebarPlaylists();
  } else {
    if (btn) btn.disabled = false;
    showToast('Playlist eklenemedi: ' + (res?.error || ''), 'error');
  }
};

window.previewSharedPlFromSetup = function(idx) {
  const setupData = window._sharedSetupData;
  const rawLink = window._sharedSetupRawLink;
  if (!setupData || !setupData.playlists || !setupData.playlists[idx]) return;
  const pl = setupData.playlists[idx];
  renderSharedPlaylistInSearch(pl, rawLink, true, () => {
    renderSharedSetupInSearch(setupData, rawLink);
  }, `Paket İçi Çalma Listesi (${pl.name})`);
};

window.processSharedLink = processSharedLink;
window.renderSharedPlaylistInSearch = renderSharedPlaylistInSearch;
window.renderSharedSetupInSearch = renderSharedSetupInSearch;

window.setupSearch = setupSearch;
window.doSearch = doSearch;
window.renderSearchPage = renderSearchPage;
window.loadMoreSearch = loadMoreSearch;
window.renderTrackGrid = renderTrackGrid;
window.onCardClick = onCardClick;
window.getGridTracks = getGridTracks;
window.playTrackFromGrid = playTrackFromGrid;
