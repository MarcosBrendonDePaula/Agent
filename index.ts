import { VoiceCaptureController } from "./src/modules/voice-capture/index.ts";
import { TTSController } from "./src/modules/tts/index.ts";
import { TTSCacheController } from "./src/modules/tts-cache/index.ts";
import { Synthesizer } from "./src/modules/tts/synthesizer.ts";
import { loadTTSConfig } from "./src/modules/tts/config.ts";

console.log("=== AGENT - Teste Voice → TTS (com cache) ===\n");

const ttsConfig = await loadTTSConfig(process.env.ELEVENLABS_API_KEY!);
const voiceId = ttsConfig.voiceId;

// --- Cache ---
const cache = new TTSCacheController({}, process.cwd(), ttsConfig.language);
await cache.init();

// --- Voice Capture ---
const voiceCapture = new VoiceCaptureController({
  onTranscription(result) {
    const text = result.text.trim();
    if (!text) return;

    // filtra alucinações conhecidas do Whisper em silêncio/ruído
    const normalized = text.toLowerCase().replace(/[.,!?;:\s]+/g, " ").trim();
    const hallucinations = [
      "legendas pela comunidade amara org",
      "legendas criadas pela comunidade amara org",
      "inscreva-se no canal",
      "inscreva se no canal",
      "obrigado por assistir",
    ];
    if (hallucinations.some((h) => normalized.includes(h))) {
      console.log(`[Whisper] Alucinação filtrada: "${text}"`);
      return;
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  Você: "${text}"`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    tts.speak(text);
  },
  onError(error, capturerId) {
    console.error(`[Capture Erro ${capturerId}]`, error.message);
  },
});

// --- TTS (com mute/unmute durante reprodução) ---
const tts = new TTSController({
  onSpeechReady(result) {
    console.log(`[TTS] Pronto: ${result.id} (${result.durationMs}ms)`);
  },
  onPlayStart(_id) {
    voiceCapture.mute();
  },
  onPlayEnd(_id) {
    // delay de 500ms antes de desmutar - evita eco residual
    setTimeout(() => voiceCapture.unmute(), 500);
  },
  onSpeechEnd(id) {
    console.log(`[TTS] Fim: ${id}`);
  },
  onError(error, req) {
    voiceCapture.unmute();
    console.error(`[TTS Erro] ${req.id}:`, error.message);
  },
});
await tts.init();

// Conecta cache ↔ TTS
tts.setCacheResolver((text) => cache.resolveAudio(text, voiceId));
tts.onAudioGenerated((text, audio) => cache.storeNative(text, voiceId, audio));
const synthesizer = new Synthesizer(ttsConfig);
cache.setSynthesizer((text) => synthesizer.synthesize(text));

// --- Start ---
await voiceCapture.init();

const devices = await voiceCapture.listDevices();
console.log("\nDispositivos:");
devices.forEach((d, i) => console.log(`  ${i}: ${d}`));
console.log(`\nFale algo! (Ctrl+C para parar)\n`);

await voiceCapture.start();

process.on("SIGINT", async () => {
  console.log("\n\nEncerrando...\n");

  const text = await voiceCapture.stop();
  await tts.waitForCompletion();
  await tts.stop();

  const stats = cache.getStats();
  console.log("=== Cache ===");
  console.log(`Entradas: ${stats.totalEntries} (${stats.nativeEntries} native)`);
  console.log(`Hit rate: ${Math.round(stats.hitRate * 100)}%`);
  console.log(`Tamanho: ${(stats.totalSizeBytes / 1024 / 1024).toFixed(1)}MB`);

  if (stats.topWords.length > 0) {
    console.log("\nTop:");
    stats.topWords.slice(0, 10).forEach((w) =>
      console.log(`  "${w.text}" → ${w.hits}x (${w.quality})`)
    );
  }

  await cache.shutdown();

  console.log("\n=== Texto ===");
  console.log(text || "(vazio)");
  process.exit(0);
});
