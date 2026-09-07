'use strict';
/* ═══════════════════════════════════════════════════════════
   PLAYER — Oynatma, kuyruk, kontroller, indirme
   ═══════════════════════════════════════════════════════════ */

const audio = document.getElementById('audio-element');

let currentPlayRequestId = 0;

// ── Playback ──────────────────────────────────────────────────
async function playTrack(track, queue) {
  if (!track) return;
  
  const reqId = ++currentPlayRequestId;
  
  State.currentTrack = track;
  if (!State.history.includes(track.id)) {
    State.history.push(track.id);
    if (State.history.length > 15) State.history.shift();
  }

  // En Son Dinlenenler mantığı (Aynı şarkı varsa çıkar, en başa ekle)
  State.recentTracks = State.recentTracks.filter(t => t.id !== track.id);
  State.recentTracks.unshift(track);
  if (State.recentTracks.length > 12) State.recentTracks.pop();
  
  // Kalıcı hafızaya kaydet
  localStorage.setItem('lcc_recent_tracks', JSON.stringify(State.recentTracks));

  if (State.currentView === 'discover' && typeof window.renderRecentTracks === 'function') {
    window.renderRecentTracks();
  }

  if (queue) { State.queue = queue; State.queueIndex = queue.findIndex(t => t.id === track.id); }
  updatePlayerUI(track);
  updateNowPlayingPanel(track);
  updateQueueHighlight();
  updateGridHighlight(track.id);
  loadLyrics(track);
  audio.pause();
  audio.src = '';
  audio.removeAttribute('src');
  showPlayerLoading(true);

  try {
    let playId = track.id;

    // ── Yerel dosya oynatma ───────────────────────────────────
    if (playId.startsWith('local:')) {
      const filePath = playId.slice(6);
      const proxyUrl = await window.lumina.playLocalFile(filePath);
      if (!proxyUrl) throw new Error('Yerel dosya bulunamadı: ' + filePath);
      audio.src = proxyUrl;
      const pp = audio.play();
      if (pp) pp.catch(e => {
        if (e.name !== 'AbortError') showToast('Oynatma hatası: ' + e.message, 'error');
      });
      showPlayerLoading(false);
      return;
    }

    // ── Spotify ID'yi YouTube ID'ye çözümle ──────────────────
    if (playId.startsWith('spotify:')) {
      if (track.id_resolved) {
        playId = track.id_resolved;
        console.log('[spotify] using cached youtube ID:', playId);
      } else {
        const query = playId.substring(8);
        console.log('[spotify] resolving youtube ID for:', query);
        const searchRes = await window.lumina.search(query);
        const items = searchRes.items || searchRes;

        if (reqId !== currentPlayRequestId) return;

        if (items && items.length > 0) {
          playId = items[0].id;
          track.id_resolved = playId;
          console.log('[spotify] resolved to:', playId, items[0].title);
          if (items[0].thumbnail) {
            track.thumbnail = items[0].thumbnail;
            document.querySelectorAll(`.track-row[data-id="${track.id}"] .track-row-thumb`)
              .forEach(img => { img.src = track.thumbnail; });
          }
          for (const p of State.playlists) {
            if (p.tracks.some(t => t.id === track.id)) {
              window.lumina.saveSpotifyImport({ id: p.id, tracks: p.tracks, sourceUrl: p.sourceUrl });
            }
          }
        } else {
          throw new Error('Eşleşen şarkı bulunamadı');
        }
      }
    }

    // ── 1. Önce çevrimdışı önbelleğe bak (Spotify mantığı) ───
    const isCachedLocally = window.AudioCacheManager?.isCached(playId);
    if (isCachedLocally) {
      let cachedAudio = null;
      try { cachedAudio = await window.AudioCacheManager.get(playId); } catch(_) {}
      if (cachedAudio?.url && reqId === currentPlayRequestId) {
        console.log('[play] 💾 Offline cache\'den oynatılıyor:', playId);
        if (cachedAudio.title && !track.title) track.title = cachedAudio.title;
        if (cachedAudio.thumbnail && !track.thumbnail) {
          track.thumbnail = cachedAudio.thumbnail;
          updatePlayerUI(track);
          updateNowPlayingPanel(track);
        }
        audio.src = cachedAudio.url;
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch(e => {
            if (e.name === 'AbortError' || e.message.includes('interrupted')) return;
            console.error('[audio.play] Cache oynatma hatası:', e.name, e.message);
            showPlayerLoading(false);
          });
        }
        showPlayerLoading(false);
        loadRelated(playId);
        prefetchNextInQueue();
        return;
      }
    }

    // ── 2. Çevrimdışı kontrol — gereksiz network isteğini önle ──
    if (!navigator.onLine) {
      showPlayerLoading(false);
      showToast('Çevrimdışı moddasınız — bu şarkı daha önce indirilmemiş.', 'warning');
      return;
    }

    // ── 3. İnternet'ten stream URL al ────────────────────────
    const info = await window.lumina.getStreamUrl(playId);

    if (reqId !== currentPlayRequestId) return;

    if (!info?.url) {
      throw new Error('Stream URL alınamadı (sunucudan boş yanıt geldi)');
    }

    console.log('[play] 🌐 Stream URL:', info.url.substring(0, 80), '...');
    if (info.title && !track.title) track.title = info.title;
    if (info.thumbnail && !track.id.startsWith('spotify:') && !track.thumbnail) {
      track.thumbnail = info.thumbnail;
      updatePlayerUI(track);
      updateNowPlayingPanel(track);
    }
    audio.src = info.url;
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch(e => {
        if (e.name === 'AbortError' || e.message.includes('interrupted')) return;
        console.error('[audio.play] Error:', e.name, e.message);
        showPlayerLoading(false);
        showToast(`Oynatma hatası: ${e.message}`, 'error');
      });
    }
    showPlayerLoading(false);

    // ── 4. Arka planda diske kaydet (sonraki oynatma için) ─────────
    if (window.AudioCacheManager && !window.AudioCacheManager.isCached(playId)) {
      const _playIdForCache = playId;      // Closure için açık referans
      const _reqIdForCache  = reqId;       // Aynı şarkı olduğundan emin ol
      setTimeout(() => {
        // Sadece hala aynı istek aktifse cache'le
        if (_reqIdForCache === currentPlayRequestId && !audio.paused) {
          window.AudioCacheManager.put(_playIdForCache, { silent: true }).catch(() => {});
        }
      }, 12000); // 12 saniye — stream yerleştikten sonra cache'le
    }

    loadRelated(playId);
    prefetchNextInQueue();
  } catch (e) {
    if (e.name === 'AbortError') return; // İptal edilen istek — sessizce geç
    console.error('[playTrack] Hata:', e.message);
    showPlayerLoading(false);
    // Çevrimdışı hatada otomatik olarak sonraki şarkıya geçme
    const isOfflineErr = e.message?.includes('Çevrimdışı') || e.message?.includes('offline');
    if (!isOfflineErr) {
      showToast('Yüklenemedi: ' + (e.message || track.title), 'error');
      setTimeout(() => playNext(), 2500);
    }
  }
}

