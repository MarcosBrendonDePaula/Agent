import OpenAI from "openai";
import type { ThinkingConfig, ChatMessage, ThoughtOutput } from "./types.ts";

export class Brain {
  private client: OpenAI;
  private config: ThinkingConfig;
  private history: ChatMessage[] = [];

  constructor(config: ThinkingConfig) {
    this.config = config;
    this.client = new OpenAI({ apiKey: config.apiKey });
  }

  async think(userMessage: string, memoryContext: string): Promise<ThoughtOutput> {
    const systemContent = memoryContext
      ? `${this.config.systemPrompt}\n\n${memoryContext}`
      : this.config.systemPrompt;

    const messages: ChatMessage[] = [
      { role: "system", content: systemContent },
      ...this.history,
      { role: "user", content: userMessage },
    ];

    const response = await this.client.chat.completions.create({
      model: this.config.model,
      messages,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content ?? "";

    let parsed: ThoughtOutput;
    try {
      const json = JSON.parse(raw);
      const shouldRespond = json.should_respond ?? json.shouldRespond ?? true;

      parsed = {
        shouldRespond,
        response: json.response ?? json.text ?? "",
        memoriesToStore: json.memories_to_store ?? json.memoriesToStore ?? [],
        emotion: json.emotion,
        reason: json.reason,
      };
    } catch {
      parsed = {
        shouldRespond: true,
        response: raw,
        memoriesToStore: [],
      };
    }

    // atualiza histórico (mesmo quando não responde, registra que ouviu)
    this.history.push({ role: "user", content: userMessage });
    if (parsed.shouldRespond && parsed.response) {
      this.history.push({ role: "assistant", content: parsed.response });
    }

    while (this.history.length > this.config.maxHistoryMessages * 2) {
      this.history.shift();
    }

    return parsed;
  }

  clearHistory(): void {
    this.history = [];
  }

  getHistory(): ChatMessage[] {
    return [...this.history];
  }
}
