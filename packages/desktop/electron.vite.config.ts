import { defineConfig } from "electron-vite"
import type { Plugin } from "vite"
import { BetaNotes } from "./script/beta-notes"
import { pickerPlugin } from "./script/picker"
import { nodePtyPackage } from "./script/utils"

function resolveChannel() {
  const raw = process.env.OPENCODE_CHANNEL

  if (raw === "local" || raw === "dev" || raw === "beta" || raw === "prod") return raw

  if (raw === "latest") return "prod"

  return "dev"
}

const appPlugin = (await import("@opencode/app/vite")).default

const splashReadyPath = "/__opencode/splash-ready"

// Vite's bundled dev server answers the first document request with a generic "Bundling in progress"
// page. Serve the product's own splash instead, and let it reload once the first bundle is in memory.
const splashPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenCode</title>
    <style>
      html,
      body {
        height: 100%;
        margin: 0;
      }

      body {
        display: flex;
        align-items: center;
        justify-content: center;
        background: #fafafa;
      }

      @media (prefers-color-scheme: dark) {
        body {
          background: #1a1a1a;
        }
      }

      .splash {
        position: relative;
        width: min(500px, 80vw);
        line-height: 0;
        opacity: 0.6;
      }

      @media (prefers-color-scheme: dark) {
        .splash {
          filter: saturate(0.62) brightness(0.86);
        }
      }

      .splash img {
        display: block;
        width: 100%;
        height: auto;
      }

      /* The light is the same artwork painted white under a moving gradient mask, so the band only lands on the
         letterforms. A filled layer here would sweep a white rectangle over the splash. */
      .sweep {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: contain;
        filter: brightness(0) invert(1);
        mix-blend-mode: screen;
        -webkit-mask-image: linear-gradient(to right, transparent 38%, #000 50%, transparent 62%);
        mask-image: linear-gradient(to right, transparent 38%, #000 50%, transparent 62%);
        -webkit-mask-size: 300% 100%;
        mask-size: 300% 100%;
        -webkit-mask-repeat: no-repeat;
        mask-repeat: no-repeat;
        animation: sweep 1800ms ease-in-out infinite;
      }

      @keyframes sweep {
        0% {
          -webkit-mask-position: 100% 0;
          mask-position: 100% 0;
          opacity: 0;
        }

        18%,
        82% {
          opacity: 0.9;
        }

        100% {
          -webkit-mask-position: 0% 0;
          mask-position: 0% 0;
          opacity: 0;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .sweep {
          animation: none;
          opacity: 0;
        }
      }
    </style>
  </head>
  <body>
    <div class="splash">
      <img src="/assets/changhong.svg" alt="" />
      <img class="sweep" src="/assets/changhong.svg" alt="" aria-hidden="true" />
    </div>
    <script>
      const timer = setInterval(() => {
        fetch("${splashReadyPath}", { cache: "no-store" })
          .then((response) => {
            if (response.status !== 204) return

            clearInterval(timer)
            location.reload()
          })
          .catch(() => {})
      }, 250)
    </script>
  </body>
</html>`

const bundledSplash: Plugin = {
  name: "opencode-desktop:bundled-splash",
  apply: "serve",
  configureServer(server) {
    const ready = async (bundled: NonNullable<typeof server.environments.client.bundledDev>) =>
      !(await bundled.triggerBundleRegenerationIfStale()) && bundled.memoryFiles.get("index.html") !== undefined

    server.middlewares.use((req, res, next) => {
      const bundled = server.environments.client.bundledDev

      if (!bundled || req.method !== "GET") return next()

      const pathname = new URL(req.url ?? "/", "http://localhost").pathname

      void (async () => {
        if (pathname === splashReadyPath) {
          res.statusCode = (await ready(bundled)) ? 204 : 503
          res.setHeader("cache-control", "no-store")
          res.end()
          return
        }

        if (pathname !== "/" && pathname !== "/index.html") return next()

        if (await ready(bundled)) return next()

        res.statusCode = 200
        res.setHeader("content-type", "text/html; charset=utf-8")
        res.setHeader("cache-control", "no-store")
        res.end(splashPage)
      })().catch(next)
    })
  },
}

// Every module the entry reaches through static imports lands in one chunk. Automatic splitting
// otherwise fragments the initial graph into ~50 files shared with lazy routes, and each file costs
// the renderer a main-thread request round trip through the main process before first paint.
// Rolldown hands every chunk-name call a fresh context, so the graph is walked once per output.
const initialGraph = new Set<string>()

const initialChunk: Plugin = {
  name: "opencode-desktop:initial-chunk",
  renderStart() {
    const entries = [...this.getModuleIds()].filter((id) => this.getModuleInfo(id)?.isEntry)
    initialGraph.clear()
    entries.forEach((id) => initialGraph.add(id))

    // A Set's iterator also visits members added while iterating, so this reaches every static import.
    for (const id of initialGraph) this.getModuleInfo(id)?.importedIds.forEach((imported) => initialGraph.add(imported))
  },
}

export default defineConfig(async ({ command }) => {
  const channel = resolveChannel()
  const nodePtyPkg = nodePtyPackage()

  // Beta builds carry their commit and recent history for the updater's "What's new in beta"; the dev server carries
  // them without asking GitHub, so the page can be tried; other channels none.
  const betaNotes =
    channel === "beta"
      ? await BetaNotes.enrich(BetaNotes.embed(), { token: process.env.GITHUB_TOKEN })
      : command === "serve"
        ? BetaNotes.embed()
        : undefined

  return {
    main: {
      resolve: {
        dedupe: ["effect"],
      },
      define: {
        // Local renderer/server mode still uses the dev application identity and updater policy.
        "import.meta.env.OPENCODE_CHANNEL": JSON.stringify(channel === "local" ? "dev" : channel),
      },
      build: {
        minify: command === "build",
        rolldownOptions: {
          input: { index: "src/main/index.ts" },
          output: {
            format: "es",
            // DesktopPaths resolves resources from the main output directory,
            // including when the lazy desktop entry shares it with other chunks.
            chunkFileNames: "[name]-[hash].js",
          },
        },
        externalizeDeps: {
          // Bundle the Effect family together.
          exclude: ["effect", "@effect/platform-node", "@effect/platform-node-shared", "drizzle-orm"],
          include: [nodePtyPkg],
        },
      },
      plugins: [
        {
          name: "opencode:node-pty-narrower",
          enforce: "pre",
          resolveId(s) {
            if (s === "@lydell/node-pty") return nodePtyPkg

            return undefined
          },
        },
        {
          // Rolldown emits its own scoped createRequire runtime for CommonJS dependencies.
          // electron-vite's post-bundle regex shim injects a top-level `const require` that collides
          // with bundled ESM modules declaring their own `require` (such as @effect/platform-node).
          name: "opencode:disable-esm-shim",
          configResolved(config) {
            const shim = config.plugins.find((plugin) => plugin.name === "vite:esm-shim")

            if (shim) delete shim.renderChunk
          },
        },
      ],
    },
    preload: {
      build: {
        minify: command === "build",
        rolldownOptions: {
          input: { index: "src/preload/index.ts" },
          output: {
            format: "cjs",
            // The package is "type": "module". Under --no-sandbox Electron loads the preload
            // through Node's module loader, which treats a .js file as ESM and fails on
            // require("electron"). The sandboxed path ignores the extension.
            entryFileNames: "[name].cjs",
          },
        },
      },
    },
    renderer: {
      experimental: {
        bundledDev: true,
      },
      define: {
        "import.meta.env.OPENCODE_VERSION": JSON.stringify(process.env.OPENCODE_VERSION),
        "import.meta.env.VITE_OPENCODE_CHANNEL": JSON.stringify(channel),
        "import.meta.env.OPENCODE_COMMIT": betaNotes ? JSON.stringify(betaNotes.sha) : "undefined",
        "import.meta.env.OPENCODE_BETA_NOTES": betaNotes ? JSON.stringify(JSON.stringify(betaNotes)) : "undefined",
        "import.meta.env.OPENCODE_TEST_ONBOARDING": JSON.stringify(
          command === "serve" && process.env.OPENCODE_TEST_ONBOARDING === "1",
        ),
      },
      plugins: [bundledSplash, pickerPlugin(), appPlugin, initialChunk],
      publicDir: "../../../app/public",
      root: "src/renderer",
      build: {
        minify: command === "build",
        sourcemap: true,
        rolldownOptions: {
          input: {
            main: "src/renderer/index.html",
          },
          output: {
            codeSplitting: {
              groups: [{ name: (id) => (initialGraph.has(id) ? "app" : null), priority: 10 }],
            },
          },
        },
      },
    },
  }
})
