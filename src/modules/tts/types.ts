export interface TTSConfig {
  elevenLabsApiKey: string;
  voiceId: string;
  modelId: string;
  language: string;
  stability: number;
  similarityBoost: number;
  style: number;
  speed: number;
  outputFormat: string;
  concurrency: number;
  ffmpegPath?: string;
}

export interface TTSRequest {
  id: string;
  text: string;
  timestamp: number;
  priority: number;
}

export interface TTSResult {
  id: string;
  text: string;
  audio: Uint8Array;
  durationMs: number;
  timestamp: number;
}

export interface TTSEvents {
  onSpeechReady: (result: TTSResult) => void;
  onSpeechStart: (request: TTSRequest) => void;
  onSpeechEnd: (id: string) => void;
  onError: (error: Error, request: TTSRequest) => void;
  onQueueChange: (pending: number) => void;
}

export const DEFAULT_TTS_CONFIG: Omit<TTSConfig, "elevenLabsApiKey"> = {
  voiceId: "21m00Tcm4TlvDq8ikWAM",  // Rachel - voz padrão
  modelId: "eleven_multilingual_v2",
  language: "pt",
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0.0,
  speed: 1.0,
  outputFormat: "mp3_44100_128",
  concurrency: 2,
};
