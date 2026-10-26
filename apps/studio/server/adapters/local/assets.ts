import "server-only";
import { readFile, readdir, mkdir, open, rename, unlink } from "node:fs/promises";
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
/**
 * Apply the original logo in the bottom-right corner, inside the 8% safe area the prompt reserves.
 * The file is only scaled; its letters and colors are never redrawn by the AI.
 */
export async function stampLogo(art: Buffer, logo: Logo, width: number, height: number) {
  const marginX = Math.round(width * 0.08);
  const marginY = Math.round(height * 0.08);
  const padding = Math.max(8, Math.round(width * 0.012));
  const mark = await sharp(Buffer.from(logo.bytes), { limitInputPixels: 40_000_000 })
    .resize({
      width: Math.round(width * 0.24),
      height: Math.round(height * 0.1),
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  const plateWidth = mark.info.width + padding * 2;
  const plateHeight = mark.info.height + padding * 2;
  const left = Math.max(0, width - marginX - plateWidth);
  const top = Math.max(0, height - marginY - plateHeight);
  const plate = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${plateWidth}" height="${plateHeight}"><rect width="100%" height="100%" rx="${padding}" fill="#ffffff" fill-opacity="0.92"/></svg>`,
  );
  return sharp(art)
    .composite([
      { input: plate, left, top },
      { input: mark.data, left: left + padding, top: top + padding },
    ])
    .png()
    .toBuffer();
}
export const localAssets: AssetStore = {
  async save(tenant, rawId, bytes, options) {
    const id = studioId.parse(rawId);
    const directory = tenantDirectory(tenant);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const [width, height] = formats[options?.format ?? "square"].size.split("x").map(Number);
    let rendered = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .resize(width, height, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();
    if (options?.logo) rendered = await stampLogo(rendered, options.logo, width!, height!);
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
  let bytes: Buffer;
  try {
    bytes = await readFile(fullPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new HttpError(
        400,
        "invalid_logo",
        "O logo cadastrado não foi encontrado. Envie-o novamente em Minha marca.",
      );
    throw error;
  }
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
const logoFile = /^brand-logo-[a-f0-9-]{36}\.(png|jpg)$/;
/** Validate (PNG/JPG, 5 MB), normalize and store a private logo; returns its relative file name. */
export async function saveBrandLogo(tenant: string, bytes: Uint8Array) {
  if (!bytes.length || bytes.length > 5_000_000)
    throw new HttpError(400, "invalid_logo", "Logo deve ser PNG ou JPG de até 5 MB.");
  const signature = Buffer.from(bytes.subarray(0, 8)).toString("hex");
  const png = signature === "89504e470d0a1a0a";
  const jpeg = signature.startsWith("ffd8ff");
  if (!png && !jpeg)
    throw new HttpError(
      400,
      "invalid_logo",
      "Formato não aceito. Envie o logo em PNG ou JPG; SVG, PDF e WebP não são aceitos.",
    );
  let normalized: Buffer;
  try {
    // sharp drops metadata by default; only the largest side is limited and alpha is kept.
    const pipeline = sharp(Buffer.from(bytes), { limitInputPixels: 40_000_000 }).resize({
      width: 1024,
      height: 1024,
      fit: "inside",
      withoutEnlargement: true,
    });
    normalized = await (png ? pipeline.png() : pipeline.jpeg({ quality: 92 })).toBuffer();
  } catch {
    throw new HttpError(
      400,
      "invalid_logo",
      "Não foi possível ler essa imagem. Ela pode estar corrompida.",
    );
  }
  const directory = tenantDirectory(tenant);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const name = `brand-logo-${crypto.randomUUID()}.${png ? "png" : "jpg"}`;
  await atomicFile(join(/* turbopackIgnore: true */ directory, name), normalized);
  return name;
}
const logoLocks = new Map<string, Promise<unknown>>();
/**
 * Serialize logo replacement and pruning per tenant. Without it, a prune that computed its keep
 * set before an upload finished could delete the logo that was just saved.
 */
export function withBrandLogoLock<T>(tenant: string, task: () => Promise<T>): Promise<T> {
  const run = (logoLocks.get(tenant) ?? Promise.resolve()).catch(() => {}).then(task);
  const tail = run.catch(() => {});
  logoLocks.set(tenant, tail);
  void tail.then(() => {
    if (logoLocks.get(tenant) === tail) logoLocks.delete(tenant);
  });
  return run;
}
/**
 * Remove logo files no current brand or queued job needs. Never touches generated art.
 * Call inside withBrandLogoLock, computing `keep` within the same lock.
 */
export async function pruneBrandLogos(tenant: string, keep: Set<string>) {
  if (keep.has("*")) return;
  const directory = tenantDirectory(tenant);
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => logoFile.test(name) && !keep.has(name))
      .map((name) => unlink(join(/* turbopackIgnore: true */ directory, name)).catch(() => {})),
  );
}
const personFile = /^person-[a-f0-9-]{36}-[a-f0-9-]{36}\.jpg$/;
const personPhotoLimit = 5_000_000;
/**
 * Validate (PNG/JPG, 5 MB) and store one face photo privately. EXIF orientation is applied and
 * every metadata block (GPS, camera, dates) is dropped; the largest side is limited to 1024 px.
 */
export async function savePersonPhoto(tenant: string, personId: string, bytes: Uint8Array) {
  if (!bytes.length || bytes.length > personPhotoLimit)
    throw new HttpError(400, "invalid_photo", "Cada foto deve ser PNG ou JPG de até 5 MB.");
  const signature = Buffer.from(bytes.subarray(0, 8)).toString("hex");
  if (signature !== "89504e470d0a1a0a" && !signature.startsWith("ffd8ff"))
    throw new HttpError(
      400,
      "invalid_photo",
      "Formato não aceito. Envie fotos em PNG ou JPG; HEIC, WebP, SVG e PDF não são aceitos.",
    );
  let normalized: Buffer;
  try {
    normalized = await sharp(Buffer.from(bytes), { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    throw new HttpError(
      400,
      "invalid_photo",
      "Não foi possível ler uma das fotos. Ela pode estar corrompida.",
    );
  }
  const directory = tenantDirectory(tenant);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const name = `person-${studioId.parse(personId)}-${crypto.randomUUID()}.jpg`;
  await atomicFile(join(/* turbopackIgnore: true */ directory, name), normalized);
  return name;
}
/** Read the photos of a registered person; a missing file means the person was removed. */
export async function loadPersonPhotos(tenant: string, names: string[]): Promise<Logo[]> {
  const directory = tenantDirectory(tenant);
  return Promise.all(
    names.map(async (name) => {
      if (!personFile.test(name))
        throw new HttpError(400, "invalid_photo", "Foto de pessoa inválida.");
      try {
        const bytes = await readFile(join(/* turbopackIgnore: true */ directory, name));
        return { bytes: new Uint8Array(bytes), type: "image/jpeg" as const };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          throw new HttpError(
            409,
            "person_removed",
            "As fotos desta pessoa foram removidas da marca. Nenhuma arte foi gerada com elas.",
          );
        throw error;
      }
    }),
  );
}
export async function readPersonPhoto(tenant: string, name: string) {
  if (!personFile.test(name)) throw new HttpError(404, "photo_not_found", "Foto não encontrada.");
  try {
    return await readFile(join(/* turbopackIgnore: true */ tenantDirectory(tenant), name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new HttpError(404, "photo_not_found", "Foto não encontrada.");
    throw error;
  }
}
/** Delete photo files immediately; removal is how a person withdraws consent. */
export async function deletePersonPhotos(tenant: string, names: string[]) {
  const directory = tenantDirectory(tenant);
  await Promise.all(
    names
      .filter((name) => personFile.test(name))
      .map((name) =>
        unlink(join(/* turbopackIgnore: true */ directory, name)).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }),
      ),
  );
}
export async function readBrandLogo(tenant: string, path: string) {
  if (!logoFile.test(path)) throw new HttpError(404, "logo_not_found", "Logo não encontrado.");
  try {
    const bytes = await readFile(join(/* turbopackIgnore: true */ tenantDirectory(tenant), path));
    return { bytes, type: path.endsWith(".png") ? "image/png" : "image/jpeg" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new HttpError(404, "logo_not_found", "Logo não encontrado.");
    throw error;
  }
}