function showPlayerLoading(loading) {
  const btn = $('btn-play');
  if (loading) {
    btn.innerHTML = `<div class="search-spinner" style="display:block;width:20px;height:20px;border-color:rgba(255,255,255,0.3);border-top-color:#fff"></div>`;
  } else {
    btn.innerHTML = `
      <span class="material-symbols-outlined icon-play" style="font-size: 32px; ${audio.paused ? '' : 'display:none;'}">play_arrow</span>
      <span class="material-symbols-outlined icon-pause" style="font-size: 32px; ${audio.paused ? 'display:none;' : ''}">pause</span>`;
  }
}

async function loadRelated(videoId) {
  const list = $('up-next-list');
  if (!list) return;

  if (State.queue.length <= State.queueIndex + 1) {
    list.innerHTML = '<div style="padding:10px 20px;font-size:12px;color:var(--c-text-3)">Yükleniyor...</div>';
  } else {
    renderUpNext();
  }

  const queryId = videoId.startsWith('spotify:') ? State.currentTrack?.id_resolved : videoId;
  const items = queryId ? await window.lumina.getRelated(queryId) : [];

  const filtered = items.filter(t =>
    !State.queue.find(q => q.id === t.id) &&
    !State.history.includes(t.id) &&
    t.id !== State.currentTrack?.id
  );
  window.__relatedTracks = filtered;

  renderUpNext();
}

window.playQueueTrack = function (idx) {
  if (idx >= 0 && idx < State.queue.length) {
    State.queueIndex = idx;
    playTrack(State.queue[idx], null);
  }
};
window.removeFromQueueAction = function (idx) {
  if (idx >= 0 && idx < State.queue.length) {
    State.queue.splice(idx, 1);
    showToast('Sıradan kaldırıldı', 'info');
    renderUpNext();
  }
};

window.onTrackDragStart = function (e, track) {
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', JSON.stringify({ source: 'search', track }));
  }
};

window.onQueueDragStart = function (e, idx) {
  e.dataTransfer.setData('text/plain', JSON.stringify({ source: 'queue', idx }));
};

window.onQueueDragOver = function (e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
};

window.onQueueDrop = function (e, dropIdx) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('drag-over');
  try {
    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
    if (data.source === 'search') {
      const targetQueueIdx = State.queueIndex + 1 + dropIdx;
      State.queue.splice(targetQueueIdx, 0, data.track);
      showToast('Sıraya eklendi', 'success');
      renderUpNext();
    } else if (data.source === 'queue') {
      const fromIdx = State.queueIndex + 1 + data.idx;
      const toIdx = State.queueIndex + 1 + dropIdx;
      if (fromIdx !== toIdx) {
        const [movedTrack] = State.queue.splice(fromIdx, 1);
        State.queue.splice(toIdx, 0, movedTrack);
        renderUpNext();
      }
    }
  } catch (err) {
    console.error('Drag drop error:', err);
  }
};

function setupUpNextDrop() {
  const panel = $('up-next-section') || $('up-next-list');
  if (!panel) return;

  const handleDragOver = e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    panel.classList.add('drag-active');
  };

  const handleDragLeave = e => {
    panel.classList.remove('drag-active');
  };

  const handleDrop = e => {
    e.preventDefault();
    panel.classList.remove('drag-active');

    if (e.target.closest('.up-next-item')) return;

    try {
      const dataStr = e.dataTransfer.getData('text/plain');
      if (!dataStr) return;
      const data = JSON.parse(dataStr);

      if (data.source === 'search' && data.track) {
        addToQueue(data.track);
        showToast(`"${data.track.title.substring(0, 25)}" sıraya eklendi`, 'success');
      }
    } catch (err) {
      console.warn('[drop] Error parsing data:', err);
    }
  };

  panel.addEventListener('dragover', handleDragOver);
  panel.addEventListener('dragleave', handleDragLeave);
  panel.addEventListener('drop', handleDrop);
}

function renderUpNext() {
  const list = $('up-next-list');
  if (!list) return;
  if (!list.dataset.dropSetup) {
    setupUpNextDrop();
    list.dataset.dropSetup = "1";
  }
  let html = '';

  const queuedTracks = State.queue.slice(State.queueIndex + 1);
  if (queuedTracks.length > 0) {
    const headerTitle = 'Sıradakiler';
    html += `<div style="padding:12px 20px 8px;font-size:11px;color:var(--c-accent-3);font-weight:700;letter-spacing:1px;text-transform:uppercase;">${headerTitle}</div>`;
    html += queuedTracks.map((t, idx) => `
      <div class="up-next-item" draggable="true" 
           ondragstart="window.onQueueDragStart(event, ${idx})"
           ondragover="window.onQueueDragOver(event)"
           ondragenter="this.classList.add('drag-over')"
           ondragleave="this.classList.remove('drag-over')"
           ondrop="window.onQueueDrop(event, ${idx})"
           onclick="playQueueTrack(${State.queueIndex + 1 + idx})"
           oncontextmenu="showTrackContextMenu(event, ${JSON.stringify(t).replace(/"/g, '&quot;')}, 'queue:${State.queueIndex + 1 + idx}')">
        <span class="material-symbols-outlined" style="font-size:16px;color:var(--c-text-3);margin-right:8px;flex-shrink:0;cursor:grab">drag_indicator</span>
        <img class="up-next-thumb" src="${escHtml(t.thumbnail || '')}" loading="lazy" onerror="this.src=''">
        <div class="up-next-info">
          <div class="up-next-title">${escHtml(t.title)}</div>
          <div class="up-next-artist">${escHtml(t.author || '')}</div>
        </div>
      </div>`).join('');
  }

  if ((State.autoplay || State.isRadioMode) && window.__relatedTracks && window.__relatedTracks.length > 0) {
    html += `<div style="padding:12px 20px 8px;font-size:11px;color:var(--c-text-3);font-weight:600;letter-spacing:1px;text-transform:uppercase;">Otomatik Oynatılacaklar</div>`;
    html += window.__relatedTracks.slice(0, 10).map(t => `
      <div class="up-next-item" onclick="playTrack(${JSON.stringify(t).replace(/"/g, '&quot;')}, null)"
           oncontextmenu="showTrackContextMenu(event, ${JSON.stringify(t).replace(/"/g, '&quot;')}, 'related')">
        <img class="up-next-thumb" src="${escHtml(t.thumbnail || '')}" loading="lazy" onerror="this.src=''">
        <div class="up-next-info">
          <div class="up-next-title">${escHtml(t.title)}</div>
          <div class="up-next-artist">${escHtml(t.author || '')} · ${escHtml(t.duration || '')}</div>
        </div>
      </div>`).join('');
  }

  if (!html) {
    html = '<div style="padding:12px 20px;font-size:12px;color:var(--c-text-3)">Sıra boş</div>';
  }
  list.innerHTML = html;
}

