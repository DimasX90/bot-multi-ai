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

async function incrRedis(key) {
  const res = await fetch(`${UPSTASH_REST_URL}/incr/${key}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_REST_TOKEN}` },
  });
  const data = await res.json();
  return data.result;
}

async function cariDiInternet(query) {
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query: query,
        max_results: 3,
        search_depth: "basic"
      })
    });
    const data = await response.json();
    if (!data.results || data.results.length === 0) return "Tidak ditemukan informasi relevan di internet.";
    return data.results.map(res => `Sumber: ${res.title} (${res.url})\nInformasi: ${res.content}`).join("\n\n");
  } catch (err) {
    return "Gagal melakukan pencarian internet karena gangguan teknis.";
  }
}

async function uploadCloudinaryKustom(imageBuffer, jenisPerbaikan) {
  try {
    const formData = new FormData();
    formData.append('file', new Blob([imageBuffer], { type: 'image/jpeg' }));
    formData.append('api_key', CLOUDINARY_API_KEY);
    formData.append('timestamp', Math.floor(Date.now() / 1000).toString());
    formData.append('upload_preset', 'ml_default');

    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
      method: 'POST', body: formData
    });
    const data = await res.json();
    if (!res.ok) return null;

    const urlAsli = data.secure_url;
    let efek = "q_auto,f_auto"; 

    if (jenisPerbaikan.includes("semua kontras")) {
      efek += ",e_improve,e_sharpen:40,e_auto_contrast"; 
    } else if (jenisPerbaikan.includes("semua")) {
      efek += ",e_improve,e_sharpen:40,e_auto_contrast,e_auto_color"; 
    }

    if (jenisPerbaikan.includes("bersih kontras")) {
      efek += ",e_auto_contrast"; 
    } else if (jenisPerbaikan.includes("bersih")) {
      efek += ",e_auto_contrast,e_auto_color"; 
    }

    if (jenisPerbaikan.includes("terang")) efek += ",e_improve";
    if (jenisPerbaikan.includes("tajam")) efek += ",e_sharpen:60";
    if (jenisPerbaikan.includes("warna")) efek += ",e_auto_color";

    return urlAsli.replace("/upload/", `/upload/${efek}/`);
  } catch (err) {
    console.error("Cloudinary Error:", err);
    return null;
  }
}

async function kirimPesanTelegram(chatId, teks) {
  let teksBersih = teks.replace(/<think>[\s\S]*?<\/think>\n*/g, '').trim();
  if (!teksBersih) teksBersih = teks;

  let resMarkdown = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: teksBersih, parse_mode: 'Markdown' }),
  });
  let dataMarkdown = await resMarkdown.json();

  if (!dataMarkdown.ok) {
    let htmlText = teksBersih.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    htmlText = htmlText.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    htmlText = htmlText.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    let resHtml = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: htmlText, parse_mode: 'HTML' }),
    });
    let dataHtml = await resHtml.json();

    if (!dataHtml.ok) {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: teksBersih }),
      });
    }
  }
}

async function kirimFotoBinaryTelegram(chatId, imageBuffer, caption) {
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('photo', new Blob([imageBuffer], { type: 'image/jpeg' }), 'edited.jpg');
  formData.append('caption', caption);
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, { method: 'POST', body: formData });
}

async function kirimFotoTelegramURL(chatId, urlFoto, caption) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, photo: urlFoto, caption: caption, parse_mode: 'HTML' }),
  });
}

