import "server-only";
import type { Publication } from "@saraivabr/instagram-studio-kit";
import { database } from "./repository";
import { HttpError } from "../../errors";

export type StoredPublication = Publication & {
  scope: string;
  profile_id: string;
  owner_pid?: number;
};
function db() {
  const connection = database();
  connection.exec(`
    CREATE TABLE IF NOT EXISTS instagram_profiles(tenant TEXT NOT NULL, scope TEXT NOT NULL, profile_id TEXT NOT NULL, PRIMARY KEY(tenant,scope));
    CREATE TABLE IF NOT EXISTS instagram_publications(tenant TEXT NOT NULL,id TEXT NOT NULL,scope TEXT NOT NULL,profile_id TEXT NOT NULL,status TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(tenant,id));
  `);
  return connection;
}
export function savedProfile(tenant: string, scope: string) {
  return (
    db()
      .prepare("SELECT profile_id FROM instagram_profiles WHERE tenant=? AND scope=?")
      .get(tenant, scope) as { profile_id: string } | undefined
  )?.profile_id;
}
export function saveProfile(tenant: string, scope: string, profile: string) {
  db()
    .prepare(
      "INSERT INTO instagram_profiles VALUES(?,?,?) ON CONFLICT(tenant,scope) DO UPDATE SET profile_id=excluded.profile_id",
    )
    .run(tenant, scope, profile);
}
export function publications(tenant: string): StoredPublication[] {
  return (
    db()
      .prepare(
        "SELECT value FROM instagram_publications WHERE tenant=? ORDER BY rowid DESC LIMIT 50",
      )
      .all(tenant) as { value: string }[]
  ).map((row) => JSON.parse(row.value) as StoredPublication);
}
export function publication(tenant: string, id: string): StoredPublication | undefined {
  const row = db()
    .prepare("SELECT value FROM instagram_publications WHERE tenant=? AND id=?")
    .get(tenant, id) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as StoredPublication) : undefined;
}
export function reservePublication(tenant: string, entry: StoredPublication) {
  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    if (
      connection
        .prepare("SELECT id FROM instagram_publications WHERE tenant=? AND id=?")
        .get(tenant, entry.id)
    )
      throw new HttpError(
        409,
        "publication_exists",
        "Este envio já existe. Atualize o resultado; não repita a publicação.",
      );
    const unresolved = connection
      .prepare(
        "SELECT value FROM instagram_publications WHERE tenant=? AND status IN ('preparing','sending','pending','uncertain')",
      )
      .all(tenant) as { value: string }[];
    if (
      unresolved.some((row) => {
        const old = JSON.parse(row.value) as StoredPublication;
        return (
          old.account_id === entry.account_id &&
          old.item_ids.some((id) => entry.item_ids.includes(id))
        );
      })
    )
      throw new HttpError(
        409,
        "publication_unresolved",
        "Há um envio destas imagens aguardando confirmação. Atualize o resultado antes de tentar novamente.",
      );
    connection
      .prepare("INSERT INTO instagram_publications VALUES(?,?,?,?,?,?)")
      .run(tenant, entry.id, entry.scope, entry.profile_id, entry.status, JSON.stringify(entry));
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}
export function updatePublication(
  tenant: string,
  entry: StoredPublication,
  expectedStatus?: Publication["status"],
) {
  const values = [entry.status, JSON.stringify(entry), tenant, entry.id];
  if (expectedStatus) values.push(expectedStatus);
  return (
    db()
      .prepare(
        `UPDATE instagram_publications SET status=?,value=? WHERE tenant=? AND id=?${expectedStatus ? " AND status=?" : ""}`,
      )
      .run(...values).changes > 0
  );
}
