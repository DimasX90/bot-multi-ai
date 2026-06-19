// api/webhook.js

export const config = {
  runtime: 'edge',
};

// ==================== CONFIGURATION ====================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY; 
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

// SIFAT: Sistem Pengiriman 3 Lapis Bawaan (Stabil & Otomatis Salin Kode)
async function kirimPesanTelegram(chatId, teks) {
  let teksBersih = teks.replace(/<think>[\s\S]*?<\/think>\n*/g, '').trim();
  if (!teksBersih) teksBersih = teks;

  // Lapis 1: Markdown (Tombol Salin otomatis muncul)
  let resMarkdown = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: teksBersih, parse_mode: 'Markdown' }),
  });
  let dataMarkdown = await resMarkdown.json();

  // Lapis 2: HTML jika Markdown gagal karena karakter aneh
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

    // Lapis 3: Teks Biasa (Pasti Berhasil)
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

    let imageBuffer = null;
    let base64Image = null;
    
    if (isImage && fileIdToDownload) {
      const resFile = await (await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileIdToDownload}`)).json();
      if (resFile.ok) {
        const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${resFile.result.file_path}`;
        imageBuffer = await (await fetch(fileUrl)).arrayBuffer();
        if (aiPilihan === "gemini" || aiPilihan === "nano") {
          base64Image = Buffer.from(imageBuffer).toString('base64');
        }
      }
    }

    // [A] CLIPDROP
    if (aiPilihan === "edit") {
      if (!isImage || !imageBuffer) {
        await kirimPesanTelegram(chatId, "📸 Sesi edit foto aktif! Kirim foto untuk saya perbagus.");
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      await kirimPesanTelegram(chatId, "⏳ AI sedang memproses fotomu...");
      let targetW = 2048, targetH = 2048; 
      if (fotoMasuk && fotoMasuk.length > 0) {
        const fotoAsli = fotoMasuk[fotoMasuk.length > 1 ? 1 : 0];
        targetW = Math.min(fotoAsli.width * 2, 4096); 
        targetH = Math.min(fotoAsli.height * 2, 4096);
      }
      const formData = new FormData();
      formData.append('image_file', new Blob([imageBuffer], { type: 'image/jpeg' }), 'foto.jpg');
      formData.append('target_width', targetW.toString());
      formData.append('target_height', targetH.toString());

      const resClipdrop = await fetch('https://clipdrop-api.co/image-upscaling/v1/upscale', {
        method: 'POST', headers: { 'x-api-key': CLIPDROP_API_KEY }, body: formData
      });
      if (resClipdrop.ok) {
        const enhancedImageBuffer = await resClipdrop.arrayBuffer();
        await kirimFotoBinaryTelegram(chatId, enhancedImageBuffer, "✨ Foto berhasil diperbagus menjadi HD!");
      } else {
        await kirimPesanTelegram(chatId, `❌ Gagal mengedit. Error: ${await resClipdrop.text()}`);
      }
    }
      
    // [B] GEMINI
    else if (aiPilihan === "gemini") {
      const pertanyaanClean = pesanUser.replace(/@gemini/gi, '').trim() || "Tolong analisis.";
      await kirimPesanTelegram(chatId, "⏳ Gemini sedang memproses jawaban...");
      let memoriMentah = await getRedis(`memori_gemini_${chatId}`) || [];
      let formatGemini = memoriMentah.map(msg => ({ role: msg.role, parts: [{ text: msg.content }] }));
      let partsSaatIni = [{ text: pertanyaanClean }];
      if (base64Image) partsSaatIni.push({ "inline_data": { "mime_type": "image/jpeg", "data": base64Image } });
      formatGemini.push({ role: "user", parts: partsSaatIni });
      const resGemini = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: formatGemini })
      });
      const resData = await resGemini.json();
      
      // --- SISTEM PELACAK ERROR BARU ---
      let jawaban = resData.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!jawaban) {
         // Jika gagal, tampilkan pesan error asli dari server Google
         jawaban = `⚠️ Respon tidak dikenali.\n\nAlasan dari Google:\n${JSON.stringify(resData).substring(0, 300)}`;
      }
      // ---------------------------------

      if (!jawaban.startsWith("⚠️")) {
          memoriMentah.push({ role: "user", content: pertanyaanClean });
          memoriMentah.push({ role: "model", content: jawaban });
          await setRedis(`memori_gemini_${chatId}`, memoriMentah.slice(-6));
      }
      await kirimPesanTelegram(chatId, `[Gemini 2.5 Flash]:\n\n${jawaban}`);
    }

    // [C] GROQ
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

    // [D] NEMOTRON SUPER (DIFFUSIONGEMMA)
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

    // [E] AI VISION NANO DENGAN INGATAN TEKS CERDAS (MAKSIMAL 8 INGINATAN)
    else if (aiPilihan === "nano") {
      const pertanyaanClean = pesanUser.replace(/@nano/gi, '').trim() || "Jelaskan gambar ini.";
      await kirimPesanTelegram(chatId, "⏳ NVIDIA sedang menganalisis pesan...");
      
      let riwayatNano = [];

      // KONDISI A: PENGGUNA MENGIRIM GAMBAR BARU
      if (isImage && base64Image) {
        let konten = [
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
          { type: "text", text: pertanyaanClean }
        ];

        try {
          const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${NVIDIA_API_KEY}` },
            body: JSON.stringify({ 
              model: "meta/llama-3.2-11b-vision-instruct", 
              messages: [{ role: "user", content: konten }], 
              max_tokens: 700 
            })
          });
          
          const data = await res.json();
          const jawaban = data.choices?.[0]?.message?.content || "⚠️ Respon kosong.";
          
          if (!jawaban.startsWith("⚠️")) {
            // Reset & simpan ingatan baru berupa teks saja agar tidak membebani database
            riwayatNano.push({ role: "user", content: `[Melihat Gambar]: ${pertanyaanClean}` });
            riwayatNano.push({ role: "assistant", content: jawaban });
            await setRedis(`memori_nano_${chatId}`, riwayatNano);
          }
          await kirimPesanTelegram(chatId, `[NVIDIA Vision]:\n\n${jawaban}`);
        } catch (err) {
          await kirimPesanTelegram(chatId, "⚠️ Terjadi kesalahan atau timeout saat membaca gambar.");
        }
      } 
      // KONDISI B: PENGGUNA BERTANYA LEWAT TEKS (FOLLOW-UP OBROLAN GAMBAR)
      else {
        riwayatNano = await getRedis(`memori_nano_${chatId}`) || [];
        riwayatNano.push({ role: "user", content: pertanyaanClean });

        try {
          const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${NVIDIA_API_KEY}` },
            body: JSON.stringify({ 
              model: "meta/llama-3.2-11b-vision-instruct", 
              messages: riwayatNano, // Mengirim teks riwayat lengkap beserta konteks jawaban gambar sebelumnya
              max_tokens: 700 
            })
          });
          
          const data = await res.json();
          const jawaban = data.choices?.[0]?.message?.content || "⚠️ Respon kosong.";
          
          if (!jawaban.startsWith("⚠️")) {
            riwayatNano.push({ role: "assistant", content: jawaban });
            // Kunci maksimal 8 ingatan (4 dari pengguna, 4 respon AI) sesuai permintaanmu
            if (riwayatNano.length > 8) riwayatNano = riwayatNano.slice(-8);
            await setRedis(`memori_nano_${chatId}`, riwayatNano);
          }
          await kirimPesanTelegram(chatId, `[NVIDIA Vision]:\n\n${jawaban}`);
        } catch (err) {
          await kirimPesanTelegram(chatId, "⚠️ Terjadi kesalahan saat memproses obrolan teks.");
        }
      }
    }
      
    // [F] PEXELS
    else if (aiPilihan === "gambar") {
      const promptGambar = pesanUser.replace(/@gambar/gi, '').trim();
      if (!promptGambar) return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      await kirimPesanTelegram(chatId, "⏳ Mencari foto...");
      const resPexels = await (await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(promptGambar)}&per_page=1`, { headers: { "Authorization": "Ak8w1HkWL0my455bsljopg04tq2JHkUkQH9SDmT5DDDhtp92GHEZuHTq" } })).json();
      if (resPexels.photos?.length > 0) await kirimFotoTelegramURL(chatId, resPexels.photos[0].src.large, `📸 Hasil: <b>${promptGambar}</b>`);
    }

    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  } catch (error) {
    console.error("Global Error:", error);
    return new Response(JSON.stringify({ status: 'error' }), { status: 200 });
  }
  }
        
