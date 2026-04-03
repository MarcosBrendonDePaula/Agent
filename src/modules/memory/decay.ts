import type { MemoryConfig } from "./types.ts";
import { MemoryGraph } from "./graph.ts";

export class DecayEngine {
  private config: MemoryConfig;
  private graph: MemoryGraph;

  constructor(config: MemoryConfig, graph: MemoryGraph) {
    this.config = config;
    this.graph = graph;
  }

  // aplica decaimento em todas as memórias
  tick(): { decayed: number; forgotten: number } {
    const now = Date.now();
    let decayed = 0;
    let forgotten = 0;

    for (const node of this.graph.getAllNodes(["active", "fading"])) {
      const hoursSince = (now - node.lastAccessedAt) / (1000 * 60 * 60);
      if (hoursSince < 0.01) continue; // menos de ~36s, ignora

      const newImportance = node.importance * Math.exp(-this.config.decayRate * hoursSince);
      const newStatus = this.graph.computeStatus(newImportance);

      if (newImportance !== node.importance) {
        this.graph.updateNode(node.id, { importance: newImportance });
        decayed++;
        if (newStatus === "forgotten") forgotten++;
      }
    }

    // decai arestas de nós fracos
    for (const node of this.graph.getAllNodes()) {
      for (const edge of this.graph.getConnectedEdges(node.id)) {
        const source = this.graph.getNode(edge.source);
        const target = this.graph.getNode(edge.target);
        if (!source || !target) continue;

        const minImportance = Math.min(source.importance, target.importance);
        if (minImportance < this.config.fadeThreshold && edge.weight > minImportance) {
          edge.weight = Math.max(0.01, edge.weight * 0.95);
        }
      }
    }

    return { decayed, forgotten };
  }

  // reforça memória quando acessada
  reinforce(nodeId: string): void {
    const node = this.graph.getNode(nodeId);
    if (!node) return;

    const boost = this.config.reinforcementBoost;
    const newImportance = Math.min(1.0, node.importance + boost * (1 - node.importance));

    this.graph.updateNode(nodeId, {
      importance: newImportance,
      lastAccessedAt: Date.now(),
      accessCount: node.accessCount + 1,
    });

    // propaga reforço para vizinhos
    this.propagate(nodeId);
  }

  // reforço manual com quantidade específica
  strengthen(nodeId: string, amount: number): void {
    const node = this.graph.getNode(nodeId);
    if (!node) return;

    const newImportance = Math.min(1.0, node.importance + amount * (1 - node.importance));
    this.graph.updateNode(nodeId, { importance: newImportance });
  }

  private propagate(nodeId: string): void {
    const factor = this.config.propagationFactor;
    const boost = this.config.reinforcementBoost;

    for (const edge of this.graph.getConnectedEdges(nodeId)) {
      const neighborId = edge.source === nodeId ? edge.target : edge.source;
      const neighbor = this.graph.getNode(neighborId);
      if (!neighbor) continue;

      const neighborBoost = boost * edge.weight * factor;
      const newImportance = Math.min(1.0, neighbor.importance + neighborBoost * (1 - neighbor.importance));

      this.graph.updateNode(neighborId, {
        importance: newImportance,
        lastAccessedAt: Date.now(),
      });
    }
  }
}
