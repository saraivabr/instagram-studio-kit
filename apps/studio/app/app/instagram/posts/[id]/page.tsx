import { Review } from "@/features/instagram/components/review";
import { notFound } from "next/navigation";
import { getItem, requestContext } from "@/server/runtime";
import { z } from "zod";
export const dynamic = "force-dynamic";
export const metadata = { title: "Revisar postagem" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const context = await requestContext();
  if (!(await getItem(id, context.tenantId))) notFound();
  return <Review id={id} />;
}