function updateGridHighlight(id) {
  document.querySelectorAll('.track-card, .search-top-result-card, .quick-card').forEach(c => {
    c.classList.toggle('playing', c.dataset.id === id);
  });
  document.querySelectorAll('.track-row, .search-track-row, .search-pl-table-row').forEach(r => {
    r.classList.toggle('playing', r.dataset.id === id);
  });
}

function updateQueueHighlight() {
  document.querySelectorAll('.track-row[data-idx]').forEach(r => {
    r.classList.toggle('playing', parseInt(r.dataset.idx) === State.queueIndex);
  });
}

function playNext() {
  if (!State.queue.length) {
    if ((State.autoplay || State.isRadioMode) && window.__relatedTracks && window.__relatedTracks.length > 0) {
      console.log('[autoplay] picking a related song...');
      const idx = Math.floor(Math.random() * Math.min(window.__relatedTracks.length, 5));
      const nextTrack = window.__relatedTracks[idx];
      window.__relatedTracks.splice(idx, 1);
      playTrack(nextTrack, [nextTrack]);
      return;
    }
    return;
  }

  if (State.repeat === 'one') { playTrack(State.currentTrack, null); return; }

  if (State.shuffle) {
    if (!State.shuffleOrder || State.shuffleOrder.length === 0) {
      State.shuffleOrder = State.queue.map((_, i) => i).filter(i => i !== State.queueIndex);
      for (let i = State.shuffleOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [State.shuffleOrder[i], State.shuffleOrder[j]] = [State.shuffleOrder[j], State.shuffleOrder[i]];
      }
    }
    if (State.shuffleOrder.length === 0) {
      if (State.repeat === 'all') { State.shuffleOrder = null; playNext(); return; }
      else {
        State.queue = [];
        if ((State.autoplay || State.isRadioMode) && window.__relatedTracks && window.__relatedTracks.length > 0) {
          playNext();
          return;
        }
        updatePlayPauseIcon(false); return;
      }
    }
    State.queueIndex = State.shuffleOrder.shift();
  } else {
    State.queueIndex++;
    if (State.queueIndex >= State.queue.length) {
      if (State.repeat === 'all') { State.queueIndex = 0; }
      else {
        State.queue = [];
        if ((State.autoplay || State.isRadioMode) && window.__relatedTracks && window.__relatedTracks.length > 0) {
          playNext();
          return;
        }
        updatePlayPauseIcon(false);
        return;
      }
    }
  }
  playTrack(State.queue[State.queueIndex], null);
}

function playPrev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (!State.queue.length) return;
  State.queueIndex = Math.max(0, State.queueIndex - 1);
  playTrack(State.queue[State.queueIndex], null);
}

// ── Player UI ─────────────────────────────────────────────────
function updatePlayerUI(track) {
  $('player-title').textContent = track.title || 'Bilinmeyen';
  $('player-artist').textContent = track.author || '';
  const thumb = $('player-thumb');
  thumb.innerHTML = track.thumbnail
    ? `<img src="${escHtml(track.thumbnail)}" onerror="this.style.display='none'">`
    : `<span class="material-symbols-outlined" style="font-size: 24px; opacity: 0.5;">music_note</span>`;
  $('btn-download-current').style.display = '';
  const liked = State.liked.has(track.id);
  $('player-like-btn').classList.toggle('liked', liked);
  document.title = `${track.title} — Lumina Music`;

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || 'Bilinmeyen',
      artist: track.author || 'Lumina Music',
      artwork: track.thumbnail ? [{ src: track.thumbnail, sizes: '512x512', type: 'image/png' }] : []
    });
  }
}

function updateNowPlayingPanel(track) {
  $('panel-title').textContent = track.title || '';
  $('panel-artist').textContent = track.author || '';
  const art = $('panel-artwork');
  const img = $('panel-artwork-img');
  const placeholder = art.querySelector('.artwork-placeholder');
  const glow = $('artwork-glow');
  const video = $('panel-video-preview');

  if (track.thumbnail) {
    img.src = track.thumbnail;
    img.style.display = 'block';
    placeholder.style.display = 'none';
    art.classList.add('active');
    video.classList.remove('ready'); // Her yeni ┼ƒark─▒da reset
    glow.style.background = 'var(--c-accent)';
    glow.classList.add('active');
    AmbientMode.update(track.thumbnail);
    prepareVideoPreview(track);
  } else {
    img.style.display = 'none';
    placeholder.style.display = 'flex';
    art.classList.remove('active');
    glow.classList.remove('active');
    AmbientMode.update(null);
    video.src = '';
    video.classList.remove('ready');
  }
}

async function prepareVideoPreview(track) {
  const video = $('panel-video-preview');
  if (!track || !window.lumina?.getStreamUrl) return;

  try {
    const playId = track.id_resolved || track.id;
    if (playId.startsWith('spotify:')) return;

    // M┬╝zik ├ºalarken arka planda d┬╝┼ƒ┬╝k ├º├╢z┬╝n┬╝rl┬╝kl┬╝ video stream'i al─▒yoruz (preview i├ºin)
    const info = await window.lumina.getStreamUrl(playId, { quality: 'low', type: 'video' });
    if (info && info.url) {
      video.src = info.url;
      video.load();
    }
  } catch (e) {
    console.warn('[video-preview] Error loading preview:', e);
  }
}

