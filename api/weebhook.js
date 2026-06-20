versatile", messages: riwayatChat.slice(-16) })});
      const groqData = await resGroq.json();
      const jawabanGroq = groqData.choices?.[0]?.message?.content || "âš ï¸ Gagal memproses.";
      if (!jawabanGroq.startsWith("âš ï¸")) {
        riwayatChat.push({ role: "assistant", content: jawabanGroq });
        await setRedis(`memori_${chatId}`, riwayatChat.slice(-16));
      }
      await kirimPesanTelegram(chatId, `[Groq Llama-3.3]:\n\n${jawabanGroq}`);
    }

    // [D] NEMOTRON SUPER (DIFFUSIONGEMMA)
    else if (aiPilihan === "super") {
      const pertanyaanClean = pesanUser.replace(/@super/gi, '').trim() || "Halo";
      await kirimPesanTelegram(chatId, "â³ DiffusionGemma sedang merangkai jawaban...");
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
          let jawabanSuper = dataSuper.choices?.[0]?.message?.content || "âš ï¸ Kosong.";
          riwayatSuper.push({ role: "assistant", content: jawabanSuper });
          await setRedis(`memori_super_${chatId}`, riwayatSuper.slice(-16));
          await kirimPesanTelegram(chatId, `[DiffusionGemma]:\n\n${jawabanSuper}`);
        } else {
          await kirimPesanTelegram(chatId, `âš ï¸ Error API:\n${JSON.stringify(dataSuper).substring(0, 100)}`);
        }
      } catch (err) {
        await kirimPesanTelegram(chatId, "âš ï¸ Waktu habis. Vercel memotong proses karena server NVIDIA terlalu lambat.");
      }
    }

    // [E] AI VISION NANO
    else if (aiPilihan === "nano") {
      const pertanyaanClean = pesanUser.replace(/@nano/gi, '').trim() || "Jelaskan gambar ini.";
      await kirimPesanTelegram(chatId, "â³ NVIDIA sedang menganalisis pesan...");
      
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
            body: JSON.stringify({ 
              model: "meta/llama-3.2-11b-vision-instruct", 
              messages: [{ role: "user", content: konten }], 
              max_tokens: 700 
            })
          });
          
          const data = await res.json();
          const jawaban = data.choices?.[0]?.message?.content || "âš ï¸ Respon kosong.";
          
          if (!jawaban.startsWith("âš ï¸")) {
            riwayatNano.push({ role: "user", content: `[Melihat Gambar]: ${pertanyaanClean}` });
            riwayatNano.push({ role: "assistant", content: jawaban });
            await setRedis(`memori_nano_${chatId}`, riwayatNano);
          }
          await kirimPesanTelegram(chatId, `[NVIDIA Vision]:\n\n${jawaban}`);
        } catch (err) {
          await kirimPesanTelegram(chatId, "âš ï¸ Terjadi kesalahan atau timeout saat membaca gambar.");
        }
      } 
      else {
        riwayatNano = await getRedis(`memori_nano_${chatId}`) || [];
        riwayatNano.push({ role: "user", content: pertanyaanClean });

        try {
          const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${NVIDIA_API_KEY}` },
            body: JSON.stringify({ 
              model: "meta/llama-3.2-11b-vision-instruct", 
              messages: riwayatNano, 
              max_tokens: 700 
            })
          });
          
          const data = await res.json();
          const jawaban = data.choices?.[0]?.message?.content || "âš ï¸ Respon kosong.";
          
          if (!jawaban.startsWith("âš ï¸")) {
            riwayatNano.push({ role: "assistant", content: jawaban });
            if (riwayatNano.length > 8) riwayatNano = riwayatNano.slice(-8);
            await setRedis(`memori_nano_${chatId}`, riwayatNano);
          }
          await kirimPesanTelegram(chatId, `[NVIDIA Vision]:\n\n${jawaban}`);
        } catch (err) {
          await kirimPesanTelegram(chatId, "âš ï¸ Terjadi kesalahan saat memproses obrolan teks.");
        }
      }
    }
      
    // [F] PEXELS
    else if (aiPilihan === "gambar") {
      const promptGambar = pesanUser.replace(/@gambar/gi, '').trim();
      if (!promptGambar) return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      await kirimPesanTelegram(chatId, "â³ Mencari foto...");
      const resPexels = await (await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(promptGambar)}&per_page=1`, { headers: { "Authorization": "Ak8w1HkWL0my455bsljopg04tq2JHkUkQH9SDmT5DDDhtp92GHEZuHTq" } })).json();
      if (resPexels.photos?.length > 0) await kirimFotoTelegramURL(chatId, resPexels.photos[0].src.large, `ðŸ“¸ Hasil: <b>${promptGambar}</b>`);
    }

    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  } catch (error) {
    console.error("Global Error:", error);
    return new Response(JSON.stringify({ status: 'error' }), { status: 200 });
  }
                              }
