import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { StudioShell } from "@/features/instagram/components/shared";
import { InstagramGrowthClient } from "@/features/instagram/components/growth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Automações do Instagram | escreve.ai" };

export default async function InstagramGrowthSubPage() {
  const user = await loadAuthUser();
  if (!user) redirect("/login");
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/login");

  return (
    <StudioShell>
      <InstagramGrowthClient orgId={activeOrg.orgId} />
    </StudioShell>
  );
}
