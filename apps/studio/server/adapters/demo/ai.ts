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
export const mockAiRequest = async (path: string, body: Record<string, unknown>) => {
  if (path.startsWith("images/")) {
    const size = String(body.size).split("x").map(Number);
    const [width, height] = size as [number, number];
    const prompt = String(body.prompt);
    const requested =
      prompt.match(/Pedido: ([\s\S]*?)\. Use a identidade/)?.[1] ?? "Sua ideia ganha forma";
    const slide = requested.match(/Slide (\d\/8) — ([^:\n]+):/);
    const idea = requested.match(/Ideia e fatos fornecidos pelo usuário: ([^\n]+)/)?.[1];
    const title = escape(
      (slide ? `Slide ${slide[1]} · ${slide[2]}. ${idea ?? "Sua ideia"}` : requested).slice(0, 150),
    );
    const words = title.split(/\s+/);
    const lines: string[] = [];
    for (const word of words) {
      const last = lines.at(-1);
      if (last && last.length + word.length < 36) lines[lines.length - 1] = last + " " + word;
      else lines.push(word);
    }
    const text = lines
      .slice(0, 4)
      .map(
        (line, index) =>
          `<tspan x="${Math.round(width * 0.16)}" dy="${index ? 36 : 0}">${line}</tspan>`,
      )
      .join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f3f1ec"/><circle cx="${width * 0.85}" cy="${height * 0.22}" r="${width * 0.4}" fill="#c8d6c1"/><rect x="70" y="${height * 0.5}" width="${width - 140}" height="${height * 0.3}" rx="32" fill="#41573b"/><text x="${Math.round(width * 0.16)}" y="${height * 0.16}" font-family="sans-serif" font-size="26" fill="#506d48">STUDIO · DEMONSTRAÇÃO</text><text x="${Math.round(width * 0.16)}" y="${height * 0.56}" font-family="sans-serif" font-size="32" fill="white">Conteúdo para seu negócio</text><text x="${Math.round(width * 0.16)}" y="${height * 0.64}" font-family="DejaVu Sans, sans-serif" font-size="26" fill="white">${text}</text><text x="${Math.round(width * 0.16)}" y="${height * 0.83}" font-family="sans-serif" font-size="24" fill="#5d594f">Arte simulada · sem geração de IA</text></svg>`;
    const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
    return { data: [{ b64_json: bytes.toString("base64") }] };
  }
  if (body.tools)
    throw new Error("Pesquisa real requer credencial e modelo configurados no servidor.");
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
