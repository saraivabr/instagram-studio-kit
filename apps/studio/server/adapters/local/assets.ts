import "server-only";
import { readFile, mkdir, open, rename, unlink } from "node:fs/promises";
import { join, resolve, relative, isAbsolute, sep } from "node:path";
import sharp from "sharp";
import { formats, studioId, type AssetStore, type Logo } from "@saraivabr/instagram-studio-kit";
import { dataDirectory, tenantDirectory } from "./paths";
import { HttpError } from "../../errors";
async function atomicFile(path: string, bytes: Uint8Array) {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
export const localAssets: AssetStore = {
  async save(tenant, rawId, bytes, options) {
    const id = studioId.parse(rawId);
    const directory = tenantDirectory(tenant);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const [width, height] = formats[options?.format ?? "square"].size.split("x").map(Number);
    const rendered = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .resize(width, height, { fit: "cover" })
      .png()
      .toBuffer();
    await atomicFile(join(/* turbopackIgnore: true */ directory, `${id}.png`), rendered);
    await atomicFile(
      join(directory, `${id}.webp`),
      await sharp(rendered)
        .resize({ width: 320, height: 480, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 75 })
        .toBuffer(),
    );
    return join("assets", directory.split(/[\\/]/).at(-1)!, `${id}.png`);
  },
};
export async function image(
  tenant: string,
  rawId: string,
  thumbnail = false,
  legacyPath?: string | null,
) {
  const id = studioId.parse(rawId);
  const directory = tenantDirectory(tenant);
  try {
    return await readFile(
      join(/* turbopackIgnore: true */ directory, `${id}.${thumbnail ? "webp" : "png"}`),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // Preserve assets migrated from the original local store; never accept arbitrary paths.
    const legacyMatch = /^local\/([a-f0-9-]{36})\.png$/i.exec(legacyPath ?? "");
    const legacy =
      tenant === "local" && legacyMatch?.[1]?.toLowerCase() === id
        ? join(/* turbopackIgnore: true */ dataDirectory, "local", `${legacyMatch[1]}.png`)
        : null;
    let bytes: Buffer;
    try {
      bytes = await readFile(legacy ?? join(/* turbopackIgnore: true */ directory, `${id}.png`));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT")
        throw new HttpError(404, "asset_not_found", "Arquivo não encontrado.");
      throw cause;
    }
    return thumbnail
      ? sharp(bytes)
          .resize({ width: 320, height: 480, fit: "inside" })
          .webp({ quality: 75 })
          .toBuffer()
      : bytes;
  }
}
/** Brand adapter returns a private file path; read only inside the tenant's asset directory. */
export async function loadLogo(tenant: string, path?: string | null): Promise<Logo | undefined> {
  if (!path) return;
  const directory = tenantDirectory(tenant);
  const fullPath = resolve(/* turbopackIgnore: true */ directory, path);
  const localPath = relative(directory, fullPath);
  if (!localPath || localPath === ".." || localPath.startsWith(".." + sep) || isAbsolute(localPath))
    throw new HttpError(400, "invalid_logo", "Caminho de logo inválido.");
  const bytes = await readFile(fullPath);
  const signature = bytes.subarray(0, 8).toString("hex");
  const type =
    signature === "89504e470d0a1a0a"
      ? "image/png"
      : signature.startsWith("ffd8ff")
        ? "image/jpeg"
        : null;
  if (!type || bytes.length > 5_000_000)
    throw new HttpError(400, "invalid_logo", "Logo deve ser PNG/JPG de até 5 MB.");
  return { bytes: new Uint8Array(bytes), type };
}
