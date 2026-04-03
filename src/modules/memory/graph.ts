import type { MemoryNode, MemoryEdge, MemoryConfig, MemoryStatus } from "./types.ts";

export class MemoryGraph {
  private nodes = new Map<string, MemoryNode>();
  private edges = new Map<string, MemoryEdge>();
  private outgoing = new Map<string, Set<string>>(); // nodeId → edgeIds
  private incoming = new Map<string, Set<string>>(); // nodeId → edgeIds
  private config: MemoryConfig;

  constructor(config: MemoryConfig) {
    this.config = config;
  }

  // --- Nodes ---

  addNode(node: MemoryNode): void {
    this.nodes.set(node.id, node);
    if (!this.outgoing.has(node.id)) this.outgoing.set(node.id, new Set());
    if (!this.incoming.has(node.id)) this.incoming.set(node.id, new Set());
  }

  getNode(id: string): MemoryNode | undefined {
    return this.nodes.get(id);
  }

  updateNode(id: string, updates: Partial<MemoryNode>): MemoryNode | undefined {
    const node = this.nodes.get(id);
    if (!node) return undefined;
    Object.assign(node, updates);
    node.status = this.computeStatus(node.importance);
    return node;
  }

  removeNode(id: string): boolean {
    if (!this.nodes.has(id)) return false;

    // remove todas as arestas conectadas
    const outEdges = this.outgoing.get(id) ?? new Set();
    const inEdges = this.incoming.get(id) ?? new Set();

    for (const edgeId of [...outEdges, ...inEdges]) {
      this.removeEdge(edgeId);
    }

    this.nodes.delete(id);
    this.outgoing.delete(id);
    this.incoming.delete(id);
    return true;
  }

  getAllNodes(includeStatus?: MemoryStatus[]): MemoryNode[] {
    const all = Array.from(this.nodes.values());
    if (!includeStatus) return all;
    return all.filter((n) => includeStatus.includes(n.status));
  }

  // --- Edges ---

  addEdge(edge: MemoryEdge): void {
    if (!this.nodes.has(edge.source) || !this.nodes.has(edge.target)) return;

    // respeita limite de arestas por nó
    const outCount = this.outgoing.get(edge.source)?.size ?? 0;
    if (outCount >= this.config.maxEdgesPerNode) return;

    this.edges.set(edge.id, edge);

    if (!this.outgoing.has(edge.source)) this.outgoing.set(edge.source, new Set());
    this.outgoing.get(edge.source)!.add(edge.id);

    if (!this.incoming.has(edge.target)) this.incoming.set(edge.target, new Set());
    this.incoming.get(edge.target)!.add(edge.id);
  }

  getEdge(id: string): MemoryEdge | undefined {
    return this.edges.get(id);
  }

  removeEdge(id: string): boolean {
    const edge = this.edges.get(id);
    if (!edge) return false;

    this.outgoing.get(edge.source)?.delete(id);
    this.incoming.get(edge.target)?.delete(id);
    this.edges.delete(id);
    return true;
  }

  getEdgesBetween(sourceId: string, targetId: string): MemoryEdge[] {
    const outEdges = this.outgoing.get(sourceId) ?? new Set();
    return [...outEdges]
      .map((eid) => this.edges.get(eid)!)
      .filter((e) => e && e.target === targetId);
  }

  // --- Navegação ---

  getNeighbors(nodeId: string, depth = 1): MemoryNode[] {
    const visited = new Set<string>();
    const queue: Array<{ id: string; d: number }> = [{ id: nodeId, d: 0 }];
    visited.add(nodeId);

    while (queue.length > 0) {
      const { id, d } = queue.shift()!;
      if (d >= depth) continue;

      const outEdges = this.outgoing.get(id) ?? new Set();
      const inEdges = this.incoming.get(id) ?? new Set();

      for (const edgeId of [...outEdges, ...inEdges]) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;
        const neighborId = edge.source === id ? edge.target : edge.source;
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push({ id: neighborId, d: d + 1 });
        }
      }
    }

    visited.delete(nodeId);
    return [...visited].map((id) => this.nodes.get(id)!).filter(Boolean);
  }

  getConnectedEdges(nodeId: string): MemoryEdge[] {
    const outEdges = this.outgoing.get(nodeId) ?? new Set();
    const inEdges = this.incoming.get(nodeId) ?? new Set();
    return [...outEdges, ...inEdges].map((eid) => this.edges.get(eid)!).filter(Boolean);
  }

  // --- Status ---

  computeStatus(importance: number): MemoryStatus {
    if (importance >= this.config.fadeThreshold) return "active";
    if (importance >= this.config.forgetThreshold) return "fading";
    return "forgotten";
  }

  // --- Serialização ---

  serialize(): { nodes: MemoryNode[]; edges: MemoryEdge[] } {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()),
    };
  }

  deserialize(data: { nodes: MemoryNode[]; edges: MemoryEdge[] }): void {
    this.nodes.clear();
    this.edges.clear();
    this.outgoing.clear();
    this.incoming.clear();

    for (const node of data.nodes) this.addNode(node);
    for (const edge of data.edges) this.addEdge(edge);
  }

  get nodeCount(): number { return this.nodes.size; }
  get edgeCount(): number { return this.edges.size; }
}
