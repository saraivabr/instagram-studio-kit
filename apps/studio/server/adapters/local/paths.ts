import "server-only";
import { join } from "node:path";
export const dataDirectory = join(process.cwd(), ".studio-data");
