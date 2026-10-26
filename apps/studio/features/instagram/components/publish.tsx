"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { randomId } from "@/lib/random-id";
import type { StudioItem } from "@saraivabr/instagram-studio-kit/schemas";
import type { Publication } from "@saraivabr/instagram-studio-kit/schemas";
import { Notice, studioApi, thumbnailUrl } from "@/features/instagram/components/shared";
type State = {
  accounts: { id: string; username: string; active: boolean }[];
  publications: Publication[];
  can_publish: boolean;
  message?: string;
};
const labels: Record<Publication["status"], string> = {
  preparing: "Preparando imagens",
  sending: "Confirmando envio",
  pending: "Processando no Instagram",
  published: "Publicado",
  failed: "Falhou",
  uncertain: "Aguardando confirmação",
};
type PublishPostProps = {
  item: StudioItem;
  caption: string;
  carouselItems?: StudioItem[];
};
export function PublishPost(props: PublishPostProps) {
  const { activeOrg } = useAuth();
  return <PublishPostForOrganization key={`${activeOrg?.orgId}:${props.item.id}`} {...props} />;
}
function PublishPostForOrganization({ item, caption, carouselItems }: PublishPostProps) {
  const t = useT();
  const [state, setState] = useState<State>();
  const [account, setAccount] = useState("");
  const [library, setLibrary] = useState<StudioItem[]>([]);
  const [libraryCursor, setLibraryCursor] = useState<string | null>(null);
  const loadLibrary = (cursor?: string) =>
    studioApi<{ items: StudioItem[]; meta: { cursor: string | null } }>(
      `?kind=post&status=ready&limit=48${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    )
      .then((r) => {
        setLibrary((current) => [
          ...current,
          ...r.items.filter(
            (i) =>
              i.kind === "post" &&
              i.status === "ready" &&
              i.input.kind === "post" &&
              i.input.format !== "story",
          ),
        ]);
        setLibraryCursor(r.meta.cursor);
      })
      .catch((e) => setError(e.message));
  const [selected, setSelected] = useState<string[]>(
    carouselItems?.map((entry) => entry.id) ?? [item.id],
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const intent = useRef<{ fingerprint: string; id: string } | null>(null);
  const story = item.input.kind === "post" && item.input.format === "story";
  const load = useCallback(async (signal?: AbortSignal) => {
    const value = await studioApi<State>("/publish", { signal, cache: "no-store" });
    if (signal?.aborted) return;
    setState(value);
    setAccount((current) =>
      value.accounts.some((a) => a.id === current && a.active)
        ? current
        : value.accounts.find((a) => a.active)?.id || "",
    );
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((e) => {
      if (!controller.signal.aborted) setError(e.message);
    });
    return () => controller.abort();
  }, [load]);
  const publications = state?.publications.filter((p) => p.item_ids.includes(item.id)) ?? [];
  const unresolved = publications.some((p) =>
    ["sending", "uncertain", "pending", "preparing"].includes(p.status),
  );
  async function publish() {
    setBusy(true);
    setError("");
    const body = {
      account_id: account,
      item_ids: selected,
      format: story ? "story" : selected.length > 1 ? "carousel" : "feed",
      caption,
    };
    const fingerprint = JSON.stringify(body);
    if (intent.current?.fingerprint !== fingerprint)
      intent.current = { fingerprint, id: randomId() };
    try {
      await studioApi("/publish", {
        method: "POST",
        body: JSON.stringify({ ...body, id: intent.current.id }),
      });
      setReviewing(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível publicar.");
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-2xl border p-5">
      <h2 className="font-semibold">{t("Publicar no Instagram")}</h2>
      <Link href="/app/connections?aba=sociais" className="text-sm underline">
        {t("Conectar ou trocar minha conta")}
      </Link>
      {error && <Notice error>{error}</Notice>}
      {state && (
        <>
          {state.message && <Notice>{state.message}</Notice>}
          <label className="block space-y-2">
            <span className="text-sm">{t("Conta que vai publicar")}</span>
            <select
              className="w-full rounded-xl border bg-background p-3"
              disabled={busy || reviewing}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="">{t("Selecione sua conta")}</option>
              {state.accounts
                .filter((a) => a.active)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    @{a.username}
                  </option>
                ))}
            </select>
          </label>
          {!story && !carouselItems && (
            <details
              onToggle={(e) => {
                if (e.currentTarget.open && !library.length) void loadLibrary();
              }}
            >
              <summary className="cursor-pointer text-sm underline">
                {t("Montar carrossel com minhas criações")}
              </summary>
              <p className="my-3 text-sm text-muted-foreground">
                {t("Selecione até 10 imagens. A ordem de seleção será a ordem do carrossel.")}
              </p>
              <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto">
                {library.map((i) => (
                  <label key={i.id} className="space-y-1 rounded-lg border p-2">
                    <input
                      type="checkbox"
                      disabled={
                        busy ||
                        reviewing ||
                        i.id === item.id ||
                        (!selected.includes(i.id) && selected.length >= 10)
                      }
                      checked={selected.includes(i.id)}
                      onChange={(e) =>
                        setSelected((s) =>
                          e.target.checked ? [...s, i.id] : s.filter((id) => id !== i.id),
                        )
                      }
                    />
                    <span className="ml-2 text-xs">
                      {selected.includes(i.id)
                        ? `${selected.indexOf(i.id) + 1}ª imagem`
                        : "Adicionar"}
                    </span>
                    {i.image_url && (
                      <Image
                        unoptimized
                        src={thumbnailUrl(i)!}
                        alt={i.input.kind === "post" ? i.input.brief : "Criação"}
                        width={120}
                        height={150}
                        className="aspect-[4/5] w-full rounded-md object-cover"
                      />
                    )}
                  </label>
                ))}
              </div>
              {libraryCursor && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => void loadLibrary(libraryCursor)}
                >
                  {t("Carregar mais criações")}
                </Button>
              )}
              <Link href="/app/instagram/new" className="mt-3 inline-block text-sm underline">
                {t("Gerar outra imagem para o carrossel")}
              </Link>
            </details>
          )}
          {story && (
            <p className="text-sm text-muted-foreground">
              {t("Stories ficam disponíveis por 24 horas e não exibem a legenda.")}
            </p>
          )}
          {reviewing ? (
            <div className="space-y-3 rounded-xl bg-muted/40 p-4">
              <p>
                {t("Publicar agora")}{" "}
                {selected.length > 1
                  ? `um carrossel com ${selected.length} imagens`
                  : story
                    ? t("este Story")
                    : t("esta imagem")}{" "}
                {t("em")} <strong>@{state.accounts.find((a) => a.id === account)?.username}</strong>
                ?
              </p>
              {!story && (
                <p className="text-sm whitespace-pre-wrap">{caption || t("Sem legenda")}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {t("O conteúdo ficará visível na conta escolhida.")}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy || unresolved} onClick={() => void publish()}>
                  {busy ? t("Publicando…") : t("Confirmar publicação")}
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setReviewing(false)}>
                  {t("Voltar à revisão")}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              disabled={
                !state.can_publish || !account || busy || item.status !== "ready" || unresolved
              }
              onClick={() => setReviewing(true)}
            >
              {t("Revisar publicação")}
            </Button>
          )}
          {publications.map((p) => (
            <div key={p.id} className="space-y-2 border-t pt-3 text-sm">
              <p className="font-medium">{t(labels[p.status])}</p>
              {p.error && <p role="status">{p.error}</p>}
              {p.status === "failed" && state.can_publish && (
                <Button
                  variant="outline"
                  disabled={busy || unresolved}
                  onClick={() => {
                    intent.current = null;
                    setReviewing(true);
                  }}
                >
                  {t("Revisar nova tentativa")}
                </Button>
              )}
              {p.permalink && (
                <a href={p.permalink} rel="noreferrer" target="_blank" className="underline">
                  {t("Ver no Instagram")}
                </a>
              )}
              {p.status === "published" && (
                <Link href="/app/growth/instagram" className="block underline">
                  {t("Criar automação para esta postagem")}
                </Link>
              )}
            </div>
          ))}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void (async () => {
                setBusy(true);
                try {
                  setError("");
                  await load();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Não foi possível atualizar.");
                } finally {
                  setBusy(false);
                }
              })()
            }
          >
            {t("Atualizar resultado")}
          </Button>
        </>
      )}
    </section>
  );
}
