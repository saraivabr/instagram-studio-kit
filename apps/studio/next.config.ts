import type { NextConfig } from "next";
import { resolve } from "node:path";
const config: NextConfig = {
  devIndicators: false,
  turbopack: { root: resolve(process.cwd(), "../..") },
};
export default config;
