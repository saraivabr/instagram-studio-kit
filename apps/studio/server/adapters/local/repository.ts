import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createSchema,
  type StudioItem,
  type StudioInput,
  type StudioReadRepository,
  type StudioListQuery,
} from "@saraivabr/instagram-studio-kit";
import { dataDirectory } from "./paths";
import { HttpError } from "../../errors";
type Row = { value: string };
export type JobContext = { name: string; accent?: string | null; logoPath?: string | null };
export type Job = { id: string; tenant: string; item_id: string; context: JobContext };
const state = globalThis as typeof globalThis & { studioDb?: DatabaseSync };
function transaction<T>(db: DatabaseSync, run: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = run();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function database() {
  if (state.studioDb) return state.studioDb;
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(dataDirectory, "studio.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS items(tenant TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,carousel_id TEXT,created_at TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0,value TEXT NOT NULL,PRIMARY KEY(tenant,id));
    CREATE INDEX IF NOT EXISTS items_page ON items(tenant,archived,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS items_filter ON items(tenant,archived,kind,status,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS items_carousel ON items(tenant,archived,carousel_id);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,item_id TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',context TEXT NOT NULL,created_at TEXT NOT NULL,started_at TEXT,cost REAL NOT NULL DEFAULT 0,UNIQUE(tenant,item_id));
    CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(state,created_at);
    CREATE TABLE IF NOT EXISTS brands(tenant TEXT PRIMARY KEY,description TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
  `);
  try {
    if (
      !(db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]).some(
        (column) => column.name === "cost",
      )
    )
      db.exec("ALTER TABLE jobs ADD COLUMN cost REAL NOT NULL DEFAULT 0");
    if (!db.prepare("SELECT value FROM metadata WHERE key='json_migrated'").get()) {
      const path = join(dataDirectory, "items.json");
      // Validate the entire legacy file before changing the database. Never discard corrupt data.
      const legacy = existsSync(path)
        ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, StudioItem>)
        : {};
      if (!legacy || Array.isArray(legacy) || typeof legacy !== "object")
        throw new Error("Invalid legacy store");
      const entries = Object.entries(legacy).map(([key, item]) => {
        const pair: unknown = JSON.parse(key);
        if (
          !Array.isArray(pair) ||
          pair.length !== 2 ||
          typeof pair[0] !== "string" ||
          !pair[0] ||
          typeof item !== "object" ||
          !item
        )
          throw new Error("Invalid legacy record");
        const input = createSchema.parse(item.input);
        if (
          String(pair[1]).toLowerCase() !== input.id ||
          item.id.toLowerCase() !== input.id ||
          item.kind !== input.kind ||
          !["ready", "generating", "failed"].includes(item.status) ||
          !Number.isFinite(Date.parse(item.created_at))
        )
          throw new Error("Invalid legacy item");
        return [
          pair[0],
          {
            ...item,
            id: input.id,
            input,
            ...(item.status === "generating"
              ? {
                  status: "failed" as const,
                  error:
                    "Geração interrompida antes da migração. Confira o histórico antes de tentar novamente.",
                }
              : {}),
          },
        ] as const;
      });
      if (existsSync(path)) copyFileSync(path, join(dataDirectory, "items.pre-sqlite.json"));
      transaction(db, () => {
        for (const [tenant, item] of entries) insert(db, tenant, item);
        db.prepare("INSERT INTO metadata VALUES('json_migrated','1')").run();
      });
    }
    state.studioDb = db;
    return db;
  } catch (error) {
    db.close();
    throw new Error(
      "Não foi possível abrir o armazenamento local. Preserve os arquivos para recuperação.",
      { cause: error },
    );
  }
}
function insert(db: DatabaseSync, tenant: string, item: StudioItem) {
  db.prepare(
    "INSERT OR IGNORE INTO items(tenant,id,kind,status,carousel_id,created_at,value) VALUES(?,?,?,?,?,?,?)",
  ).run(
    tenant,
    item.id,
    item.kind,
    item.status,
    item.input.kind === "post" ? (item.input.carousel?.id ?? null) : null,
    item.created_at,
    JSON.stringify(item),
  );
}
function lookup(db: DatabaseSync, tenant: string, id: string, includeArchived = false) {
  const row = db
    .prepare(
      `SELECT value FROM items WHERE tenant=? AND id=?${includeArchived ? "" : " AND archived=0"}`,
    )
    .get(tenant, id.toLowerCase()) as Row | undefined;
  return row ? (JSON.parse(row.value) as StudioItem) : undefined;
}
function newItem(input: StudioInput): StudioItem {
  const now = new Date().toISOString();
  return {
    id: input.id,
    kind: input.kind,
    input,
    status: input.kind === "reference" ? "ready" : "generating",
    caption: "",
    answer: "",
    sources: [],
    asset_path: null,
    error: null,
    created_at: now,
    updated_at: now,
  };
}
function complete(db: DatabaseSync, tenant: string, id: string, changes: Partial<StudioItem>) {
  const current = lookup(db, tenant, id);
  if (!current) throw new HttpError(404, "item_not_found", "Item não encontrado.");
  const item = {
    ...current,
    ...changes,
    id: current.id,
    input: current.input,
    kind: current.kind,
    created_at: current.created_at,
    updated_at: new Date().toISOString(),
  };
  db.prepare("UPDATE items SET status=?,value=? WHERE tenant=? AND id=?").run(
    item.status,
    JSON.stringify(item),
    tenant,
    current.id,
  );
  return item;
}
export const repository: StudioReadRepository = {
  async claim(tenant, input) {
    const db = database();
    return transaction(db, () => {
      const existing = lookup(db, tenant, input.id, true);
      if (existing) return { created: false, item: existing };
      const item = newItem(input);
      insert(db, tenant, item);
      return { created: true, item };
    });
  },
  async complete(tenant, id, changes) {
    return complete(database(), tenant, id, changes);
  },
  async get(tenant, id) {
    return lookup(database(), tenant, id);
  },
  async list(tenant, query: StudioListQuery = {}) {
    const db = database();
    const clauses = ["tenant=?", "archived=0"];
    const values: (string | number)[] = [tenant];
    for (const field of ["kind", "status", "carousel_id"] as const)
      if (query[field]) {
        clauses.push(`${field}=?`);
        values.push(query[field]!);
      }
    const where = clauses.join(" AND ");
    const total = (
      db.prepare(`SELECT COUNT(*) AS n FROM items WHERE ${where}`).get(...values) as { n: number }
    ).n;
    if (query.cursor) {
      let cursor: unknown;
      try {
        cursor = JSON.parse(Buffer.from(query.cursor, "base64url").toString());
      } catch {
        throw new HttpError(400, "invalid_cursor", "Cursor de paginação inválido.");
      }
      if (
        !Array.isArray(cursor) ||
        cursor.length !== 2 ||
        !cursor.every((v) => typeof v === "string") ||
        !Number.isFinite(Date.parse(cursor[0]))
      )
        throw new HttpError(400, "invalid_cursor", "Cursor de paginação inválido.");
      clauses.push("(created_at<? OR (created_at=? AND id<?))");
      values.push(cursor[0], cursor[0], cursor[1]);
    }
    const limit = Math.min(100, Math.max(1, query.limit ?? 24));
    const rows = db
      .prepare(
        `SELECT value FROM items WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC,id DESC LIMIT ?`,
      )
      .all(...values, limit + 1) as Row[];
    const has_more = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => JSON.parse(row.value) as StudioItem);
    const last = items.at(-1);
    return {
      items,
      meta: {
        total,
        has_more,
        cursor:
          has_more && last
            ? Buffer.from(JSON.stringify([last.created_at, last.id])).toString("base64url")
            : null,
      },
    };
  },
  async updateCaption(tenant, id, caption) {
    const db = database();
    return transaction(db, () => {
      const item = lookup(db, tenant, id);
      if (!item) throw new HttpError(404, "item_not_found", "Item não encontrado.");
      if (item.kind !== "post" || item.status !== "ready")
        throw new HttpError(
          409,
          "item_not_editable",
          "Somente posts prontos permitem editar a legenda.",
        );
      return complete(db, tenant, id, { caption });
    });
  },
  async archive(tenant, id) {
    const db = database();
    return transaction(db, () => {
      const item = lookup(db, tenant, id);
      if (!item) throw new HttpError(404, "item_not_found", "Item não encontrado.");
      if (item.status === "generating")
        throw new HttpError(409, "item_busy", "Aguarde a geração terminar antes de remover.");
      db.prepare("UPDATE items SET archived=1 WHERE tenant=? AND id=?").run(tenant, item.id);
      return true;
    });
  },
};
/** Persist all intent, quota and queue entries in one transaction before any provider call. */
export function enqueue(
  tenant: string,
  inputs: StudioInput[],
  context: JobContext,
  replaceId?: string,
) {
  const db = database();
  return transaction(db, () => {
    if (replaceId) {
      const previous = lookup(db, tenant, replaceId);
      if (!previous || previous.status !== "failed")
        throw new HttpError(
          409,
          "retry_not_allowed",
          "Somente pedidos interrompidos podem ser tentados novamente.",
        );
    }
    const existing = inputs.map((input) => lookup(db, tenant, input.id, true));
    const pending = inputs.filter((input, index) => !existing[index] && input.kind !== "reference");
    const configuredLimit = Number(process.env.STUDIO_DAILY_GENERATION_LIMIT || "20");
    const limit =
      Number.isSafeInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 20;
    const used = (
      db
        .prepare("SELECT COUNT(*) AS n FROM jobs WHERE tenant=? AND created_at>=?")
        .get(tenant, new Date().toISOString().slice(0, 10)) as { n: number }
    ).n;
    if (pending.length && used + pending.length > limit)
      throw new HttpError(
        429,
        "generation_limit",
        `Limite diário de ${limit} gerações por organização atingido.`,
      );
    const estimate = Number(process.env.STUDIO_ESTIMATED_GENERATION_COST_USD || "0");
    const budget = Number(process.env.STUDIO_DAILY_BUDGET_USD || "0");
    if (
      pending.length &&
      (!Number.isFinite(estimate) ||
        estimate < 0 ||
        !Number.isFinite(budget) ||
        budget < 0 ||
        (budget > 0 && estimate <= 0))
    )
      throw new HttpError(
        503,
        "budget_configuration",
        "Configure um custo estimado positivo para limitar o orçamento de geração.",
      );
    const spent = (
      db
        .prepare("SELECT COALESCE(SUM(cost),0) AS n FROM jobs WHERE tenant=? AND created_at>=?")
        .get(tenant, new Date().toISOString().slice(0, 10)) as { n: number }
    ).n;
    if (pending.length && budget > 0 && spent + pending.length * estimate > budget + 0.000001)
      throw new HttpError(
        429,
        "generation_budget",
        "Orçamento diário reservado para esta organização atingido.",
      );
    // A carousel submission may be replayed, but cannot replace its slide IDs implicitly.
    const group = inputs.length === 8 && inputs[0]?.kind === "post" ? inputs[0].carousel?.id : null;
    if (
      group &&
      db
        .prepare("SELECT id FROM items WHERE tenant=? AND carousel_id=? AND archived=0")
        .all(tenant, group)
        .some((row) => !inputs.some((input) => input.id === row.id))
    )
      throw new HttpError(
        409,
        "carousel_conflict",
        "Este carrossel já foi registrado com outros slides.",
      );
    const now = new Date().toISOString();
    const result = inputs.map((input, index) => {
      if (existing[index]) return existing[index]!;
      const item = newItem(input);
      insert(db, tenant, item);
      if (input.kind !== "reference")
        db.prepare(
          "INSERT INTO jobs(id,tenant,item_id,context,created_at,cost) VALUES(?,?,?,?,?,?)",
        ).run(randomUUID(), tenant, item.id, JSON.stringify(context), now, estimate);
      if (input.kind === "post")
        db.prepare(
          "INSERT INTO brands(tenant,description) VALUES(?,?) ON CONFLICT(tenant) DO UPDATE SET description=excluded.description",
        ).run(tenant, input.niche);
      return item;
    });
    if (replaceId)
      db.prepare("UPDATE items SET archived=1 WHERE tenant=? AND id=?").run(tenant, replaceId);
    return result;
  });
}
export function claimJob(): Job | undefined {
  const db = database();
  return transaction(db, () => {
    const stale = db
      .prepare("SELECT tenant,item_id FROM jobs WHERE state='running' AND started_at<?")
      .all(new Date(Date.now() - 10 * 60_000).toISOString()) as {
      tenant: string;
      item_id: string;
    }[];
    for (const job of stale) {
      const item = lookup(db, job.tenant, job.item_id);
      if (item?.status === "generating")
        complete(db, job.tenant, job.item_id, {
          status: "failed",
          error:
            "Geração interrompida. Confira o provedor antes de tentar novamente; a chamada pode ter sido cobrada.",
        });
      db.prepare("UPDATE jobs SET state='failed' WHERE tenant=? AND item_id=?").run(
        job.tenant,
        job.item_id,
      );
    }
    if (db.prepare("SELECT id FROM jobs WHERE state='running' LIMIT 1").get()) return;
    const row = db
      .prepare(
        "SELECT id,tenant,item_id,context FROM jobs WHERE state='queued' ORDER BY created_at,rowid LIMIT 1",
      )
      .get() as { id: string; tenant: string; item_id: string; context: string } | undefined;
    if (!row) return;
    db.prepare("UPDATE jobs SET state='running',started_at=? WHERE id=? AND state='queued'").run(
      new Date().toISOString(),
      row.id,
    );
    return { ...row, context: JSON.parse(row.context) as JobContext };
  });
}
export function finishJob(id: string, success: boolean) {
  database()
    .prepare("UPDATE jobs SET state=? WHERE id=?")
    .run(success ? "completed" : "failed", id);
}
export function storedDescription(tenant: string): string | undefined {
  return (
    database().prepare("SELECT description FROM brands WHERE tenant=?").get(tenant) as
      { description: string } | undefined
  )?.description;
}
