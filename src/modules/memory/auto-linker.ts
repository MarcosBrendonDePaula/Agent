import type { MemoryNode, MemoryEdge } from "./types.ts";
import { MemoryGraph } from "./graph.ts";
import { RELATION_TYPES, extractKeyTokens, tokenOverlap } from "./relations.ts";

export interface LinkResult {
  edges: MemoryEdge[];
  topicNodes: MemoryNode[];
}

/**
 * AutoLinker: cria relações automaticamente quando uma memória é adicionada.
 *
 * Estratégia:
 * 1. Extrai tokens-chave do conteúdo
 * 2. Para cada token, verifica se existe um nó "tópico" → conecta
 * 3. Se não existe, cria o nó tópico e conecta
 * 4. Compara com memórias recentes → conecta se overlap > threshold
 * 5. Conecta com a memória anterior na sessão (temporal)
 */
export class AutoLinker {
  private graph: MemoryGraph;
  private lastMemoryId: string | null = null;
  private sessionId: string;
  private topicIndex = new Map<string, string>(); // token → nodeId do tópico

  constructor(graph: MemoryGraph) {
    this.graph = graph;
    this.sessionId = `session-${Date.now()}`;
    this.rebuildTopicIndex();
  }

  /**
   * Reconstrói o índice de tópicos a partir do grafo existente.
   * Chamado no init e quando carrega do disco.
   */
  rebuildTopicIndex(): void {
    this.topicIndex.clear();
    for (const node of this.graph.getAllNodes()) {
      if (node.tags.includes("topic")) {
        const tokens = extractKeyTokens(node.content);
        for (const token of tokens) {
          this.topicIndex.set(token, node.id);
        }
      }
    }
  }

  /**
   * Processa uma nova memória: cria relações automáticas.
   * Retorna as arestas e nós-tópico criados.
   */
  link(node: MemoryNode): LinkResult {
    const edges: MemoryEdge[] = [];
    const topicNodes: MemoryNode[] = [];
    const tokens = extractKeyTokens(node.content);

    // 1. Conecta com tópicos existentes ou cria novos
    const linkedTopics = new Set<string>();
    for (const token of tokens) {
      const topicId = this.topicIndex.get(token);

      if (topicId && !linkedTopics.has(topicId)) {
        linkedTopics.add(topicId);
        const edge = this.createEdge(node.id, topicId, RELATION_TYPES.about, 0.6);
        if (edge) edges.push(edge);
      }
    }

    // 2. Conecta com memórias que têm overlap significativo de tokens
    const allActive = this.graph.getAllNodes(["active", "fading"]);
    for (const other of allActive) {
      if (other.id === node.id) continue;
      if (other.tags.includes("topic")) continue;

      const overlap = tokenOverlap(node.content, other.content);

      if (overlap > 0.5) {
        const edge = this.createEdge(node.id, other.id, RELATION_TYPES.same_topic, overlap);
        if (edge) edges.push(edge);
      } else if (overlap > 0.35) {
        const edge = this.createEdge(node.id, other.id, RELATION_TYPES.related_to, overlap);
        if (edge) edges.push(edge);
      }
    }

    // 3. Conecta temporalmente com a memória anterior da sessão (peso baixo)
    if (this.lastMemoryId && this.lastMemoryId !== node.id) {
      const edge = this.createEdge(this.lastMemoryId, node.id, RELATION_TYPES.follows, 0.1);
      if (edge) edges.push(edge);
    }
    this.lastMemoryId = node.id;

    return { edges, topicNodes };
  }

  /**
   * Cria um nó tópico e indexa seus tokens.
   */
  createTopic(name: string, importance = 0.4): MemoryNode {
    const node: MemoryNode = {
      id: crypto.randomUUID(),
      content: name,
      tags: ["topic"],
      importance,
      initialImportance: importance,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 0,
      metadata: { type: "topic" },
      status: "active",
    };

    this.graph.addNode(node);

    // indexa tokens do tópico
    for (const token of extractKeyTokens(name)) {
      this.topicIndex.set(token, node.id);
    }

    return node;
  }

  /**
   * Registra múltiplos tópicos de uma vez (ex: na inicialização).
   */
  registerTopics(topics: string[]): MemoryNode[] {
    return topics.map((t) => {
      // verifica se já existe
      const existing = this.topicIndex.get(t.toLowerCase());
      if (existing) return this.graph.getNode(existing)!;
      return this.createTopic(t);
    });
  }

  private createEdge(sourceId: string, targetId: string, relation: string, weight: number): MemoryEdge | null {
    // evita duplicar
    const existing = this.graph.getEdgesBetween(sourceId, targetId);
    if (existing.some((e) => e.relation === relation)) return null;

    const edge: MemoryEdge = {
      id: crypto.randomUUID(),
      source: sourceId,
      target: targetId,
      relation,
      weight,
      createdAt: Date.now(),
      metadata: {},
    };

    this.graph.addEdge(edge);
    return edge;
  }

  newSession(): void {
    this.sessionId = `session-${Date.now()}`;
    this.lastMemoryId = null;
  }

  get currentSession(): string {
    return this.sessionId;
  }
}
