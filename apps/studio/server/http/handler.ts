import { type NextRequest, NextResponse } from "next/server";
import {
  studio,
  list,
  getItem,
  editItem,
  deleteReference,
  image,
  present,
} from "@/server/runtime";
import { editSchema } from "@saraivabr/instagram-studio-kit";
const ok = (data: unknown) =>
  NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
const fail = (message: string, status = 422) =>
  NextResponse.json(
    { error: { code: "studio_unavailable", message } },
    { status },
  );
async function readJson(req: NextRequest) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("Body obrigatório.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 20000) {
      await reader.cancel();
      throw new Error("Body excedido.");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
export async function handleStudioRequest(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const requestOrigin = new URL(`http://${req.headers.get("host")}`);
  const host = requestOrigin.hostname;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host))
    return fail("Exemplo local: integre autenticação antes de hospedar.", 403);
  if (
    req.method !== "GET" &&
    req.headers.get("origin") !== requestOrigin.origin
  )
    return fail("Origem inválida.", 403);
  try {
    if (path.startsWith("/api/assets/")) {
      const bytes = await image(path.split("/").at(-1)!);
      return new NextResponse(new Uint8Array(bytes), {
        headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
      });
    }
    if (path === "/api/v1/instagram") {
      if (req.method === "GET") {
        const group = req.nextUrl.searchParams.get("carousel_id");
        const items = await list();
        return ok({
          items: group
            ? items.filter(
                (i) =>
                  i.input.kind === "post" && i.input.carousel?.id === group,
              )
            : items,
          can_create: true,
        });
      }
      if (req.method === "POST") {
        if (
          process.env.OPENAI_API_KEY &&
          (!process.env.OPENAI_IMAGE_MODEL || !process.env.OPENAI_TEXT_MODEL)
        )
          return fail("Configure os dois modelos no servidor.");
        return ok(
          present(
            await studio.create("local", await readJson(req), {
              name: "Sua empresa",
              accent: "#506d48",
            }),
          ),
        );
      }
    }
    if (path === "/api/v1/instagram/account") return ok({ account: null });
    if (path === "/api/v1/instagram/insights")
      return ok({ connected: false, accounts: [] });
    if (path === "/api/v1/instagram/publish")
      return req.method === "GET"
        ? ok({ accounts: [], publications: [], can_publish: false })
        : fail("Conecte seu adapter social e autorização antes de publicar.");
    if (path === "/api/v1/growth/instagram")
      return req.method === "GET"
        ? NextResponse.json({
            data: { automations: [], accounts: [], can_edit: false },
            triggers: [],
          })
        : fail("Integre o executor social antes de ativar automações.");
    const id = path.startsWith("/api/v1/instagram/")
      ? path.split("/").at(-1)
      : null;
    if (id) {
      const item = await getItem(id);
      if (!item) return fail("Item não encontrado.", 404);
      if (req.method === "GET") return ok(item);
      if (req.method === "PATCH")
        return ok(
          await editItem(id, editSchema.parse(await readJson(req)).caption),
        );
      if (req.method === "DELETE") return ok(await deleteReference(id));
    }
    return fail("Rota indisponível.", 404);
  } catch {
    return fail(
      "Não foi possível concluir. Confira a configuração e o histórico antes de gerar novamente.",
    );
  }
}
