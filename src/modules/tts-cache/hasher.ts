import { CryptoHasher } from "bun";

export function hashKey(text: string, voiceId: string, language = "pt"): string {
  const hasher = new CryptoHasher("sha256");
  hasher.update(`${language}:${voiceId}:${normalize(text)}`);
  return hasher.digest("hex").slice(0, 16);
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,!?;:]+$/g, "");
}

export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

export function buildPhraseKeys(text: string): string[] {
  const words = tokenize(text);
  const keys: string[] = [];

  // frase completa
  keys.push(normalize(text));

  // sub-frases de 2+ palavras (bigrams, trigrams, etc)
  for (let size = Math.min(words.length - 1, 5); size >= 2; size--) {
    for (let i = 0; i <= words.length - size; i++) {
      keys.push(words.slice(i, i + size).join(" "));
    }
  }

  // palavras individuais
  for (const word of words) {
    keys.push(word);
  }

  return keys;
}
