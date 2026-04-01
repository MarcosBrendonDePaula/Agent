export { TTSController } from "./controller.ts";
export { TTSPipeline } from "./tts-pipeline.ts";
export { PriorityQueue } from "./priority-queue.ts";
export { Synthesizer } from "./synthesizer.ts";
export { AudioPlayer } from "./player.ts";
export { loadTTSConfig, saveTTSConfig, updateTTSConfig } from "./config.ts";
export {
  DEFAULT_TTS_CONFIG,
  type TTSConfig,
  type TTSRequest,
  type TTSResult,
  type TTSEvents,
} from "./types.ts";
export type { TTSStatus } from "./controller.ts";
