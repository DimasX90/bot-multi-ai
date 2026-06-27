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

// 🔥 GEMBOK REDIS
async function setRedis(key, value) {
  await fetch(`${UPSTASH_REST_URL}/set/${key}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_REST_TOKEN}` },
    body: JSON.stringify(value),
  });
}

async function getRedis(key) {
  const res = await fetch(`${UPSTASH_REST_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${UPSTASH_REST_TOKEN}` },
  });
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : null;
}

// 🔥 FUNGSI BANTUAN INTERNET & CLOUDINARY
async function cariDiInternet(query) {
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    if (jenisPerbaikan.includes("bersih kontras")) efek += ",e_auto_contrast"; 
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
    if (!dataHtml.ok) {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: teksBersih }) });
    }
  }
}

async function kirimFotoTelegramURL(chatId, urlFoto, caption) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, photo: urlFoto, caption: caption, parse_mode: 'HTML' }),
  });
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
    
    // 🔥 GEMBOK ANTI-SPAM
    const updateId = data.update_id;
    if (updateId) {
      const cekPesanGanda = await getRedis(`pesan_${updateId}`);
      if (cekPesanGanda) {
        return new Response(JSON.stringify({ status: 'ignored_duplicate' }), { status: 200 });
      }
      await setRedis(`pesan_${updateId}`, "sedang diproses");
    }

    const messageData = data.message || {};
    const chatId = messageData.chat?.id;
    const pesanUser = messageData.text || messageData.caption || "";
    const pesanLowercase = pesanUser.toLowerCase().trim();
    
    const fotoMasuk = messageData.photo;
    const dokumenMasuk = messageData.document;

    if (!chatId || (pesanUser === "" && !fotoMasuk && !dokumenMasuk)) {
      return new Response(JSON.stringify({ status: 'ignored' }), { status: 200 });
    }
    
    // JIKA MENGETIK /START, BALAS LANGSUNG INSTAN
    if (pesanLowercase === "/start") {
      await setRedis(`sesi_${chatId}`, ""); 
      const teksSambut = `✨ *Selamat Datang di Multiple AI Response Bot!* ✨\n` +
                         `Silakan pilih atau panggil AI yang ingin kamu gunakan dengan cara mengetik kodenya:\n\n` +
                         `🌐 *@search [kueri]* -> Mode Perplexity (Browsing internet realtime)\n` +
                         `🧠 *@gemini [pesan/foto]* -> Analisis teks & gambar tingkat lanjut\n` +
                         `⚡ *@groq [pesan]* -> Jawaban super cepat via Llama 3.3\n` +
                         `🔮 *@super [pesan]* -> Mode Llama 4 Scout (Super Kilat via Groq)\n` +
                         `📸 *@nano [foto]* -> NVIDIA Vision khusus pembaca gambar\n` +
                         `🎨 *@gambar [prompt]* -> Cari foto berkualitas tinggi via Pexels\n` +
                         `✨ *@edit [foto]* -> Perbagus foto dengan AI Racikan Kustom\n` +
                         `📝 *@AnalisaTugas [soal/foto]* -> Asisten cerdas tugas sekolah & bedah matematika\n\n` +
                         `*Contoh:* \`@search berita bola hari ini\` atau tinggal kirim foto dengan caption \`@AnalisaTugas kerjakan\``;
                         
      await kirimPesanTelegram(chatId, teksSambut);
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    }

    // 🔥 JALUR CEPAT DETEKSI SALURAN (ANTI-NYANGKUT)
    let aiPilihan = await getRedis(`sesi_${chatId}`);
    if (pesanLowercase.includes("@search") || pesanLowercase.startsWith("/search")) { aiPilihan = "search"; await setRedis(`sesi_${chatId}`, aiPilihan); }
    else if (pesanLowercase.includes("@gemini") || (fotoMasuk && pesanUser === "" && aiPilihan !== "edit")) { aiPilihan = "gemini"; await setRedis(`sesi_${chatId}`, aiPilihan); }
    else if (pesanLowercase.includes("@groq") || pesanLowercase.includes("@grok")) { aiPilihan = "groq"; await setRedis(`sesi_${chatId}`, aiPilihan); }
    else if (pesanLowercase.includes("@super")) { aiPilihan = "super"; await setRedis(`sesi_${chatId}`, aiPilihan); }
    else if (pesanLowercase.includes("@nano")) { aiPilihan = "nano"; await setRedis(`sesi_${chatId}`, aiPilihan); }
    else if (pesanLowercase.includes("@gambar")) { aiPilihan = "gambar"; await setRedis(`sesi_${chatId}`, aiPilihan); }
    else if (pesanLowercase.includes("@edit")) { aiPilihan = "edit"; await setRedis(`sesi_${chatId}`, aiPilihan); }
    else if (pesanLowercase.includes("@analisatugas")) { aiPilihan = "analisatugas"; await setRedis(`sesi_${chatId}`, aiPilihan); }

    if (!aiPilihan) {
      await kirimPesanTelegram(chatId, "💡 Silakan panggil AI terlebih dahulu.\nContoh: \`@search berita terkini\`, \`@gemini halo\`, atau \`@AnalisaTugas\` (kirim foto)");
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    }

    // 🔥 LEMPAR PROSES BERAT KE LATAR BELAKANG AGAR TIDAK TIMEOUT 25 DETIK!
    context.waitUntil(prosesLatarBelakang(chatId, aiPilihan, pesanUser, pesanLowercase, fotoMasuk, dokumenMasuk));

    // KIRIM RESPON AWAL INSTAN KE VERCEL (AKAN LOLOS DARI BATAS 25 DETIK)
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

    if (fotoMasuk) {
      const indexFoto = fotoMasuk.length - 1; 
      fileIdToDownload = fotoMasuk[indexFoto].file_id;
      isImage = true;
    } 
    else if (dokumenMasuk && dokumenMasuk.mime_type && dokumenMasuk.mime_type.startsWith('image/')) {
      fileIdToDownload = dokumenMasuk.file_id;
      isImage = true;
    }

    let imageBuffer = null;
    let base64Image = null;
    
    // Proses download gambar dilakukan di latar belakang tanpa membebani server utama
    if (isImage && fileIdToDownload) {
      const resFile = await (await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileIdToDownload}`)).json();
      if (resFile.ok) {
        const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${resFile.result.file_path}`;
        const resStream = await fetch(fileUrl);
        imageBuffer = await resStream.arrayBuffer();
        if (aiPilihan === "gemini" || aiPilihan === "nano" || aiPilihan === "analisatugas") {
          base64Image = Buffer.from(imageBuffer).toString('base64');
        }
      }
    }
    
    // [1] MODE EDIT GAMBAR VIA CLOUDINARY
    if (aiPilihan === "edit") {
      if (!isImage || !imageBuffer) {
        await kirimPesanTelegram(chatId, "📸 *Sesi AI Perbaikan Foto Aktif!*\nKirimkan fotomu lalu tambahkan salah satu kata kunci ini di caption:\n\n👉 *terang*, *tajam*, *warna*, *bersih*, *bersih kontras*, *semua*, atau *semua kontras*\n\n_(Kosongkan caption selain tag @edit untuk auto-poles alami)_");
        return;
      }
      await kirimPesanTelegram(chatId, "🪄 AI sedang mengolah fotomu dengan racikan kustom...");
      
      const linkHasil = await uploadCloudinaryKustom(imageBuffer, pesanLowercase);
      if (linkHasil) {
        await kirimFotoTelegramURL(chatId, linkHasil, "✨ Hasil perbaikan foto kamu sudah siap!");
      } else {
        await kirimPesanTelegram(chatId, "❌ Gagal memproses gambar di Cloudinary.");
      }
    }
      
    // [2] MODE GEMINI MULTIMODAL
    else if (aiPilihan === "gemini") {
      let pertanyaanClean = pesanUser.replace(/@gemini/gi, '').trim() || "Tolong analisis.";
      pertanyaanClean += " (Berikan jawaban yang singkat, padat, langsung ke inti langkah pengerjaan/rumusnya saja, hindari teks pembuka atau penjelasan teori yang terlalu panjang agar respons cepat).";
      
      await kirimPesanTelegram(chatId, "⏳ Gemini sedang memproses jawaban...");
      let memoriMentah = [];
      
      if (base64Image) {
         await setRedis(`memori_gemini_${chatId}`, []); 
         memoriMentah = []; 
      } else {
         memoriMentah = await getRedis(`memori_gemini_${chatId}`) || [];
      }

      let formatGemini = memoriMentah.map(msg => ({ role: msg.role, parts: [{ text: msg.content }] }));
      let partsSaatIni = [{ text: pertanyaanClean }];
      if (base64Image) partsSaatIni.push({ "inline_data": { "mime_type": "image/jpeg", "data": base64Image } });
      formatGemini.push({ role: "user", parts: partsSaatIni });
      
      const resGemini = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: formatGemini })
      });
      const resData = await resGemini.json();
      
      let jawaban = resData.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!jawaban) {
         jawaban = `⚠️ Respon tidak dikenali.\n\nAlasan dari Google:\n${JSON.stringify(resData).substring(0, 300)}`;
      }

      if (!jawaban.startsWith("⚠️")) {
          memoriMentah.push({ role: "user", content: pertanyaanClean });
          memoriMentah.push({ role: "model", content: jawaban });
          await setRedis(`memori_gemini_${chatId}`, memoriMentah.slice(-6));
      }
      await kirimPesanTelegram(chatId, `[Gemini 2.5 Flash]:\n\n${jawaban}`);
    }

    // [3] MODE PERPLEXITY (BROWSING + GROQ)
    else if (aiPilihan === "search") {
      const kueriPencarian = pesanUser.replace(/@search|\/search/gi, '').trim();
      if (!kueriPencarian) {
        await kirimPesanTelegram(chatId, "🔍 Harap masukkan topik pencarian. Contoh: \`@search berita sepak bola hari ini\`");
        return;
      }

      await kirimPesanTelegram(chatId, "🌐 Sedang berselancar di internet via Tavily...");
      const hasilInternet = await cariDiInternet(kueriPencarian);

      await kirimPesanTelegram(chatId, "🧠 Menyerahkan data riset ke Groq (Llama 3.3)...");
      const instruksiRangkum = "Kamu adalah Asisten Riset Pintar. Tugasmu menjawab pertanyaan pengguna secara objektif berdasarkan data internet yang disediakan. Jawab secara terstruktur menggunakan poin-poin penting, pastikan data penting (seperti angka, nominal, atau nama kebijakan) TIDAK DIHAPUS. Jika pengguna menanyakan sebuah program, kebijakan, atau visi, JABARKAN SELURUH visi atau poin tersebut secara lengkap satu per satu beserta penjelasannya. Jangan gunakan basa-basi pembuka. WAJIB: Di bagian paling bawah jawabanmu, buatkan bagian khusus bertuliskan '📌 Sumber Referensi:' lalu daftarkan semua judul website beserta URL/Link yang valid dari data internet di bawah ini agar pengguna bisa mengkliknya.\n\nPertanyaan: " + kueriPencarian + "\n\nData Internet:\n" + hasilInternet;

      const resGroqSearch = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_API_KEY },
        body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: instruksiRangkum }] })
      });
      
      const dataSearch = await resGroqSearch.json();
      const jawabanFinal = dataSearch.choices?.[0]?.message?.content || "⚠️ Gagal merangkum hasil penelusuran dengan Groq.";
      await kirimPesanTelegram(chatId, "[Perplexity Mode 🌐 via Groq]:\n\n" + jawabanFinal);
    }
      
    // [4] MODE GROQ CONVERSATIONAL
    else if (aiPilihan === "groq") {
      const pertanyaanClean = pesanUser.replace(/@groq|@grok/gi, '').trim();
      await kirimPesanTelegram(chatId, "⏳ Groq sedang memproses jawaban...");
      let riwayatChat = await getRedis(`memori_${chatId}`) || [];
      riwayatChat.push({ role: "user", content: pertanyaanClean });
      const resGroq = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` }, body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: riwayatChat.slice(-16) })});
      const groqData = await resGroq.json();
      const jawabanGroq = groqData.choices?.[0]?.message?.content || "⚠️ Gagal memproses.";
      if (!jawabanGroq.startsWith("⚠️")) {
        riwayatChat.push({ role: "assistant", content: jawabanGroq });
        await setRedis(`memori_${chatId}`, riwayatChat.slice(-16));
      }
      await kirimPesanTelegram(chatId, `[Groq Llama-3.3]:\n\n${jawabanGroq}`);
    }

    // [5] MODE SUPER KILAT VIA LLAMA 4 SCOUT (GROQ)
    else if (aiPilihan === "super") {
      const pertanyaanClean = pesanUser.replace(/@super/gi, '').trim() || "Halo";
      await kirimPesanTelegram(chatId, "⏳ Llama Scout (via Groq) sedang merangkai jawaban kilat...");
      let riwayatSuper = await getRedis(`memori_super_${chatId}`) || [];
      riwayatSuper.push({ role: "user", content: pertanyaanClean });

      try {
        const resSuper = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: 'POST', 
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
          body: JSON.stringify({ 
            model: "meta-llama/llama-4-scout-17b-16e-instruct", 
            messages: riwayatSuper.slice(-16),
            temperature: 1.0,
            max_tokens: 1024,
            top_p: 1.0,
            stream: false
          })
        });
        
        const dataSuper = await resSuper.json();
        if (resSuper.ok) {
          let jawabanSuper = dataSuper.choices?.[0]?.message?.content || "⚠️ Kosong.";
          riwayatSuper.push({ role: "assistant", content: jawabanSuper });
          await setRedis(`memori_super_${chatId}`, riwayatSuper.slice(-16));
          await kirimPesanTelegram(chatId, `[Llama 4 Scout ⚡ Groq]:\n\n${jawabanSuper}`);
        } else {
          await kirimPesanTelegram(chatId, `⚠️ Error API Groq:\n${JSON.stringify(dataSuper).substring(0, 100)}`);
        }
      } catch (err) {
        await kirimPesanTelegram(chatId, "⚠️ Terjadi kesalahan saat menghubungi server Groq.");
      }
    }

        // [6] MODE NVIDIA VISION
    else if (aiPilihan === "nano") {
      const pertanyaanClean = pesanUser.replace(/@nano/gi, '').trim() || "Jelaskan gambar ini.";
      await kirimPesanTelegram(chatId, "⏳ NVIDIA sedang menganalisis pesan...");
      let riwayatNano = [];

      if (isImage && base64Image) {
        let konten = [
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
          { type: "text", text: pertanyaanClean }
        ];

        try {
          const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${NVIDIA_API_KEY}` },
            body: JSON.stringify({ model: "meta/llama-3.2-11b-vision-instruct", messages: [{ role: "user", content: konten }], max_tokens: 700 })
          });
          
          const data = await res.json();
          const jawaban = data.choices?.[0]?.message?.content || "⚠️ Respon kosong.";
          if (!jawaban.startsWith("⚠️")) {
            riwayatNano.push({ role: "user", content: `[Melihat Gambar]: ${pertanyaanClean}` });
            riwayatNano.push({ role: "assistant", content: jawaban });
            await setRedis(`memori_nano_${chatId}`, riwayatNano);
          }
          await kirimPesanTelegram(chatId, `[NVIDIA Vision]:\n\n${jawaban}`);
        } catch (err) {
          await kirimPesanTelegram(chatId, "⚠️ Terjadi kesalahan atau timeout saat membaca gambar.");
        }
      } 
      else {
        riwayatNano = await getRedis(`memori_nano_${chatId}`) || [];
        riwayatNano.push({ role: "user", content: pertanyaanClean });

        try {
          const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${NVIDIA_API_KEY}` },
            body: JSON.stringify({ model: "meta/llama-3.2-11b-vision-instruct", messages: riwayatNano, max_tokens: 700 })
          });
          
          const data = await res.json();
          const jawaban = data.choices?.[0]?.message?.content || "⚠️ Respon kosong.";
          if (!jawaban.startsWith("⚠️")) {
            riwayatNano.push({ role: "assistant", content: jawaban });
            if (riwayatNano.length > 8) riwayatNano = riwayatNano.slice(-8);
            await setRedis(`memori_nano_${chatId}`, riwayatNano);
          }
          await kirimPesanTelegram(chatId, `[NVIDIA Vision]:\n\n${jawaban}`);
        } catch (err) {
          await kirimPesanTelegram(chatId, "⚠️ Terjadi kesalahan saat memproses obrolan teks.");
        }
      }
    }
      
    // [7] MODE PENCARIAN GAMBAR PEXELS (SUDAH DIPERBAIKI)
    else if (aiPilihan === "gambar") {
      const promptGambar = pesanUser.replace(/@gambar/gi, '').trim();
      if (!promptGambar) return;
      await kirimPesanTelegram(chatId, "⏳ Mencari foto...");
      const resPexels = await (await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(promptGambar)}&per_page=1`, { headers: { "Authorization": "Ak8w1HkWL0my455bsljopg04tq2JHkUkQH9SDmT5DDDhtp92GHEZuHTq" } })).json();
      if (resPexels.photos?.length > 0) await kirimFotoTelegramURL(chatId, resPexels.photos[0].src.large, `📸 Hasil: <b>${promptGambar}</b>`);
    }

        // [6] MODE NVIDIA VISION
    else if (aiPilihan === "nano") {
      const pertanyaanClean = pesanUser.replace(/@nano/gi, '').trim() || "Jelaskan gambar ini.";
      await kirimPesanTelegram(chatId, "⏳ NVIDIA sedang menganalisis pesan...");
      let riwayatNano = [];

      if (isImage && base64Image) {
        let konten = [
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
          { type: "text", text: pertanyaanClean }
        ];

        try {
          const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${NVIDIA_API_KEY}` },
            body: JSON.stringify({ model: "meta/llama-3.2-11b-vision-instruct", messages: [{ role: "user", content: konten }], max_tokens: 700 })
          });
          
          const data = await res.json();
          const jawaban = data.choices?.[0]?.message?.content || "⚠️ Respon kosong.";
          if (!jawaban.startsWith("⚠️")) {
            riwayatNano.push({ role: "user", content: `[Melihat Gambar]: ${pertanyaanClean}` });
            riwayatNano.push({ role: "assistant", content: jawaban });
            await setRedis(`memori_nano_${chatId}`, riwayatNano);
          }
          await kirimPesanTelegram(chatId, `[NVIDIA Vision]:\n\n${jawaban}`);
        } catch (err) {
          await kirimPesanTelegram(chatId, "⚠️ Terjadi kesalahan atau timeout saat membaca gambar.");
        }
      } 
      else {
        riwayatNano = await getRedis(`memori_nano_${chatId}`) || [];
        riwayatNano.push({ role: "user", content: pertanyaanClean });

        try {
          const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${NVIDIA_API_KEY}` },
            body: JSON.stringify({ model: "meta/llama-3.2-11b-vision-instruct", messages: riwayatNano, max_tokens: 700 })
          });
          
          const data = await res.json();
          const jawaban = data.choices?.[0]?.message?.content || "⚠️ Respon kosong.";
          if (!jawaban.startsWith("⚠️")) {
            riwayatNano.push({ role: "assistant", content: jawaban });
            if (riwayatNano.length > 8) riwayatNano = riwayatNano.slice(-8);
            await setRedis(`memori_nano_${chatId}`, riwayatNano);
          }
          await kirimPesanTelegram(chatId, `[NVIDIA Vision]:\n\n${jawaban}`);
        } catch (err) {
          await kirimPesanTelegram(chatId, "⚠️ Terjadi kesalahan saat memproses obrolan teks.");
        }
      }
    }

        // [6] MODE NVIDIA VISION
    else if (aiPilihan === "nano") {
      const pertanyaanClean = pesanUser.replace(/@nano/gi, '').trim() || "Jelaskan gambar ini.";
      await kirimPesanTelegram(chatId, "⏳ NVIDIA sedang menganalisis pesan...");
      let riwayatNano = [];

      if (isImage && base64Image) {
        let konten = [
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
          { type: "text", text: pertanyaanClean }
        ];

        try {
          const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${NVIDIA_API_KEY}` },
            body: JSON.stringify({ model: "meta/llama-3.2-11b-vision-instruct", messages: [{ role: "user", content: konten }], max_tokens: 700 })
          });
          
          const data = await res.json();
          const jawaban = data.choices?.[0]?.message?.content || "⚠️ Respon kosong.";
          if (!jawaban.startsWith("⚠️")) {
            riwayatNano.push({ role: "user", content: `[Melihat Gambar]: ${pertanyaanClean}` });
            riwayatNano.push({ role: "assistant", content: jawaban });
            await setRedis(`memori_nano_${chatId}`, riwayatNano);
          }
          await kirimPesanTelegram(chatId, `[NVIDIA Vision]:\n\n${jawaban}`);
        } catch (err) {
          await kirimPesanTelegram(chatId, "⚠️ Terjadi kesalahan atau timeout saat membaca gambar.");
        }
      } 
      else {
        riwayatNano = await getRedis(`memori_nano_${chatId}`) || [];
        riwayatNano.push({ role: "user", content: pertanyaanClean });

        try {
          const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${NVIDIA_API_KEY}` },
            body: JSON.stringify({ model: "meta/llama-3.2-11b-vision-instruct", messages: riwayatNano, max_tokens: 700 })
          });
          
          const data = await res.json();
          const jawaban = data.choices?.[0]?.message?.content || "⚠️ Respon kosong.";
          if (!jawaban.startsWith("⚠️")) {
            riwayatNano.push({ role: "assistant", content: jawaban });
            if (riwayatNano.length > 8) riwayatNano = riwayatNano.slice(-8);
            await setRedis(`memori_nano_${chatId}`, riwayatNano);
          }
          await kirimPesanTelegram(chatId, `[NVIDIA Vision]:\n\n${jawaban}`);
        } catch (err) {
          await kirimPesanTelegram(chatId, "⚠️ Terjadi kesalahan saat memproses obrolan teks.");
        }
      }
    }
      
    // [7] MODE PENCARIAN GAMBAR PEXELS
    else if (aiPilihan === "gambar") {
      const promptGambar = pesanUser.replace(/@gambar/gi, '').trim();
      if (!promptGambar) return;
      await kirimPesanTelegram(chatId, "⏳ Mencari foto...");
      const resPexels = await (await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(promptGambar)}&per_page=1`, { headers: { "Authorization": "Ak8w1HkWL0my455bsljopg04tq2JHkUkQH9SDmT5DDDhtp92GHEZuHTq" } })).json();
      if (resPexels.photos?.length > 0) await kirimFotoTelegramURL(chatId, resPexels.photos[0].src.large, `📸 Hasil: <b>${promptGambar}</b>`);
    }

                // [8] MODE ANALISA TUGAS SEKOLAH - MIGRASI UTUH KE GEMINI 2.5 FLASH (ANTI-POTONG)
    else if (aiPilihan === "analisatugas") {
      const pertanyaanClean = pesanUser.replace(/@analisatugas/gi, '').trim();
      
      if (!pertanyaanClean && !base64Image) {
        await kirimPesanTelegram(chatId, "📝 *Saluran Analisa Tugas Aktif!*\nSilakan ketik tugas/soal atau langsung kirim FOTO soalmu ke sini.");
        return;
      }
      
      await kirimPesanTelegram(chatId, "⏳ Gemini 2.5 Flash sedang menganalisis soal dan menyusun dokumen pembahasan...");
      
      // 🔒 PROMPT UTUH (Sama sekali tidak diubah sesuai permintaanmu)
      const instruksiPakar = `Kamu adalah Guru Matematika/Sains SMA Senior yang sangat disiplin dan akurat. Tugasmu:
1. Selesaikan soal pada gambar secara ilmiah, logis, dan runut sesuai dengan standar Kurikulum Nasional SMA.
2. WAJIB menuliskan RUMUS BAKU (General Formula) yang bersumber dari buku cetak resmi terlebih dahulu di awal pembahasan sebelum memasukkan angka.
3. WAJIB menggunakan huruf 'x' untuk simbol perkalian pada teks biasa, atau simbol '\\times' jika di dalam rumus LaTeX. DILARANG KERAS menggunakan tanda bintang (*) sebagai simbol perkalian karena akan merusak format teks.
4. Gunakan format pangkat yang rapi (seperti ² atau ³) pada teks biasa, atau format LaTeX standard seperti $3^2$ agar tercetak sempurna di dokumen.
5. Berikan pembahasan yang bersih dan mudah dipahami, langsung ke perhitungan inti, dan tuliskan kesimpulan jawaban akhir secara ringkas tepat satu kali di bagian paling bawah. JANGAN mengulang seluruh teks pembahasan atau membuat soal baru agar dokumen tetap rapi.
Format Rumus: Wajib bungkus rumus pendek/inline dengan $...$ dan rumus panjang/matriks/display dengan $$...$$.`;
      
      let pesanKirim = [];

      if (base64Image) {
        const teksPrompt = pertanyaanClean ? pertanyaanClean : "Selesaikan seluruh soal pada gambar ini secara urut menggunakan rumus resmi.";
        pesanKirim.push({
          role: "user",
          content: [
            { type: "text", text: `${instruksiPakar}\n\nPerintah Tambahan: ${teksPrompt}` },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
          ]
        });
      } else {
        pesanKirim.push({ role: "user", content: `${instruksiPakar}\n\nSoal: ${pertanyaanClean}` });
      }
      
      // 🔥 DIALIHKAN SECARA RESMI KE ENDPOINT COMPATIBLE GEMINI 2.5 FLASH (8192 TOKENS JATAH UTUH)
      const resGeminiTugas = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", { 
        method: 'POST', 
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${process.env.GEMINI_API_KEY}` // Pastikan variabel ini sudah ada di Environment Variables Vercel kamu
        }, 
        body: JSON.stringify({ 
          model: "gemini-2.5-flash", 
          messages: pesanKirim,
          max_tokens: 8192,                  // Mengaktifkan jatah maksimal output murni tanpa terpotong
          temperature: 0.15,                 // Diturunkan ke 0.15 agar hitungan matematika SMA tetap kaku dan presisi
          top_p: 0.95,            
          stream: false           
        })
      });
      
      const geminiData = await resGeminiTugas.json();
      const hasilTugas = geminiData.choices?.[0]?.message?.content;
      
      if (hasilTugas) {
        await kirimPesanTelegram(chatId, "✅ Analisis selesai! Sedang mencetak dokumen...");
        const namaFileHasil = base64Image ? "Analisis_Soal_Lengkap.html" : "Tugas_Sekolah_Siap_Cetak.html";
        
        let markdownBersih = hasilTugas.replace(/<think>[\s\S]*?<\/think>/gi, '');
        
        // 🔥 JARING PENGAMAN otomatis mengubah pangkat ^2, ^3 dan perkalian * jika AI khilaf
        markdownBersih = markdownBersih
            .replace(/(\d+)\*(\d+)/g, '$1 x $2') 
            .replace(/(\d+)\^2/g, '$1²')          
            .replace(/(\d+)\^3/g, '$1³');         

        const amanUntukHtml = markdownBersih
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        // 🔒 DESAIN HTML UTUH (Sama sekali tidak diubah sesuai permintaanmu)
        const desainHtmlUtuh = `
        <!DOCTYPE html>
        <html lang="id">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
            <title>Kunci Jawaban & Pembahasan SMA</title>
            
            <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
            <script src="https://polyfill.io/v3/polyfill.min.js?features=es6"></script>
            <script>
              window.MathJax = {
                tex: { inlineMath: [['$', '$']], displayMath: [['$$', '$$']] },
                startup: {
                  pageReady: () => {
                    let txt = document.getElementById('raw-markdown').value;
                    let mathBlocks = [];
                    
                    let partsDD = txt.split("$$");
                    for (let i = 1; i < partsDD.length; i += 2) {
                      mathBlocks.push("$$" + partsDD[i] + "$$");
                      partsDD[i] = "%%DISPLAYMATH_" + (mathBlocks.length - 1) + "%%";
                    }
                    txt = partsDD.join("");
                    
                    let partsD = txt.split("$");
                    for (let i = 1; i < partsD.length; i += 2) {
                      mathBlocks.push("$" + partsD[i] + "$");
                      partsD[i] = "%%INLINEMATH_" + (mathBlocks.length - 1) + "%%";
                    }
                    txt = partsD.join("");
                    
                    let parsedHtml = marked.parse(txt);
                    
                    for (let i = 0; i < mathBlocks.length; i++) {
                      parsedHtml = parsedHtml.replace("%%DISPLAYMATH_" + i + "%%", mathBlocks[i]);
                      parsedHtml = parsedHtml.replace("%%INLINEMATH_" + i + "%%", mathBlocks[i]);
                    }
                    
                    document.getElementById('content').innerHTML = parsedHtml;
                    return MathJax.typesetPromise([document.getElementById('content')]);
                  }
                }
              };
            </script>
            <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>

            <style>
                body { 
                    font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
                    line-height: 1.6; 
                    padding: 40px 25px; 
                    color: #222; 
                    max-width: 850px; 
                    margin: 0 auto; 
                    font-size: 16px; 
                    background-color: #ffffff; 
                }
                h2 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 12px; margin-bottom: 30px; text-align: center; }
                h3 { color: #34495e; margin-top: 25px; border-left: 4px solid #3498db; padding-left: 10px; }
                ul, ol { padding-left: 22px; }
                li { margin-bottom: 6px; }
                p { margin-bottom: 14px; text-align: justify; }
                hr { border: 0; border-top: 1px solid #eee; margin: 25px 0; }
                b { color: #111; }
                .MathJax { overflow-x: auto; overflow-y: hidden; font-size: 105%; }

                @media (max-width: 600px) {
                    body { padding: 20px 14px; }
                    h2 { font-size: 22px; margin-bottom: 20px; }
                    p, li { font-size: 15px; }
                    .MathJax { font-size: 98%; }
                }
            </style>
        </head>
        <body>
            
            <h2>📄 Kunci Jawaban & Pembahasan Lengkap</h2>
            <textarea id="raw-markdown" style="display: none;">${amanUntukHtml}</textarea>
            <div id="content"></div>
            
        </body>
        </html>
        `;

        await kirimDokumenHtmlTelegram(chatId, desainHtmlUtuh, namaFileHasil, `📄 Hasil pembahasan matematika kurikulum SMA`);
      } else {
        const pesanError = geminiData.error?.message || JSON.stringify(geminiData);
        await kirimPesanTelegram(chatId, `❌ Gagal memproses!\n\n*Pesan Error Gemini:*\n\`${pesanError}\``);
      }
    }
    
