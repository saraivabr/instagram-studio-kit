import "server-only";
/** Local example binds to loopback. No real authentication is implemented. */
export async function requireAuth(_request?: Request) {
  return { id: "local-user" };
}
export const loadAuthUser = requireAuth;
export async function resolveActiveOrg(_user: unknown) {
  return { orgId: "local", role: "admin" };
}
