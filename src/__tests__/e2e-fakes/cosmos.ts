// Build-time substitute for features/common/services/cosmos.ts.
// Loaded via next.config.js webpack alias when AZURECHAT_TEST_BACKEND=memory.
// Provides the same exports backed by in-memory maps so e2e specs can run
// against a Next.js dev server without a real Cosmos endpoint.

type Doc = Record<string, any> & { id?: string };

// Minimal Cosmos SQL filter for the in-memory fake. We honour TOP-LEVEL
// `r.field=@param` equality clauses joined by AND. Anything inside parentheses
// (the `(r.isPublished=@x OR r.userId=@y OR ...)` patterns used for persona
// access checks) is intentionally NOT enforced — over-collection in those
// disjuncts is safer than wrongly excluding rows. The dominant must-enforce
// filters (type, userId, threadId, isDeleted) all live at the top level.
function applyEqualityFilters(docs: Doc[], spec: any): Doc[] {
  if (!spec || typeof spec.query !== "string") return [...docs];
  const params: Array<{ name: string; value: any }> = spec.parameters ?? [];
  const paramMap: Record<string, any> = {};
  for (const p of params) {
    const key = p.name.startsWith("@") ? p.name : `@${p.name}`;
    paramMap[key] = p.value;
  }
  const wherePart = (spec.query.split(/\bWHERE\b/i)[1] ?? "").split(/\bORDER\s+BY\b/i)[0] ?? "";
  // Strip everything inside (...) so OR-disjuncts and IS_DEFINED clauses don't
  // get pulled into the AND chain.
  let stripped = "";
  let depth = 0;
  for (const ch of wherePart) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0) stripped += ch;
  }
  const filters: Array<{ field: string; value: any }> = [];
  for (const clause of stripped.split(/\bAND\b/i)) {
    const m = clause.match(/\br\.(\w+)\s*=\s*(@\w+)/);
    if (!m) continue;
    if (!(m[2] in paramMap)) continue;
    filters.push({ field: m[1], value: paramMap[m[2]] });
  }
  if (filters.length === 0) return [...docs];
  return docs.filter((doc) => filters.every((f) => doc[f.field] === f.value));
}

class InMemoryContainer {
  private docs: Doc[] = [];

  constructor(seed: Doc[] = []) {
    this.docs = [...seed];
  }

  item(id: string, _partitionKey?: string) {
    const find = () => this.docs.findIndex((d) => d.id === id);
    return {
      read: async () => ({ resource: this.docs[find()] ?? undefined }),
      patch: async (ops: Array<{ op: string; path: string; value?: any }>) => {
        const idx = find();
        if (idx === -1) throw Object.assign(new Error("Not found"), { code: 404 });
        for (const op of ops) {
          const key = op.path.replace(/^\//, "");
          if (op.op === "set" || op.op === "replace" || op.op === "add") {
            this.docs[idx][key] = op.value;
          } else if (op.op === "remove") {
            delete this.docs[idx][key];
          } else if (op.op === "incr") {
            const current = this.docs[idx][key];
            this.docs[idx][key] =
              (typeof current === "number" ? current : 0) + (op.value ?? 0);
          }
        }
        return { resource: this.docs[idx] };
      },
      delete: async () => {
        const idx = find();
        if (idx >= 0) this.docs.splice(idx, 1);
        return { resource: undefined };
      },
    };
  }

  items = {
    create: async (doc: Doc) => {
      const stored = { ...doc, id: doc.id ?? `id-${this.docs.length + 1}` };
      this.docs.push(stored);
      return { resource: stored };
    },
    upsert: async (doc: Doc) => {
      const idx = this.docs.findIndex((d) => d.id === doc.id);
      if (idx >= 0) this.docs[idx] = doc;
      else this.docs.push(doc);
      return { resource: doc };
    },
    query: (spec: any) => {
      const filtered = applyEqualityFilters(this.docs, spec);
      return {
        fetchAll: async () => ({ resources: filtered }),
        fetchNext: async () => ({ resources: filtered, hasMoreResults: false }),
      };
    },
  };

  _all() {
    return this.docs;
  }
}

const containers = new Map<string, InMemoryContainer>();

function getContainer(name: string): InMemoryContainer {
  let c = containers.get(name);
  if (!c) {
    c = new InMemoryContainer();
    containers.set(name, c);
  }
  return c;
}

const fakeClient = {
  database: (_dbName: string) => ({
    container: (name: string) => getContainer(name),
  }),
};

export const CosmosInstance = () => fakeClient as any;

const DB_NAME = process.env.AZURE_COSMOSDB_DB_NAME || "chat";
const CONTAINER_NAME = process.env.AZURE_COSMOSDB_CONTAINER_NAME || "history";
const CONFIG_CONTAINER_NAME = process.env.AZURE_COSMOSDB_CONFIG_CONTAINER_NAME || "config";

export const HistoryContainer = () => CosmosInstance().database(DB_NAME).container(CONTAINER_NAME);
export const ConfigContainer = () => CosmosInstance().database(DB_NAME).container(CONFIG_CONTAINER_NAME);
