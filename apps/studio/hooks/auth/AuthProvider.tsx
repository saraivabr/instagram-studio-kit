"use client";
/** Local single-tenant example. Replace alongside lib/auth/server for hosted use. */
export function useAuth() {
  return { activeOrg: { orgId: "local", role: "admin" } };
}
