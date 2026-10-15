"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArtisanIcon } from "@/components/brand/ArtisanIcon";
import { Intro, Loading, Notice, StudioShell, studioApi } from "./shared";

export type ConnectionFeedback = "connected" | "denied" | "failed" | null;
type Account = { id: string; username: string; avatar_url: string | null; active: boolean };
type ConnectionState = {
  configured: boolean;
  accounts: Account[];
  can_edit: boolean;
  message?: string;
};
const feedbackMessages = {
  connected: "Autorização concluída. Confira o estado da sua conta abaixo.",
  denied: "A conexão foi cancelada ou não recebeu autorização. Você pode tentar novamente.",
  failed: "Não foi possível concluir a conexão. Tente novamente.",
};

export function InstagramConnections({ feedback }: { feedback: ConnectionFeedback }) {
  const { activeOrg } = useAuth();
  return (
    <ConnectionsForOrganization
      key={activeOrg?.orgId}
      orgId={activeOrg?.orgId}
      feedback={feedback}
    />
  );
}

function ConnectionsForOrganization({
  orgId,
  feedback,
}: {
  orgId?: string;
  feedback: ConnectionFeedback;
}) {
  const t = useT();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["instagram-connections", orgId],
    queryFn: ({ signal }) =>
      studioApi<ConnectionState>("/connections", { signal, cache: "no-store" }),
    enabled: !!orgId,
    staleTime: 0,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [disconnecting, setDisconnecting] = useState<Account | null>(null);
  const actionController = useRef<AbortController | null>(null);
  useEffect(() => () => actionController.current?.abort(), []);
  const { refetch } = query;
  useEffect(() => {
    if (feedback) void refetch();
  }, [feedback, refetch]);

  async function connect(accountId?: string) {
    const controller = new AbortController();
    actionController.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    setDisconnecting(null);
    try {
      const result = await studioApi<{ auth_url: string }>("/connections", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          action: "connect",
          ...(accountId ? { account_id: accountId } : {}),
        }),
      });
      if (controller.signal.aborted) return;
      let authorization: URL;
      try {
        authorization = new URL(result.auth_url);
        if (authorization.protocol !== "https:" || authorization.username || authorization.password)
          throw new Error();
      } catch {
        throw new Error(
          t("Não foi possível abrir a autorização. Atualize a página e tente novamente."),
        );
      }
      window.location.assign(authorization.href);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : t("Não foi possível conectar a conta."));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function disconnect(account: Account) {
    const controller = new AbortController();
    actionController.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await studioApi("/connections", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({ action: "disconnect", account_id: account.id, confirmed: true }),
      });
      if (controller.signal.aborted) return;
      setDisconnecting(null);
      setNotice(t("Conta desconectada desta instalação."));
      await Promise.all([
        query.refetch(),
        client.invalidateQueries({ queryKey: ["instagram-account", orgId] }),
      ]);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : t("Não foi possível desconectar a conta."));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const state = query.data;
  const canEdit = !!state?.configured && state.can_edit;
  return (
    <StudioShell>
      <Intro eyebrow={t("Sua conta")} title={t("Conecte seu Instagram.")}>
        {t(
          "Autorize uma conta profissional, de empresa ou criador de conteúdo, para publicar suas criações, consultar resultados e configurar respostas a comentários.",
        )}
      </Intro>
      {feedback && (
        <Notice error={feedback !== "connected"}>{t(feedbackMessages[feedback])}</Notice>
      )}
      {(error || query.error) && (
        <Notice error>
          {error || query.error?.message}{" "}
          <button className="underline" disabled={busy} onClick={() => void query.refetch()}>
            {t("Atualizar contas")}
          </button>
        </Notice>
      )}
      {notice && <Notice>{notice}</Notice>}
      {query.isPending ? (
        <Loading />
      ) : (
        state && (
          <section className="space-y-6 rounded-3xl border border-border bg-muted/20 p-6 sm:p-8">
            {state.message && <Notice>{state.message}</Notice>}
            {!state.configured && (
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {t(
                  "Peça à equipe responsável por esta instalação para configurar a integração. As credenciais ficam somente no servidor; você não precisa informar uma chave nesta tela.",
                )}
              </p>
            )}
            {state.configured && !state.can_edit && (
              <Notice>
                {t(
                  "Seu acesso permite consultar as contas. Peça a um administrador para conectar ou desconectar o Instagram.",
                )}
              </Notice>
            )}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="font-serif text-2xl">{t("Contas desta instalação")}</h2>
              <div className="flex flex-wrap gap-3">
                <Button disabled={busy || !canEdit} onClick={() => void connect()}>
                  {t(busy ? "Aguarde…" : "Conectar Instagram")}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || query.isFetching}
                  onClick={() => void query.refetch()}
                >
                  {t("Atualizar contas")}
                </Button>
              </div>
            </div>
            {state.accounts.length ? (
              <ul className="space-y-4">
                {state.accounts.map((account) => (
                  <li
                    key={account.id}
                    className="space-y-4 rounded-2xl border border-border bg-background p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar className="h-12 w-12">
                          {account.avatar_url && <AvatarImage src={account.avatar_url} alt="" />}
                          <AvatarFallback>
                            <ArtisanIcon symbol="instagram" className="h-6 w-6" />
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <h3 className="truncate font-medium">@{account.username}</h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {t(account.active ? "Conectada" : "Precisa de reconexão")}
                          </p>
                        </div>
                      </div>
                      {canEdit && (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => void connect(account.id)}
                          >
                            {t("Reconectar")}
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setDisconnecting(account)}
                          >
                            {t("Desconectar")}
                          </Button>
                        </div>
                      )}
                    </div>
                    {disconnecting?.id === account.id && (
                      <Notice>
                        <p>
                          {t("Desconectar")} <strong>@{account.username}</strong>{" "}
                          {t("desta instalação?")}
                        </p>
                        <p className="mt-2">
                          {t(
                            "Para publicar ou usar automações novamente, será necessário conectar a conta.",
                          )}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-3">
                          <Button disabled={busy} onClick={() => void disconnect(account)}>
                            {t("Confirmar desconexão")}
                          </Button>
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => setDisconnecting(null)}
                          >
                            {t("Manter conectada")}
                          </Button>
                        </div>
                      </Notice>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                {t("Nenhuma conta do Instagram conectada a esta instalação.")}
              </p>
            )}
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t(
                "Conectar a conta não publica conteúdo nem envia mensagens. Cada publicação passa por revisão; automações exigem confirmação antes de serem ativadas.",
              )}
            </p>
          </section>
        )
      )}
      <Link href="/app/instagram" className="inline-block text-sm underline">
        {t("Voltar ao Instagram")}
      </Link>
    </StudioShell>
  );
}
