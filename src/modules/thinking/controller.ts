import { Brain } from "./brain.ts";
import { loadThinkingConfig, saveThinkingConfig } from "./config.ts";
import type { ThinkingConfig, ThinkingEvents, ThoughtInput, ThoughtOutput } from "./types.ts";
import type { MemoryController } from "../memory/controller.ts";
import type { VoiceCaptureController } from "../voice-capture/controller.ts";
import type { TTSController } from "../tts/controller.ts";

export class ThinkingController {
  private brain!: Brain;
  private config!: ThinkingConfig;
  private events: Partial<ThinkingEvents>;
  private memory: MemoryController;
  private ears: VoiceCaptureController;
  private mouth: TTSController;
  private running = false;
  private inputQueue: ThoughtInput[] = [];
  private processing = false;

  constructor(
    memory: MemoryController,
    ears: VoiceCaptureController,
    mouth: TTSController,
    events: Partial<ThinkingEvents> = {},
  ) {
    this.memory = memory;
    this.ears = ears;
    this.mouth = mouth;
    this.events = events;
  }

  async init(): Promise<void> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY não definida");

    this.config = await loadThinkingConfig(apiKey);
    this.brain = new Brain(this.config);

    console.log(`[Thinking] Inicializado: model=${this.config.model} | temp=${this.config.temperature}`);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    await this.ears.start();

    console.log("[Thinking] Loop de pensamento ativo.");
  }

  // chamado quando os ouvidos capturam algo
  async hear(text: string): Promise<void> {
    const input: ThoughtInput = {
      text,
      timestamp: Date.now(),
    };

    this.inputQueue.push(input);
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.inputQueue.length === 0) return;
    this.processing = true;

    while (this.inputQueue.length > 0) {
      const input = this.inputQueue.shift()!;

      try {
        this.events.onThinking?.(input.text);

        // 1. consulta memórias relevantes
        const { context } = this.memory.autoRecall(input.text, 5);

        console.log(`[Thinking] Ouviu: "${input.text}"`);
        if (context) {
          console.log(`[Thinking] Memórias injetadas: ${context.split("\n").length} itens`);
        }

        // 2. pensa (chama LLM)
        const output = await this.brain.think(input.text, context);

        // 3. armazena novas memórias (mesmo sem responder)
        if (output.memoriesToStore.length > 0) {
          const stored = this.memory.autoStore(output.memoriesToStore);
          console.log(`[Thinking] Memórias salvas: ${stored.length}`);
        }

        // 4. decide se fala ou fica em silêncio
        if (output.shouldRespond && output.response) {
          console.log(`[Thinking] Respondeu: "${output.response.slice(0, 80)}${output.response.length > 80 ? "..." : ""}"`);
          this.mouth.speak(output.response);
          this.events.onResponse?.(output);
        } else {
          const reason = output.reason ?? "sem necessidade de resposta";
          console.log(`[Thinking] Ouviu e ficou em silêncio (${reason})`);
          this.events.onSilent?.(input.text, reason);
        }

        // 5. tick de manutenção da memória
        this.memory.tick();

      } catch (error) {
        console.error(`[Thinking] Erro:`, (error as Error).message);
        this.events.onError?.(error as Error);
      }
    }

    this.processing = false;
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    const text = await this.ears.stop();
    await this.mouth.waitForCompletion();
    await this.mouth.stop();
    await this.memory.shutdown();

    console.log("[Thinking] Encerrado.");
    console.log(`[Thinking] Texto capturado:\n${text}`);
  }

  async setConfig(updates: Partial<Omit<ThinkingConfig, "apiKey">>): Promise<void> {
    this.config = { ...this.config, ...updates };
    await saveThinkingConfig(this.config);
    this.brain = new Brain(this.config);
    console.log("[Thinking] Config atualizada.");
  }

  clearHistory(): void {
    this.brain.clearHistory();
    console.log("[Thinking] Histórico limpo.");
  }

  get isRunning(): boolean {
    return this.running;
  }
}