// Otomatik oynatma ve haz─▒r olma durumunu y├╢net
function setupVideoPreviewEvents() {
  const video = $('panel-video-preview');
  if (!video) return;

  video.oncanplay = () => {
    video.play().catch(() => { });
    video.classList.add('ready'); // CSS'te opacity 1 yapar
  };

  video.onerror = () => {
    video.classList.remove('ready');
  };
}

// ── Player Controls ───────────────────────────────────────────
function setupPlayerControls() {
  $('btn-play').onclick = togglePlayPause;
  $('btn-next').onclick = playNext;
  $('btn-prev').onclick = playPrev;
  $('btn-shuffle').onclick = toggleShuffle;
  $('btn-repeat').onclick = toggleRepeat;
  $('player-like-btn').onclick = toggleLike;
  if ($('player-share-btn')) $('player-share-btn').onclick = () => shareTrack(State.currentTrack);
  $('btn-download-current').onclick = () => { if (State.currentTrack) downloadTrack(State.currentTrack); };
  $('btn-mute').onclick = toggleMute;
  setupVideoPreviewEvents();

  if ($('btn-smart-radio')) {
    const btnRadio = $('btn-smart-radio');
    if (State.isRadioMode) btnRadio.classList.add('active');
    btnRadio.onclick = () => {
      State.isRadioMode = !State.isRadioMode;
      localStorage.setItem('lcc_auto_radio', JSON.stringify(State.isRadioMode));
      btnRadio.classList.toggle('active', State.isRadioMode);
      showToast(State.isRadioMode ? '📻 Smart Mix açıldı. Akıllı radyo modu aktif.' : 'Smart Mix kapatıldı.', 'info');
      if (typeof renderUpNext === 'function') renderUpNext();
    };
  }

  // ── Visualizer toggle ──
  if ($('btn-visualizer')) {
    const btnViz = $('btn-visualizer');
    btnViz.onclick = () => {
      if (window.VisualizerGL) {
        const active = VisualizerGL.toggle(audio);
        btnViz.classList.toggle('visualizer-active', active);
        btnViz.title = active ? 'Visualizer Aktif' : 'Visualizer';
        showToast(active ? '✨ WebGL Visualizer açıldı' : 'Visualizer kapatıldı', 'info');
      }
    };
  }

  if ($('btn-lyrics')) $('btn-lyrics').onclick = toggleLyrics;
  if ($('btn-close-lyrics')) $('btn-close-lyrics').onclick = toggleLyrics;
  if ($('btn-mini-player')) {
    $('btn-mini-player').onclick = async () => {
      const isMini = await window.lumina.toggleMiniPlayer();
      document.body.classList.toggle('mini-player-mode', isMini);
      document.documentElement.classList.toggle('mini-mode', isMini);
      if (isMini && $('lyrics-panel').classList.contains('show')) toggleLyrics();
    };
  }
  if ($('btn-mini-exit')) {
    $('btn-mini-exit').onclick = async () => {
      const isMini = await window.lumina.toggleMiniPlayer();
      document.body.classList.toggle('mini-player-mode', isMini);
      document.documentElement.classList.toggle('mini-mode', isMini);
    };
  }

  // ── Audio event listeners ──
  audio.addEventListener('play', () => {
    updatePlayPauseIcon(true);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'playing';
    }
    // Visualizer aktifse ses kaynağını bağla
    if (window.VisualizerGL && $('btn-visualizer')?.classList.contains('visualizer-active')) {
      VisualizerGL.start(audio);
    }
    
    // Discord RPC Güncelleme
    if (State.currentTrack && window.lumina.updateDiscordPresence) {
      const vidId = State.currentTrack.id_resolved || State.currentTrack.id;
      const isYt = !vidId.startsWith('local:') && !vidId.startsWith('spotify:');
      
      window.lumina.updateDiscordPresence({
        details: State.currentTrack.title || 'Bilinmeyen Şarkı',
        state: State.currentTrack.author || 'Bilinmeyen Sanatçı',
        largeImageKey: State.currentTrack.thumbnail || 'lcc_music', 
        songUrl: isYt ? `https://www.youtube.com/watch?v=${vidId}` : null,
        startTimestamp: Math.floor(Date.now() - (audio.currentTime * 1000)),
        endTimestamp: audio.duration ? Math.floor(Date.now() + (audio.duration - audio.currentTime) * 1000) : null,
        largeImageText: State.currentTrack.title || 'LCC-MUSIC'
      });
    }
    broadcastRemoteState();
  });
  audio.addEventListener('pause', () => {
    updatePlayPauseIcon(false);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused';
    }
    // Visualizer'ı tamamen kapatma, sadece animasyonu yavaşlat
    // (Kullanıcı manuel kapatmadıkça canvas aktif kalır)
    if (window.VisualizerGL && !$('btn-visualizer')?.classList.contains('visualizer-active')) {
      VisualizerGL.stop();
    }
    
    // Discord RPC Güncelleme (Paused)
    if (State.currentTrack && window.lumina.updateDiscordPresence) {
      window.lumina.updateDiscordPresence({
        details: State.currentTrack.title || 'Bilinmeyen Şarkı',
        state: 'Duraklatıldı | ' + (State.currentTrack.author || ''),
        smallImageKey: 'pause-icon',
        smallImageText: 'Duraklatıldı'
      });
    }
    broadcastRemoteState();
  });
  audio.addEventListener('ended', () => playNext());
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('loadedmetadata', () => { $('time-total').textContent = formatTime(audio.duration); });
  audio.addEventListener('error', (e) => {
    console.error('[audio error]', e);
    setTimeout(() => playNext(), 1500);
  });

  const trackEl = $('progress-track');
  let dragging = false;
  trackEl.addEventListener('mousedown', e => {
    dragging = true;
    seekTo(e, trackEl);
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => { if (dragging) seekTo(e, trackEl); });
  window.addEventListener('mouseup', () => { dragging = false; });

  $('btn-download-current').onclick = () => { if (State.currentTrack) showDownloadModal(State.currentTrack); };
}

