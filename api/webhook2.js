export const config = {
  runtime: 'edge',
};

// ==================== CONFIGURATION ====================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY; 
const TAVILY_API_KEY = process.env.TAVILY_API_KEY; 
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;      
const UPSTASH_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
// =======================================================

// 🔥 GEMBOK REDIS DENGAN TRY-CATCH (ANTI-CRASH)
async function setRedis(key, value) {
  try {
    if (!UPSTASH_REST_URL || !UPSTASH_REST_TOKEN) return;
    await fetch(`${UPSTASH_REST_URL}/set/${key}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_REST_TOKEN}` },
      body: JSON.stringify(value),
    });
  } catch (e) {
    console.error("Redis Set Error:", e);
  }
}

async function getRedis(key) {
  try {
    if (!UPSTASH_REST_URL || !UPSTASH_REST_TOKEN) return null;
    const res = await fetch(`${UPSTASH_REST_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${UPSTASH_REST_TOKEN}` },
    });
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch (e) {
    console.error("Redis Get Error:", e);
    return null;
  }
}

// 🔥 FUNGSI BANTUAN INTERNET (DOKUMEN RESMI) & CLOUDINARY
async function cariDiInternet(query) {
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: TAVILY_API_KEY, query: query, max_results: 3, search_depth: "basic" })
    });
    const data = await response.json();
    if (!data.results || data.results.length === 0) return "Tidak ditemukan informasi relevan di internet.";
    return data.results.map(res => `Sumber: ${res.title} (${res.url})\nInformasi: ${res.content}`).join("\n\n");
  } catch (err) { return "Gagal melakukan pencarian internet karena gangguan teknis."; }
}

async function uploadCloudinaryKustom(imageBuffer, jenisPerbaikan) {
  try {
    const formData = new FormData();
    formData.append('file', new Blob([imageBuffer], { type: 'image/jpeg' }));
    formData.append('api_key', CLOUDINARY_API_KEY);
    formData.append('timestamp', Math.floor(Date.now() / 1000).toString());
    formData.append('upload_preset', 'ml_default');
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) return null;
    const urlAsli = data.secure_url;
    let efek = "q_auto,f_auto"; 
    if (jenisPerbaikan.includes("semua kontras")) efek += ",e_improve,e_sharpen:40,e_auto_contrast"; 
    else if (jenisPerbaikan.includes("semua")) efek += ",e_improve,e_sharpen:40,e_auto_contrast,e_auto_color"; 
    else if (jenisPerbaikan.includes("bersih kontras")) efek += ",e_auto_contrast"; 
    else if (jenisPerbaikan.includes("bersih")) efek += ",e_auto_contrast,e_auto_color"; 
    if (jenisPerbaikan.includes("terang")) efek += ",e_improve";
    if (jenisPerbaikan.includes("tajam")) efek += ",e_sharpen:60";
    if (jenisPerbaikan.includes("warna")) efek += ",e_auto_color";
    return urlAsli.replace("/upload/", `/upload/${efek}/`);
  } catch (err) { return null; }
}

// 🔥 FUNGSI TRANSMISI TELEGRAM
async function kirimPesanTelegram(chatId, teks) {
  let teksBersih = teks.replace(/<think>[\s\S]*?<\/think>\n*/g, '').trim();
  if (!teksBersih) teksBersih = teks;
  let resMarkdown = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: teksBersih, parse_mode: 'Markdown' }),
  });
  let dataMarkdown = await resMarkdown.json();
  if (!dataMarkdown.ok) {
    let htmlText = teksBersih.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>').replace(/`([^`]+)`/g, '<code>$1</code>');
    let resHtml = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: htmlText, parse_mode: 'HTML' }),
    });
    let dataHtml = await resHtml.json();
    if (!dataHtml.ok) await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: teksBersih }) });
  }
}

async function kirimFotoTelegramURL(chatId, urlFoto, caption) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, photo: urlFoto, caption: caption, parse_mode: 'HTML' }) });
}

