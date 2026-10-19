"use client";
import { useT } from "@/hooks/i18n/useT";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StudioShell, Intro, Notice } from "@/features/instagram/components/shared";
type BrandView = {
  name: string;
  description: string;
  accent: string;
  logo_url: string | null;
  logo_mode: "ai" | "stamp";
  can_edit: boolean;
};
async function brandApi(path: string, init?: RequestInit): Promise<BrandView> {
  const response = await fetch(`/api/v1/brand${path}`, init);
  const json = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(json?.error?.message || "Não foi possível concluir. Tente novamente.");
  return json.data;
}
const hex = /^#[0-9a-fA-F]{6}$/;
export function BrandSettings({
  canEdit,
  initial,
}: {
  canEdit: boolean;
  initial: {
    name: string;
    description: string;
    accent: string;
    logoUrl: string | null;
    logoMode: "ai" | "stamp";
  };
}) {
  const t = useT();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [accent, setAccent] = useState(initial.accent);
  const [logoMode, setLogoMode] = useState(initial.logoMode);
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const disabled = busy || !canEdit;
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  }
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    return run(async () => {
      const brand = await brandApi("", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, accent, logo_mode: logoMode }),
      });
      setAccent(brand.accent);
      setSaved(true);
      router.refresh();
    });
  };
  const upload = (file: File | undefined) => {
    if (!file) return;
    return run(async () => {
      if (!["image/png", "image/jpeg"].includes(file.type))
        throw new Error(
          "Formato não aceito. Envie o logo em PNG ou JPG; SVG, PDF e WebP não são aceitos.",
        );
      if (file.size > 5_000_000) throw new Error("O logo deve ter até 5 MB.");
      const body = new FormData();
      body.append("logo", file);
      const brand = await brandApi("/logo", { method: "POST", body });
      setLogoUrl(brand.logo_url);
      setSaved(true);
      router.refresh();
    });
  };
  const remove = () =>
    run(async () => {
      const brand = await brandApi("/logo", { method: "DELETE" });
      setLogoUrl(brand.logo_url);
      setSaved(true);
      router.refresh();
    });
  const preview = (background: string) => (
    <div
      className="flex h-28 items-center justify-center rounded-2xl border border-border p-4"
      style={{ background }}
    >
      {logoUrl && (
        <Image
          unoptimized
          width={160}
          height={80}
          src={logoUrl}
          alt={t("Logo da empresa")}
          className="max-h-20 w-auto object-contain"
        />
      )}
    </div>
  );
  return (
    <StudioShell>
      <Intro eyebrow={t("Configurações")} title={t("Minha marca")}>
        {t("Cadastre uma vez. As próximas artes usam o nome, a cor e o logo da sua empresa.")}
      </Intro>
      <form onSubmit={save} className="max-w-2xl space-y-6">
        {!canEdit && (
          <Notice>
            {t("Você pode ver a marca, mas só quem edita conteúdo consegue alterá-la.")}
          </Notice>
        )}
        <div className="space-y-2">
          <label htmlFor="brand-name" className="block font-medium">
            {t("Nome da empresa")}
          </label>
          <Input
            id="brand-name"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="brand-description" className="block font-medium">
            {t("O que a empresa faz")}
          </label>
          <Textarea
            id="brand-description"
            required
            minLength={2}
            maxLength={2000}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="brand-accent-hex" className="block font-medium">
            {t("Cor principal")}
          </label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              aria-label={t("Selecionar cor")}
              value={hex.test(accent) ? accent : "#506d48"}
              onChange={(e) => setAccent(e.target.value)}
              disabled={disabled}
              className="h-11 w-14 cursor-pointer rounded-lg border border-border bg-transparent"
            />
            <Input
              id="brand-accent-hex"
              required
              pattern="#[0-9a-fA-F]{6}"
              maxLength={7}
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              disabled={disabled}
              className="w-32 font-mono"
            />
          </div>
        </div>
        <fieldset className="space-y-3" disabled={disabled}>
          <legend className="block font-medium">{t("Logo")}</legend>
          {logoUrl ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {preview("#ffffff")}
              {preview("#1f2a1c")}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("Nenhum logo enviado ainda.")}</p>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg"
            aria-label={t("Arquivo do logo")}
            className="sr-only"
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
              {logoUrl ? t("Trocar") : t("Enviar logo")}
            </Button>
            {logoUrl && (
              <Button type="button" variant="outline" onClick={() => void remove()}>
                {t("Remover")}
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {t("PNG ou JPG até 5 MB. Prefira PNG com fundo transparente.")}
          </p>
        </fieldset>
        <fieldset className="space-y-2" disabled={disabled}>
          <legend className="block font-medium">{t("Como aplicar o logo")}</legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="logo-mode"
              checked={logoMode === "stamp"}
              onChange={() => setLogoMode("stamp")}
              className="mt-1 accent-current"
            />
            <span>
              {t("Aplicar o arquivo original no canto (recomendado)")}
              <span className="block text-muted-foreground">
                {t("O logo sai idêntico ao enviado, em qualquer provedor de imagem.")}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="logo-mode"
              checked={logoMode === "ai"}
              onChange={() => setLogoMode("ai")}
              className="mt-1 accent-current"
            />
            <span>
              {t("A IA desenha o logo na arte")}
              <span className="block text-muted-foreground">
                {t("A IA pode redesenhar o logo e trocar letras. Confira cada arte.")}
              </span>
            </span>
          </label>
        </fieldset>
        {error && <Notice error>{error}</Notice>}
        {saved && !error && <Notice>{t("Marca salva.")}</Notice>}
        {canEdit && (
          <Button size="lg" type="submit" disabled={busy}>
            {busy ? t("Salvando…") : t("Salvar marca")}
          </Button>
        )}
      </form>
    </StudioShell>
  );
}