function togglePlayPause() {
  if (!State.currentTrack) return;
  audio.paused ? audio.play() : audio.pause();
}

function updatePlayPauseIcon(playing) {
  const btn = $('btn-play');
  const ip = btn.querySelector('.icon-play');
  const ipa = btn.querySelector('.icon-pause');
  if (ip) ip.style.display = playing ? 'none' : '';
  if (ipa) ipa.style.display = playing ? '' : 'none';

  // Albüm kapağı dönsün / dursun
  const thumb = $('player-thumb');
  const img = thumb?.querySelector('img');
  if (img) img.style.animationPlayState = playing ? 'running' : 'paused';
}

function toggleShuffle() {
  State.shuffle = !State.shuffle;
  if (State.shuffle) {
    State.shuffleOrder = null;
  }
  updateShuffleBtn();
  saveSettings();
}
function updateShuffleBtn() { $('btn-shuffle').classList.toggle('active', State.shuffle); }

function toggleRepeat() {
  State.repeat = State.repeat === 'none' ? 'all' : State.repeat === 'all' ? 'one' : 'none';
  updateRepeatBtn();
  saveSettings();
}
function updateRepeatBtn() {
  const btn = $('btn-repeat');
  btn.classList.toggle('active', State.repeat !== 'none');
  btn.title = State.repeat === 'one' ? 'Tekrar: Bir' : State.repeat === 'all' ? 'Tekrar: Tümü' : 'Tekrar: Yok';
}

function toggleLike(trackArg) {
  const track = (trackArg && !trackArg.type) ? trackArg : State.currentTrack;
  if (!track) return;
  const id = track.id;
  const wasLiked = State.liked.has(id);
  
  if (wasLiked) {
    State.liked.delete(id);
    State.likedTracks = State.likedTracks.filter(t => t.id !== id);
  } else {
    State.liked.add(id);
    State.likedTracks.push(track);
    
    // Eğer o sırada bir playlist detayı açıksa, şarkıyı o playliste de otomatik ekle
    if (State.currentPlaylistId) {
      const pl = State.playlists.find(p => p.id === State.currentPlaylistId);
      if (pl && !pl.tracks.find(t => t.id === id)) {
        if (typeof window.addToPlaylistAction === 'function') {
          window.addToPlaylistAction(State.currentPlaylistId, track);
        }
      }
    }
  }
  if (State.currentTrack && State.currentTrack.id === id) {
    const btn = $('player-like-btn');
    if (btn) btn.classList.toggle('liked', State.liked.has(id));
  }
  saveSettings();
  if (State.currentView === 'library') {
    renderLibrary();
  }
}

function toggleMute() {
  State.muted = !State.muted;
  audio.muted = State.muted;
  $('btn-mute').querySelector('.vol-icon-full').style.display = State.muted ? 'none' : '';
  $('btn-mute').querySelector('.vol-icon-mute').style.display = State.muted ? '' : 'none';
}

function seekTo(e, trackEl) {
  const rect = trackEl.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  if (audio.duration) audio.currentTime = pct * audio.duration;
  updateProgressUI(pct);
}

function updateProgress() {
  if (!audio.duration) return;
  const pct = audio.currentTime / audio.duration;
  updateProgressUI(pct);
  $('time-current').textContent = formatTime(audio.currentTime);

  // Lirik ve Remote senkronizasyonu
  if (window._updateLyricHighlight) {
    window._updateLyricHighlight(audio.currentTime);
  }
  
  // Remote state'i çok sık basmamak için (yaklaşık saniyede 1)
  if (!window._throttle_rs || Date.now() - window._throttle_rs > 1000) {
     broadcastRemoteState();
     window._throttle_rs = Date.now();
  }
}

function updateProgressUI(pct) {
  const fill = $('progress-fill');
  const thumb = $('progress-thumb');
  const p = (pct * 100).toFixed(2) + '%';
  fill.style.width = p;
  thumb.style.left = p;
}

// ── Volume ────────────────────────────────────────────────────
function setupVolumeControl() {
  const slider = $('volume-slider');
  slider.addEventListener('input', () => {
    State.volume = parseInt(slider.value) / 100;
    audio.volume = State.volume;
    audio.muted = false;
    State.muted = false;
    $('btn-mute').querySelector('.vol-icon-full').style.display = '';
    $('btn-mute').querySelector('.vol-icon-mute').style.display = 'none';
    saveSettings();
    broadcastRemoteState();
  });
}

// ── Download ──────────────────────────────────────────────────
function showDownloadModal(track) {
  const currentBitrate = State.settings?.mp3Bitrate || '320K';
  showModal(`İndir: ${track.title.substring(0, 40)}`, `
    <p style="font-size:13px;color:var(--c-text-2);margin-bottom:12px">Format ve kalite seçimi yapın:</p>
    
    <div style="background:var(--c-bg-3);border:1px solid var(--c-border);border-radius:12px;padding:12px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between">
       <span style="font-size:13px;color:var(--c-text-2);font-weight:600">MP3 Kalitesi:</span>
       <select id="modal-mp3-bitrate" class="settings-select" style="padding:6px 12px;font-size:12px;min-width:130px">
          <option value="320K" ${currentBitrate === '320K' ? 'selected' : ''}>320 kbps</option>
          <option value="256K" ${currentBitrate === '256K' ? 'selected' : ''}>256 kbps</option>
          <option value="192K" ${currentBitrate === '192K' ? 'selected' : ''}>192 kbps</option>
          <option value="128K" ${currentBitrate === '128K' ? 'selected' : ''}>128 kbps</option>
       </select>
    </div>

    <div style="display:flex;gap:10px;flex-direction:column">
      <div style="display:flex;gap:10px">
        <button class="btn-primary" style="flex:1" onclick="startDownloadWrapper(${JSON.stringify(track).replace(/"/g, '&quot;')}, 'mp3', document.getElementById('modal-mp3-bitrate').value);closeModal()">
          🎵 MP3 İndir
        </button>
        <button class="btn-primary" style="flex:1;background:var(--c-accent-2)" onclick="startDownloadWrapper(${JSON.stringify(track).replace(/"/g, '&quot;')}, 'wav');closeModal()">
          🔊 WAV İndir
        </button>
      </div>
      <button class="btn-secondary" style="width:100%" onclick="startDownloadWrapper(${JSON.stringify(track).replace(/"/g, '&quot;')}, 'mp4');closeModal()">
        🎬 MP4 (Video)
      </button>
    </div>`);
}

