import { Manrope, IBM_Plex_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";
const manrope = Manrope({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-interface",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  weight: ["400", "500"],
  variable: "--font-mono",
});
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Instagram Studio",
  description: "O módulo de Instagram para integrar à sua solução.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${manrope.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-bg font-sans text-text antialiased">
        <Providers>
          <div className="border-b border-border bg-accent-soft px-6 py-2 text-center text-xs">
            {process.env.OPENAI_API_KEY
              ? "Instalação local · criação com IA configurada · publicação e Direct não conectados"
              : "Demonstração local · artes simuladas · publicação e Direct não conectados"}
          </div>
          <main className="mx-auto max-w-[1440px] p-4 sm:p-8 lg:px-12 lg:py-10">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
