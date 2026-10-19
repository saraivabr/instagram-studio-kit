import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { redirect } from "next/navigation";
import { companyContext } from "@/lib/instagram/brand";
import { storedBrand } from "@/server/adapters/local/repository";
import { BrandSettings } from "@/features/instagram/components/brand";
export const metadata = { title: "Minha marca" };
// The brand lives in SQLite and changes at runtime, so this page must never be prerendered.
export const dynamic = "force-dynamic";
export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app/instagram");
  const brand = await companyContext(org.orgId);
  const stored = storedBrand(org.orgId);
  return (
    <BrandSettings
      canEdit={["admin", "owner", "editor"].includes(org.role)}
      initial={{
        name: stored?.name?.trim() ? brand.name : "",
        description: stored?.description?.trim() ? brand.description : "",
        accent: brand.accent ?? "#506d48",
        logoUrl: brand.logoUrl,
        logoMode: brand.logoMode,
      }}
    />
  );
}
