"use client";
import { useT } from "@/hooks/i18n/useT";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StudioShell, Intro, Notice } from "@/features/instagram/components/shared";
import type { BrandPersonView } from "@/lib/instagram/brand";
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
    people: BrandPersonView[];
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
      <BrandPeople canEdit={canEdit} initial={initial.people} />
    </StudioShell>
  );
}
async function peopleApi(path: string, init?: RequestInit): Promise<BrandPersonView[]> {
  const response = await fetch(`/api/v1/brand/people${path}`, init);
  const json = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(json?.error?.message || "Não foi possível concluir. Tente novamente.");
  return json.data.people;
}
/** People who authorized the use of their image. Photos are private and go only to the provider. */
function BrandPeople({ canEdit, initial }: { canEdit: boolean; initial: BrandPersonView[] }) {
  const t = useT();
  const router = useRouter();
  const photoInput = useRef<HTMLInputElement>(null);
  const [people, setPeople] = useState(initial);
  const [name, setName] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const disabled = busy || !canEdit;
  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setNotice(await action());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  }
  const choose = (files: FileList | null) => {
    const list = Array.from(files ?? []);
    setError("");
    if (list.length > 3) return setError(t("Escolha no máximo 3 fotos."));
    if (list.some((file) => !["image/png", "image/jpeg"].includes(file.type)))
      return setError(t("Envie fotos em PNG ou JPG; HEIC, WebP, SVG e PDF não são aceitos."));
    if (list.some((file) => file.size > 5_000_000))
      return setError(t("Cada foto deve ter até 5 MB."));
    setPhotos(list);
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    return run(async () => {
      if (!consent) throw new Error(t("Confirme a autorização da pessoa antes de enviar."));
      if (!photos.length) throw new Error(t("Escolha de 1 a 3 fotos de frente."));
      const body = new FormData();
      body.append("name", name);
      body.append("consent", "true");
      for (const photo of photos) body.append("photos", photo);
      setPeople(await peopleApi("", { method: "POST", body }));
      setName("");
      setPhotos([]);
      setConsent(false);
      return t("Pessoa adicionada. Ela já pode ser incluída nas próximas artes.");
    });
  };
  const remove = (person: BrandPersonView) =>
    run(async () => {
      setPeople(await peopleApi(`/${person.id}`, { method: "DELETE" }));
      return t("Pessoa e fotos removidas.");
    });
  return (
    <section aria-labelledby="brand-people" className="mt-12 max-w-2xl space-y-6">
      <div className="space-y-2">
        <h2 id="brand-people" className="text-2xl font-medium">
          {t("Pessoas da marca")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t(
            "Cadastre quem pode aparecer nas artes, como você ou alguém da equipe. Na criação, escolha incluir a pessoa.",
          )}
        </p>
        <Notice>
          {t(
            "O rosto é aproximado, não idêntico, e pode variar entre as artes. Nem todo provedor de imagem aceita fotos de referência. As fotos ficam privadas na sua organização, são enviadas só ao provedor de imagem e saem na hora quando você remove a pessoa.",
          )}
        </Notice>
      </div>
      {people.length ? (
        <ul className="space-y-3">
          {people.map((person) => (
            <li
              key={person.id}
              className="flex flex-wrap items-center gap-4 rounded-2xl border border-border p-4"
            >
              <div className="flex gap-2">
                {person.photo_urls.map((url, index) => (
                  <Image
                    key={url}
                    unoptimized
                    width={56}
                    height={56}
                    src={url}
                    alt={`${t("Foto")} ${index + 1} ${t("de")} ${person.name}`}
                    className="h-14 w-14 rounded-xl object-cover"
                  />
                ))}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{person.name}</p>
                <p className="text-sm text-muted-foreground">
                  {t("Autorização confirmada em")}{" "}
                  {new Date(person.consent_at).toLocaleDateString("pt-BR")}
                </p>
              </div>
              {canEdit && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void remove(person)}
                >
                  {t("Remover")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("Nenhuma pessoa cadastrada ainda.")}</p>
      )}
      {canEdit && (
        <form onSubmit={add} className="space-y-4 rounded-3xl border border-border bg-muted/30 p-5">
          <div className="space-y-2">
            <label htmlFor="person-name" className="block font-medium">
              {t("Nome da pessoa")}
            </label>
            <Input
              id="person-name"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <input
              ref={photoInput}
              type="file"
              multiple
              accept="image/png,image/jpeg"
              aria-label={t("Fotos da pessoa")}
              className="sr-only"
              onChange={(e) => {
                choose(e.target.files);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => photoInput.current?.click()}
            >
              {photos.length ? t("Trocar fotos") : t("Escolher fotos")}
            </Button>
            <p className="text-sm text-muted-foreground">
              {photos.length
                ? `${photos.length} ${photos.length === 1 ? t("foto escolhida") : t("fotos escolhidas")}`
                : t("De 1 a 3 fotos de frente, com boa luz. PNG ou JPG até 5 MB cada.")}
            </p>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              required
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              disabled={disabled}
              className="mt-1"
            />
            {t("Tenho autorização desta pessoa para usar a imagem dela.")}
          </label>
          {error && <Notice error>{error}</Notice>}
          {notice && !error && <Notice>{notice}</Notice>}
          <Button type="submit" disabled={busy || !consent || !photos.length}>
            {busy ? t("Enviando…") : t("Adicionar pessoa")}
          </Button>
        </form>
      )}
      {!canEdit && error && <Notice error>{error}</Notice>}
    </section>
  );
}
