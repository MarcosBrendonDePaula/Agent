import type { MemoryNode, MemoryConfig, MemoryStatus } from "./types.ts";
import { MemoryGraph } from "./graph.ts";

export class MemorySearch {
  private config: MemoryConfig;
  private graph: MemoryGraph;

  constructor(config: MemoryConfig, graph: MemoryGraph) {
    this.config = config;
    this.graph = graph;
  }

  search(query: string, limit?: number, includeStatuses?: MemoryStatus[]): MemoryNode[] {
    const maxResults = limit ?? this.config.searchResultsLimit;
    const statuses = includeStatuses ?? ["active"];
    const nodes = this.graph.getAllNodes(statuses);

    if (nodes.length === 0) return [];

    const queryTokens = this.tokenize(query);
    const queryTags = this.extractTags(query);

    // IDF sobre o corpus
    const idf = this.computeIDF(nodes);

    const scored = nodes.map((node) => {
      let score = 0;

      // tag match (filtro forte)
      if (queryTags.length > 0) {
        const tagMatch = queryTags.filter((t) => node.tags.includes(t)).length;
        if (tagMatch === 0) return { node, score: 0 };
        score += tagMatch * 0.3;
      }

      // similaridade textual
      const textScore = this.tfidfSimilarity(queryTokens, this.tokenize(node.content), idf);
      score += textScore;

      // peso da importância
      score *= node.importance;

      // boost de recência
      const hoursAgo = (Date.now() - node.lastAccessedAt) / (1000 * 60 * 60);
      const recencyBoost = 1.0 + this.config.recencyBoostFactor * Math.exp(-hoursAgo / 168);
      score *= recencyBoost;

      return { node, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map((s) => s.node);
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[.,!?;:()[\]{}'"]/g, "")
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }

  private extractTags(query: string): string[] {
    const tags: string[] = [];
    const regex = /#(\w+)/g;
    let match;
    while ((match = regex.exec(query)) !== null) {
      tags.push(match[1]!);
    }
    return tags;
  }

  private computeIDF(nodes: MemoryNode[]): Map<string, number> {
    const docFreq = new Map<string, number>();
    const totalDocs = nodes.length;

    for (const node of nodes) {
      const tokens = new Set(this.tokenize(node.content));
      for (const token of tokens) {
        docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
      }
    }

    const idf = new Map<string, number>();
    for (const [token, freq] of docFreq) {
      idf.set(token, Math.log(totalDocs / (1 + freq)));
    }

    return idf;
  }

  private tfidfSimilarity(queryTokens: string[], docTokens: string[], idf: Map<string, number>): number {
    if (queryTokens.length === 0 || docTokens.length === 0) return 0;

    const docSet = new Set(docTokens);
    let score = 0;

    for (const token of queryTokens) {
      if (docSet.has(token)) {
        const tf = docTokens.filter((t) => t === token).length / docTokens.length;
        const idfScore = idf.get(token) ?? 1;
        score += tf * idfScore;
      }
    }

    // normaliza pelo tamanho da query
    return score / queryTokens.length;
  }
}
