import { resolve } from "path";
import type { MemoryNode, MemoryEdge } from "./types.ts";
import { MemoryGraph } from "./graph.ts";

interface GraphData {
  version: number;
  lastSaved: number;
  nodes: MemoryNode[];
  edges: MemoryEdge[];
}

export class MemoryPersistence {
  private filePath: string;
  private dirty = false;

  constructor(dataFile: string, baseDir: string) {
    this.filePath = resolve(baseDir, dataFile);
  }

  async load(graph: MemoryGraph): Promise<void> {
    try {
      const file = Bun.file(this.filePath);
      const data = await file.json() as GraphData;
      graph.deserialize({ nodes: data.nodes, edges: data.edges });
      console.log(`[Memory] Carregado: ${data.nodes.length} memórias, ${data.edges.length} conexões`);
    } catch {
      console.log("[Memory] Grafo novo (nenhum existente).");
    }
  }

  async save(graph: MemoryGraph): Promise<void> {
    if (!this.dirty) return;

    const { nodes, edges } = graph.serialize();
    const data: GraphData = {
      version: 1,
      lastSaved: Date.now(),
      nodes,
      edges,
    };

    // backup simples
    try {
      const bakPath = this.filePath + ".bak";
      const existing = Bun.file(this.filePath);
      if (await existing.exists()) {
        await Bun.write(bakPath, existing);
      }
    } catch { /* ok */ }

    await Bun.write(this.filePath, JSON.stringify(data, null, 2));
    this.dirty = false;
  }

  markDirty(): void {
    this.dirty = true;
  }

  get isDirty(): boolean {
    return this.dirty;
  }
}
