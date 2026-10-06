import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { StudioShell } from "@/features/instagram/components/shared";
import { InstagramGrowthClient } from "@/features/instagram/components/growth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Automações do Instagram | Instagram Studio" };

export default async function InstagramGrowthSubPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app/instagram");

  return (
    <StudioShell>
      <InstagramGrowthClient orgId={activeOrg.orgId} />
    </StudioShell>
  );
}
