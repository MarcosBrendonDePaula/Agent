import { VoiceCaptureController } from "./src/modules/voice-capture/index.ts";
import { TTSController } from "./src/modules/tts/index.ts";
import { TTSCacheController } from "./src/modules/tts-cache/index.ts";
import { MemoryController } from "./src/modules/memory/index.ts";
import { ThinkingController } from "./src/modules/thinking/index.ts";
import { Synthesizer } from "./src/modules/tts/synthesizer.ts";
import { loadTTSConfig } from "./src/modules/tts/config.ts";

console.log("=== Luna - Agente de Voz Autônomo ===\n");

const ttsConfig = await loadTTSConfig(process.env.ELEVENLABS_API_KEY!);
const voiceId = ttsConfig.voiceId;

// --- Memória ---
const memory = new MemoryController();

// --- Cache TTS ---
const cache = new TTSCacheController({}, process.cwd(), ttsConfig.language);
await cache.init();

// --- Boca (TTS) ---
let thinking: ThinkingController; // referência forward para mute/unmute

const mouth = new TTSController({
  onSpeechReady(result) {
    console.log(`[Boca] Pronto: ${result.id} (${result.durationMs}ms)`);
  },
  onPlayStart(_id) {
    ears.mute();
  },
  onPlayEnd(_id) {
    setTimeout(() => ears.unmute(), 500);
  },
  onSpeechEnd(id) {
    console.log(`[Boca] Fim: ${id}`);
  },
  onError(error, req) {
    ears.unmute();
    console.error(`[Boca Erro] ${req.id}:`, error.message);
  },
});

// --- Ouvidos (Voice Capture) ---
const ears = new VoiceCaptureController({
  onTranscription(result) {
    const text = result.text.trim();
    if (!text) return;

    // filtra alucinações do Whisper
    const normalized = text.toLowerCase().replace(/[.,!?;:\s]+/g, " ").trim();
    const hallucinations = [
      "legendas pela comunidade amara org",
      "legendas criadas pela comunidade amara org",
      "inscreva-se no canal",
      "inscreva se no canal",
      "obrigado por assistir",
    ];
    if (hallucinations.some((h) => normalized.includes(h))) return;

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  Você: "${text}"`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // envia pro cérebro processar
    thinking.hear(text);
  },
  onError(error, capturerId) {
    console.error(`[Ouvido Erro ${capturerId}]`, error.message);
  },
});

// --- Cérebro (Thinking) ---
thinking = new ThinkingController(memory, ears, mouth, {
  onThinking(input) {
    console.log(`[Cérebro] Pensando...`);
  },
  onResponse(output) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  Luna: "${output.response}"`);
    if (output.emotion) console.log(`  Emoção: ${output.emotion}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  },
  onSilent(input, reason) {
    console.log(`[Cérebro] (ouviu, ficou quieta: ${reason})`);
  },
  onError(error) {
    console.error(`[Cérebro Erro]`, error.message);
  },
});

// --- Conecta Cache ↔ TTS ---
await mouth.init();
mouth.setCacheResolver((text) => cache.resolveAudio(text, voiceId));
mouth.onAudioGenerated((text, audio) => cache.storeNative(text, voiceId, audio));
const synthesizer = new Synthesizer(ttsConfig);
cache.setSynthesizer((text) => synthesizer.synthesize(text));

// --- Inicia tudo ---
await memory.init();
await thinking.init();
await ears.init();

const devices = await ears.listDevices();
console.log("\nDispositivos de áudio:");
devices.forEach((d, i) => console.log(`  ${i}: ${d}`));
console.log(`\nLuna está ouvindo... Fale algo! (Ctrl+C para parar)\n`);

await thinking.start();

// --- Shutdown ---
process.on("SIGINT", async () => {
  console.log("\n\nEncerrando Luna...\n");

  await thinking.stop();

  const cacheStats = cache.getStats();
  const memStats = memory.getStats();

  console.log("\n=== Stats ===");
  console.log(`Cache: ${cacheStats.totalEntries} entradas | Hit rate: ${Math.round(cacheStats.hitRate * 100)}%`);
  console.log(`Memória: ${memStats.totalNodes} nós | ${memStats.totalEdges} conexões | ${memStats.totalClusters} clusters`);

  if (memStats.topMemories.length > 0) {
    console.log("\nTop memórias:");
    memStats.topMemories.slice(0, 5).forEach((m) =>
      console.log(`  (${m.importance}) ${m.content}`)
    );
  }

  await cache.shutdown();
  process.exit(0);
});
