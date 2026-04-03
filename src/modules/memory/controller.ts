import { MemoryGraph } from "./graph.ts";
import { DecayEngine } from "./decay.ts";
import { MemorySearch } from "./search.ts";
import { ClusterDetector } from "./cluster.ts";
import { AutoLinker } from "./auto-linker.ts";
import { MemoryPersistence } from "./persistence.ts";
import { loadMemoryConfig, updateMemoryConfig } from "./config.ts";
import { extractKeyTokens } from "./relations.ts";
import type {
  MemoryNode,
  MemoryEdge,
  MemoryCluster,
  MemoryConfig,
  MemoryStats,
  MemoryStatus,
} from "./types.ts";

export class MemoryController {
  private graph!: MemoryGraph;
  private decay!: DecayEngine;
  private search!: MemorySearch;
  private clusters!: ClusterDetector;
  private linker!: AutoLinker;
  private persistence!: MemoryPersistence;
  private config!: MemoryConfig;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;

  async init(baseDir = process.cwd()): Promise<void> {
    this.config = await loadMemoryConfig();
    this.graph = new MemoryGraph(this.config);
    this.decay = new DecayEngine(this.config, this.graph);
    this.search = new MemorySearch(this.config, this.graph);
    this.clusters = new ClusterDetector(this.graph);
    this.linker = new AutoLinker(this.graph);
    this.persistence = new MemoryPersistence(this.config.dataFile, baseDir);

    await this.persistence.load(this.graph);
    this.linker.rebuildTopicIndex();

    this.autoSaveTimer = setInterval(() => this.persistence.save(this.graph), this.config.autoSaveIntervalMs);

    console.log(`[Memory] Inicializado: ${this.graph.nodeCount} memórias, ${this.graph.edgeCount} conexões`);
  }

  async shutdown(): Promise<void> {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    this.persistence.markDirty();
    await this.persistence.save(this.graph);
    console.log("[Memory] Salvo e encerrado.");
  }

  // --- CRUD de memórias ---

  create(content: string, tags: string[] = [], importance = 0.5, metadata: Record<string, unknown> = {}): MemoryNode {
    const now = Date.now();
    const node: MemoryNode = {
      id: crypto.randomUUID(),
      content,
      tags,
      importance: Math.max(0, Math.min(1, importance)),
      initialImportance: importance,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      metadata,
      status: this.graph.computeStatus(importance),
    };

    this.graph.addNode(node);

    // auto-link: cria relações com memórias existentes e tópicos
    const links = this.linker.link(node);
    if (links.edges.length > 0) {
      console.log(`[Memory] Auto-link: ${links.edges.length} conexões criadas`);
    }

    this.persistence.markDirty();

    console.log(`[Memory] Criada: "${content.slice(0, 50)}${content.length > 50 ? "..." : ""}" (${node.id.slice(0, 8)}, imp: ${importance})`);
    return node;
  }

  recall(id: string): MemoryNode | null {
    const node = this.graph.getNode(id);
    if (!node) return null;

    this.decay.reinforce(id);
    this.persistence.markDirty();
    return node;
  }

  update(id: string, updates: { content?: string; tags?: string[]; metadata?: Record<string, unknown> }): MemoryNode | null {
    const node = this.graph.updateNode(id, updates);
    if (node) this.persistence.markDirty();
    return node ?? null;
  }

  forget(id: string): boolean {
    const node = this.graph.getNode(id);
    if (!node) return false;

    this.graph.updateNode(id, { importance: 0, status: "forgotten" });
    this.persistence.markDirty();
    return true;
  }

  remove(id: string): boolean {
    const removed = this.graph.removeNode(id);
    if (removed) this.persistence.markDirty();
    return removed;
  }

  strengthen(id: string, amount = 0.2): MemoryNode | null {
    const node = this.graph.getNode(id);
    if (!node) return null;

    this.decay.strengthen(id, amount);
    this.persistence.markDirty();
    return this.graph.getNode(id) ?? null;
  }

  // --- Conexões ---

  connect(sourceId: string, targetId: string, relation: string, weight = 0.5, metadata: Record<string, unknown> = {}): MemoryEdge | null {
    const source = this.graph.getNode(sourceId);
    const target = this.graph.getNode(targetId);
    if (!source || !target) return null;

    // evita duplicar mesma relação
    const existing = this.graph.getEdgesBetween(sourceId, targetId);
    if (existing.some((e) => e.relation === relation)) {
      return existing.find((e) => e.relation === relation)!;
    }

    const edge: MemoryEdge = {
      id: crypto.randomUUID(),
      source: sourceId,
      target: targetId,
      relation,
      weight: Math.max(0, Math.min(1, weight)),
      createdAt: Date.now(),
      metadata,
    };

    this.graph.addEdge(edge);
    this.persistence.markDirty();
    return edge;
  }

