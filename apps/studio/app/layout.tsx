import localFont from "next/font/local";
import { Providers } from "./providers";
import { ConfigurationBanner } from "@/features/instagram/components/shared";
import "./globals.css";
const manrope = localFont({
  src: "../public/fonts/manrope.ttf",
  display: "swap",
  variable: "--font-interface",
});
const mono = localFont({
  src: [
    { path: "../public/fonts/ibm-plex-mono-regular.ttf", weight: "400" },
    { path: "../public/fonts/ibm-plex-mono-medium.ttf", weight: "500" },
  ],
  display: "swap",
  variable: "--font-mono",
});
export const metadata = {
  title: "Instagram Studio",
  description: "O módulo de Instagram para integrar à sua solução.",
  icons: { icon: "/favicon.svg" },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${manrope.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-bg font-sans text-text antialiased">
        <Providers>
          <ConfigurationBanner />
          <main className="mx-auto max-w-[1440px] p-4 sm:p-8 lg:px-12 lg:py-10">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
