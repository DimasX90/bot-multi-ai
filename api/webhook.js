// api/webhook.js

export const config = {
  runtime: 'edge',
};

// ==================== CONFIGURATION ====================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY; // 👈 API NVIDIA RESMI
const CLIPDROP_API_KEY = process.env.CLIPDROP_API_KEY; 
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

async function kirimPesanTelegram(chatId, teks) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: teks }),
  });
}

async function kirimFotoBinaryTelegram(chatId, imageBuffer, caption) {
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('photo', new Blob([imageBuffer], { type: 'image/jpeg' }), 'edited.jpg');
  formData.append('caption', caption);

  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, {
    method: 'POST',
    body: formData,
  });
}

async function kirimFotoTelegramURL(chatId, urlFoto, caption) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, photo: urlFoto, caption: caption, parse_mode: 'HTML' }),
  });
}

export default async function handler(request) {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  try {
    const data = await request.json();
    
    // --- 1. ANTI-SPAM ---
    const updateId = data.update_id;
    if (updateId) {
      const hitCount = await incrRedis(`spam_${updateId}`);
      if (hitCount > 3) return new Response(JSON.stringify({ status: 'terblokir' }), { status: 200 });
    }

    const messageData = data.message || {};
    const chatId = messageData.chat?.id;
    const pesanUser = messageData.text || messageData.caption || "";
    const pesanLowercase = pesanUser.toLowerCase().trim();
    
    // --- DETEKSI FOTO ---
    const fotoMasuk = messageData.photo;
    const dokumenMasuk = messageData.document;
    
    let fileIdToDownload = null;
    let isImage = false;

    // Ambil ukuran foto yang aman
    if (fotoMasuk) {
      const indexFoto = fotoMasuk.length > 1 ? 1 : 0; 
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

    // --- 2. PINDAH SALURAN AI ---
    if (pesanLowercase.includes("@gemini") || (isImage && pesanUser === "" && !(await getRedis(`sesi_${chatId}`)) === "edit")) {
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
    }

    let aiPilihan = await getRedis(`sesi_${chatId}`);

    if (!aiPilihan) {
      await kirimPesanTelegram(chatId, "💡 Silakan panggil AI terlebih dahulu.\nContoh: `@groq halo`, `@super kode`, `@nano` (kirim gambar), atau `@edit` (kirim foto)");
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    }

    // --- 3. PENGUNDUHAN GAMBAR ---
    let imageBuffer = null;
    let base64Image = null;
    
    if (isImage && fileIdToDownload) {
      const resFile = await (await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileIdToDownload}`)).json();
      if (resFile.ok) {
        const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${resFile.result.file_path}`;
        imageBuffer = await (await fetch(fileUrl)).arrayBuffer();
        
        if (aiPilihan === "gemini" || aiPilihan === "nano") {
          // 👈 PERBAIKAN: Menggunakan Buffer agar gambar tidak korup/rusak
          base64Image = Buffer.from(imageBuffer).toString('base64');
        }
      }
    }

    // --- 4. EKSEKUSI AI ---

    // [A] CLIPDROP
    if (aiPilihan === "edit") {
      if (!isImage || !imageBuffer) {
        await kirimPesanTelegram(chatId, "📸 Sesi edit foto aktif! Kirim foto untuk saya perbagus.");
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }

      await kirimPesanTelegram(chatId, "⏳ AI sedang memproses fotomu...");

      const formData = new FormData();
      formData.append('image_file', new Blob([imageBuffer], { type: 'image/jpeg' }), 'foto.jpg');
      
      // KEDUA BARIS TARGET WIDTH & HEIGHT YANG MEMBUAT ERROR SUDAH DIHAPUS

      const resClipdrop = await fetch('https://clipdrop-api.co/image-upscaling/v1/upscale', {
        method: 'POST',
        headers: { 'x-api-key': CLIPDROP_API_KEY },
        body: formData
      });

      if (resClipdrop.ok) {
        const enhancedImageBuffer = await resClipdrop.arrayBuffer();
        await kirimFotoBinaryTelegram(chatId, enhancedImageBuffer, "✨ Foto berhasil diperbagus menjadi HD!");
      } else {
        const errorData = await resClipdrop.text();
        console.error("Error Clipdrop:", errorData); 
        await kirimPesanTelegram(chatId, `❌ Gagal mengedit. Alasan dari Clipdrop:\n\n${errorData.substring(0, 50)}`);
      }
    }
      
    // [B] GEMINI DENGAN MEMORI
    else if (aiPilihan === "gemini") {
      const pertanyaanClean = pesanUser.replace(/@gemini/gi, '').trim() || "Tolong analisis gambar ini dengan detail.";
      await kirimPesanTelegram(chatId, "⏳ Gemini sedang memproses jawaban...");
      
      let memoriMentah = await getRedis(`memori_gemini_${chatId}`) || [];
      let formatGemini = memoriMentah.map(msg => ({
          role: msg.role,
          parts: [{ text: msg.content }]
      }));

      let partsSaatIni = [{ text: pertanyaanClean }];
      if (base64Image) {
          partsSaatIni.push({ "inline_data": { "mime_type": "image/jpeg", "data": base64Image } });
      }
      formatGemini.push({ role: "user", parts: partsSaatIni });

      const resGemini = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: formatGemini })
      });
      const resData = await resGemini.json();
      const jawaban = resData.candidates?.[0]?.content?.parts?.[0]?.text || "⚠️ Respon tidak dikenali.";
      
      if (!jawaban.startsWith("⚠️")) {
          memoriMentah.push({ role: "user", content: pertanyaanClean });
          memoriMentah.push({ role: "model", content: jawaban });
          if (memoriMentah.length > 6) memoriMentah = memoriMentah.slice(-6); 
          await setRedis(`memori_gemini_${chatId}`, memoriMentah);
      }

      await kirimPesanTelegram(chatId, `[Gemini 2.5 Flash]:\n\n${jawaban}`);
    }

    // [C] GROQ DENGAN MEMORI
    else if (aiPilihan === "groq") {
      const pertanyaanClean = pesanUser.replace(/@groq|@grok/gi, '').trim();
      if (isImage) {
        await kirimPesanTelegram(chatId, "⚠️ Groq tidak bisa melihat gambar. Dipindah otomatis ke Gemini!");
        await setRedis(`sesi_${chatId}`, "gemini");
        return new Response(JSON.stringify({ status: 'redirected' }), { status: 200 });
      } 
      await kirimPesanTelegram(chatId, "⏳ Groq sedang memproses jawaban...");
      
      let riwayatChat = await getRedis(`memori_${chatId}`) || [];
      riwayatChat.push({ role: "user", content: pertanyaanClean });
      if (riwayatChat.length > 16) riwayatChat = riwayatChat.slice(-16);
      
      const resGroq = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` }, body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: riwayatChat })});
      const groqData = await resGroq.json();
      const jawabanGroq = groqData.choices?.[0]?.message?.content || "⚠️ Gagal memproses Groq.";
      
      if (!jawabanGroq.startsWith("⚠️")) {
        riwayatChat.push({ role: "assistant", content: jawabanGroq });
        await setRedis(`memori_${chatId}`, riwayatChat);
      }
      await kirimPesanTelegram(chatId, `[Groq Llama-3.3]:\n\n${jawabanGroq}`);
    }

    // [D] NEMOTRON SUPER (NVIDIA RESMI) DENGAN MEMORI 
    else if (aiPilihan === "super") {
      const pertanyaanClean = pesanUser.replace(/@super/gi, '').trim() || "Halo";
      await kirimPesanTelegram(chatId, "⏳ Nemotron Super sedang merangkai jawaban...");
      
      let riwayatSuper = await getRedis(`memori_super_${chatId}`) || [];
      riwayatSuper.push({ role: "user", content: pertanyaanClean });
      if (riwayatSuper.length > 16) riwayatSuper = riwayatSuper.slice(-16);

      const resSuper = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: 'POST', 
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${NVIDIA_API_KEY}`
        },
        body: JSON.stringify({ 
          model: "nvidia/nemotron-3-super-120b-a12b", 
          messages: riwayatSuper,
          max_tokens: 1024
        })
      });
      
      const dataSuper = await resSuper.json();
      let jawabanSuper = "";

      if (!resSuper.ok) {
        jawabanSuper = `⚠️ Error NVIDIA API: ${JSON.stringify(dataSuper)}`;
        console.error("NVIDIA API Error:", dataSuper);
      } else {
        jawabanSuper = dataSuper.choices?.[0]?.message?.content || "⚠️ Gagal memproses (Data kosong).";
        riwayatSuper.push({ role: "assistant", content: jawabanSuper });
        await setRedis(`memori_super_${chatId}`, riwayatSuper);
      }
      
      await kirimPesanTelegram(chatId, `[Nemotron Super 120B]:\n\n${jawabanSuper}`);
    }

    // [E] AI VISION NANO (NVIDIA RESMI) DENGAN MEMORI
    else if (aiPilihan === "nano") {
      const pertanyaan = pesanUser.replace(/@nano/gi, '').trim() || "Jelaskan gambar ini.";
      
      // 1. Berikan respon instan ke Telegram agar Vercel tidak timeout
      await kirimPesanTelegram(chatId, "⏳ NVIDIA sedang memproses gambar, mohon tunggu sebentar...");

      // 2. Gunakan 'fetch' dengan timeout yang lebih pendek agar tidak menggantung
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // Batasi proses 20 detik

      try {
        let konten = [];
        if (base64Image) {
            konten.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } });
        }
        konten.push({ type: "text", text: pertanyaan });

        const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${NVIDIA_API_KEY}` },
        body: JSON.stringify({ 
          model: "meta/llama-3.2-11b-vision-instruct", // 👈 Model yang jauh lebih ringan & cepat
          messages: [{ role: "user", content: konten }],
          max_tokens: 500, // 👈 Tetap batasi token agar respon instan
          temperature: 0.5
        })
      });
        
        clearTimeout(timeoutId);
        const data = await res.json();
        const jawaban = data.choices?.[0]?.message?.content || "Respon kosong.";
        await kirimPesanTelegram(chatId, `[NVIDIA Vision]:\n\n${jawaban}`);

      } catch (err) {
        await kirimPesanTelegram(chatId, "⚠️ Terjadi timeout. Model terlalu sibuk. Coba lagi nanti atau gunakan @gemini.");
      }
    }
      
    // [F] PEXELS (GAMBAR)
    else if (aiPilihan === "gambar") {
      const promptGambar = pesanUser.replace(/@gambar/gi, '').trim();
      if (!promptGambar) {
        await kirimPesanTelegram(chatId, "💡 Sesi gambar aktif. Silakan ketik kata kunci (contoh: `@gambar pemandangan`).");
      } else {
        await kirimPesanTelegram(chatId, "⏳ Mencari foto terbaik untukmu...");
        const API_KEY_PEXELS = "Ak8w1HkWL0my455bsljopg04tq2JHkUkQH9SDmT5DDDhtp92GHEZuHTq";
        const resPexels = await (await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(promptGambar)}&per_page=1`, { headers: { "Authorization": API_KEY_PEXELS } })).json();
        if (resPexels.photos && resPexels.photos.length > 0) {
          await kirimFotoTelegramURL(chatId, resPexels.photos[0].src.large, `📸 Hasil untuk: <b>${promptGambar}</b>`);
        } else {
          await kirimPesanTelegram(chatId, "❌ Foto tidak ditemukan.");
        }
      }
    }

    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });

  } catch (error) {
    console.error("Global Error:", error);
    return new Response(JSON.stringify({ status: 'error' }), { status: 200 });
  }
}
