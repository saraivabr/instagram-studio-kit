import type { NextConfig } from "next";
import { resolve } from "node:path";
import tempoNextjsPlugin from "tempo-sdk/nextjs";

const development = process.env.NODE_ENV === "development";
// Tempo's design canvas renders routes in an iframe and sets TEMPO=true only for that dev server.
// Every other run, including production, keeps the app unframeable.
const canvasPreview = development && process.env.TEMPO === "true";
// App Router needs inline hydration scripts. Hosts that require strict script
// isolation should replace unsafe-inline with a per-request nonce in a proxy.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  `connect-src 'self'${development ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  `frame-ancestors ${canvasPreview ? "*" : "'none'"}`,
].join("; ");

const config: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  turbopack: { root: resolve(process.cwd(), "../..") },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          ...(canvasPreview ? [] : [{ key: "X-Frame-Options", value: "DENY" }]),
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
// The plugin only annotates elements under TEMPO=true; otherwise the config is unchanged.
export default tempoNextjsPlugin()(
  config as Parameters<ReturnType<typeof tempoNextjsPlugin>>[0],
) as NextConfig;
