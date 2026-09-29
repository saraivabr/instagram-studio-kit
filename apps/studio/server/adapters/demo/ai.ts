import "server-only";
import sharp from "sharp";
const escape = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export const mockAiRequest = async (
  path: string,
  body: Record<string, unknown>,
) => {
  if (path.startsWith("images/")) {
    const size = String(body.size).split("x").map(Number);
    const [width, height] = size as [number, number];
    const prompt = String(body.prompt);
    const title = escape(
      (
        prompt.match(/Pedido: ([\s\S]*?)\. Use a identidade/)?.[1] ??
        "Sua ideia ganha forma"
      ).slice(0, 100),
    );
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f3f1ec"/><circle cx="${width * 0.85}" cy="${height * 0.22}" r="${width * 0.4}" fill="#c8d6c1"/><rect x="70" y="${height * 0.5}" width="${width - 140}" height="${height * 0.3}" rx="32" fill="#41573b"/><text x="85" y="115" font-family="sans-serif" font-size="26" fill="#506d48">STUDIO · DEMONSTRAÇÃO</text><text x="85" y="${height * 0.56}" font-family="sans-serif" font-size="32" fill="white">Conteúdo para seu negócio</text><foreignObject x="85" y="${height * 0.6}" width="${width - 180}" height="${height * 0.18}"><div xmlns="http://www.w3.org/1999/xhtml" style="font:24px sans-serif;color:white;line-height:1.5">${title}</div></foreignObject><text x="85" y="${height - 75}" font-family="sans-serif" font-size="24" fill="#5d594f">Arte simulada · sem geração de IA</text></svg>`;
    const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
    return { data: [{ b64_json: bytes.toString("base64") }] };
  }
  if (body.tools)
    throw new Error(
      "Pesquisa real requer credencial e modelo configurados no servidor.",
    );
  return {
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "[Demonstração] Organize suas ideias e transforme conhecimento em conteúdo útil. Qual é o próximo passo para seu negócio?",
          },
        ],
      },
    ],
  };
};
