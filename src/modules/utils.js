'use strict';
/* ═══════════════════════════════════════════════════════════
   UTILS — Yardımcı fonksiyonlar, Toast, Modal, Visualizer
   ═══════════════════════════════════════════════════════════ */

// ── Helpers ───────────────────────────────────────────────────
const $ = id => document.getElementById(id);
window.$ = $;

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
}

function formatBytes(b) {
  if (!b) return '';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

// ── Context Menu ──────────────────────────────────────────────
function setupContextMenu() {
  document.addEventListener('click', () => closeContextMenu());
}

function closeContextMenu() {
  $('context-menu').style.display = 'none';
}

// ── Modal ─────────────────────────────────────────────────────
function setupModal() {
  $('modal-close').onclick = closeModal;
  $('modal-overlay').addEventListener('click', e => { if (e.target === $('modal-overlay')) closeModal(); });
}

function showModal(title, bodyHtml) {
  $('modal-title').textContent = title;
  $('modal-body').innerHTML    = bodyHtml;
  $('modal-overlay').style.display = 'flex';
}

function closeModal() {
  $('modal-overlay').style.display = 'none';
}

// ── Toast Notification ────────────────────────────────────────
function showToast(msg, type='info') {
  const el = document.createElement('div');
  el.className = 'download-toast' + (type === 'success' ? ' done' : type === 'error' ? ' error' : '');
  el.style.minWidth = '220px';
  el.innerHTML = `<div class="toast-header"><span class="toast-title">${escHtml(msg)}</span></div>`;
  $('download-toasts').appendChild(el);
  setTimeout(() => { el.classList.add('removing'); setTimeout(() => el.remove(), 280); }, 2800);
}

// ── Download Toasts ───────────────────────────────────────────
function addDownloadToast(videoId, title) {
  const toasts = $('download-toasts');
  const id = 'toast-' + videoId;
  if ($(id)) return;
  const el = document.createElement('div');
  el.className = 'download-toast';
  el.id = id;
  el.innerHTML = `
    <div class="toast-header">
      <span class="material-symbols-outlined toast-icon" style="color:#a78bfa;font-size:20px;margin-right:8px">download</span>
      <span class="toast-title">${escHtml(title)}</span>
      <button class="toast-close" onclick="removeToast('${id}')">
        <span class="material-symbols-outlined" style="font-size:14px">close</span>
      </button>
    </div>
    <div class="toast-progress-track"><div class="toast-progress-fill" id="toast-fill-${videoId}" style="width:0%"></div></div>
    <div class="toast-status" id="toast-status-${videoId}">İndiriliyor...</div>`;
  toasts.appendChild(el);
}

function removeToast(id) {
  const el = $(id);
  if (!el) return;
  el.classList.add('removing');
  setTimeout(() => el.remove(), 280);
}

// ── Welcome Toast ─────────────────────────────────────────────
function showWelcomeToast() {
  const el = document.createElement('div');
  el.className = 'welcome-toast';
  el.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <span class="material-symbols-outlined" style="font-size: 24px; color: var(--c-accent-3)">waving_hand</span>
      <span>Hoşgeldin Gardess !!! Bir Donate Atsan İyi Olurdu ... İyi Dinlemeler !!!</span>
    </div>
  `;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'none';
    el.style.transform = 'translate(-50%, -150%)';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 600);
  }, 5000);
}

// ── Spectrum Visualizer ───────────────────────────────────────
function setupVisualizer() {
  const canvas  = $('spectrum-canvas');
  const ctx2d   = canvas.getContext('2d');
  let audioCtx, analyser, source, animFrame;
  let fallback  = true;
  let fallbackData = Array.from({length: 32}, () => Math.random() * 0.4);
  const audio = document.getElementById('audio-element');

  function initAudioContext() {
    if (audioCtx) return;
    try {
      audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
      analyser  = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      source    = audioCtx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
      fallback  = false;
    } catch (e) {
      console.warn('[visualizer] WebAudio not available:', e.message);
      fallback = true;
    }
  }

  audio.addEventListener('play', () => {
    initAudioContext();
    if (audioCtx?.state === 'suspended') audioCtx.resume();
    cancelAnimationFrame(animFrame);
    drawSpectrum();
  });
  audio.addEventListener('pause', () => cancelAnimationFrame(animFrame));

  function drawSpectrum() {
    animFrame = requestAnimationFrame(drawSpectrum);
    const W = canvas.width, H = canvas.height;
    ctx2d.clearRect(0, 0, W, H);
    let data;
    if (!fallback && analyser) {
      const buf = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(buf);
      data = Array.from(buf).slice(0, 32).map(v => v / 255);
    } else {
      fallbackData = fallbackData.map(v => {
        const delta = (Math.random() - 0.5) * 0.08;
        return Math.max(0.05, Math.min(0.9, v + delta));
      });
      data = fallbackData;
    }
    const bars  = data.length;
    const bw    = W / bars - 1.5;
    const grad  = ctx2d.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, '#6d28d9');
    grad.addColorStop(0.5, '#8b5cf6');
    grad.addColorStop(1, '#a78bfa');
    ctx2d.fillStyle = grad;
    data.forEach((v, i) => {
      const bh = Math.max(2, v * H);
      const x  = i * (bw + 1.5);
      const r  = Math.min(bw / 2, 3);
      ctx2d.beginPath();
      ctx2d.roundRect(x, H - bh, bw, bh, r);
      ctx2d.fill();
    });
  }

  // Draw idle state
  (function idleDraw() {
    if (!audio.paused) return;
    const W = canvas.width, H = canvas.height;
    ctx2d.clearRect(0, 0, W, H);
    const bars = 32, bw = W / bars - 1.5;
    ctx2d.fillStyle = 'rgba(139,92,246,0.2)';
    for (let i = 0; i < bars; i++) {
      const bh = 2 + Math.random() * 4;
      ctx2d.beginPath();
      ctx2d.roundRect(i * (bw + 1.5), H - bh, bw, bh, 1);
      ctx2d.fill();
    }
    setTimeout(idleDraw, 200);
  })();
}

// Global erişim
window.escHtml = escHtml;
window.formatTime = formatTime;
window.formatBytes = formatBytes;
window.showModal = showModal;
window.closeModal = closeModal;
window.showToast = showToast;
window.addDownloadToast = addDownloadToast;
window.removeToast = removeToast;
window.showWelcomeToast = showWelcomeToast;
window.setupContextMenu = setupContextMenu;
window.closeContextMenu = closeContextMenu;
window.setupModal = setupModal;
window.setupVisualizer = setupVisualizer;
