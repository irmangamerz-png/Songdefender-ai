# Song Defender AI

Website pengenal lagu dari URL TikTok/YouTube dan file MP3/MP4, plus pencarian berbantuan AI berdasarkan petunjuk teks.

## Fitur
- URL TikTok/YouTube diproses di server melalui `yt-dlp` → FFmpeg → AudD.
- Upload MP3/MP4 diproses terpisah dan tidak menggunakan caption sebagai nama lagu.
- AI query helper opsional via OpenAI API untuk menyusun pencarian dari deskripsi/lirik/petunjuk.
- Hasil recognition menampilkan judul, artis, album, link sumber, dan preview jika AudD menyediakannya.
- UI responsif dark-mode.

## Jalankan lokal
1. Install Node.js 20+, FFmpeg, Python 3, dan yt-dlp.
2. Salin `.env.example` menjadi `.env`.
3. Isi `AUDD_API_TOKEN`. `OPENAI_API_KEY` opsional.
4. Jalankan:
   ```bash
   npm install
   npm start
   ```
5. Buka `http://localhost:3000`.

## Deploy Railway
1. Upload folder ini ke GitHub sebagai repository baru.
2. Di Railway pilih **New Project → Deploy from GitHub Repo** dan pilih repo.
3. Tambahkan variable `AUDD_API_TOKEN`; `OPENAI_API_KEY` opsional.
4. Railway menggunakan Dockerfile yang memasang FFmpeg dan yt-dlp.
5. Generate domain publik di Settings → Networking → Generate Domain.

## Catatan penting
- API key jangan ditaruh di frontend; hanya di environment server.
- Recognition audio memerlukan token AudD dan koneksi internet. AI helper memerlukan OpenAI API key.
- yt-dlp mungkin gagal untuk video tertentu karena batasan platform, login, region, atau perubahan situs.
- Gunakan hanya URL/file yang Anda berhak akses. Temporary files dihapus setelah diproses.
- Jangan gunakan ini untuk mengunduh atau membagikan materi yang melanggar hak cipta.
