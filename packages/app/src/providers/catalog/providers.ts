import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { normalizeProviderList } from "@/runtime/server/global-sync/utils"
import { isServiceUnavailableError } from "@aicraft/client/promise"
import { retry } from "@aicraft/util/retry"
import { Iterable, pipe } from "effect"
import { createEffect, createMemo, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import type { ProviderListResponse } from "@/runtime/server/types"
import { useIntegrations } from "./integrations"

export { isPopularProvider, popularProviders, providerRank } from "./order"

const emptyProviderCatalog: ProviderListResponse = { all: new Map(), connected: [], default: {} }

// A cold Location lists its catalogs once its plugins activate, which can take longer than the server's 5 s wait.
export const syncWhileBooting = <A>(load: () => Promise<A>) =>
  retry(load, { attempts: 12, delay: 1000, maxDelay: 5000, retryIf: isServiceUnavailableError })

export function useProviders(directory: Accessor<string | undefined>) {
  const data = useData()
  const sdk = useServerSDK()

  const location = () => {
    const dir = directory()

    return dir ? { directory: dir } : undefined
  }

  // A failed catalog sync leaves both lists undefined, which reads exactly like "still loading". Keeping the failure
  // lets the settings page stop the spinner and offer the sync again.
  const [load, setLoad] = createStore<{ failed?: unknown }>({})

  const sync = async () => {
    const ref = location()

    if (!ref) await data.location.syncInfo()
    const resolved = ref ?? data.location.default()
    await syncWhileBooting(() =>
      Promise.all([data.location.provider.sync(resolved), data.location.model.sync(resolved)]),
    )
  }

  const reload = () => {
    setLoad("failed", undefined)

    return sync().catch((cause: unknown) => setLoad("failed", cause))
  }

  createEffect(() => {
    if (sdk.connection.status() !== "connected") return
    location()
    void reload()
  })
  const integrations = useIntegrations(directory)

  const providers = createMemo(() => {
    const ref = location()
    const provider = data.location.provider.list(ref)
    const model = data.location.model.list(ref)

    if (!provider || !model) return emptyProviderCatalog

    return normalizeProviderList(provider, model)
  })

  const ready = () => {
    const ref = location()

    return data.location.provider.list(ref) !== undefined && data.location.model.list(ref) !== undefined
  }

  return {
    ready,
    // The catalog sync failed; `retry` runs it again.
    error: () => load.failed,
    retry: () => void reload(),
    all: () => providers().all,
    default: () => providers().default,
    // Every provider the server reports, pinned set first and the rest by name. The settings list and the pickers
    // offer all of them: this client keeps no allowlist, so nothing is filtered here.
    catalog: () =>
      pipe(
        providers().all,
        Iterable.map(([, p]) => p),
        Iterable.map((p) => ({ id: p.id, name: p.name })),
        (v) => Array.from(v),
      ),
    connected: () => {
      const connected = new Set(providers().connected)

      return pipe(
        providers().all,
        Iterable.map(([, p]) => p),
        Iterable.filter((p) => connected.has(p.id)),
        (v) => Array.from(v),
      )
    },
    // Any stored or detected connection, or a provider with models beyond the keyless AI Craft catalog.
    // Undefined until both catalogs load, so callers never mistake loading for a first run.
    anyConnection: () => {
      if (!integrations.ready() || !ready()) return undefined

      if (integrations.list().some((integration) => integration.connections.length > 0)) return true

      return providers().connected.some(
        (id) => id !== "opencode" && Object.keys(providers().all.get(id)?.models ?? {}).length > 0,
      )
    },
    paid: () => {
      const connected = new Set(providers().connected)

      const paid = [
        ...Iterable.filter(
          providers().all,
          ([id]) =>
            connected.has(id) &&
            (id !== "opencode" || Object.values(providers().all.get(id)?.models ?? {}).some((m) => m.cost?.input)),
        ),
      ]

      return paid
    },
  }
}
