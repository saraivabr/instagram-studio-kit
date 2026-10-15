"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type {
  InstagramAutomation,
  InstagramPost,
  InstagramAutomationLog,
} from "@saraivabr/instagram-studio-kit/social";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { randomId } from "@/lib/random-id";
import { Notice } from "./shared";

type State = {
  automations: InstagramAutomation[];
  accounts: { id: string; username: string; active: boolean }[];
  can_edit: boolean;
  message?: string;
};
type AutomationMutation =
  | {
      action: "create" | "edit";
      id: string;
      rule: {
        name: string;
        account_id: string;
        post_id: string;
        keywords: string[];
        match_mode: string;
        dm_response_template: string;
        comment_reply: string;
      };
    }
  | { action: "toggle"; id: string; is_active: boolean };
type Confirmation = { request: AutomationMutation; name: string };

function ConfirmAutomation({
  confirmation,
  busy,
  onConfirm,
  onCancel,
}: {
  confirmation: Confirmation;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const request = confirmation.request;
  const activating =
    request.action === "create" || (request.action === "toggle" && request.is_active);
  const pausing = request.action === "toggle" && !request.is_active;
  return (
    <Notice>
      <h3 className="font-semibold">
        {t(
          activating
            ? "Ativar esta automação?"
            : pausing
              ? "Pausar esta automação?"
              : "Salvar estas alterações?",
        )}
      </h3>
      <p className="mt-2 font-medium">{confirmation.name}</p>
      <p className="mt-2">
        {t(
          activating
            ? "Ela ficará ativa e poderá enviar mensagens reais por Direct e respostas públicas nos comentários, conforme a configuração. Confira os dados antes de confirmar."
            : pausing
              ? "Confirme a pausa desta automação."
              : "As alterações serão aplicadas à automação. Se ela estiver ativa, poderá enviar mensagens reais por Direct com o novo conteúdo.",
        )}
      </p>
      {request.action !== "toggle" && (
        <div className="mt-3 space-y-2 rounded-xl border border-border bg-background p-3">
          <p>
            {t("Palavras:")} {request.rule.keywords.join(", ")}
          </p>
          <p className="whitespace-pre-wrap">{request.rule.dm_response_template}</p>
          {request.rule.comment_reply && (
            <p className="whitespace-pre-wrap">
              {t("Resposta pública:")} {request.rule.comment_reply}
            </p>
          )}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="button" disabled={busy} onClick={onConfirm}>
          {t(
            busy
              ? "Salvando…"
              : activating
                ? "Confirmar e ativar"
                : pausing
                  ? "Confirmar pausa"
                  : "Confirmar alterações",
          )}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          {t("Voltar à revisão")}
        </Button>
      </div>
    </Notice>
  );
}
async function api<T>(query = "", body?: unknown): Promise<T> {
  const response = await fetch(
    `/api/v1/growth/instagram${query}`,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error?.message ?? "Não foi possível concluir. Tente novamente.");
  return result.data;
}
const field = "w-full rounded-xl border bg-background p-3";
export function InstagramGrowthClient({ orgId }: { orgId: string }) {
  return <InstagramGrowthForOrganization key={orgId} />;
}
function InstagramGrowthForOrganization() {
  const t = useT();
  const idioma = useTagDeIdioma();
  const [state, setState] = useState<State>();
  const editorRef = useRef<HTMLElement>(null);
  const logsRef = useRef<HTMLElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [editing, setEditing] = useState<InstagramAutomation | "new" | null>(null);
  const [requestId, setRequestId] = useState("");
  const [account, setAccount] = useState("");
  const [posts, setPosts] = useState<InstagramPost[]>([]);
  const [post, setPost] = useState("");
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [mode, setMode] = useState("word");
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [logs, setLogs] = useState<{ name: string; rows: InstagramAutomationLog[] } | null>(null);
  useEffect(() => {
    if (editing) editorRef.current?.scrollIntoView({ block: "start" });
  }, [editing]);
  useEffect(() => {
    if (logs) logsRef.current?.scrollIntoView({ block: "start" });
  }, [logs]);
  async function load() {
    setState(await api<State>());
  }
  useEffect(() => {
    void api<State>()
      .then(setState)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!account || !editing) return;
    let active = true;
    void api<{ posts: InstagramPost[] }>(`?account_id=${encodeURIComponent(account)}`)
      .then((r) => {
        if (active) setPosts(r.posts);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [account, editing]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  }
  function edit(rule: InstagramAutomation | "new") {
    setConfirmation(null);
    setEditing(rule);
    setRequestId(randomId());
    setError("");
    const r = rule === "new" ? null : rule;
    setAccount(r?.accountId ?? state?.accounts.find((a) => a.active)?.id ?? "");
    setPost(r?.platformPostId ?? "");
    setName(r?.name ?? "");
    setKeywords(r?.keywords.join(", ") ?? "");
    setMode(r?.matchMode ?? "word");
    setMessage(r?.dmMessage ?? "");
    setReply(r?.commentReply ?? "");
  }
  async function confirmMutation() {
    if (!confirmation) return;
    const request = confirmation.request;
    await run(async () => {
      await api("", { ...request, confirmed: true });
      setConfirmation(null);
      if (request.action !== "toggle") setEditing(null);
      await load();
    });
  }
  return (
    <section className="mx-auto w-full max-w-5xl space-y-7 p-5 sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{t("Instagram")}</p>
          <h1 className="text-3xl font-semibold">{t("Transforme comentários em conversas.")}</h1>
          <p className="mt-3 max-w-xl text-muted-foreground">
            {t("Escolha uma postagem e as palavras que enviam sua resposta no Direct.")}
          </p>
        </div>
        <Link href="/app/connections?aba=sociais" className="text-sm underline">
          {t("Conectar Instagram")}
        </Link>
      </header>
      {error && (
        <p role="alert" className="rounded-xl border border-destructive p-4 text-destructive">
          {error}
        </p>
      )}
      {state?.message && <Notice>{state.message}</Notice>}
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={
            !state?.can_edit || busy || !!confirmation || !state.accounts.some((a) => a.active)
          }
          onClick={() => edit("new")}
        >
          {t("Nova automação")}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void run(load)}>
          {t("Atualizar resultados")}
        </Button>
      </div>
      {!state && !error && <p role="status">{t("Carregando suas automações…")}</p>}
      {state && (
        <div className="grid grid-cols-3 gap-3">
          {[
            [t("Ativas"), state.automations.filter((a) => a.isActive).length],
            [t("Directs enviados"), state.automations.reduce((n, a) => n + a.stats.dmsSent, 0)],
            [t("Falhas"), state.automations.reduce((n, a) => n + a.stats.dmsFailed, 0)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border p-4">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="mt-2 text-2xl font-semibold">{value}</p>
            </div>
          ))}
        </div>
      )}
      {state?.automations.length === 0 && (
        <p className="rounded-2xl border p-8">
          {t("Nenhuma automação ainda. Conecte uma conta e escolha sua primeira postagem.")}
        </p>
      )}
      <div className="space-y-4">
        {state?.automations.map((rule) => (
          <article key={rule.id} className="space-y-3 rounded-2xl border p-5">
            <div className="flex flex-wrap justify-between gap-3">
              <h2 className="font-semibold">{rule.name}</h2>
              <span className="text-sm">{rule.isActive ? t("Ativa") : t("Pausada")}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {rule.postTitle ||
                (rule.platformPostId
                  ? `${t("Postagem")} ${rule.platformPostId}`
                  : t("Todas as postagens"))}
            </p>
            <p className="text-sm">
              {t("Palavras:")} {rule.keywords.join(", ") || t("Qualquer comentário")}
            </p>
            <p className="rounded-xl bg-muted/40 p-3 text-sm whitespace-pre-wrap">
              {rule.dmMessage}
            </p>
            <p className="text-sm text-muted-foreground">
              {rule.stats.dmsSent} {t("enviados ·")} {rule.stats.dmsFailed} {t("falhas ·")}{" "}
              {rule.stats.read} {t("lidos")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const r = await api<{ logs: InstagramAutomationLog[] }>(`?logs=${rule.id}`);
                    setLogs({ name: rule.name, rows: r.logs });
                  })
                }
              >
                {t("Ver resultados")}
              </Button>
              {state.can_edit && (
                <>
                  <Button
                    variant="outline"
                    disabled={busy || !!confirmation}
                    onClick={() => edit(rule)}
                  >
                    {t("Editar")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy || !!confirmation}
                    onClick={() =>
                      setConfirmation({
                        name: rule.name,
                        request: { action: "toggle", id: rule.id, is_active: !rule.isActive },
                      })
                    }
                  >
                    {rule.isActive ? t("Pausar") : t("Ativar")}
                  </Button>
                </>
              )}
            </div>
            {confirmation?.request.action === "toggle" && confirmation.request.id === rule.id && (
              <ConfirmAutomation
                confirmation={confirmation}
                busy={busy}
                onConfirm={() => void confirmMutation()}
                onCancel={() => setConfirmation(null)}
              />
            )}
          </article>
        ))}
      </div>
      {logs && (
        <section ref={logsRef} className="scroll-mt-24 space-y-3 rounded-2xl border p-5">
          <div className="flex justify-between gap-3">
            <h2 className="font-semibold">
              {t("Resultados ·")} {logs.name}
            </h2>
            <Button variant="ghost" onClick={() => setLogs(null)}>
              {t("Fechar")}
            </Button>
          </div>
          {logs.rows.length === 0 && <p>{t("Nenhuma execução registrada.")}</p>}
          {logs.rows.map((log) => (
            <div key={log.id} className="space-y-1 border-t py-3 text-sm">
              <p>
                {new Date(log.createdAt).toLocaleString(idioma)} ·{" "}
                {(
                  {
                    sent: t("Enviado"),
                    failed: t("Falhou"),
                    pending: t("Aguardando envio"),
                    skipped: t("Ignorado"),
                    gated: t("Aguardando confirmação"),
                  } as Record<string, string>
                )[log.status] ?? log.status}
              </p>
              <p>{log.commentText}</p>
              {log.error && <p className="text-destructive">{log.error}</p>}
              {log.commentReplyError && (
                <p className="text-destructive">
                  {t("Resposta pública:")} {log.commentReplyError}
                </p>
              )}
            </div>
          ))}
        </section>
      )}
      {editing && (
        <section
          className="scroll-mt-24 rounded-2xl border bg-card p-5 sm:p-7"
          ref={editorRef}
          aria-label={t("Editor de automação")}
        >
          <h2 className="mb-5 text-xl font-semibold">
            {editing === "new" ? t("Nova automação") : t("Editar automação")}
          </h2>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setConfirmation({
                name,
                request: {
                  action: editing === "new" ? "create" : "edit",
                  id: editing === "new" ? requestId : editing.id,
                  rule: {
                    name,
                    account_id: account,
                    post_id: post,
                    keywords: keywords
                      .split(",")
                      .map((k) => k.trim())
                      .filter(Boolean),
                    match_mode: mode,
                    dm_response_template: message,
                    comment_reply: reply,
                  },
                },
              });
            }}
          >
            <fieldset className="space-y-4" disabled={busy || !!confirmation}>
              <label className="block space-y-2">
                <span>{t("Nome da automação")}</span>
                <Input
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="block space-y-2">
                <span>{t("Conta do Instagram")}</span>
                <select
                  className={field}
                  value={account}
                  disabled={editing !== "new"}
                  onChange={(e) => {
                    setPosts([]);
                    setAccount(e.target.value);
                    setPost("");
                  }}
                >
                  {state?.accounts
                    .filter((a) => a.active)
                    .map((a) => (
                      <option value={a.id} key={a.id}>
                        @{a.username}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block space-y-2">
                <span>{t("Postagem que receberá os comentários")}</span>
                <select
                  required
                  className={field}
                  disabled={editing !== "new"}
                  value={post}
                  onChange={(e) => setPost(e.target.value)}
                >
                  <option value="">
                    {editing === "new" ? t("Escolha uma postagem") : t("Todas as postagens")}
                  </option>
                  {post && !posts.some((p) => p.id === post) && (
                    <option value={post}>
                      {t("Postagem")} {post}
                    </option>
                  )}
                  {posts.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.message.slice(0, 110) || p.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-2">
                <span>{t("Palavras-chave, separadas por vírgula")}</span>
                <Input
                  required
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder={t("QUERO, PREÇO")}
                />
              </label>
              <label className="block space-y-2">
                <span>{t("Quando responder")}</span>
                <select className={field} value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="word">{t("A palavra aparece no comentário")}</option>
                  <option value="contains">{t("O comentário contém o texto")}</option>
                  <option value="exact">{t("O comentário é exatamente o texto")}</option>
                </select>
              </label>
              <label className="block space-y-2">
                <span id="instagram-dm-label">{t("Mensagem no Direct")}</span>
                <Textarea
                  aria-labelledby="instagram-dm-label"
                  required
                  maxLength={640}
                  rows={5}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </label>
              <label className="block space-y-2">
                <span id="instagram-reply-label">
                  {t("Resposta pública após o Direct (opcional)")}
                </span>
                <Textarea
                  aria-labelledby="instagram-reply-label"
                  maxLength={1000}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder={t("Te enviei os detalhes no Direct.")}
                />
              </label>
              <p className="text-sm text-muted-foreground">
                {t(
                  "Ao salvar uma nova regra, ela fica ativa. O envio depende das permissões e limites do Instagram; acompanhe recusas em Ver resultados.",
                )}
              </p>
              <div className="flex gap-3">
                <Button disabled={busy} type="submit">
                  {busy
                    ? t("Salvando…")
                    : editing === "new"
                      ? t("Revisar ativação")
                      : t("Revisar alterações")}
                </Button>
                <Button
                  disabled={busy}
                  variant="outline"
                  type="button"
                  onClick={() => setEditing(null)}
                >
                  {t("Cancelar")}
                </Button>
              </div>
            </fieldset>
            {confirmation && confirmation.request.action !== "toggle" && (
              <ConfirmAutomation
                confirmation={confirmation}
                busy={busy}
                onConfirm={() => void confirmMutation()}
                onCancel={() => setConfirmation(null)}
              />
            )}
          </form>
        </section>
      )}
    </section>
  );
}
