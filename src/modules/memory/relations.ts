// Tipos de relação que o grafo pode ter
export const RELATION_TYPES = {
  // temporais
  follows: "follows",           // A aconteceu depois de B
  caused: "caused",             // A causou B
  during: "during",             // A aconteceu durante B

  // semânticas
  about: "about",               // memória é sobre esta entidade/tópico
  related_to: "related_to",     // relação genérica
  contradicts: "contradicts",   // A contradiz B
  confirms: "confirms",         // A confirma B
  updates: "updates",           // A é versão mais recente de B

  // hierárquicas
  part_of: "part_of",           // A é parte de B
  contains: "contains",         // A contém B
  example_of: "example_of",    // A é exemplo de B

  // associativas
  same_topic: "same_topic",     // mesmo assunto
  same_person: "same_person",   // mesma pessoa mencionada
  same_place: "same_place",     // mesmo lugar
  same_session: "same_session", // mesma conversa/sessão
} as const;

export type RelationType = typeof RELATION_TYPES[keyof typeof RELATION_TYPES];

// Categorias de memória
export const MEMORY_CATEGORIES = {
  fact: "fact",                 // fato sobre o mundo ou usuário
  preference: "preference",     // preferência do usuário
  person: "person",             // info sobre uma pessoa
  place: "place",               // info sobre um lugar
  event: "event",               // algo que aconteceu
  topic: "topic",               // tópico de interesse
  instruction: "instruction",   // instrução ou regra
  context: "context",           // contexto de conversa
  emotion: "emotion",           // estado emocional detectado
} as const;

export type MemoryCategory = typeof MEMORY_CATEGORIES[keyof typeof MEMORY_CATEGORIES];

// Extrai tokens-chave de um texto para matching
export function extractKeyTokens(text: string): string[] {
  const stopWords = new Set([
    "o", "a", "os", "as", "um", "uma", "uns", "umas",
    "de", "do", "da", "dos", "das", "em", "no", "na", "nos", "nas",
    "por", "para", "com", "sem", "sob", "sobre",
    "e", "ou", "mas", "se", "que", "como", "quando", "onde",
    "não", "sim", "já", "ainda", "mais", "menos", "muito", "pouco",
    "eu", "tu", "ele", "ela", "nós", "eles", "elas", "você", "vocês",
    "meu", "minha", "seu", "sua", "nosso", "nossa",
    "esse", "essa", "este", "esta", "isso", "isto", "aquilo",
    "ser", "estar", "ter", "fazer", "ir", "vir", "poder", "dever",
    "foi", "era", "tem", "vai", "está", "são", "tá",
    "the", "is", "are", "was", "were", "be", "been",
    "to", "of", "in", "for", "on", "with", "at", "by",
    "and", "or", "but", "not", "this", "that", "it",
  ]);

  return text
    .toLowerCase()
    .replace(/[.,!?;:()[\]{}'"]/g, "")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !stopWords.has(t));
}

// Calcula sobreposição de tokens entre dois textos (0-1)
export function tokenOverlap(a: string, b: string): number {
  const tokensA = new Set(extractKeyTokens(a));
  const tokensB = new Set(extractKeyTokens(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }

  return (2 * intersection) / (tokensA.size + tokensB.size);
}
