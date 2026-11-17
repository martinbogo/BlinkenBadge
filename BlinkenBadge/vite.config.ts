import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

// Which host the editor is built against. The unused implementation is not
// bundled, so the desktop build carries no font table and the web build
// carries no Tauri client.
const target = process.env.BADGE_TARGET === "web" ? "web" : "tauri";

// https://vite.dev/config/
export default defineConfig(async () => ({
  define: {
    __BADGE_HOST__: JSON.stringify(process.env.TAURI_ENV_PLATFORM ?? "desktop"),
  },
  build: { target: ["safari15", "chrome111"] },
  // Relative, so the browser build works from a subdirectory. Vite's default
  // emits root-absolute asset paths, which 404 for anyone not hosting at the
  // domain root. The desktop build is always served from the root of its own
  // webview, so it keeps the default.
  base: target === "web" ? "./" : "/",

  plugins: [
    react(),
    ...(target === "web"
      ? [
          {
            name: "web-content-security-policy",
            apply: "build" as const,
            transformIndexHtml: () => [
              {
                tag: "meta",
                attrs: {
                  "http-equiv": "Content-Security-Policy",
                  content:
                    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'",
                },
                injectTo: "head-prepend" as const,
              },
            ],
          },
        ]
      : []),
  ],

  resolve: {
    alias: {
      "@platform-impl": fileURLToPath(
        new URL(`./src/platform/${target}.ts`, import.meta.url),
      ),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    // The web build imports the generated glyph table, which lives beside the
    // Rust one at the repository root rather than inside this package.
    fs: { allow: [".."] },
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
