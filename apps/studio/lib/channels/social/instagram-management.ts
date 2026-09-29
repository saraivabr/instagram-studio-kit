import { z } from "zod";
export const socialId = z.string().regex(/^[a-f0-9]{24}$/);
export const publishedPostSchema = z.object({
  id: z.string().min(1),
  message: z.string().default(""),
  permalink: z.string().optional(),
  picture: z.string().optional(),
  mediaType: z.string().optional(),
});
export const automationSchema = z.object({
  id: socialId,
  accountId: socialId,
  name: z.string(),
  platform: z.literal("instagram"),
  platformPostId: z.string().nullish(),
  postTitle: z.string().nullish(),
  keywords: z.array(z.string()),
  matchMode: z.enum(["contains", "word", "exact"]),
  dmMessage: z.string(),
  commentReply: z.string().nullish(),
  isActive: z.boolean(),
  stats: z
    .object({
      triggered: z.number().default(0),
      dmsSent: z.number().default(0),
      dmsFailed: z.number().default(0),
      read: z.number().default(0),
    })
    .default({ triggered: 0, dmsSent: 0, dmsFailed: 0, read: 0 }),
});
export const automationLogSchema = z.object({
  id: z.string(),
  commentText: z.string().nullish(),
  commenterName: z.string().nullish(),
  status: z.string(),
  error: z.string().nullish(),
  commentReplyStatus: z.string().nullish(),
  commentReplyError: z.string().nullish(),
  createdAt: z.string(),
});
export type InstagramAutomation = z.infer<typeof automationSchema>;
export type InstagramPost = z.infer<typeof publishedPostSchema>;
export type InstagramAutomationLog = z.infer<typeof automationLogSchema>;
