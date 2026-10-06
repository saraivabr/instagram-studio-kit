/** Demonstration only: process-local, not durable and not suitable for multi-instance deployment. */
export function memoryRepository() {
  const records = new Map();
  return {
    async claim(tenant, input) {
      const key = JSON.stringify([tenant, input.id]);
      if (records.has(key)) return { created: false, item: structuredClone(records.get(key)) };
      const now = new Date().toISOString();
      const item = {
        id: input.id,
        kind: input.kind,
        input,
        status: "generating",
        caption: "",
        answer: "",
        sources: [],
        asset_path: null,
        error: null,
        created_at: now,
        updated_at: now,
      };
      records.set(key, item);
      return { created: true, item: structuredClone(item) };
    },
    async complete(tenant, id, changes) {
      const key = JSON.stringify([tenant, id]);
      if (!records.has(key)) throw new Error("Item não encontrado nesta organização.");
      const item = {
        ...records.get(key),
        ...changes,
        updated_at: new Date().toISOString(),
      };
      records.set(key, item);
      return structuredClone(item);
    },
  };
}
