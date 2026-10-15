import { handleStudioRequest } from "@/server/http/handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export {
  handleStudioRequest as GET,
  handleStudioRequest as POST,
  handleStudioRequest as PATCH,
  handleStudioRequest as DELETE,
};
