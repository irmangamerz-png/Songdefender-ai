const tabs = [...document.querySelectorAll('.tab')];
const panels = [...document.querySelectorAll('.panel')];
const activity = document.getElementById('activity');
const result = document.getElementById('result');
const aiResults = document.getElementById('ai-results');
const loaderTitle = document.getElementById('activity-title');
const loaderCopy = document.getElementById('activity-copy');
const fileInput = document.getElementById('audio-file');
let busy = false;

tabs.forEach(tab => tab.addEventListener('click', () => {
  tabs.forEach(t => { t.classList.toggle('active', t === tab); t.setAttribute('aria-selected', String(t === tab)); });
  panels.forEach(p => p.classList.toggle('active', p.dataset.panel === tab.dataset.tab));
  clearMessages();
}));
fileInput.addEventListener('change', () => {
  const f = fileInput.files[0];
  document.getElementById('file-title').textContent = f ? f.name : 'Pilih MP3, WAV, M4A, atau MP4';
  document.getElementById('file-subtitle').textContent = f ? `${(f.size / 1024 / 1024).toFixed(1)} MB · siap dianalisis` : 'Ketuk untuk memilih file dari perangkat · Maks. 50 MB';
});
function clearMessages() { activity.classList.add('hidden'); result.classList.add('hidden'); aiResults.classList.add('hidden'); }
function setBusy(title, copy) { busy = true; result.classList.add('hidden'); aiResults.classList.add('hidden'); activity.classList.remove('hidden'); loaderTitle.textContent = title; loaderCopy.textContent = copy; }
function setIdle() { busy = false; activity.classList.add('hidden'); }
function safeUrl(url) { try { const u = new URL(url); return ['http:', 'https:'].includes(u.protocol) ? u.href : '#'; } catch { return '#'; } }
function renderTrack(track, sourceLabel = 'HASIL PENGENALAN AUDIO') {
  setIdle(); result.classList.remove('hidden');
  const cover = track.album_art ? `<img class="cover" src="${safeUrl(track.album_art)}" alt="Sampul album" onerror="this.outerHTML='<div class=&quot;cover cover-fallback&quot;>♫</div>'">` : '<div class="cover cover-fallback">♫</div>';
  const title = escapeHtml(track.title || 'Judul belum diketahui');
  const artist = escapeHtml(track.artist || 'Artis tidak diketahui');
  const album = track.album ? `<div class="result-album">${escapeHtml(track.album)}</div>` : '';
  const links = [];
  if (track.song_link) links.push(`<a class="secondary-btn" target="_blank" rel="noopener noreferrer" href="${safeUrl(track.song_link)}">↗ Buka sumber lagu</a>`);
  if (track.spotify_url) links.push(`<a class="secondary-btn" target="_blank" rel="noopener noreferrer" href="${safeUrl(track.spotify_url)}">◉ Spotify</a>`);
  if (track.apple_music_url) links.push(`<a class="secondary-btn" target="_blank" rel="noopener noreferrer" href="${safeUrl(track.apple_music_url)}">♪ Apple Music</a>`);
  const preview = track.preview_url ? `<audio class="preview" controls preload="none" src="${safeUrl(track.preview_url)}">Browser tidak mendukung audio.</audio>` : '';
  result.innerHTML = `<div class="result-top">${cover}<div><div class="result-meta">${sourceLabel}</div><div class="result-title">${title}</div><div class="result-artist">${artist}</div>${album}</div></div>${links.length ? `<div class="result-actions">${links.join('')}</div>` : ''}${preview}<p class="disclaimer">${track.preview_url ? 'Cuplikan disediakan oleh sumber musik.' : 'Preview audio tidak tersedia untuk hasil ini. Gunakan tautan sumber untuk mendengarkan lagu.'}</p>`;
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function handleRecognition(url, file) {
  if (busy) return;
  setBusy('Sedang mengenali lagu…', url ? 'Mengambil audio video dan mencocokkan fingerprint audio.' : 'Menganalisis file dan mencari kecocokan lagu.');
  try {
    let response;
    if (url) {
      response = await fetch('/api/recognize-url', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
    } else {
      const fd = new FormData(); fd.append('file', file);
      response = await fetch('/api/recognize-file', {method:'POST',body:fd});
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Pencarian gagal. Periksa konfigurasi server.');
    if (data.track) renderTrack(data.track);
    else {
      setIdle(); result.classList.remove('hidden');
      result.innerHTML = `<div class="result-meta">BELUM ADA KECOCOKAN</div><div class="result-title">Lagu belum dikenali</div><p class="disclaimer">${escapeHtml(data.message || 'Coba cuplikan audio yang lebih jelas dan tidak terlalu pendek.')}</p>`;
    }
  } catch (e) {
    setIdle(); result.classList.remove('hidden');
    result.innerHTML = `<div class="result-meta">ADA KENDALA</div><div class="result-title">Belum bisa mencari lagu</div><p class="disclaimer">${escapeHtml(e.message)}<br>Pastikan server aktif dan token AudD sudah diatur.</p>`;
  }
}
document.getElementById('url-form').addEventListener('submit', e => {
  e.preventDefault(); const url = document.getElementById('video-url').value.trim();
  if (!url) return;
  handleRecognition(url, null);
});
document.getElementById('file-form').addEventListener('submit', e => {
  e.preventDefault(); const f = fileInput.files[0];
  if (!f) { alert('Pilih file audio atau video dulu.'); return; }
  handleRecognition(null, f);
});
document.getElementById('ai-form').addEventListener('submit', async e => {
  e.preventDefault(); const query = document.getElementById('ai-query').value.trim(); const lyrics = document.getElementById('ai-lyrics').value.trim();
  if (!query && !lyrics) { alert('Masukkan petunjuk lagu atau potongan lirik dulu.'); return; }
  setBusy('AI sedang menyusun pencarian…', 'Mengubah petunjukmu menjadi kandidat pencarian lagu.');
  try {
    const response = await fetch('/api/ai-search', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query, lyrics})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'AI search belum tersedia.');
    setIdle(); aiResults.classList.remove('hidden');
    aiResults.innerHTML = `<h3>✧ Saran pencarian AI</h3>${(data.suggestions || []).map(s => `<div class="suggestion"><strong>${escapeHtml(s.title || 'Petunjuk pencarian')}</strong><p>${escapeHtml(s.reason || '')}</p>${s.search_query ? `<button class="secondary-btn search-web" data-query="${escapeHtml(s.search_query)}">Cari di web ↗</button>` : ''}</div>`).join('')}<p class="disclaimer">${escapeHtml(data.note || 'Saran AI bukan konfirmasi identitas lagu. Untuk hasil pasti, gunakan link video atau upload audio.')}</p>`;
    aiResults.querySelectorAll('.search-web').forEach(btn => btn.addEventListener('click', () => window.open('https://www.google.com/search?q=' + encodeURIComponent(btn.dataset.query), '_blank', 'noopener')));
  } catch(err) {
    setIdle(); aiResults.classList.remove('hidden');
    aiResults.innerHTML = `<h3>AI search belum tersedia</h3><p class="disclaimer">${escapeHtml(err.message)} Pastikan OPENAI_API_KEY sudah diatur di server. Pengenalan audio lewat AudD tetap merupakan fitur terpisah.</p>`;
  }
});
