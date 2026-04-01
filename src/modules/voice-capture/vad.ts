// Voice Activity Detection baseado em energia RMS do áudio PCM 16-bit

export interface VADConfig {
  energyThreshold: number;    // nível mínimo de energia para considerar "voz" (0-1)
  silenceFrames: number;      // quantos frames de silêncio pra considerar "parou de falar"
  speechFrames: number;       // quantos frames de voz pra considerar "começou a falar"
  frameSize: number;          // tamanho do frame em samples (ex: 480 = 30ms a 16kHz)
}

export const DEFAULT_VAD_CONFIG: VADConfig = {
  energyThreshold: 0.02,
  silenceFrames: 30,   // ~900ms de silêncio (30 frames * 30ms)
  speechFrames: 3,     // ~90ms de voz pra ativar
  frameSize: 480,      // 30ms a 16kHz
};

export type VADState = "silence" | "speech" | "trailing";

export class VAD {
  private config: VADConfig;
  private _state: VADState = "silence";
  private silenceCount = 0;
  private speechCount = 0;
  private _peakEnergy = 0;
  private _avgEnergy = 0;
  private energySamples: number[] = [];

  constructor(config: Partial<VADConfig> = {}) {
    this.config = { ...DEFAULT_VAD_CONFIG, ...config };
  }

  // Analisa um chunk de áudio PCM 16-bit LE e retorna se tem voz
  processChunk(pcmData: Uint8Array): VADState {
    const energy = this.calculateRMS(pcmData);
    this.trackEnergy(energy);

    const isSpeech = energy > this.config.energyThreshold;

    switch (this._state) {
      case "silence":
        if (isSpeech) {
          this.speechCount++;
          if (this.speechCount >= this.config.speechFrames) {
            this._state = "speech";
            this.silenceCount = 0;
          }
        } else {
          this.speechCount = 0;
        }
        break;

      case "speech":
        if (!isSpeech) {
          this._state = "trailing";
          this.silenceCount = 1;
        }
        this.speechCount = 0;
        break;

      case "trailing":
        if (isSpeech) {
          this._state = "speech";
          this.silenceCount = 0;
        } else {
          this.silenceCount++;
          if (this.silenceCount >= this.config.silenceFrames) {
            this._state = "silence";
            this.speechCount = 0;
          }
        }
        break;
    }

    return this._state;
  }

  // Analisa áudio completo e retorna se contém voz
  static hasVoice(pcmData: Uint8Array, threshold = 0.02): boolean {
    if (pcmData.length < 100) return false;

    // pula header WAV (44 bytes) se presente
    const offset = pcmData.length > 44 && pcmData[0] === 0x52 ? 44 : 0;
    const view = new DataView(pcmData.buffer, pcmData.byteOffset + offset);
    const sampleCount = Math.floor((pcmData.length - offset) / 2);

    if (sampleCount === 0) return false;

    let sumSquares = 0;
    let peakSamples = 0;
    const chunkSize = Math.min(sampleCount, 8000); // analisa em blocos de ~500ms

    for (let chunk = 0; chunk < sampleCount; chunk += chunkSize) {
      const end = Math.min(chunk + chunkSize, sampleCount);
      let chunkSum = 0;

      for (let i = chunk; i < end; i++) {
        const sample = view.getInt16(i * 2, true) / 32768;
        chunkSum += sample * sample;
      }

      const chunkRMS = Math.sqrt(chunkSum / (end - chunk));
      if (chunkRMS > threshold) {
        peakSamples += (end - chunk);
      }
      sumSquares += chunkSum;
    }

    // precisa ter pelo menos 10% do áudio com voz
    const voiceRatio = peakSamples / sampleCount;
    return voiceRatio > 0.1;
  }

  // Retorna a porcentagem de voz no áudio (0-1)
  static voiceRatio(pcmData: Uint8Array, threshold = 0.02): number {
    if (pcmData.length < 100) return 0;

    const offset = pcmData.length > 44 && pcmData[0] === 0x52 ? 44 : 0;
    const view = new DataView(pcmData.buffer, pcmData.byteOffset + offset);
    const sampleCount = Math.floor((pcmData.length - offset) / 2);

    if (sampleCount === 0) return 0;

    const frameSize = 480; // 30ms a 16kHz
    let voiceFrames = 0;
    let totalFrames = 0;

    for (let i = 0; i < sampleCount; i += frameSize) {
      const end = Math.min(i + frameSize, sampleCount);
      let sum = 0;

      for (let j = i; j < end; j++) {
        const sample = view.getInt16(j * 2, true) / 32768;
        sum += sample * sample;
      }

      const rms = Math.sqrt(sum / (end - i));
      totalFrames++;
      if (rms > threshold) voiceFrames++;
    }

    return totalFrames > 0 ? voiceFrames / totalFrames : 0;
  }

  // Retorna o pico de energia RMS (frame mais alto)
  static peakRMS(pcmData: Uint8Array, _threshold = 0.02): number {
    if (pcmData.length < 100) return 0;

    const offset = pcmData.length > 44 && pcmData[0] === 0x52 ? 44 : 0;
    const view = new DataView(pcmData.buffer, pcmData.byteOffset + offset);
    const sampleCount = Math.floor((pcmData.length - offset) / 2);

    if (sampleCount === 0) return 0;

    const frameSize = 480;
    let peak = 0;

    for (let i = 0; i < sampleCount; i += frameSize) {
      const end = Math.min(i + frameSize, sampleCount);
      let sum = 0;
      for (let j = i; j < end; j++) {
        const sample = view.getInt16(j * 2, true) / 32768;
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / (end - i));
      if (rms > peak) peak = rms;
    }

    return peak;
  }

  private calculateRMS(pcmData: Uint8Array): number {
    if (pcmData.length < 2) return 0;

    // PCM 16-bit LE: cada sample = 2 bytes
    const view = new DataView(pcmData.buffer, pcmData.byteOffset);
    const sampleCount = Math.floor(pcmData.length / 2);
    let sum = 0;

    for (let i = 0; i < sampleCount; i++) {
      const sample = view.getInt16(i * 2, true) / 32768; // normaliza pra -1..1
      sum += sample * sample;
    }

    return Math.sqrt(sum / sampleCount);
  }

  private trackEnergy(energy: number): void {
    this._peakEnergy = Math.max(this._peakEnergy, energy);
    this.energySamples.push(energy);
    if (this.energySamples.length > 100) this.energySamples.shift();
    this._avgEnergy = this.energySamples.reduce((a, b) => a + b, 0) / this.energySamples.length;
  }

  reset(): void {
    this._state = "silence";
    this.silenceCount = 0;
    this.speechCount = 0;
  }

  get state(): VADState {
    return this._state;
  }

  get peakEnergy(): number {
    return this._peakEnergy;
  }

  get avgEnergy(): number {
    return this._avgEnergy;
  }
}
