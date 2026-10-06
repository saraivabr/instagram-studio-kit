import "server-only";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
export const dataDirectory = resolve(
  /* turbopackIgnore: true */
  process.env.STUDIO_DATA_DIR || join(process.cwd(), ".studio-data"),
);
/** Hash authenticated tenant IDs so an adapter cannot introduce filesystem traversal. */
export const tenantDirectory = (tenant: string) =>
  join(dataDirectory, "assets", createHash("sha256").update(tenant).digest("hex"));
