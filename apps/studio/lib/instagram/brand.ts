import "server-only";
import { storedDescription } from "@/server/adapters/local/repository";
export type CompanyContext = {
  name: string;
  description: string;
  descriptionSource: "post" | "agent" | null;
  logoPath: string | null;
  logoUrl: string | null;
  accent: string | null;
};
/** Replace with your tenant-scoped brand store. logoPath is private, inside tenantDirectory. */
export async function companyContext(org: string): Promise<CompanyContext> {
  const description = storedDescription(org);
  return {
    name: "Sua empresa",
    description: description ?? "Consultoria de negócios",
    descriptionSource: description ? "post" : null,
    logoPath: null,
    logoUrl: null,
    accent: "#506d48",
  };
}
