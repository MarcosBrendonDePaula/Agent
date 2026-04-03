export type MemoryStatus = "active" | "fading" | "forgotten";

export interface MemoryNode {
  id: string;
  content: string;
  tags: string[];
  importance: number;
  initialImportance: number;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  metadata: Record<string, unknown>;
  status: MemoryStatus;
}

export interface MemoryEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  weight: number;
  createdAt: number;
  metadata: Record<string, unknown>;
}

export interface MemoryCluster {
  id: string;
  label: string;
  memberIds: string[];
  avgImportance: number;
}

export interface MemoryStats {
  totalNodes: number;
  activeNodes: number;
  fadingNodes: number;
  forgottenNodes: number;
  totalEdges: number;
  totalClusters: number;
  avgImportance: number;
  topMemories: Array<{ id: string; content: string; importance: number }>;
}

export interface MemoryConfig {
  dataFile: string;
  decayRate: number;
  reinforcementBoost: number;
  propagationFactor: number;
  fadeThreshold: number;
  forgetThreshold: number;
  maxNodes: number;
  maxEdgesPerNode: number;
  autoSaveIntervalMs: number;
  searchResultsLimit: number;
  recencyBoostFactor: number;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  dataFile: "data/memory-graph.json",
  decayRate: 0.01,
  reinforcementBoost: 0.15,
  propagationFactor: 0.3,
  fadeThreshold: 0.3,
  forgetThreshold: 0.05,
  maxNodes: 10000,
  maxEdgesPerNode: 50,
  autoSaveIntervalMs: 30000,
  searchResultsLimit: 20,
  recencyBoostFactor: 0.1,
};