  disconnect(edgeId: string): boolean {
    const removed = this.graph.removeEdge(edgeId);
    if (removed) this.persistence.markDirty();
    return removed;
  }

  // --- Busca ---

  find(query: string, limit?: number, includeFading = false): MemoryNode[] {
    const statuses: MemoryStatus[] = includeFading ? ["active", "fading"] : ["active"];
    return this.search.search(query, limit, statuses);
  }

  getNeighbors(id: string, depth = 1): MemoryNode[] {
    return this.graph.getNeighbors(id, depth);
  }

  getConnections(id: string): MemoryEdge[] {
    return this.graph.getConnectedEdges(id);
  }

  // --- Clusters ---

  listClusters(): MemoryCluster[] {
    return this.clusters.detect();
  }

  // --- Manutenção ---

  tick(): { decayed: number; forgotten: number } {
    const result = this.decay.tick();

    // limpa nós forgotten antigos se exceder limite
    if (this.graph.nodeCount > this.config.maxNodes) {
      const forgotten = this.graph.getAllNodes(["forgotten"]);
      const toRemove = forgotten
        .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)
        .slice(0, this.graph.nodeCount - this.config.maxNodes);

      for (const node of toRemove) {
        this.graph.removeNode(node.id);
      }

      if (toRemove.length > 0) {
        this.persistence.markDirty();
      }
    }

