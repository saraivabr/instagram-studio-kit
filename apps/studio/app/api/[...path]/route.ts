import { handleStudioRequest } from "@/server/http/handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export {
  handleStudioRequest as GET,
  handleStudioRequest as POST,
  handleStudioRequest as PATCH,
  handleStudioRequest as DELETE,
};
