export interface ThinkingConfig {
  model: string;
  apiKey: string;
  systemPrompt: string;
  maxHistoryMessages: number;
  temperature: number;
  maxTokens: number;
}

export const DEFAULT_THINKING_CONFIG: Omit<ThinkingConfig, "apiKey"> = {
  model: "gpt-4o-mini",
  systemPrompt: `Você é uma assistente de voz inteligente e amigável. Responda de forma natural e concisa, como numa conversa falada.

Regras:
- Respostas curtas e diretas (será falado em voz alta)
- Pode usar humor e ser expressiva
- Lembre-se do contexto das memórias injetadas
- Quando aprender algo novo sobre o usuário, indique no campo memories_to_store
- Fale em português brasileiro`,
  maxHistoryMessages: 20,
  temperature: 0.7,
  maxTokens: 300,
};

export interface ThoughtInput {
  text: string;
  timestamp: number;
}

export interface ThoughtOutput {
  shouldRespond: boolean;
  response: string;
  memoriesToStore: Array<{
    content: string;
    tags: string[];
    importance: number;
    relatedTo?: string;
    relation?: string;
  }>;
  emotion?: string;
  reason?: string; // por que decidiu responder ou não
}

export interface ThinkingEvents {
  onThinking: (input: string) => void;
  onResponse: (output: ThoughtOutput) => void;
  onSilent: (input: string, reason: string) => void;
  onError: (error: Error) => void;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