async function kirimDokumenHtmlTelegram(chatId, kontenHtml, namaFile, caption) {
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('document', new Blob([kontenHtml], { type: 'text/html' }), namaFile);
  if (caption) formData.append('caption', caption);
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`, { method: 'POST', body: formData });
      }

// ================= MAIN HANDLER DENGAN BACKGROUND WORKER =================
export default async function handler(request, context) {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  try {
    const data = await request.json();
    const updateId = data.update_id;
    if (updateId) {
      const cekPesanGanda = await getRedis(`pesan_${updateId}`);
      if (cekPesanGanda) return new Response(JSON.stringify({ status: 'ignored_duplicate' }), { status: 200 });
      await setRedis(`pesan_${updateId}`, "sedang diproses");
    }

    const messageData = data.message || {};
    const chatId = messageData.chat?.id;
    const pesanUser = messageData.text || messageData.caption || "";
    const pesanLowercase = pesanUser.toLowerCase().trim();
    const fotoMasuk = messageData.photo;
    const dokumenMasuk = messageData.document;

    if (!chatId || (pesanUser === "" && !fotoMasuk && !dokumenMasuk)) return new Response(JSON.stringify({ status: 'ignored' }), { status: 200 });
    
    if (pesanLowercase === "/start") {
      await setRedis(`sesi_${chatId}`, ""); 
      const teksSambut = "✨ *Selamat Datang di Multiple AI Response Bot!* ✨\n\n" +
                         "Silakan pilih atau panggil AI yang ingin kamu gunakan dengan cara mengetik kodenya:\n\n" +
                         "🌐 *@search [kueri]* -> Mode Perplexity (Browsing internet realtime)\n" +
                         "🧠 *@gemini [pesan/foto]* -> Analisis teks & gambar tingkat lanjut\n" +
                         "⚡ *@groq [pesan]* -> Jawaban super cepat via Llama 3.3\n" +
                         "🔮 *@super [pesan]* -> Mode Llama 4 Scout (Super Kilat via Groq)\n" +
                         "📸 *@nano [foto]* -> NVIDIA Vision khusus pembaca gambar\n" +
                         "🎨 *@gambar [prompt]* -> Cari foto berkualitas tinggi via Pexels\n" +
                         "✨ *@edit [foto]* -> Perbagus foto dengan AI Racikan Kustom\n" +
                         "📝 *@analisatugas [soal/foto/pdf]* -> Asisten cerdas matematika & bedah soal PDF\n" +
                         "📚 *@tugasumum [teks/foto/pdf]* -> Jawab tugas non-matematika & bedah file PDF\n\n" +
                         "Contoh: @search berita bola hari ini atau tinggal kirim foto dengan caption @analisatugas kerjakan";
      await kirimPesanTelegram(chatId, teksSambut);
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    }

    let aiPilihan = await getRedis(`sesi_${chatId}`);
    if (pesanLowercase.includes("@search") || pesanLowercase.startsWith("/search")) { aiPilihan = "search"; await setRedis(`sesi_${chatId}`, aiPilihan); }
    else if (pesanLowercase.includes("@gemini") || (fotoMasuk && pesanUser === "" && aiPilihan !== "edit")) { aiPilihan = "gemini"; await setRedis(`sesi_${chatId}`, aiPilihan); }
    else if (pesanLowercase.includes("@groq") || pesanLowercase.includes("@grok")) { aiPilihan = "groq"; await setRedis(`sesi_${chatId}`, aiPilihan); }
    else if (pesanLowercase.includes("@super")) { aiPilihan = "super"; await setRedis(`sesi_${chatId}`, aiPilihan); }
    else if (pesanLowercase.includes("@nano")) { aiPilihan = "nano"; await setRedis(`sesi_${chatId}`, aiPilihan); }
    else if (pesanLowercase.includes("@gambar")) { aiPilihan = "gambar"; await setRedis(`sesi_${chatId}`, aiPilihan); }
    else if (pesanLowercase.includes("@edit")) { aiPilihan = "edit"; await setRedis(`sesi_${chatId}`, aiPilihan); }
    else if (pesanLowercase.includes("@analisatugas")) { aiPilihan = "analisatugas"; await setRedis(`sesi_${chatId}`, aiPilihan); }
    else if (pesanLowercase.includes("@tugasumum")) { aiPilihan = "tugasumum"; await setRedis(`sesi_${chatId}`, aiPilihan); }

    if (!aiPilihan) {
      await kirimPesanTelegram(chatId, "💡 Silakan panggil AI terlebih dahulu.\nContoh: `@search berita terkini`, `@gemini halo`, atau `@analisatugas` (kirim foto/pdf)");
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    }

    context.waitUntil(prosesLatarBelakang(chatId, aiPilihan, pesanUser, pesanLowercase, fotoMasuk, dokumenMasuk));
    return new Response(JSON.stringify({ status: 'queued_in_background' }), { status: 200 });
  } catch (error) {
    console.error('Main handler error:', error);
    return new Response(JSON.stringify({ status: 'error' }), { status: 500 });
  }
}

// ================= FUNGSI PROSES DI LATAR BELAKANG (BACKGROUND WORKER) =================
async function prosesLatarBelakang(chatId, aiPilihan, pesanUser, pesanLowercase, fotoMasuk, dokumenMasuk) {
  try {
    let fileIdToDownload = null;
    let isImage = false;
    let isPdf = false;
    let pdfBase64 = null;

    if (fotoMasuk) {
      const indexFoto = fotoMasuk.length - 1; 
      fileIdToDownload = fotoMasuk[indexFoto].file_id;
      isImage = true;
    } 
    else if (dokumenMasuk) {
      if (dokumenMasuk.mime_type === 'application/pdf') {
        fileIdToDownload = dokumenMasuk.file_id;
        isPdf = true;
      } else if (dokumenMasuk.mime_type && dokumenMasuk.mime_type.startsWith('image/')) {
        fileIdToDownload = dokumenMasuk.file_id;
        isImage = true;
      }
    }
    
    let imageBuffer = null;
    let base64Image = null;
    
    if ((isImage || isPdf) && fileIdToDownload) {
      const resFile = await (await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileIdToDownload}`)).json();
      if (resFile.ok) {
        const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${resFile.result.file_path}`;
        const resStream = await fetch(fileUrl);
        imageBuffer = await resStream.arrayBuffer();
        if (aiPilihan === "gemini" || aiPilihan === "nano" || aiPilihan === "analisatugas" || aiPilihan === "tugasumum") {
          if (isImage) base64Image = Buffer.from(imageBuffer).toString('base64');
          if (isPdf) pdfBase64 = Buffer.from(imageBuffer).toString('base64');
        }
      }
    }
    
    // [1] MODE EDIT GAMBAR
    if (aiPilihan === "edit") {
      if (!isImage || !imageBuffer) { await kirimPesanTelegram(chatId, "📸 *Sesi AI Perbaikan Foto Aktif!*\nKirimkan fotomu lalu tambahkan salah satu kata kunci ini di caption:\n\n👉 *terang*, *tajam*, *warna*, *bersih*, *bersih kontras*, *semua*, atau *semua kontras*"); return; }
      await kirimPesanTelegram(chatId, "🪄 AI sedang mengolah fotomu dengan racikan kustom...");
      const linkHasil = await uploadCloudinaryKustom(imageBuffer, pesanLowercase);
      if (linkHasil) await kirimFotoTelegramURL(chatId, linkHasil, "✨ Hasil perbaikan foto kamu sudah siap!");
      else await kirimPesanTelegram(chatId, "❌ Gagal memproses gambar di Cloudinary.");
    }
    // [2] MODE GEMINI
    else if (aiPilihan === "gemini") {
      let pertanyaanClean = pesanUser.replace(/@gemini/gi, '').trim() || "Tolong analisis.";
      pertanyaanClean += " (Berikan jawaban yang singkat, padat, langsung ke inti langkah pengerjaan/rumusnya saja).";
      await kirimPesanTelegram(chatId, "⏳ Gemini sedang memproses jawaban...");
      let memoriMentah = [];
      if (base64Image) { await setRedis(`memori_gemini_${chatId}`, []); memoriMentah = []; } else { memoriMentah = await getRedis(`memori_gemini_${chatId}`) || []; }
      let formatGemini = memoriMentah.map(msg => ({ role: msg.role, parts: [{ text: msg.content }] }));
      let partsSaatIni = [{ text: pertanyaanClean }];
      if (base64Image) partsSaatIni.push({ "inline_data": { "mime_type": "image/jpeg", "data": base64Image } });
      formatGemini.push({ role: "user", parts: partsSaatIni });
      const resGemini = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: formatGemini }) });
      const resData = await resGemini.json();
      let jawaban = resData.candidates?.[0]?.content?.parts?.[0]?.text || "⚠️ Respon tidak dikenali.";
      if (!jawaban.startsWith("⚠️")) { memoriMentah.push({ role: "user", content: pertanyaanClean }); memoriMentah.push({ role: "model", content: jawaban }); await setRedis(`memori_gemini_${chatId}`, memoriMentah.slice(-6)); }
      await kirimPesanTelegram(chatId, `[Gemini 2.5 Flash]:\n\n${jawaban}`);
    }
    // [3] MODE PERPLEXITY (SEARCH)
    else if (aiPilihan === "search") {
      const kueriPencarian = pesanUser.replace(/@search|\/search/gi, '').trim();
      if (!kueriPencarian) { 
        await kirimPesanTelegram(chatId, "🔍 Harap masukkan topik pencarian. Contoh: `@search berita terbaru hari ini`"); 
        return; 
      }
      
      await kirimPesanTelegram(chatId, "🌐 Sedang berselancar di internet via Tavily...");
      const hasilInternet = await cariDiInternet(kueriPencarian);
      
      await kirimPesanTelegram(chatId, "⚡ Menyerahkan data riset ke Groq (Qwen 3.8 27B) untuk dirangkum...");
      const instruksiRangkum = "Kamu adalah Asisten Riset Pintar. Jawab pertanyaan pengguna secara terstruktur, objektif, dan ringkas berdasarkan data internet berikut. Di bagian paling bawah, WAJIB tuliskan '📌 Sumber Referensi:' lalu daftarkan semua judul website beserta URL/link yang ada dari data internet tersebut.\n\nPertanyaan: " + kueriPencarian + "\n\nData Internet:\n" + hasilInternet;
      
      try {
        const resGroqSearch = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GROQ_API_KEY}`
          },
          body: JSON.stringify({
            model: "qwen/qwen3.8-27b",
            messages: [{ role: "user", content: instruksiRangkum }],
            temperature: 0.6,
            max_completion_tokens: 2048,
            top_p: 0.95,
            stream: false,
            reasoning_effort: "default",
            stop: null
          })
        });
        
        const dataSearch = await resGroqSearch.json();
        const hasilRangkuman = dataSearch.choices?.[0]?.message?.content;
        
        if (hasilRangkuman) {
          await kirimPesanTelegram(chatId, "[Perplexity Mode 🌐 via Groq Qwen-3.8]:\n\n" + hasilRangkuman);
        } else {
          const pesanErrorGroq = dataSearch.error?.message || "Format respon Groq tidak valid.";
          await kirimPesanTelegram(chatId, "⚠️ Gagal merangkum via Groq.\n\nDetail Error: " + pesanErrorGroq);
        }
      } catch (err) {
        await kirimPesanTelegram(chatId, "⚠️ Terjadi kesalahan koneksi ke Groq saat merangkum hasil penelusuran.");
      }
    }
    // [4] MODE GROQ
    else if (aiPilihan === "groq") {
      const pertanyaanClean = pesanUser.replace(/@groq|@grok/gi, '').trim() || "Halo";
      await kirimPesanTelegram(chatId, "🧠 GPT-OSS 120B sedang menganalisis & berpikir...");
      
      // Key Redis khusus untuk memori Groq
      let riwayatGroq = await getRedis(`memori_groq_${chatId}`) || []; 
      riwayatGroq.push({ role: "user", content: pertanyaanClean });

      try {
        const resGroq = await fetch("https://api.groq.com/openai/v1/chat/completions", { 
          method: 'POST', 
          headers: { 
            'Content-Type': 'application/json', 
            'Authorization': `Bearer ${GROQ_API_KEY}` 
          }, 
          body: JSON.stringify({ 
            model: "openai/gpt-oss-120b", 
            messages: riwayatGroq.slice(-8), // Menggunakan 8 pesan terakhir
            temperature: 1,
            max_completion_tokens: 2048,
            top_p: 1,
            reasoning_effort: "medium",
            stream: false,
            stop: null
          })
        });
        
        const groqData = await resGroq.json(); 
        const jawabanGroq = groqData.choices?.[0]?.message?.content;

        if (jawabanGroq) { 
          riwayatGroq.push({ role: "assistant", content: jawabanGroq }); 
          await setRedis(`memori_groq_${chatId}`, riwayatGroq.slice(-8)); // Simpan 8 pesan terakhir
          await kirimPesanTelegram(chatId, `[Groq 🧠 via GPT-OSS 120B]:\n\n${jawabanGroq}`);
        } else {
          const detailError = groqData.error?.message || "Gagal memproses via GPT-OSS 120B.";
          await kirimPesanTelegram(chatId, `⚠️ Groq Gagal:\n\n${detailError}`);
        }
      } catch (err) {
        await kirimPesanTelegram(chatId, "⚠️ Terjadi kesalahan koneksi ke Groq (GPT-OSS).");
      }
    }
    // [5] MODE SUPER (GROQ LLAMA 4 SCOUT)
    else if (aiPilihan === "super") {
      const pertanyaanClean = pesanUser.replace(/@super|\/super/gi, '').trim() || "Halo";
      await kirimPesanTelegram(chatId, "⚡ Mode Super Kilat (Qwen 3.8 27B) sedang memproses...");
      
      // Key Redis khusus untuk memori Super
      let riwayatSuper = await getRedis(`memori_super_${chatId}`) || []; 
      riwayatSuper.push({ role: "user", content: pertanyaanClean });

      try {
        const resSuper = await fetch("https://api.groq.com/openai/v1/chat/completions", { 
          method: 'POST', 
          headers: { 
            'Content-Type': 'application/json', 
            'Authorization': `Bearer ${GROQ_API_KEY}` 
          }, 
          body: JSON.stringify({ 
            model: "qwen/qwen3.8-27b", 
            messages: riwayatSuper.slice(-8), // Menggunakan 8 pesan terakhir
            temperature: 0.6,
            max_completion_tokens: 2048,
            top_p: 0.95,
            stream: false,
            reasoning_effort: "default",
            stop: null
          })
        });
        
        const superData = await resSuper.json(); 
        const jawabanSuper = superData.choices?.[0]?.message?.content;
        
        if (jawabanSuper) { 
          riwayatSuper.push({ role: "assistant", content: jawabanSuper }); 
          await setRedis(`memori_super_${chatId}`, riwayatSuper.slice(-8)); // Simpan 8 pesan terakhir
          await kirimPesanTelegram(chatId, `[Super Mode ⚡ via Qwen 3.8]:\n\n${jawabanSuper}`);
        } else {
          const detailError = superData.error?.message || "Gagal memproses via Qwen.";
          await kirimPesanTelegram(chatId, `⚠️ Super Mode Gagal:\n\n${detailError}`);
        }
      } catch (err) {
        await kirimPesanTelegram(chatId, "⚠️ Terjadi kesalahan koneksi ke Groq (Qwen).");
      }
    }
    // [6] MODE NVIDIA VISION
    else if (aiPilihan === "nano") {
      const pertanyaanClean = pesanUser.replace(/@nano/gi, '').trim() || "Jelaskan gambar ini.";
      await kirimPesanTelegram(chatId, "⏳ NVIDIA sedang menganalisis pesan...");
      let riwayatNano = [];
      if (isImage && base64Image) {
        let konten = [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }, { type: "text", text: pertanyaanClean }];
        try {
          const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${NVIDIA_API_KEY}` }, body: JSON.stringify({ model: "meta/llama-3.2-11b-vision-instruct", messages: [{ role: "user", content: konten }], max_tokens: 700 })});
          const data = await res.json(); await kirimPesanTelegram(chatId, `[NVIDIA Vision]:\n\n${data.choices?.[0]?.message?.content || "⚠️ Respon kosong."}`);
        } catch (err) { await kirimPesanTelegram(chatId, "⚠️ Terjadi kesalahan."); }
      } else {
        riwayatNano = await getRedis(`memori_nano_${chatId}`) || []; riwayatNano.push({ role: "user", content: pertanyaanClean });
        try {
          const res = await fetch("https://integrate.api.nvidia.com/v1,chat/completions", { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${NVIDIA_API_KEY}` }, body: JSON.stringify({ model: "meta/llama-3.2-11b-vision-instruct", messages: riwayatNano, max_tokens: 700 })});
          const data = await res.json(); await kirimPesanTelegram(chatId, `[NVIDIA Vision]:\n\n${data.choices?.[0]?.message?.content || "⚠️ Respon kosong."}`);
        } catch (err) { await kirimPesanTelegram(chatId, "⚠️ Terjadi kesalahan."); }
      }
    }
    // [7] MODE PEXELS
    else if (aiPilihan === "gambar") {
      const promptGambar = pesanUser.replace(/@gambar/gi, '').trim(); if (!promptGambar) return;
      await kirimPesanTelegram(chatId, "⏳ Mencari foto...");
      const resPexels = await (await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(promptGambar)}&per_page=1`, { headers: { "Authorization": "Ak8w1HkWL0my455bsljopg04tq2JHkUkQH9SDmT5DDDhtp92GHEZuHTq" } })).json();
      if (resPexels.photos?.length > 0) await kirimFotoTelegramURL(chatId, resPexels.photos[0].src.large, `📸 Hasil: <b>${promptGambar}</b>`);
    }
    // [8] MODE ANALISA TUGAS MATEMATIKA / SMA
    else if (aiPilihan === "analisatugas") {
      const pertanyaanClean = pesanUser.replace(/@analisatugas/gi, '').trim();
      if (!pertanyaanClean && !base64Image && !pdfBase64) {
        await kirimPesanTelegram(chatId, "📝 *Saluran Analisa Tugas Aktif!*\nSilakan ketik tugas/soal atau langsung kirim FOTO/PDF soalmu ke sini.");
        return;
      }
      await kirimPesanTelegram(chatId, "⏳ Gemini 2.5 Flash sedang menganalisis soal...");
      const instruksiPakar = `Kamu adalah Guru Matematika/Sains SMA Senior. Tugasmu menyelesaikannya secara ilmiah dan akurat. Gunakan rumus baku terlebih dahulu.`;
      
      let isiKonten = [{ text: `${instruksiPakar}\n\nPerintah Tambahan: ${pertanyaanClean || "Selesaikan soal ini."}` }];
      if (base64Image) isiKonten.push({ inline_data: { mime_type: "image/jpeg", data: base64Image } });
      if (pdfBase64) isiKonten.push({ inline_data: { mime_type: "application/pdf", data: pdfBase64 } });
      
      const resGeminiTugas = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: "user", parts: isiKonten }], generationConfig: { maxOutputTokens: 8192, temperature: 0.15 } })
      });
      const geminiData = await resGeminiTugas.json(); const hasilTugas = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (hasilTugas) {
        await kirimPesanTelegram(chatId, "✅ Analisis selesai! Sedang mencetak dokumen...");
        const namaFileHasil = pdfBase64 ? "Pembahasan_Soal_PDF.html" : (base64Image ? "Analisis_Soal_Lengkap.html" : "Tugas_Sekolah_Siap_Cetak.html");
        let markdownBersih = hasilTugas.replace(/<think>[\s\S]*?<\/think>/gi, '');
        const amanUntukHtml = markdownBersih.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        const desainHtmlUtuh = `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>Kunci Jawaban</title><script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script></head><body><h2>📄 Pembahasan Lengkap</h2><textarea id="raw-markdown" style="display: none;">${amanUntukHtml}</textarea><div id="content"></div><script>document.getElementById('content').innerHTML = marked.parse(document.getElementById('raw-markdown').value);</script></body></html>`;
        await kirimDokumenHtmlTelegram(chatId, desainHtmlUtuh, namaFileHasil, `📄 Hasil pembahasan matematika kurikulum SMA`);
      } else { await kirimPesanTelegram(chatId, `❌ Gagal memproses!`); }
    }
    // [9] MODE TUGAS UMUM
    else if (aiPilihan === "tugasumum") {
      const pertanyaanClean = pesanUser.replace(/@tugasumum/gi, '').trim();
      if (!pertanyaanClean && !base64Image && !pdfBase64) {
        await kirimPesanTelegram(chatId, "📚 *Saluran Tugas Umum Aktif!*\nSilakan ketik pertanyaan, kirim foto soal, atau lampirkan file PDF tugasmu ke sini.");
        return;
      }
      await kirimPesanTelegram(chatId, "⏳ Gemini sedang membaca referensi dokumen...");
      const instruksiUmum = `Kamu adalah Asisten Akademik Multidisiplin. Tugasmu menjawab materi non-matematika secara terstruktur dan rapi.`;

      let isiKonten = [{ text: `${instruksiUmum}\n\nPertanyaan: ${pertanyaanClean || "Analisislah dokumen ini."}` }];
      if (base64Image) isiKonten.push({ inline_data: { mime_type: "image/jpeg", data: base64Image } });
      if (pdfBase64) isiKonten.push({ inline_data: { mime_type: "application/pdf", data: pdfBase64 } });
      
      const resGemini = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: "user", parts: isiKonten }] })
      });
      const resData = await resGemini.json();
      const jawabanTugas = resData.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (jawabanTugas) {
        await kirimPesanTelegram(chatId, "✅ Analisis selesai! Sedang mencetak dokumen...");
        const namaFileHasil = pdfBase64 ? "Pembahasan_Tugas_PDF.html" : "Tugas_Umum_Siap_Cetak.html";
        let markdownBersih = jawabanTugas.replace(/<think>[\s\S]*?<\/think>/gi, '');
        const amanUntukHtml = markdownBersih.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        const desainHtmlUtuh = `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>Pembahasan Tugas</title><script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script></head><body><h2>📖 Pembahasan Tugas Umum</h2><textarea id="raw-markdown" style="display: none;">${amanUntukHtml}</textarea><div id="content"></div><script>document.getElementById('content').innerHTML = marked.parse(document.getElementById('raw-markdown').value);</script></body></html>`;
        await kirimDokumenHtmlTelegram(chatId, desainHtmlUtuh, namaFileHasil, `📖 Hasil pembahasan tugas umum`);
      } else {
        await kirimPesanTelegram(chatId, `❌ Gagal memproses dokumen tugas.`);
      }
    }
  } catch (error) {
    console.error('Error in prosesLatarBelakang:', error);
  }
        }
    
