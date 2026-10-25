import "server-only";
import { storedBrand, storedPeople } from "@/server/adapters/local/repository";
/** People with recorded consent who can be included in an art. Photos stay private. */
export type BrandPersonView = {
  id: string;
  name: string;
  photo_urls: string[];
  consent_at: string;
};
export type CompanyContext = {
  name: string;
  description: string;
  descriptionSource: "post" | "agent" | null;
  logoPath: string | null;
  logoUrl: string | null;
  logoMode: "ai" | "stamp";
  accent: string | null;
  people: BrandPersonView[];
};
export const defaultBrand = {
  name: "Sua empresa",
  description: "Consultoria de negócios",
  accent: "#506d48",
} as const;
/** Brand registered in "Minha marca"; defaults apply to anything not filled in yet. */
export async function companyContext(org: string): Promise<CompanyContext> {
  const brand = storedBrand(org);
  const description = brand?.description?.trim() || undefined;
  const logoPath = brand?.logo_path || null;
  return {
    name: brand?.name?.trim() || defaultBrand.name,
    description: description ?? defaultBrand.description,
    descriptionSource: description ? "post" : null,
    logoPath,
    logoUrl: logoPath
      ? `/api/v1/brand/logo?v=${encodeURIComponent(brand?.updated_at ?? "0")}`
      : null,
    logoMode: brand?.logo_mode === "ai" ? "ai" : "stamp",
    accent: brand?.accent || defaultBrand.accent,
    people: storedPeople(org).map((person) => ({
      id: person.id,
      name: person.name,
      consent_at: person.consent_at,
      photo_urls: person.photos.map(
        (_, index) => `/api/v1/brand/people/${person.id}/photos/${index + 1}`,
      ),
    })),
  };
}