async function startDownloadWrapper(track, format, overrideQuality) {
  let dlId = track.id_resolved || track.id;
  if (dlId.startsWith('spotify:')) {
    const query = dlId.substring(8);
    const searchRes = await window.lumina.search(query);
    const items = searchRes.items || searchRes;
    if (items && items.length > 0) dlId = items[0].id;
    else { showToast('İndirilecek video bulunamadı'); return; }
  }
  await startDownload(dlId, track.title, format, overrideQuality);
}

async function downloadTrack(track, format) {
  if (format) {
    await startDownloadWrapper(track, format);
  } else if (State.settings && State.settings.dlFormat && State.settings.dlFormat !== 'ask') {
    await startDownloadWrapper(track, State.settings.dlFormat);
  } else {
    showDownloadModal(track);
  }
}

async function downloadPlaylist(playlistId, format) {
  const pl = State.playlists.find(p => p.id === playlistId);
  if (!pl || !pl.tracks.length) return;

  showToast(`"${pl.name}" toplu indirme başlatıldı (${format.toUpperCase()})`, 'info');

  for (const track of pl.tracks) {
    await startDownloadWrapper(track, format);
  }
}

async function startDownload(videoId, title, format, overrideQuality) {
  addDownloadToast(videoId, title);
  const mp3Quality = overrideQuality || State.settings?.mp3Bitrate || '320K';
  await window.lumina.download({ videoId, title, format, mp3Quality });
}

function showTrackContextMenu(e, track, source) {
  e.preventDefault();
  const menu = $('context-menu');
  if (!menu || !track) return;

  if (track.type === 'playlist') {
    const jsonStr = JSON.stringify(track).replace(/"/g, '&quot;');
    menu.innerHTML = `
      <button class="ctx-item" onclick="openYoutubePlaylist('${escHtml(track.id)}', ${jsonStr}.title);closeContextMenu()">
        <span class="material-symbols-outlined" style="font-size:18px;margin-right:8px">queue_music</span>
        Çalma Listesini Aç
      </button>
      <button class="ctx-item" onclick="playYoutubePlaylistAll('${escHtml(track.id)}');closeContextMenu()">
        <span class="material-symbols-outlined" style="font-size:18px;margin-right:8px">play_arrow</span>
        Tümünü Çal
      </button>
      <div class="ctx-sep"></div>
      <button class="ctx-item" onclick="navigator.clipboard.writeText('https://www.youtube.com/playlist?list=${escHtml(track.id)}');showToast('Bağlantı kopyalandı', 'success');closeContextMenu()">
        <span class="material-symbols-outlined" style="font-size:18px;margin-right:8px">share</span>
        Listeyi Paylaş
      </button>`;
    menu.style.display = 'block';
    const x = Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 8);
    const y = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8);
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    return;
  }
  const playlistItems = State.playlists.map(pl => `
    <button class="ctx-item" onclick="addToPlaylistAction('${pl.id}', ${JSON.stringify(track).replace(/"/g, '&quot;')});closeContextMenu()">
      <span class="material-symbols-outlined" style="font-size:18px;margin-right:8px">playlist_add</span>
      ${escHtml(pl.name)}
    </button>`).join('');
  menu.innerHTML = `
    <button class="ctx-item" onclick="playTrack(${JSON.stringify(track).replace(/"/g, '&quot;')},null);closeContextMenu()">
      <span class="material-symbols-outlined" style="font-size:18px;margin-right:8px">play_arrow</span>
      Oynat
    </button>
    <button class="ctx-item" onclick="startRadio(${JSON.stringify(track).replace(/"/g, '&quot;')});closeContextMenu()">
      <span class="material-symbols-outlined" style="font-size:18px;margin-right:8px">radio</span>
      Radyo Başlat (Benzerlerini Çal)
    </button>
    <button class="ctx-item" onclick="addToQueue(${JSON.stringify(track).replace(/"/g, '&quot;')});closeContextMenu()">
      <span class="material-symbols-outlined" style="font-size:18px;margin-right:8px">add</span>
      Sıraya Ekle
    </button>
    <div class="ctx-sep"></div>
    <button class="ctx-item" onclick="shareTrack(${JSON.stringify(track).replace(/"/g, '&quot;')});closeContextMenu()">
      <span class="material-symbols-outlined" style="font-size:18px;margin-right:8px">share</span>
      Şarkıyı Paylaş
    </button>
    <button class="ctx-item" onclick="showDownloadModal(${JSON.stringify(track).replace(/"/g, '&quot;')});closeContextMenu()">
      <span class="material-symbols-outlined" style="font-size:18px;margin-right:8px">download</span>
      İndir
    </button>
    ${playlistItems ? `<div class="ctx-sep"></div><div style="padding:4px 12px;font-size:11px;color:var(--c-text-3);font-weight:600;letter-spacing:0.5px">PLAYLİSTE EKLE</div>${playlistItems}` : ''}
    ${source?.startsWith('queue:')
      ? `<div class="ctx-sep"></div><button class="ctx-item danger" onclick="removeFromQueueAction(${source.split(':')[1]});closeContextMenu()">
          <span class="material-symbols-outlined" style="font-size:18px;margin-right:8px">delete</span>
          Sıradan Kaldır
         </button>` : ''}
    ${source?.startsWith('playlist:')
      ? `<div class="ctx-sep"></div><button class="ctx-item danger" id="ctx-pl-remove">
          <span class="material-symbols-outlined" style="font-size:18px;margin-right:8px">delete</span>
          Listeden Kaldır
         </button>` : ''}`;

  if (source?.startsWith('playlist:')) {
    const btn = menu.querySelector('#ctx-pl-remove');
    if (btn) {
      const plId = source.split(':')[1];
      btn.addEventListener('click', () => {
        removeFromPlaylistUI(plId, track.id);
        closeContextMenu();
      });
    }
  }

  menu.style.display = 'block';
  const x = Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 8);
  const y = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

function addToQueue(track) {
  if (State.isRadioMode && State.queueIndex !== -1) {
    State.queue.splice(State.queueIndex + 1, 0, track);
  } else {
    State.queue.push(track);
  }
  showToast('Sıraya eklendi', 'success');
  if (typeof renderUpNext === 'function') renderUpNext();
}

