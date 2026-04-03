import { MemoryController } from "./src/modules/memory/index.ts";

const memory = new MemoryController();
await memory.init();

console.log("\n=== Criando memórias ===\n");

const m1 = memory.create("usuário mora em São Paulo", ["localização"], 0.8);
const m2 = memory.create("gosta de correr ao ar livre", ["preferência"], 0.7);
const m3 = memory.create("perguntou sobre clima na semana passada", ["contexto"], 0.5);
const m4 = memory.create("trabalha com programação", ["profissão"], 0.7);
const m5 = memory.create("prefere café sem açúcar", ["preferência"], 0.6);
const m6 = memory.create("tem reunião toda segunda feira", ["rotina"], 0.5);
const m7 = memory.create("está desenvolvendo um agente de voz", ["projeto"], 0.8);
const m8 = memory.create("usa TypeScript e Bun", ["tecnologia"], 0.7);

console.log("\n=== Conectando manualmente ===\n");

memory.connect(m2.id, m3.id, "related_to", 0.7);
memory.connect(m1.id, m3.id, "related_to", 0.6);
memory.connect(m7.id, m8.id, "part_of", 0.8);
memory.connect(m4.id, m7.id, "related_to", 0.7);

console.log("\n=== Stats ===\n");
const stats = memory.getStats();
console.log(`Memórias: ${stats.totalNodes} | Conexões: ${stats.totalEdges} | Clusters: ${stats.totalClusters}`);
console.log("Top memórias:");
stats.topMemories.forEach((m) => console.log(`  (${m.importance}) ${m.content}`));

console.log("\n=== Teste autoRecall ===\n");

const tests = [
  "como está o tempo para correr?",
  "que linguagem de programação ele usa?",
  "café",
  "projeto de voz com IA",
  "São Paulo",
  "o que eu faço?",
  "do que você lembra?",
  "me conta sobre mim",
];

for (const input of tests) {
  console.log(`\n>> Input: "${input}"`);
  const result = memory.autoRecall(input, 3);
  if (result.context) {
    console.log(result.context);
  } else {
    console.log("  (nenhuma memória relevante)");
  }
}

console.log("\n=== Teste autoStore ===\n");

const stored = memory.autoStore([
  { content: "usuário quer adicionar reconhecimento de emoções no agente", tags: ["projeto", "feature"], importance: 0.6, relatedTo: m7.id, relation: "part_of" },
  { content: "prefere café sem açúcar", importance: 0.5 }, // duplicata!
]);

console.log(`Armazenadas: ${stored.length} memórias`);
for (const s of stored) {
  console.log(`  "${s.content.slice(0, 60)}" (${s.id.slice(0, 8)}, imp: ${s.importance})`);
}

console.log("\n=== Recall após novas memórias ===\n");

const r2 = memory.autoRecall("emoções no projeto de voz", 5);
console.log(r2.context);

console.log("\n=== Clusters ===\n");

const clusters = memory.listClusters();
for (const c of clusters) {
  console.log(`[${c.id}] "${c.label}" (${c.memberIds.length} membros, avg: ${c.avgImportance.toFixed(2)})`);
}

console.log("\n=== Stats finais ===\n");
const finalStats = memory.getStats();
console.log(`Memórias: ${finalStats.totalNodes} | Conexões: ${finalStats.totalEdges} | Clusters: ${finalStats.totalClusters}`);

await memory.shutdown();
