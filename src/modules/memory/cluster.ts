import type { MemoryCluster } from "./types.ts";
import { MemoryGraph } from "./graph.ts";

export class ClusterDetector {
  private graph: MemoryGraph;

  constructor(graph: MemoryGraph) {
    this.graph = graph;
  }

  detect(): MemoryCluster[] {
    const nodes = this.graph.getAllNodes(["active", "fading"]);
    const visited = new Set<string>();
    const clusters: MemoryCluster[] = [];
    let clusterId = 0;

    for (const node of nodes) {
      if (visited.has(node.id)) continue;

      // BFS para encontrar componente conectado
      const component: string[] = [];
      const queue = [node.id];
      visited.add(node.id);

      while (queue.length > 0) {
        const current = queue.shift()!;
        component.push(current);

        for (const neighbor of this.graph.getNeighbors(current, 1)) {
          if (!visited.has(neighbor.id)) {
            visited.add(neighbor.id);
            queue.push(neighbor.id);
          }
        }
      }

      // só cria cluster se tem 2+ membros
      if (component.length < 2) continue;

      // label = memória mais importante do cluster
      let bestNode = this.graph.getNode(component[0]!)!;
      for (const id of component) {
        const n = this.graph.getNode(id);
        if (n && n.importance > bestNode.importance) bestNode = n;
      }

      const avgImportance = component.reduce((sum, id) => {
        return sum + (this.graph.getNode(id)?.importance ?? 0);
      }, 0) / component.length;

      clusters.push({
        id: `cluster-${clusterId++}`,
        label: bestNode.content.slice(0, 80),
        memberIds: component,
        avgImportance,
      });
    }

    return clusters.sort((a, b) => b.avgImportance - a.avgImportance);
  }
}
