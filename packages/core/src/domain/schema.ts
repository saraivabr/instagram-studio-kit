import { z } from "zod";
import { carouselTemplates } from "./carousel-templates.js";

export const formats = {
  feed: { label: "Post vertical", size: "1024x1280", ratio: "4 / 5" },
  square: { label: "Post quadrado", size: "1024x1024", ratio: "1 / 1" },
  story: { label: "Story", size: "1152x2048", ratio: "9 / 16" },
} as const;
/** Canonical identifiers are also used in asset paths and idempotency claims. */
export const studioId = z.uuid().transform((id) => id.toLowerCase());
export const referenceSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/^@/, ""))
  .pipe(z.string().regex(/^[a-zA-Z0-9._]{1,30}$/, "Informe o @ do perfil, sem links ou espaços."));
export const createSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: studioId,
      kind: z.literal("post"),
      brief: z.string().trim().min(10).max(3000),
      niche: z.string().trim().min(2).max(2000),
      use_logo: z.boolean().default(true),
      /** A person registered in the brand, with consent, to appear in the art. */
      person_id: studioId.optional(),
      format: z.enum(["feed", "square", "story"]),
      caption: z.string().max(2200).default(""),
      carousel: z
        .object({
          id: studioId,
          template: z.enum(Object.keys(carouselTemplates) as [keyof typeof carouselTemplates]),
          slide: z.number().int().min(1).max(8),
        })
        .strict()
        .optional(),
    })
    .strict()
    // Slide briefs describe a 4:5 vertical system; every slide of a carousel shares it.
    .refine((post) => !post.carousel || post.format === "feed", {
      message: "Carrosséis usam o formato feed (4:5).",
      path: ["format"],
    }),
  z
    .object({
      id: studioId,
      kind: z.literal("research"),
      niche: z.string().trim().min(2).max(150),
      brief: z.string().trim().min(3).max(1000),
      references: z.array(referenceSchema).max(10).default([]),
    })
    .strict(),
  z
    .object({
      id: studioId,
      kind: z.literal("reference"),
      username: referenceSchema,
    })
    .strict(),
]);
export const editSchema = z.object({ caption: z.string().max(2200) }).strict();
export type StudioInput = z.infer<typeof createSchema>;
export interface StudioItem {
  id: string;
  kind: "post" | "research" | "reference";
  status: "generating" | "ready" | "failed";
  input: StudioInput;
  caption: string;
  answer: string;
  sources: { title: string; url: string }[];
  asset_path: string | null;
  image_url?: string | null;
  can_edit?: boolean;
  can_archive?: boolean;
  can_retry?: boolean;
  error: string | null;
  created_at: string;
  updated_at: string;
}
/**
 * Hosts a provider would fetch from inside its own network: loopback, private, link-local.
 * Only the literal hostname is checked: a public name that resolves to an internal address must be
 * blocked by the fetcher itself, which resolves again at request time (DNS can change in between).
 */
function internalHost(hostname: string) {
  // "localhost." and "printer.local." are the same hosts as without the trailing dot.
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  if (host.includes(":")) {
    // WHATWG URL serializes ::ffff:127.0.0.1 as ::ffff:7f00:1.
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
    if (mapped) {
      const [high, low] = [parseInt(mapped[1]!, 16), parseInt(mapped[2]!, 16)];
      return internalHost(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return host === "::" || host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
  }
  const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host)?.slice(1).map(Number);
  if (ipv4) {
    const [a, b] = ipv4 as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  return !host.includes(".") || /(^|\.)(localhost|local|internal|home\.arpa)$/.test(host);
}
export function safeSource(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && !internalHost(u.hostname);
  } catch {
    return false;
  }
}
