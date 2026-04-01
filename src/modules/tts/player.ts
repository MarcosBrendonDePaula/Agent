import { spawn, type Subprocess } from "bun";
import { tmpdir } from "os";
import { join } from "path";

export class AudioPlayer {
  private ffmpegPath: string;
  private playing = false;
  private currentProcess: Subprocess | null = null;

  constructor(ffmpegPath = "ffmpeg") {
    this.ffmpegPath = ffmpegPath;
  }

  async play(audioData: Uint8Array, shouldSkip?: () => boolean): Promise<void> {
    this.playing = true;

    // salva em arquivo temp pois stdin pipe do Bun em Windows é instável com ffplay
    const tempFile = join(tmpdir(), `tts-${Date.now()}.mp3`);
    await Bun.write(tempFile, audioData);

    const ffplay = this.ffmpegPath.replace("ffmpeg", "ffplay");

    this.currentProcess = spawn({
      cmd: [ffplay, "-nodisp", "-autoexit", "-loglevel", "quiet", tempFile],
      stdout: "ignore",
      stderr: "ignore",
    });

    if (shouldSkip) {
      const checkSkip = setInterval(() => {
        if (shouldSkip() && this.currentProcess) {
          this.currentProcess.kill();
          clearInterval(checkSkip);
        }
      }, 100);

      await this.currentProcess.exited;
      clearInterval(checkSkip);
    } else {
      await this.currentProcess.exited;
    }

    // limpa temp
    try {
      const { unlink } = await import("fs/promises");
      await unlink(tempFile);
    } catch { /* ok */ }

    this.currentProcess = null;
    this.playing = false;
  }

  forceStop(): void {
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
      this.playing = false;
    }
  }

  get isPlaying(): boolean {
    return this.playing;
  }
}
