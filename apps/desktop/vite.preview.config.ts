import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const desktopRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(desktopRoot, "..", "..");
const sourceIndex = join(desktopRoot, "src", "index.html");

function desktopPreviewHtml(): Plugin {
  return {
    name: "desktop-preview-html",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url !== "/" && request.url !== "/index.html") {
          next();
          return;
        }

        const html = readFileSync(sourceIndex, "utf8")
          .replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>\n\s*/u, "")
          .replace('href="./styles.css"', 'href="/apps/desktop/src/styles.css"')
          .replace('src="./app-icon.svg"', 'src="/apps/desktop/src/app-icon.svg"')
          .replace('src="./renderer.js"', 'src="/apps/desktop/src/browserPreview.ts"');
        const transformed = await server.transformIndexHtml(request.url, html);

        response.statusCode = 200;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(transformed);
      });
    }
  };
}

export default defineConfig({
  root: repoRoot,
  plugins: [desktopPreviewHtml()],
  server: {
    port: 5173,
    strictPort: false
  }
});
