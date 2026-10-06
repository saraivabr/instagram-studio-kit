"use client";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/auth/AuthProvider";
import Image from "next/image";
import { ArtisanIcon } from "@/components/brand/ArtisanIcon";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import type { StudioItem } from "@saraivabr/instagram-studio-kit/schemas";

export async function studioApi<T>(path = "", init?: RequestInit): Promise<T> {
  const r = await fetch(`/api/v1/instagram${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const json = await r.json().catch(() => null);
  if (!r.ok) throw new Error(json?.error?.message || "Não foi possível concluir. Tente novamente.");
  return json.data;
}
type ItemPage = {
  items: StudioItem[];
  can_create: boolean;
  meta: { cursor: string | null; has_more: boolean; total: number };
};
type ItemFilters = {
  kind?: StudioItem["kind"];
  status?: StudioItem["status"];
  carousel_id?: string;
  limit?: number;
};
export function useItems(filters: ItemFilters = {}) {
  const { activeOrg } = useAuth();
  const client = useQueryClient();
  const filterKey = JSON.stringify(filters);
  const queryKey = ["instagram-studio", activeOrg?.orgId, filterKey];
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) => {
      const params = new URLSearchParams({ limit: "24", ...JSON.parse(filterKey) });
      if (pageParam) params.set("cursor", pageParam);
      return studioApi<ItemPage>(`?${params}`, { signal });
    },
    getNextPageParam: (page) => (page.meta.has_more ? page.meta.cursor : undefined),
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const pendingIds = items
    .filter((item) => item.status === "generating")
    .map((item) => item.id)
    .join(",");
  const [pollError, setPollError] = useState("");
  useEffect(() => {
    if (!pendingIds) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const results = await Promise.allSettled(
        pendingIds
          .split(",")
          .map((id) => studioApi<StudioItem>(`/${id}`, { signal: controller.signal })),
      );
      if (controller.signal.aborted) return;
      const updates = new Map(
        results.flatMap((result) =>
          result.status === "fulfilled" ? [[result.value.id, result.value] as const] : [],
        ),
      );
      const failed = results.find((result) => result.status === "rejected");
      setPollError(
        failed?.status === "rejected"
          ? failed.reason instanceof Error
            ? failed.reason.message
            : "Não foi possível atualizar as criações."
          : "",
      );
      client.setQueryData<InfiniteData<ItemPage>>(
        ["instagram-studio", activeOrg?.orgId, filterKey],
        (data) => {
          if (!data) return data;
          const status = (JSON.parse(filterKey) as ItemFilters).status;
          const removed = status
            ? data.pages
                .flatMap((page) => page.items)
                .filter((item) => {
                  const updated = updates.get(item.id);
                  return updated && updated.status !== status;
                }).length
            : 0;
          return {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              meta: { ...page.meta, total: Math.max(0, page.meta.total - removed) },
              items: page.items
                .map((item) => updates.get(item.id) ?? item)
                .filter((item) => !status || item.status === status),
            })),
          };
        },
      );
      timer = setTimeout(() => void poll(), 5000);
    }
    timer = setTimeout(() => void poll(), 5000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [pendingIds, activeOrg?.orgId, filterKey, client]);
  return {
    items,
    loading: query.isPending,
    error: query.error?.message ?? (pendingIds ? pollError : ""),
    canCreate: query.data?.pages[0]?.can_create ?? false,
    total: query.data?.pages[0]?.meta.total ?? 0,
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore: () => query.fetchNextPage(),
    reload: async () => {
      await query.refetch();
    },
  };
}
export type StudioConfiguration = {
  mode: "demo" | "configured" | "incomplete";
  message: string;
  can_research: boolean;
};
export function useStudioConfiguration() {
  const { activeOrg } = useAuth();
  return useQuery({
    queryKey: ["instagram-config", activeOrg?.orgId],
    queryFn: ({ signal }) => studioApi<StudioConfiguration>("/config", { signal }),
    staleTime: 30_000,
  });
}
export function ConfigurationBanner() {
  const config = useStudioConfiguration();
  return (
    <div
      role="status"
      className="border-b border-border bg-accent-soft px-6 py-2 text-center text-xs"
    >
      {config.data?.message ??
        (config.isError
          ? "Não foi possível consultar a configuração. Atualize a página para tentar novamente."
          : "Consultando configuração do estúdio…")}
    </div>
  );
}
export function thumbnailUrl(item: StudioItem) {
  return item.image_url?.startsWith("/api/assets/")
    ? `${item.image_url.split("?")[0]}?thumbnail=1`
    : item.image_url;
}
export function ItemActions({
  item,
  onRetry,
  onArchive,
}: {
  item: StudioItem;
  onRetry: (item: StudioItem) => void | Promise<void>;
  onArchive: () => void | Promise<void>;
}) {
  const t = useT();
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(retry: boolean) {
    setBusy(true);
    setError("");
    try {
      if (retry)
        await onRetry(await studioApi<StudioItem>(`/${item.id}/retry`, { method: "POST" }));
      else {
        await studioApi(`/${item.id}`, { method: "DELETE" });
        await onArchive();
      }
      setConfirmRetry(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Não foi possível concluir."));
    } finally {
      setBusy(false);
    }
  }
  if (item.status === "generating" || (!item.can_archive && !item.can_retry)) return null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {item.can_retry && item.status === "failed" && item.kind !== "reference" && (
          <Button variant="outline" disabled={busy} onClick={() => setConfirmRetry(true)}>
            {t("Tentar novamente")}
          </Button>
        )}
        {item.can_archive && (
          <Button variant="ghost" disabled={busy} onClick={() => void run(false)}>
            {t("Arquivar pedido")}
          </Button>
        )}
      </div>
      {confirmRetry && (
        <Notice>
          <p>
            {t(
              "Esta ação cria um novo pedido. Com IA configurada, haverá uma nova chamada ao provedor e ela pode ter custo.",
            )}
          </p>
          <div className="mt-3 flex gap-3">
            <Button disabled={busy} onClick={() => void run(true)}>
              {t("Confirmar nova tentativa")}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmRetry(false)}>
              {t("Cancelar")}
            </Button>
          </div>
        </Notice>
      )}
      {error && <Notice error>{error}</Notice>}
    </div>
  );
}
const sections = [
  { href: "/app/instagram", label: "Visão Geral" },
  { href: "/app/instagram/library", label: "Minhas criações" },
  { href: "/app/instagram/growth", label: "Automações (Growth)" },
  { href: "/app/instagram/inspirations", label: "Inspirações" },
  { href: "/app/instagram/insights", label: "Meus resultados" },
];
function InstagramAccountButton() {
  const t = useT();
  const { activeOrg } = useAuth();
  const query = useQuery({
    queryKey: ["instagram-account", activeOrg?.orgId],
    queryFn: ({ signal }) =>
      studioApi<{
        account: { username: string; avatar_url: string | null; active: boolean } | null;
      }>("/account", { signal }),
    enabled: !!activeOrg?.orgId,
    staleTime: 30_000,
  });
  if (query.isPending)
    return (
      <div
        aria-label={t("Carregando conta do Instagram")}
        className="h-12 w-40 animate-pulse rounded-full bg-muted"
      />
    );
  const account = query.data?.account;
  return (
    <Link
      href="/app/connections?aba=sociais"
      aria-label={
        account
          ? `${account.active ? t("Gerenciar conta") : t("Reconectar conta")} @${account.username}`
          : undefined
      }
      className="inline-flex max-w-full items-center gap-2.5 rounded-full border border-border bg-background py-1.5 pr-4 pl-1.5 text-sm font-semibold shadow-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-4"
    >
      <span className="rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 p-0.5">
        <Avatar className="h-9 w-9 border-2 border-background">
          {account?.avatar_url && (
            <AvatarImage src={account.avatar_url} alt="" className="object-cover" />
          )}
          <AvatarFallback>
            <ArtisanIcon symbol="instagram" className="h-5 w-5" />
          </AvatarFallback>
        </Avatar>
      </span>
      <span className="max-w-48 truncate">
        {account
          ? `@${account.username}`
          : query.isError
            ? t("Ver minha conta")
            : t("Conectar minha conta")}
      </span>
    </Link>
  );
}
export function StudioShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const path = usePathname();
  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/app/instagram"
          className="inline-flex items-center gap-3 text-lg font-semibold"
        >
          <ArtisanIcon symbol="instagram" className="h-7 w-7" />
          {t("Instagram")}
        </Link>
        <InstagramAccountButton />
      </div>
      <nav
        aria-label={t("Instagram")}
        className="flex gap-2 overflow-x-auto border-b border-border pb-3"
      >
        {sections.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            aria-current={path === s.href ? "page" : undefined}
            className={`shrink-0 rounded-full px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 ${path === s.href ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          >
            {t(s.label)}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
export function Intro({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: React.ReactNode;
}) {
  const t = useT();
  return (
    <header className="max-w-2xl space-y-3">
      {eyebrow && <p className="text-sm text-muted-foreground">{t(eyebrow)}</p>}
      <h1 className="font-serif text-3xl tracking-tight sm:text-5xl">{t(title)}</h1>
      {children && (
        <div className="text-base leading-relaxed text-muted-foreground">{children}</div>
      )}
    </header>
  );
}
export function Notice({ error, children }: { error?: boolean; children: React.ReactNode }) {
  return (
    <div
      role={error ? "alert" : "status"}
      className={`rounded-2xl border p-4 text-sm leading-relaxed ${error ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/40"}`}
    >
      {children}
    </div>
  );
}
export function Loading() {
  const t = useT();
  return (
    <p role="status" className="py-12 text-muted-foreground">
      {t("Preparando seu espaço…")}
    </p>
  );
}
export function Empty({
  title,
  children,
  href,
  label,
}: {
  title: string;
  children: React.ReactNode;
  href: string;
  label: string;
}) {
  const t = useT();
  return (
    <div className="rounded-3xl border border-dashed border-border p-8 sm:p-12">
      <h2 className="font-serif text-2xl">{t(title)}</h2>
      <p className="mt-3 max-w-lg text-muted-foreground">{children}</p>
      <Button asChild className="mt-6">
        <Link href={href}>{t(label)}</Link>
      </Button>
    </div>
  );
}
export function Gallery({ items }: { items: StudioItem[] }) {
  const locale = useTagDeIdioma();
  const t = useT();
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <Link
          href={`/app/instagram/posts/${item.id}`}
          key={item.id}
          className="group min-w-0 space-y-3 rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          <div className="flex aspect-[4/5] items-center justify-center overflow-hidden rounded-3xl border border-border bg-muted/40">
            {item.image_url ? (
              <Image
                unoptimized
                width={320}
                height={400}
                src={thumbnailUrl(item)!}
                alt={item.input.kind === "post" ? item.input.brief : "Criação"}
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="px-6 text-center">
                <ArtisanIcon symbol="instagram" className="mx-auto mb-4 h-12 w-12" />
                <p>
                  {item.status === "generating"
                    ? t("Sua imagem está sendo criada…")
                    : item.status === "failed"
                      ? t("Pedido preservado")
                      : t("Imagem temporariamente indisponível")}
                </p>
              </div>
            )}
          </div>
          <h2 className="line-clamp-2 font-medium">
            {item.input.kind === "post" ? item.input.brief : t("Criação")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {item.status === "ready"
              ? t("Pronta para revisar")
              : item.status === "failed"
                ? t("Precisa de atenção")
                : t("Em andamento")}{" "}
            · {new Date(item.created_at).toLocaleDateString(locale)}
          </p>
        </Link>
      ))}
    </div>
  );
}
