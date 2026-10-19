import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import OpenAI from 'openai';

const execFileAsync = promisify(execFile);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const MAX_MB = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 50));
const TEMP_ROOT = path.join(os.tmpdir(), 'song-defender-ai');
await fs.mkdir(TEMP_ROOT, { recursive: true });

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: { directives: { defaultSrc:["'self'"], scriptSrc:["'self'"], styleSrc:["'self'","'unsafe-inline'","https://fonts.googleapis.com"], fontSrc:["'self'","https://fonts.gstatic.com"], imgSrc:["'self'","data:","https:"], mediaSrc:["'self'","https:"], connectSrc:["'self'"] } } }));
app.use(express.json({ limit: '100kb' }));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 15, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.join(process.cwd(), 'public')));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TEMP_ROOT),
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase().slice(0, 8)}`)
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.mp3','.mp4','.wav','.m4a','.aac','.ogg','.webm','.flac','.mov'];
    cb(allowed.includes(ext) ? null : new Error('Format file tidak didukung. Gunakan MP3, MP4, WAV, M4A, AAC, OGG, FLAC, atau MOV.'), allowed.includes(ext));
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'Song Defender AI', auddConfigured: Boolean(process.env.AUDD_API_TOKEN), aiConfigured: Boolean(process.env.OPENAI_API_KEY) }));

function validatePublicVideoUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('URL tidak valid. Tempel link TikTok atau YouTube yang lengkap.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Hanya URL HTTP/HTTPS yang diperbolehkan.');
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const allowed = ['youtube.com','m.youtube.com','youtu.be','music.youtube.com','tiktok.com','m.tiktok.com','vm.tiktok.com','vt.tiktok.com'];
  if (!allowed.some(domain => host === domain || host.endsWith('.' + domain))) throw new Error('Untuk saat ini gunakan link TikTok atau YouTube.');
  if (url.username || url.password) throw new Error('URL dengan kredensial tidak diperbolehkan.');
  return url.href;
}

async function downloadVideoAudio(url, workdir) {
  const out = path.join(workdir, 'source.%(ext)s');
  const attempts = [
    ['--no-playlist','--no-warnings','--socket-timeout','20','--retries','1','-f','bestaudio/best','-o',out,url],
    ['--no-playlist','--no-warnings','--socket-timeout','20','--retries','1','--extractor-args','youtube:player_client=android,web','-f','bestaudio/best','-o',out,url]
  ];
  let lastError;
  for (const args of attempts) {
    try {
      await execFileAsync('yt-dlp', args, { timeout: 150_000, maxBuffer: 4 * 1024 * 1024 });
      const names = await fs.readdir(workdir);
      const found = names.find(n => n.startsWith('source.') && !n.endsWith('.part'));
      if (found) return path.join(workdir, found);
    } catch (err) { lastError = err; }
  }
  throw new Error(`Tidak berhasil mengambil audio dari URL. Video mungkin privat, dibatasi, atau platform mengubah sistemnya. ${lastError?.stderr?.toString().slice(-500) || ''}`.trim());
}

async function convertToMp3(input, workdir) {
  const output = path.join(workdir, 'recognition.mp3');
  await execFileAsync('ffmpeg', ['-hide_banner','-loglevel','error','-y','-i',input,'-vn','-ac','1','-ar','44100','-b:a','128k','-t','90',output], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
  const stat = await fs.stat(output);
  if (!stat.size) throw new Error('Audio kosong atau tidak bisa diproses.');
  return output;
}

async function recognizeWithAudD(filePath) {
  if (!process.env.AUDD_API_TOKEN) throw new Error('AUDD_API_TOKEN belum diatur di environment server.');
  const form = new FormData();
  form.append('api_token', process.env.AUDD_API_TOKEN);
  form.append('return', 'spotify,apple_music');
  form.append('file', new Blob([await fs.readFile(filePath)], { type: 'audio/mpeg' }), 'sample.mp3');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch('https://api.audd.io/', { method: 'POST', body: form, signal: controller.signal });
    const data = await response.json();
    if (!response.ok || data.status === 'error') throw new Error(data.error?.error_message || 'Layanan pengenal audio mengembalikan kesalahan.');
    const r = data.result;
    if (!r) return { track: null, message: 'Belum ada kecocokan. Coba cuplikan yang lebih jelas atau bagian lagu yang berbeda.' };
    return { track: {
      title: r.title || null,
      artist: r.artist || null,
      album: r.album || null,
      album_art: r.spotify?.album?.images?.[0]?.url || r.apple_music?.artwork?.url?.replace('{w}', '600').replace('{h}', '600') || null,
      preview_url: r.spotify?.preview_url || r.apple_music?.previews?.[0]?.url || null,
      song_link: r.song_link || r.spotify?.external_urls?.spotify || r.apple_music?.url || null,
      spotify_url: r.spotify?.external_urls?.spotify || null,
      apple_music_url: r.apple_music?.url || null
    } };
  } finally { clearTimeout(timeout); }
}

app.post('/api/recognize-url', async (req, res) => {
  let workdir;
  try {
    const url = validatePublicVideoUrl(String(req.body?.url || ''));
    workdir = path.join(TEMP_ROOT, crypto.randomUUID());
    await fs.mkdir(workdir, { recursive: true });
    const source = await downloadVideoAudio(url, workdir);
    const audio = await convertToMp3(source, workdir);
    const found = await recognizeWithAudD(audio);
    res.json({ ...found, source: 'audio-fingerprint' });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Pencarian dari URL gagal.' });
  } finally { if (workdir) await fs.rm(workdir, { recursive: true, force: true }).catch(() => {}); }
});

app.post('/api/recognize-file', upload.single('file'), async (req, res) => {
  const filePath = req.file?.path;
  let workdir;
  try {
    if (!filePath) return res.status(400).json({ error: 'Pilih file terlebih dahulu.' });
    workdir = path.join(TEMP_ROOT, crypto.randomUUID());
    await fs.mkdir(workdir, { recursive: true });
    const audio = await convertToMp3(filePath, workdir);
    const found = await recognizeWithAudD(audio);
    res.json({ ...found, source: 'audio-fingerprint' });
  } catch (err) { res.status(400).json({ error: err.message || 'Pengenalan file gagal.' }); }
  finally {
    if (filePath) await fs.rm(filePath, { force: true }).catch(() => {});
    if (workdir) await fs.rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
});

app.post('/api/ai-search', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'OPENAI_API_KEY belum diatur. AI search opsional; pengenalan audio memakai AudD.' });
    const query = String(req.body?.query || '').slice(0, 1200);
    const lyrics = String(req.body?.lyrics || '').slice(0, 500);
    if (!query.trim() && !lyrics.trim()) return res.status(400).json({ error: 'Masukkan petunjuk lagu atau potongan lirik.' });
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Kamu asisten penemuan musik. Jangan mengarang kepastian identitas lagu. Berdasarkan petunjuk pengguna, buat hingga 4 strategi pencarian/kandidat. Jika bukti tidak cukup, gunakan query deskriptif, bukan nama lagu rekaan. Output JSON: {"suggestions":[{"title":"label kandidat atau query","reason":"alasan dan tingkat ketidakpastian","search_query":"query web yang relevan"}],"note":"penjelasan singkat bahwa ini saran, bukan pengenalan audio pasti"}' },
        { role: 'user', content: `Petunjuk: ${query || '(tidak ada)'}\nPotongan lirik: ${lyrics || '(tidak ada)'}\nBuat saran pencarian relevan. Jika ada lirik, gunakan frasa pendek sebagai petunjuk dan jangan menyalin lirik panjang.` }
      ]
    });
    let parsed;
    try { parsed = JSON.parse(completion.choices[0]?.message?.content || '{}'); } catch { parsed = {}; }
    res.json({ suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0,4) : [], note: parsed.note || 'Saran AI bukan konfirmasi identitas lagu. Gunakan audio untuk pengenalan yang lebih akurat.' });
  } catch (err) { res.status(502).json({ error: 'AI search gagal: ' + (err.message || 'kesalahan layanan') }); }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File terlalu besar. Batas ${MAX_MB} MB.` });
  res.status(400).json({ error: err.message || 'Permintaan tidak dapat diproses.' });
});

app.listen(PORT, '0.0.0.0', () => console.log(`Song Defender AI running on port ${PORT}`));
