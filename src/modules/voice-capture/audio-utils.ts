import { spawn } from "bun";

export async function detectAudioDevice(ffmpegPath = "ffmpeg"): Promise<string> {
  const proc = spawn({
    cmd: [ffmpegPath, "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  const match = stderr.match(/"([^"]+)"\s*\(audio\)/);
  if (!match?.[1]) {
    throw new Error("Nenhum dispositivo de áudio encontrado. Verifique seu microfone.");
  }

  return match[1];
}