    return result;
  }

  // --- Stats ---

  getStats(): MemoryStats {
    const all = this.graph.getAllNodes();
    const active = all.filter((n) => n.status === "active");
    const fading = all.filter((n) => n.status === "fading");
    const forgotten = all.filter((n) => n.status === "forgotten");
    const avgImportance = all.length > 0
      ? all.reduce((sum, n) => sum + n.importance, 0) / all.length
      : 0;

    const topMemories = active
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 10)
      .map((n) => ({ id: n.id, content: n.content.slice(0, 80), importance: Math.round(n.importance * 100) / 100 }));

    return {
      totalNodes: all.length,
      activeNodes: active.length,
      fadingNodes: fading.length,
      forgottenNodes: forgotten.length,
      totalEdges: this.graph.edgeCount,
      totalClusters: this.clusters.detect().length,
      avgImportance: Math.round(avgImportance * 100) / 100,
      topMemories,
    };
  }

  // --- Auto-recall: injeta contexto automático a cada interação ---

  /**
   * Chamado automaticamente a cada input do usuário.
   * Retorna memórias relevantes + vizinhos para injetar no prompt do LLM.
   * Também reforça as memórias encontradas (simula "lembrar").
   */
  autoRecall(input: string, limit = 5): { memories: MemoryNode[]; context: string } {
    const scored = new Map<string, { node: MemoryNode; score: number; source: string }>();
    const inputTokens = extractKeyTokens(input);

    if (inputTokens.length === 0) return { memories: [], context: "" };

    const WEAK_RELATIONS = new Set(["follows", "same_session"]);

    // 1. Score por overlap de tokens (preciso, sem TF-IDF que polui)
    for (const node of this.graph.getAllNodes(["active", "fading"])) {
      if (node.tags.includes("topic")) continue;

      const nodeTokens = extractKeyTokens(node.content);
      if (nodeTokens.length === 0) continue;

      // conta tokens em comum
      const nodeSet = new Set(nodeTokens);
      let matches = 0;
      for (const t of inputTokens) {
        if (nodeSet.has(t)) matches++;
      }

      if (matches === 0) continue;

      // score = % do input coberto * % do conteúdo coberto * importância
      const inputCoverage = matches / inputTokens.length;
      const contentCoverage = matches / nodeTokens.length;
      const relevance = (inputCoverage + contentCoverage) / 2;
      const score = relevance * node.importance;

      // mínimo de 20% de relevância para incluir
      if (relevance >= 0.2) {
        scored.set(node.id, { node, score, source: "direct" });
      }
    }

    // 2. Expande top matches por grafo (só relações semânticas)
    const topDirect = [...scored.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit);

    for (const [id, { score }] of topDirect) {
      for (const edge of this.graph.getConnectedEdges(id)) {
        if (WEAK_RELATIONS.has(edge.relation)) continue;

        const neighborId = edge.source === id ? edge.target : edge.source;
        if (scored.has(neighborId)) continue;

        const neighbor = this.graph.getNode(neighborId);
        if (!neighbor || neighbor.status === "forgotten") continue;
        if (neighbor.tags.includes("topic")) continue;

        // score atenuado: pai * peso da aresta * fator
        const neighborScore = score * edge.weight * 0.4;
        scored.set(neighborId, { node: neighbor, score: neighborScore, source: `via:${edge.relation}` });
      }
    }

    // 3. Se não encontrou nada relevante, injeta as memórias mais importantes
    //    (perguntas genéricas tipo "o que você sabe?", "do que lembra?")
    if (scored.size === 0) {
      const topActive = this.graph.getAllNodes(["active"])
        .sort((a, b) => b.importance - a.importance)
        .slice(0, limit);

      for (const node of topActive) {
        scored.set(node.id, { node, score: node.importance, source: "top" });
      }
    }

    // 4. Ordena e limita
    const results = [...scored.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // 5. Reforça os retornados
    for (const { node } of results) {
      this.decay.reinforce(node.id);
    }

    if (results.length > 0) this.persistence.markDirty();

    const memories = results.map((r) => r.node);
    return { memories, context: this.formatContext(memories) };
  }

  /**
   * Formata memórias para injeção no prompt do LLM.
   * Formato compacto que o LLM entende facilmente.
   */
  private formatContext(memories: MemoryNode[]): string {
    if (memories.length === 0) return "";

    const WEAK_RELATIONS = new Set(["follows", "same_session"]);

    const lines = memories.map((m) => {
      const tags = m.tags.length > 0 ? ` [${m.tags.join(", ")}]` : "";
      const imp = Math.round(m.importance * 100);

      const connections = this.graph.getConnectedEdges(m.id);
      const related = connections
        .filter((e) => !WEAK_RELATIONS.has(e.relation))
        .map((e) => {
          const otherId = e.source === m.id ? e.target : e.source;
          const other = this.graph.getNode(otherId);
          if (!other || other.tags.includes("topic")) return null;
          return `${e.relation}→"${other.content.slice(0, 40)}"`;
        })
        .filter(Boolean)
        .slice(0, 2);

      const relStr = related.length > 0 ? ` [${related.join("; ")}]` : "";
      return `<memory id="${m.id.slice(0, 8)}" importance="${imp}" tags="${m.tags.join(",")}">${m.content}${relStr}</memory>`;
    });

    return lines.join("\n");
  }

  /**
   * Chamado pelo LLM após processar uma interação.
   * Recebe o que o LLM decidiu que vale guardar.
   * Retorna as memórias criadas para o LLM poder conectá-las.
   */
  autoStore(items: Array<{
    content: string;
    tags?: string[];
    importance?: number;
    relatedTo?: string; // ID de memória existente para conectar
    relation?: string;
  }>): MemoryNode[] {
    const created: MemoryNode[] = [];

    for (const item of items) {
      // verifica se já existe memória similar (evita duplicatas)
      const existing = this.find(item.content, 1);
      if (existing.length > 0) {
        const similarity = this.textSimilarity(item.content, existing[0]!.content);
        if (similarity > 0.8) {
          // reforça a existente em vez de criar nova
          this.decay.reinforce(existing[0]!.id);
          created.push(existing[0]!);
          continue;
        }
      }

      const node = this.create(
        item.content,
        item.tags ?? [],
        item.importance ?? 0.5,
      );

      // conecta automaticamente se especificado
      if (item.relatedTo) {
        this.connect(node.id, item.relatedTo, item.relation ?? "related_to");
      }

      // conecta com memórias similares encontradas
      const similar = this.find(item.content, 3);
      for (const sim of similar) {
        if (sim.id !== node.id) {
          const simScore = this.textSimilarity(item.content, sim.content);
          if (simScore > 0.3) {
            this.connect(node.id, sim.id, "associated", simScore);
          }
        }
      }

      created.push(node);
    }

    return created;
  }

  private textSimilarity(a: string, b: string): number {
    const tokensA = new Set(a.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
    const tokensB = new Set(b.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    let intersection = 0;
    for (const t of tokensA) {
      if (tokensB.has(t)) intersection++;
    }

    return (2 * intersection) / (tokensA.size + tokensB.size);
  }

  // --- Config ---

  async setConfig(updates: Partial<MemoryConfig>): Promise<void> {
    this.config = await updateMemoryConfig(updates);
  }

  getNode(id: string): MemoryNode | null {
    return this.graph.getNode(id) ?? null;
  }
}
