import OpenAI from "openai";
import type { VoiceCaptureConfig } from "./types.ts";

export class Transcriber {
  private client: OpenAI;
  private config: VoiceCaptureConfig;

  constructor(config: VoiceCaptureConfig) {
    this.client = new OpenAI({ apiKey: config.openaiApiKey });
    this.config = config;
  }

  async transcribe(audioData: Uint8Array): Promise<string> {
    if (audioData.length < 1000) return "";

    const file = new File([audioData], "audio.wav", { type: "audio/wav" });

    const response = await this.client.audio.transcriptions.create({
      model: "whisper-1",
      file,
      language: this.config.language,
      response_format: "text",
    });

    return (response as unknown as string).trim();
  }
}