async function kirimDokumenHtmlTelegram(chatId, kontenHtml, namaFile, caption) {
  const formData = new FormData();
  formData.append('chat_id', chatId);
  // Mengubah teks HTML dari AI menjadi file fisik
  formData.append('document', new Blob([kontenHtml], { type: 'text/html' }), namaFile);
  if (caption) formData.append('caption', caption);

  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`, {
    method: 'POST',
    body: formData
  });
}

export default async function handler(request) {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  try {
    const data = await request.json();
    
    const updateId = data.update_id;
    if (updateId) {
      const hitCount = await incrRedis(`spam_${updateId}`);
      if (hitCount > 3) return new Response(JSON.stringify({ status: 'terblokir' }), { status: 200 });
    }

    const messageData = data.message || {};
    const chatId = messageData.chat?.id;
    const pesanUser = messageData.text || messageData.caption || "";
    const pesanLowercase = pesanUser.toLowerCase().trim();
    
    const fotoMasuk = messageData.photo;
    const dokumenMasuk = messageData.document;
    
    let fileIdToDownload = null;
    let isImage = false;

    if (fotoMasuk) {
      const indexFoto = fotoMasuk.length -1; 
      fileIdToDownload = fotoMasuk[indexFoto].file_id;
      isImage = true;
    } 
    else if (dokumenMasuk && dokumenMasuk.mime_type && dokumenMasuk.mime_type.startsWith('image/')) {
      fileIdToDownload = dokumenMasuk.file_id;
      isImage = true;
    }

    if (!chatId || (pesanUser === "" && !isImage)) {
      return new Response(JSON.stringify({ status: 'ignored' }), { status: 200 });
    }

    if (pesanLowercase === "/start") {
      await setRedis(`sesi_${chatId}`, ""); 
      const teksSambut = `✨ *Selamat Datang di Multiple AI Response Bot!* ✨\n` +
                         `Silakan pilih atau panggil AI yang ingin kamu gunakan dengan cara mengetik kodenya:\n\n` +
                         `🌐 *@search [kueri]* -> Mode Perplexity (Browsing internet realtime)\n` +
                         `🧠 *@gemini [pesan/foto]* -> Analisis teks & gambar tingkat lanjut\n` +
                         `⚡ *@groq [pesan]* -> Jawaban super cepat via Llama 3.3\n` +
                         `🔮 *@super [pesan]* -> Mode penalaran mendalam (DiffusionGemma)\n` +
                         `📸 *@nano [foto]* -> NVIDIA Vision khusus pembaca gambar\n` +
                         `🎨 *@gambar [prompt]* -> Cari foto berkualitas tinggi via Pexels\n` +
                         `✨ *@edit [foto]* -> Perbagus foto dengan AI Racikan Kustom\n` +
                         `📝 *@tugas [soal/foto]* -> Asisten cerdas tugas sekolah & bedah matematika (Cetak Dokumen)\n\n` +
                         `  _(Efek: terang, tajam, warna, bersih, bersih kontras, semua, semua kontras)_\n\n` +
                         `*Contoh:* \`@search berita bola hari ini\` atau tinggal kirim foto dengan caption \`@edit semua\``;
                         
      await kirimPesanTelegram(chatId, teksSambut);
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    }

    if (pesanLowercase.includes("@search") || pesanLowercase.startsWith("/search")) {
      await setRedis(`sesi_${chatId}`, "search");
    } else if (pesanLowercase.includes("@gemini") || (isImage && pesanUser === "" && (await getRedis(`sesi_${chatId}`)) !== "edit")) {
      await setRedis(`sesi_${chatId}`, "gemini");
    } else if (pesanLowercase.includes("@groq") || pesanLowercase.includes("@grok")) {
      await setRedis(`sesi_${chatId}`, "groq");
    } else if (pesanLowercase.includes("@super")) {
      await setRedis(`sesi_${chatId}`, "super");
    } else if (pesanLowercase.includes("@nano")) { 
      await setRedis(`sesi_${chatId}`, "nano");
    } else if (pesanLowercase.includes("@gambar")) {
      await setRedis(`sesi_${chatId}`, "gambar");
    } else if (pesanLowercase.includes("@edit")) {
      await setRedis(`sesi_${chatId}`, "edit");
    } else if (pesanLowercase.includes("@tugas")) {     
      await setRedis(`sesi_${chatId}`, "tugas");
    }

    let aiPilihan = await getRedis(`sesi_${chatId}`);

    if (!aiPilihan) {
      await kirimPesanTelegram(chatId, "💡 Silakan panggil AI terlebih dahulu.\nContoh: \`@search berita terkini\`, \`@gemini halo\`, \`@groq kode\`, atau \`@edit\` (kirim foto)");
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    }

    let imageBuffer = null;
    let base64Image = null;
    
    if (isImage && fileIdToDownload) {
      const resFile = await (await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileIdToDownload}`)).json();
      if (resFile.ok) {
        const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${resFile.result.file_path}`;
        imageBuffer = await (await fetch(fileUrl)).arrayBuffer();
        // PERUBAHANNYA ADA DI BARIS BAWAH INI (Tambahkan: || aiPilihan === "tugas")
        if (aiPilihan === "gemini" || aiPilihan === "nano" || aiPilihan === "tugas") {
          base64Image = Buffer.from(imageBuffer).toString('base64');
        }
      }
    }
    
    if (aiPilihan === "edit") {
      if (!isImage || !imageBuffer) {
        await kirimPesanTelegram(chatId, "📸 *Sesi AI Perbaikan Foto Aktif!*\nKirimkan fotomu lalu tambahkan salah satu kata kunci ini di caption:\n\n👉 *terang*, *tajam*, *warna*, *bersih*, *bersih kontras*, *semua*, atau *semua kontras*\n\n_(Kosongkan caption selain tag @edit untuk auto-poles alami)_");
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      await kirimPesanTelegram(chatId, "🪄 AI sedang mengolah fotomu dengan racikan kustom...");
      
      const linkHasil = await uploadCloudinaryKustom(imageBuffer, pesanLowercase);
      
      if (linkHasil) {
        await kirimFotoTelegramURL(chatId, linkHasil, "✨ Hasil perbaikan foto kamu sudah siap!");
      } else {
        await kirimPesanTelegram(chatId, "❌ Gagal memproses gambar di Cloudinary.");
      }
    }
      
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

    else if (aiPilihan === "search") {
      const kueriPencarian = pesanUser.replace(/@search|\/search/gi, '').trim();
      if (!kueriPencarian) {
        await kirimPesanTelegram(chatId, "🔍 Harap masukkan topik pencarian. Contoh: \`@search berita sepak bola hari ini\`");
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
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
      
    else if (aiPilihan === "groq") {
      const pertanyaanClean = pesanUser.replace(/@groq|@grok/gi, '').trim();
      if (isImage) return new Response(JSON.stringify({ status: 'redirected' }), { status: 200 });
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

    else if (aiPilihan === "super") {
      const pertanyaanClean = pesanUser.replace(/@super/gi, '').trim() || "Halo";
      await kirimPesanTelegram(chatId, "⏳ DiffusionGemma sedang merangkai jawaban...");
      let riwayatSuper = await getRedis(`memori_super_${chatId}`) || [];
      riwayatSuper.push({ role: "user", content: pertanyaanClean });

      try {
        const resSuper = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
          method: 'POST', 
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${NVIDIA_API_KEY}` },
          body: JSON.stringify({ 
            model: "google/diffusiongemma-26b-a4b-it", 
            messages: riwayatSuper.slice(-16),
            max_tokens: 2048,
            temperature: 1.00,
            top_p: 0.95,
            stream: false,
            chat_template_kwargs: { "enable_thinking": true } 
          })
        });
        
        const dataSuper = await resSuper.json();
        if (resSuper.ok) {
          let jawabanSuper = dataSuper.choices?.[0]?.message?.content || "⚠️ Kosong.";
          riwayatSuper.push({ role: "assistant", content: jawabanSuper });
          await setRedis(`memori_super_${chatId}`, riwayatSuper.slice(-16));
          await kirimPesanTelegram(chatId, `[DiffusionGemma]:\n\n${jawabanSuper}`);
        } else {
          await kirimPesanTelegram(chatId, `⚠️ Error API:\n${JSON.stringify(dataSuper).substring(0, 100)}`);
        }
      } catch (err) {
        await kirimPesanTelegram(chatId, "⚠️ Waktu habis. Vercel memotong proses karena server NVIDIA terlalu lambat.");
      }
    }

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
      
    else if (aiPilihan === "gambar") {
      const promptGambar = pesanUser.replace(/@gambar/gi, '').trim();
      if (!promptGambar) return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      await kirimPesanTelegram(chatId, "⏳ Mencari foto...");
      const resPexels = await (await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(promptGambar)}&per_page=1`, { headers: { "Authorization": "Ak8w1HkWL0my455bsljopg04tq2JHkUkQH9SDmT5DDDhtp92GHEZuHTq" } })).json();
      if (resPexels.photos?.length > 0) await kirimFotoTelegramURL(chatId, resPexels.photos[0].src.large, `📸 Hasil: <b>${promptGambar}</b>`);
    }

    // [G] MODE TUGAS SEKOLAH (MENDUKUNG TEKS & FOTO VIA GROQ LLAMA VISION)
    else if (aiPilihan === "tugas") {
      const pertanyaanClean = pesanUser.replace(/@tugas/gi, '').trim();
      
      await kirimPesanTelegram(chatId, "⏳ Groq Llama 4 sedang menganalisis tugasmu...");
      
      // Minta AI menulis dengan tag HTML murni agar rapi di browser
      const instruksiPakar = "Kamu adalah guru matematika yang jenius. TUGASMU ADA 2 TAHAP PADA GAMBAR INI: Tahap 1 (Bagian A / Pilihan Ganda) dan Tahap 2 (Bagian B / Essay di bagian bawah). KAMU GAGAL TOTAL JIKA BERHENTI DI NOMOR 10!\n\nSTRUKTUR WAJIB:\n1. Kerjakan semua soal Tahap 1.\n2. Setelah nomor terakhir Tahap 1 selesai, kamu WAJIB mencetak judul <h2 style='color:red;'>--- BAGIAN B (ESSAY) ---</h2>\n3. Kerjakan semua soal Tahap 2.\n4. Di paling akhir, tutup dengan <p><b>[SEMUA TUGAS SELESAI]</b></p>\n\nFormat per soal (Gunakan HTML Murni, tanpa $, tanpa markdown):\n<h3>Soal [Nomor]</h3>\n<ul>\n<li><b>Diketahui:</b> [Singkat]</li>\n<li><b>Ditanya:</b> [Singkat]</li>\n</ul>\n<p><b>Konsep:</b> [1 kalimat]</p>\n<p><b>Langkah:</b><br>\n[Hitungan pakai <br>]</p>\n<p><b>Jawaban Akhir:</b> [Kesimpulan]</p>\n<hr>\n\nIngat, pangkat gunakan <sup> (x<sup>2</sup>). LAKUKAN SAMPAI BAGIAN B ATAU MISIMU GAGAL!\n\n";     
      const modelTugas = "meta-llama/llama-4-scout-17b-16e-instruct"; 
      let pesanKirim = [];

      if (base64Image) {
        const teksPrompt = pertanyaanClean ? (instruksiPakar + "Pertanyaan Tugas: " + pertanyaanClean) : (instruksiPakar + "Selesaikan semua soal pada gambar ini menggunakan struktur HTML rapi sesuai format yang diminta.");
        
        pesanKirim.push({
          role: "user",
          content: [
            { type: "text", text: teksPrompt },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
          ]
        });
      } else {
        if (!pertanyaanClean) {
          await kirimPesanTelegram(chatId, "📝 *Sesi Dokumen Tugas Aktif!*\nSilakan ketik tugas/soal atau langsung kirim FOTO soalmu ke sini.");
          return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
        }
        pesanKirim.push({ role: "user", content: instruksiPakar + pertanyaanClean });
      }
      
      const resGroqTugas = await fetch("https://api.groq.com/openai/v1/chat/completions", { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` }, 
        body: JSON.stringify({ 
          model: modelTugas, 
          messages: pesanKirim,
          max_completion_tokens: 4096, 
          temperature: 0.4
        })
      });
      
      const groqData = await resGroqTugas.json();
      const hasilTugas = groqData.choices?.[0]?.message?.content;
      
      if (hasilTugas) {
        await kirimPesanTelegram(chatId, "✅ Analisis selesai! Sedang mencetak dokumen...");
        const namaFileHasil = base64Image ? "Analisis_Soal_Foto.html" : "Tugas_Sekolah_Siap_Cetak.html";
        
        // 🔥 TAMBAHAN BARU: Membungkus teks AI dengan desain CSS agar tulisannya besar, rapi, dan responsif di HP!
        const desainHtmlUtuh = `
        <!DOCTYPE html>
        <html lang="id">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Kunci Jawaban & Pembahasan</title>
            <style>
                /* Pengaturan gaya teks dan ukuran halaman */
                body { 
                    font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
                    line-height: 1.6; 
                    padding: 20px; 
                    color: #222; 
                    max-width: 800px; 
                    margin: 0 auto; 
                    font-size: 16px; /* Ukuran font standar yang enak dibaca */
                }
                h3 { 
                    color: #2c3e50; 
                    border-bottom: 2px solid #3498db; 
                    padding-bottom: 8px; 
                    margin-top: 30px; 
                }
                ul { padding-left: 20px; }
                li { margin-bottom: 5px; }
                p { margin-bottom: 12px; }
                hr { border: 0; border-top: 1px solid #ddd; margin: 30px 0; }
                /* Efek stabilo hijau untuk jawaban akhir agar menonjol */
                b { color: #000; }
            </style>
        </head>
        <body>
            <h2 style="text-align: center; color: #2c3e50; margin-bottom: 30px;">📄 Kunci Jawaban & Pembahasan</h2>
            ${hasilTugas}
        </body>
        </html>
        `;

        await kirimDokumenHtmlTelegram(chatId, desainHtmlUtuh, namaFileHasil, `📄 Hasil analisis dari Groq Llama 4`);
      } else {
        const pesanError = groqData.error?.message || JSON.stringify(groqData);
        await kirimPesanTelegram(chatId, `❌ Gagal memproses!\n\n*Pesan Error Groq:*\n\`${pesanError}\``);
      }
