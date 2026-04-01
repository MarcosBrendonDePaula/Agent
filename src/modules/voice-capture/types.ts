export type CapturerId = number;

export interface TranscriptionResult {
  text: string;
  duration: number;
  timestamp: number;
  capturerId: CapturerId;
}

export interface VoiceCaptureEvents {
  onTranscription: (result: TranscriptionResult) => void;
  onError: (error: Error, capturerId: CapturerId) => void;
  onBufferSwitch: (activeCapturer: CapturerId) => void;
  onSilence: (capturerId: CapturerId) => void;
}

export interface VoiceCaptureConfig {
  openaiApiKey: string;
  sampleRate: number;
  silenceThresholdMs: number;
  maxBufferDurationMs: number;
  language: string;
  ffmpegPath?: string;
  audioDevice?: string;
  capturerCount: number;
  pipelineConcurrency: number;
  vadThreshold: number;      // energia mínima RMS para considerar voz (0-1)
  vadMinVoiceRatio: number;  // % mínimo de voz no buffer para enviar ao Whisper
}

export const DEFAULT_CONFIG: Omit<VoiceCaptureConfig, "openaiApiKey"> = {
  sampleRate: 16000,
  silenceThresholdMs: 1500,
  maxBufferDurationMs: 30000,
  language: "pt",
  capturerCount: 3,
  pipelineConcurrency: 3,
  vadThreshold: 0.02,
  vadMinVoiceRatio: 0.15,
};
