"use client";
import { useT } from "@/hooks/i18n/useT";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  StudioShell,
  Intro,
  Gallery,
  Empty,
  Loading,
  Notice,
  useItems,
} from "@/features/instagram/components/shared";
export function Library() {
  const t = useT();
  const {
    items: posts,
    loading,
    error,
    reload,
    hasMore,
    loadMore,
    loadingMore,
  } = useItems({ kind: "post" });
  return (
    <StudioShell>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <Intro title={t("Suas ideias, guardadas.")}>
          {t("Abra uma criação para revisar, ajustar a legenda e baixar a imagem.")}
        </Intro>
        <Button asChild>
          <Link href="/app/instagram/new">{t("Criar postagem")}</Link>
        </Button>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <Notice error>
          {error}{" "}
          <button className="underline" onClick={() => void reload()}>
            {t("Tentar novamente")}
          </button>
        </Notice>
      ) : posts.length ? (
        <Gallery items={posts} />
      ) : (
        <Empty
          title={t("Sua biblioteca começa com uma ideia.")}
          href="/app/instagram/new"
          label={t("Criar minha primeira postagem")}
        >
          {t("As imagens que você criar ficam aqui, junto com seus pedidos e legendas.")}
        </Empty>
      )}
      {hasMore && (
        <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
          {t(loadingMore ? "Carregando…" : "Carregar mais criações")}
        </Button>
      )}
    </StudioShell>
  );
}
