import { VoiceCaptureController } from "./src/modules/voice-capture/index.ts";
import { TTSController } from "./src/modules/tts/index.ts";
import { TTSCacheController } from "./src/modules/tts-cache/index.ts";
import { Synthesizer } from "./src/modules/tts/synthesizer.ts";
import { loadTTSConfig } from "./src/modules/tts/config.ts";

console.log("=== AGENT - Teste Voice → TTS (com cache) ===\n");

const ttsConfig = await loadTTSConfig(process.env.ELEVENLABS_API_KEY!);
const voiceId = ttsConfig.voiceId;

// --- Cache (idioma do TTS config) ---
const cache = new TTSCacheController({}, process.cwd(), ttsConfig.language);
await cache.init();

// --- TTS ---
const tts = new TTSController({
  onSpeechReady(result) {
    console.log(`[TTS] Pronto: ${result.id} (${result.durationMs}ms)`);
  },
  onSpeechEnd(id) {
    console.log(`[TTS] Fim: ${id}`);
  },
  onError(error, req) {
    console.error(`[TTS Erro] ${req.id}:`, error.message);
  },
});
await tts.init();

// Conecta cache ao TTS pipeline:
// 1. Antes de chamar API → tenta cache
tts.setCacheResolver((text) => cache.resolveAudio(text, voiceId));
// 2. Após gerar via API → salva no cache
tts.onAudioGenerated((text, audio) => cache.storeNative(text, voiceId, audio));
// 3. Regen em background usa synthesizer
const synthesizer = new Synthesizer(ttsConfig);
cache.setSynthesizer((text) => synthesizer.synthesize(text));

// --- Voice Capture ---
const voiceCapture = new VoiceCaptureController({
  onTranscription(result) {
    const text = result.text.trim();
    if (!text) return;

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  Você: "${text}"`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // manda pro TTS - o pipeline resolve cache vs API internamente
    tts.speak(text);
  },

  onError(error, capturerId) {
    console.error(`[Capture Erro ${capturerId}]`, error.message);
  },
});

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
