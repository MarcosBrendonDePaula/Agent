import { spawn } from "bun";

export interface TuneResult {
  noiseFloor: number;      // energia RMS média do ruído ambiente
  peakNoise: number;       // pico de ruído detectado
  vadThreshold: number;    // threshold calibrado (noiseFloor * multiplier)
  vadMinVoiceRatio: number;
  durationMs: number;
  samples: number;
}

export async function autoTune(
  audioDevice: string,
  sampleRate = 16000,
  durationSec = 3,
  ffmpegPath = "ffmpeg",
  multiplier = 2.5, // threshold = noiseFloor * multiplier
): Promise<TuneResult> {
  console.log(`[AutoTune] Calibrando ruído ambiente (${durationSec}s)... fique em silêncio.`);

  const proc = spawn({
    cmd: [
      ffmpegPath,
      "-f", "dshow",
      "-i", `audio=${audioDevice}`,
      "-ar", String(sampleRate),
      "-ac", "1",
      "-t", String(durationSec),
      "-f", "wav",
      "-acodec", "pcm_s16le",
      "pipe:1",
    ],
    stdout: "pipe",
    stderr: "ignore",
  });

  // coleta todo o áudio
  const chunks: Uint8Array[] = [];
  const reader = proc.stdout.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  await proc.exited;

  // junta tudo
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const pcm = new Uint8Array(totalLen);
  let off = 0;
  for (const c of chunks) {
    pcm.set(c, off);
    off += c.length;
  }

  // pula WAV header
  const headerOffset = pcm.length > 44 && pcm[0] === 0x52 ? 44 : 0;
  const view = new DataView(pcm.buffer, pcm.byteOffset + headerOffset);
  const sampleCount = Math.floor((pcm.length - headerOffset) / 2);

  if (sampleCount < 100) {
    throw new Error("[AutoTune] Áudio muito curto para calibrar");
  }

  // calcula RMS por frame de 30ms
  const frameSize = 480;
  const energies: number[] = [];

  for (let i = 0; i < sampleCount; i += frameSize) {
    const end = Math.min(i + frameSize, sampleCount);
    let sum = 0;
    for (let j = i; j < end; j++) {
      const sample = view.getInt16(j * 2, true) / 32768;
      sum += sample * sample;
    }
    energies.push(Math.sqrt(sum / (end - i)));
  }

  // estatísticas do ruído
  energies.sort((a, b) => a - b);
  const noiseFloor = energies[Math.floor(energies.length * 0.5)]!;  // mediana
  const peakNoise = energies[Math.floor(energies.length * 0.95)]!;   // p95
  const vadThreshold = Math.max(peakNoise * multiplier, noiseFloor * 3, 0.005);

  // com threshold calibrado, silêncio puro deve dar ~0%
  // testamos quanto do ruído ambiente passa o threshold
  const testRatio = energies.filter((e) => e > vadThreshold).length / energies.length;
  // minVoiceRatio = ruído base + margem. Mínimo 15% pra ignorar ruído/chiado
  const vadMinVoiceRatio = Math.max(0.15, testRatio + 0.10);

  const result: TuneResult = {
    noiseFloor,
    peakNoise,
    vadThreshold: Math.round(vadThreshold * 10000) / 10000,
    vadMinVoiceRatio: Math.round(vadMinVoiceRatio * 100) / 100,
    durationMs: durationSec * 1000,
    samples: energies.length,
  };

  console.log(`[AutoTune] Ruído: floor=${noiseFloor.toFixed(4)} peak=${peakNoise.toFixed(4)}`);
  console.log(`[AutoTune] Calibrado: vadThreshold=${result.vadThreshold} vadMinVoiceRatio=${result.vadMinVoiceRatio}`);

  return result;
}
