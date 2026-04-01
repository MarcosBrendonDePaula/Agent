import { tokenize, normalize } from "./hasher.ts";

interface WordFreq {
  text: string;
  count: number;
  lastSeen: number;
  contexts: string[]; // frases onde apareceu
}

export class WordTracker {
  private words = new Map<string, WordFreq>();
  private phrases = new Map<string, WordFreq>();

  trackSentence(sentence: string): void {
    const norm = normalize(sentence);
    const words = tokenize(sentence);

    // trackeia frase completa
    this.trackPhrase(norm, norm);

    // trackeia cada palavra
    for (const word of words) {
      this.trackWord(word, norm);
    }

    // trackeia n-grams (2 até 6 palavras)
    for (let size = 2; size <= Math.min(words.length, 6); size++) {
      for (let i = 0; i <= words.length - size; i++) {
        this.trackPhrase(words.slice(i, i + size).join(" "), norm);
      }
    }
  }

  private trackWord(word: string, context: string): void {
    const existing = this.words.get(word);
    if (existing) {
      existing.count++;
      existing.lastSeen = Date.now();
      if (!existing.contexts.includes(context)) {
        existing.contexts.push(context);
        if (existing.contexts.length > 10) existing.contexts.shift();
      }
    } else {
      this.words.set(word, {
        text: word,
        count: 1,
        lastSeen: Date.now(),
        contexts: [context],
      });
    }
  }

  private trackPhrase(phrase: string, context: string): void {
    const existing = this.phrases.get(phrase);
    if (existing) {
      existing.count++;
      existing.lastSeen = Date.now();
    } else {
      this.phrases.set(phrase, {
        text: phrase,
        count: 1,
        lastSeen: Date.now(),
        contexts: [context],
      });
    }
  }

  getFrequentWords(minCount = 3, limit = 100): WordFreq[] {
    return Array.from(this.words.values())
      .filter((w) => w.count >= minCount)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  getFrequentPhrases(minCount = 2, limit = 50): WordFreq[] {
    return Array.from(this.phrases.values())
      .filter((p) => p.count >= minCount)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  getWordsToPrecache(threshold: number): string[] {
    return this.getFrequentWords(threshold).map((w) => w.text);
  }

  getPhrasesToPrecache(threshold: number): string[] {
    return this.getFrequentPhrases(threshold).map((p) => p.text);
  }

  getWordCount(word: string): number {
    return this.words.get(normalize(word))?.count ?? 0;
  }

  getPhraseCount(phrase: string): number {
    return this.phrases.get(normalize(phrase))?.count ?? 0;
  }

  serialize(): { words: WordFreq[]; phrases: WordFreq[] } {
    return {
      words: Array.from(this.words.values()),
      phrases: Array.from(this.phrases.values()),
    };
  }

  deserialize(data: { words: WordFreq[]; phrases: WordFreq[] }): void {
    this.words.clear();
    this.phrases.clear();
    for (const w of data.words) this.words.set(w.text, w);
    for (const p of data.phrases) this.phrases.set(p.text, p);
  }
}