window.startRadio = async function (track) {
  showToast('📻 Smart Mix hazırlanıyor...', 'info');
  State.isRadioMode = true;
  State.queue = [track];
  State.queueIndex = 0;

  playTrack(track, State.queue);

  let queryId = track.id;
  if (queryId.startsWith('spotify:')) {
    const q = queryId.substring(8);
    const s = await window.lumina.search(q);
    if (s.items && s.items.length) queryId = s.items[0].id;
    else return;
  }

  const related = await window.lumina.getRelated(queryId);
  if (related && related.length) {
    window.__relatedTracks = related.filter(r => r.id !== track.id);
    renderUpNext();
    showToast(`📻 Radyo: ${track.title.substring(0, 20)}... başlatıldı`, 'success');
  }
};

// ── IPC Listeners ─────────────────────────────────────────────
function setupIPCListeners() {
  window.lumina.onDownloadProgress(({ videoId, title, progress }) => {
    const fill = $(`toast-fill-${videoId}`);
    const status = $(`toast-status-${videoId}`);
    if (fill) fill.style.width = progress + '%';
    if (status) status.textContent = `İndiriliyor... %${progress}`;
  });
  window.lumina.onDownloadComplete(({ videoId, title, path }) => {
    const toast = $(`toast-${videoId}`);
    const status = $(`toast-status-${videoId}`);
    const fill = $(`toast-fill-${videoId}`);
    if (toast) { toast.classList.add('done'); }
    if (fill) fill.style.width = '100%';
    if (status) status.innerHTML = `✅ Tamamlandı! <a href="#" onclick="window.lumina.openFile('${path}');return false" style="color:var(--c-teal)">Aç</a>`;
    setTimeout(() => removeToast(`toast-${videoId}`), 6000);
  });
  window.lumina.onDownloadError(({ videoId, error }) => {
    const toast = $(`toast-${videoId}`);
    const status = $(`toast-status-${videoId}`);
    if (toast) toast.classList.add('error');
    if (status) status.textContent = '❌ Hata: ' + (error || 'Bilinmeyen hata');
    setTimeout(() => removeToast(`toast-${videoId}`), 8000);
  });
  window.lumina.onUpdateStatus(handleUpdateStatus);
  window.lumina.getUpdateStatus().then(status => {
    if (status && status.state !== 'idle') handleUpdateStatus(status);
  }).catch(() => { });
  window.lumina.onUpdateMessage(msg => {
    console.log('[app] update-message (legacy):', msg);
  });
  window.lumina.onYtdlpStatus(s => {
    const el = $('ytdlp-status');
    const txt = $('ytdlp-status-text');
    if (s === 'downloading') { el.style.display = 'flex'; txt.textContent = 'yt-dlp indiriliyor...'; }
    else if (s === 'ready') { txt.textContent = 'yt-dlp hazır'; setTimeout(() => el.style.display = 'none', 2000); }
    else if (s === 'error') { txt.textContent = 'yt-dlp hatası!'; }
  });

  window.lumina.onMediaControl(action => {
    if (action === 'play-pause') togglePlayPause();
    else if (action === 'next') playNext();
    else if (action === 'prev') playPrev();
  });

  if (window.lumina.onRemoteCommand) {
    window.lumina.onRemoteCommand(({ action, payload }) => {
      if (action === 'play-pause') togglePlayPause();
      else if (action === 'next') playNext();
      else if (action === 'prev') playPrev();
      else if (action === 'volume') {
        const slider = $('volume-slider');
        if (slider) {
          slider.value = payload * 100;
          slider.dispatchEvent(new Event('input'));
        }
      }
      else if (action === 'req-playlists') {
         if (window.lumina.sendRemoteState) {
            const remotePlaylists = [...State.playlists];
            if (State.likedTracks && State.likedTracks.length > 0) {
               remotePlaylists.unshift({
                  id: 'liked',
                  name: 'Beğenilen Müzikler',
                  tracks: State.likedTracks
               });
            }
            window.lumina.sendRemoteState({ type: 'playlists', data: remotePlaylists });
         }
      }
      else if (action === 'search') {
         window.lumina.search(payload).then(res => {
            if (window.lumina.sendRemoteState) {
               window.lumina.sendRemoteState({ type: 'search-results', data: res.items || res });
            }
         }).catch(err => console.error('[remote] search error:', err));
      }
      else if (action === 'req-stream-url') {
         const trackId = payload;
         window.lumina.getStreamUrl(trackId).then(res => {
            if (window.lumina.sendRemoteState && res && res.url) {
               window.lumina.sendRemoteState({ type: 'stream-url-result', data: { id: trackId, url: res.url } });
            }
         }).catch(err => console.error('[remote] req-stream-url error:', err));
      }
      else if (action === 'pause') {
         audio.pause();
      }
      else if (action === 'seek') {
         if (audio && audio.duration && !isNaN(payload)) {
            audio.currentTime = parseFloat(payload);
         }
      }
      else if (action === 'toggle-like') {
         if (typeof toggleLike === 'function') toggleLike();
      }
      else if (action === 'toggle-shuffle') {
         if (typeof toggleShuffle === 'function') toggleShuffle();
      }
      else if (action === 'toggle-repeat') {
         if (typeof toggleRepeat === 'function') toggleRepeat();
      }
      else if (action === 'toggle-radio') {
         const btnRadio = document.getElementById('btn-smart-radio');
         if (btnRadio) btnRadio.click();
      }
      else if (action === 'req-queue') {
         if (window.lumina.sendRemoteState) {
            const upcoming = State.queue.slice(State.queueIndex + 1);
            window.lumina.sendRemoteState({ type: 'queue-state', data: upcoming });
         }
      }
      else if (action === 'play-queue-track') {
         const relIdx = parseInt(payload);
         const targetIdx = State.queueIndex + 1 + relIdx;
         if (!isNaN(relIdx) && targetIdx >= 0 && targetIdx < State.queue.length) {
            State.queueIndex = targetIdx;
            playTrack(State.queue[targetIdx], State.queue);
         }
      }
      else if (action === 'remove-queue-track') {
         const relIdx = parseInt(payload);
         const targetIdx = State.queueIndex + 1 + relIdx;
         if (!isNaN(relIdx) && targetIdx > State.queueIndex && targetIdx < State.queue.length) {
            State.queue.splice(targetIdx, 1);
            if (typeof renderUpNext === 'function') renderUpNext();
            if (window.lumina.sendRemoteState) {
               const upcoming = State.queue.slice(State.queueIndex + 1);
               window.lumina.sendRemoteState({ type: 'queue-state', data: upcoming });
               broadcastRemoteState();
            }
         }
      }
      else if (action === 'req-lyrics') {
         if (window.lumina.sendRemoteState) {
            window.lumina.sendRemoteState({ type: 'lyrics-state', data: State.lyricsLines || [] });
         }
      }
      else if (action === 'play-track') {
         const plId = payload.playlistId;
         const track = payload.track;
         if (plId) {
            if (plId === 'liked') {
               playTrack(track, State.likedTracks);
               return;
            }
            const pl = State.playlists.find(p => p.id === plId);
            if (pl) { playTrack(track, pl.tracks); return; }
         }
         // Eğer arama'dan tetiklenmişse veya liste yoksa
         playTrack(track, [track]); 
      }
    });
  }

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', togglePlayPause);
    navigator.mediaSession.setActionHandler('pause', togglePlayPause);
    navigator.mediaSession.setActionHandler('previoustrack', playPrev);
    navigator.mediaSession.setActionHandler('nexttrack', playNext);
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (audio && audio.duration) { audio.currentTime = details.seekTime; }
    });
  }
}

