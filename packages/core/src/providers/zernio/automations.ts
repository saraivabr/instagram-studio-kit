import { z } from "zod";
import { automationMutation } from "../../domain/automation-schema.js";
import { parseSocialResponse, socialRequest, SocialError } from "./client.js";
import {
  instagramContext,
  instagramAutomations,
  instagramPosts,
  requireInstagramAccount,
} from "./instagram-management.js";
/** Host must authorize manager access, enforce quotas and audit before calling. */
export async function mutateAutomation(
  context: Awaited<ReturnType<typeof instagramContext>>,
  input: unknown,
) {
  const body = automationMutation.parse(input);
  const automations = await instagramAutomations(context);
  const existing = body.action !== "create" ? automations.find((a) => a.id === body.id) : undefined;
  if (body.action !== "create" && !existing)
    throw new SocialError("Automação não encontrada nesta organização.", 404);
  let result: unknown;
  if (body.action === "toggle") {
    requireInstagramAccount(context, existing!.accountId);
    result = await socialRequest(
      context.key,
      `comment-automations/${body.id}`,
      { isActive: body.is_active },
      { method: "PATCH" },
    );
  } else {
    const rule = body.rule;
    requireInstagramAccount(context, rule.account_id);
    if (
      existing &&
      (existing.accountId !== rule.account_id || (existing.platformPostId ?? "") !== rule.post_id)
    )
      throw new SocialError("Crie outra regra para mudar a conta ou postagem.", 422);
    const posts = await instagramPosts(context.key, rule.account_id);
    const post = posts.find((p) => p.id === rule.post_id);
    if (!post && !existing) throw new SocialError("Selecione uma postagem desta conta.", 422);
    const fields = {
      name: rule.name,
      keywords: rule.keywords,
      matchMode: rule.match_mode,
      dmMessage: rule.dm_response_template,
      commentReply: rule.comment_reply,
    };
    if (body.action === "create") {
      // Provider guarantees one active per-post rule. Reconcile uncertain creates before repeating.
      const samePost = automations.find(
        (a) => a.accountId === rule.account_id && a.platformPostId === rule.post_id && a.isActive,
      );
      if (samePost) {
        if (
          samePost.name === rule.name &&
          samePost.dmMessage === rule.dm_response_template &&
          samePost.matchMode === rule.match_mode &&
          JSON.stringify(samePost.keywords) === JSON.stringify(rule.keywords) &&
          (samePost.commentReply ?? "") === rule.comment_reply
        )
          return { automation: samePost };
        throw new SocialError(
          "Esta postagem já tem uma regra ativa. Edite a regra existente.",
          409,
        );
      }
      result = await socialRequest(
        context.key,
        "comment-automations",
        {
          ...fields,
          profileId: context.profileId,
          accountId: rule.account_id,
          platformPostId: rule.post_id,
          postTitle: post?.message.slice(0, 120),
        },
        { requestId: body.id },
      );
    } else
      result = await socialRequest(context.key, `comment-automations/${body.id}`, fields, {
        method: "PATCH",
      });
  }

  parseSocialResponse(z.object({ success: z.literal(true) }), result);
  return { saved: true };
}
