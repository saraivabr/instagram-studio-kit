import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createAi, createStudio } from "../dist/index.js";
import { memoryRepository } from "./memory.mjs";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh+kAAAAASUVORK5CYII=";
const mockRequest = async (path) =>
  path.startsWith("images/")
    ? { data: [{ b64_json: png }] }
    : {
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "Legenda demonstrativa. Conheça as possibilidades para seu negócio.",
              },
            ],
          },
        ],
      };
const assets = new Map();
const studio = createStudio({
  ai: createAi(mockRequest, { image: "mock", text: "mock" }),
  repository: memoryRepository(),
  assets: {
    async save(tenant, id, bytes) {
      const path = `${tenant}/${id}`;
      assets.set(path, bytes);
      return path;
    },
  },
});
const server = createServer(async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end(await readFile(new URL("./index.html", import.meta.url)));
    }
    if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
      const bytes = assets.get(decodeURIComponent(url.pathname.slice(8)));
      if (!bytes) {
        res.writeHead(404);
        return res.end();
      }
      res.setHeader("Content-Type", "image/png");
      return res.end(bytes);
    }
    if (req.method !== "POST" || url.pathname !== "/api/create") {
      res.writeHead(404);
      return res.end();
    }
    // Local demo accepts only same-origin browser mutations.
    const expected = `http://127.0.0.1:${server.address().port}`;
    if (req.headers.origin !== expected) {
      res.writeHead(403);
      return res.end("Origem inválida.");
    }
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 16000) {
        res.writeHead(413);
        return res.end();
      }
    }
    const item = await studio.create("demo", JSON.parse(body), {
      name: "Sua empresa",
    });
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ...item,
        image_url: `/assets/${encodeURIComponent(item.asset_path)}`,
        demo: true,
      }),
    );
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Confira o pedido. Ideia: 10–3000 caracteres; nicho: 2–2000.",
      }),
    );
  }
});
server.listen(Number(process.env.PORT || 4317), "127.0.0.1", () =>
  console.log(
    `Demo local: http://127.0.0.1:${server.address().port} (simulação, sem chamadas pagas)`,
  ),
);