// ── Prefetch ──────────────────────────────────────────────────
function prefetchNextInQueue() {
  if (!window.lumina?.prefetchStreams) return;
  const nextTracks = State.queue.slice(State.queueIndex + 1, State.queueIndex + 4);
  const nextIds = nextTracks
    .map(t => t.id_resolved || t.id)
    .filter(id => id && !id.startsWith('spotify:') && !id.startsWith('local:'));

  if (nextIds.length) {
    // Stream URL'lerini ön yükle (hızlı başlatma için)
    setTimeout(() => {
      window.lumina.prefetchStreams(nextIds).catch(() => {});
    }, 3000);

    // Audio dosyalarını arka planda indir (offline için) — sadece 1. sıradaki
    if (window.AudioCacheManager && nextIds[0]) {
      const nextId = nextIds[0];
      setTimeout(() => {
        if (!window.AudioCacheManager.isCached(nextId)) {
          window.AudioCacheManager.put(nextId, { silent: true }).catch(() => {});
        }
      }, 15000); // 15 saniye — mevcut şarkı indirilmeye bırakılsın
    }
  }
}

function broadcastRemoteState() {
  if (!window.lumina?.sendRemoteState) return;
  const isLiked = State.currentTrack && State.likedTracks ? State.likedTracks.some(t => t.id === State.currentTrack.id) : false;
  const qLen = Math.max(0, State.queue.length - State.queueIndex - 1);
  window.lumina.sendRemoteState({
    type: 'remote-state',
    data: {
      track: State.currentTrack,
      isPlaying: !audio.paused,
      currentTime: audio.currentTime,
      duration: audio.duration,
      volume: audio.volume,
      shuffle: State.shuffle,
      repeat: State.repeat,
      isRadioMode: State.isRadioMode,
      isLiked: isLiked,
      queueLength: qLen
    }
  });
}

// Global erişim
window.playTrack = playTrack;
window.playNext = playNext;
window.playPrev = playPrev;
window.setupPlayerControls = setupPlayerControls;
window.setupVolumeControl = setupVolumeControl;
window.setupIPCListeners = setupIPCListeners;
window.setupUpNextDrop = setupUpNextDrop;
window.renderUpNext = renderUpNext;
window.updatePlayerUI = updatePlayerUI;
window.updateNowPlayingPanel = updateNowPlayingPanel;
window.updateGridHighlight = updateGridHighlight;
window.updateQueueHighlight = updateQueueHighlight;
window.updateShuffleBtn = updateShuffleBtn;
window.updateRepeatBtn = updateRepeatBtn;
window.updatePlayPauseIcon = updatePlayPauseIcon;
window.updateProgress = updateProgress;
window.toggleLike = toggleLike;
window.showDownloadModal = showDownloadModal;
window.showTrackContextMenu = showTrackContextMenu;
window.startDownloadWrapper = startDownloadWrapper;
window.downloadTrack = downloadTrack;
window.downloadPlaylist = downloadPlaylist;
window.addToQueue = addToQueue;
window.prefetchNextInQueue = prefetchNextInQueue;

// ── Track Sharing ─────────────────────────────────────────────
async function copyShareText(text, btnEl) {
  try {
    if (window.lumina && window.lumina.writeClipboard) {
      await window.lumina.writeClipboard(text);
    } else {
      await navigator.clipboard.writeText(text);
    }
    if (btnEl) {
      btnEl.classList.add('copied');
      const origHtml = btnEl.innerHTML;
      btnEl.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">check</span><span>Kopyalandı!</span>';
      setTimeout(() => {
        btnEl.classList.remove('copied');
        btnEl.innerHTML = origHtml;
      }, 2000);
    }
    showToast('Bağlantı panoya kopyalandı', 'success');
  } catch (e) {
    console.error('Kopyalama hatası:', e);
    showToast('Kopyalama başarısız oldu', 'error');
  }
}
window.copyShareText = copyShareText;

async function shareTrack(track) {
  if (!track) {
    showToast('Paylaşılacak bir şarkı seçilmedi.', 'info');
    return;
  }
  const trackId = track.id_resolved || track.id;
  if (!trackId) {
    showToast('Şarkı ID bulunamadı.', 'error');
    return;
  }
  const luminaUrl = `lumina://track/${trackId}`;

  try {
    if (window.lumina && window.lumina.writeClipboard) {
      await window.lumina.writeClipboard(luminaUrl);
    } else {
      await navigator.clipboard.writeText(luminaUrl);
    }

    const shareBtn = $('player-share-btn');
    if (shareBtn) {
      shareBtn.style.color = '#22c55e';
      setTimeout(() => { shareBtn.style.color = ''; }, 1600);
    }

    showToast(`Şarkı bağlantısı kopyalandı: ${luminaUrl}`, 'success');
  } catch (e) {
    console.error('Kopyalama hatası:', e);
    showToast('Kopyalama başarısız oldu.', 'error');
  }
}
window.shareTrack = shareTrack;
