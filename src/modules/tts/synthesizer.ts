import { elevenLabsLimiter } from "./rate-limiter.ts";
import type { TTSConfig } from "./types.ts";

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

export class Synthesizer {
  private config: TTSConfig;

  constructor(config: TTSConfig) {
    this.config = config;
  }

  async synthesize(text: string): Promise<Uint8Array> {
    await elevenLabsLimiter.acquire();
    try {
      return await this.callApi(text);
    } finally {
      elevenLabsLimiter.release();
    }
  }

  private async callApi(text: string): Promise<Uint8Array> {
    const url = `${ELEVENLABS_BASE}/text-to-speech/${this.config.voiceId}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": this.config.elevenLabsApiKey,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: this.config.modelId,
        language_code: this.config.language,
        voice_settings: {
          stability: this.config.stability,
          similarity_boost: this.config.similarityBoost,
          style: this.config.style,
          speed: this.config.speed,
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`ElevenLabs API erro ${response.status}: ${body}`);
    }

    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  async listVoices(): Promise<Array<{ id: string; name: string; language: string }>> {
    const response = await fetch(`${ELEVENLABS_BASE}/voices`, {
      headers: { "xi-api-key": this.config.elevenLabsApiKey },
    });

    if (!response.ok) throw new Error(`ElevenLabs API erro ${response.status}`);

    const data = await response.json() as { voices: Array<{ voice_id: string; name: string; labels?: { language?: string } }> };

    return data.voices.map((v) => ({
      id: v.voice_id,
      name: v.name,
      language: v.labels?.language ?? "unknown",
    }));
  }
}
