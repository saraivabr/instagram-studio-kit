import { z } from "zod";
import { safeSource, studioId } from "../../domain/schema.js";
import { parseSocialResponse, socialRequest, SocialError, validateSocialId } from "./client.js";
const providerPostId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const targetSchema = z.object({
  platform: z.string(),
  accountId: z.union([z.string(), z.object({ _id: z.string() })]),
  status: z.string().optional(),
  platformPostUrl: z.string().nullish(),
  error: z.unknown().optional(),
  errorMessage: z.string().nullish(),
});
const postSchema = z.object({
  _id: z.string(),
  status: z.string(),
  platforms: z.array(targetSchema),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export function publicationResult(value: unknown, accountId: string) {
  const envelope = parseSocialResponse(
    z.object({
      post: postSchema.optional(),
      existingPost: postSchema.optional(),
    }),
    value,
  );
  const post = envelope.post ?? envelope.existingPost;
  if (!post)
    throw new SocialError(
      "Não foi possível confirmar a publicação. Atualize o resultado antes de tentar novamente.",
    );
  const target = post.platforms.find(
    (p) =>
      p.platform === "instagram" &&
      (typeof p.accountId === "string" ? p.accountId : p.accountId._id) === accountId,
  );
  if (!target) throw new SocialError("A publicação retornada não corresponde à conta escolhida.");
  const published = target.status === "published";
  const failed = !published && (target.status === "failed" || post.status === "failed");
  let permalink: string | null = null;
  if (target.platformPostUrl) {
    // A malformed optional link must never turn a confirmed publication into a retry.
    try {
      const url = new URL(target.platformPostUrl);
      if (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        /(^|\.)instagram\.com$/.test(url.hostname)
      )
        permalink = url.toString();
    } catch {
      permalink = null;
    }
  }
  return {
    provider_post_id: post._id,
    status: published ? "published" : failed ? "failed" : "pending",
    permalink,
    error: failed
      ? target.errorMessage
          ?.replace(/https?:\/\/\S+/g, "[link protegido]")
          .replace(/\bsk-[A-Za-z0-9_-]+|Bearer\s+\S+/gi, "[credencial protegida]")
          .replace(/(?:Bearer\s+)?[A-Za-z0-9_.-]{40,}/g, "[identificador protegido]")
          .slice(0, 500) ||
        "O Instagram recusou a publicação. Confira a conexão, o formato e as permissões antes de criar um novo envio."
      : null,
  } as const;
}
export async function publishInstagram(
  key: string,
  input: { id: string; account_id: string; format: string; caption: string },
  urls: string[],
) {
  const command = z
    .object({
      id: studioId,
      account_id: z.string().regex(/^[a-f0-9]{24}$/),
      format: z.enum(["feed", "story", "carousel"]),
      caption: z.string().max(2200),
    })
    .parse(input);
  const media = z.array(z.string().max(2048).refine(safeSource)).min(1).max(10).parse(urls);
  if (command.format === "carousel" ? media.length < 2 : media.length !== 1)
    throw new SocialError("Confira a quantidade de imagens para este formato.", 400);
  const result = await socialRequest(
    key,
    "posts",
    {
      content: command.format === "story" ? "" : command.caption,
      mediaItems: media.map((url) => ({ type: "image", url })),
      platforms: [
        {
          platform: "instagram",
          accountId: command.account_id,
          platformSpecificData: {
            ...(command.format === "story" ? { contentType: "story" } : {}),
            isAiGenerated: true,
          },
        },
      ],
      publishNow: true,
      metadata: { studio_publication_id: command.id },
    },
    { requestId: command.id },
  );
  return publicationResult(result, command.account_id);
}
export async function readInstagramPublication(key: string, id: string, account: string) {
  const postId = providerPostId.parse(id);
  validateSocialId(account);
  return publicationResult(
    await socialRequest(key, `posts/${encodeURIComponent(postId)}`),
    account,
  );
}
export async function findInstagramPublication(
  key: string,
  profile: string,
  id: string,
  account: string,
) {
  validateSocialId(profile);
  validateSocialId(account);
  const publicationId = studioId.parse(id);
  const response = parseSocialResponse(
    z.object({ posts: z.array(postSchema) }),
    await socialRequest(key, `posts?profileId=${encodeURIComponent(profile)}&limit=100`),
  );
  const post = response.posts.find((p) => p.metadata?.studio_publication_id === publicationId);
  return post ? publicationResult({ post }, account) : null;
}
