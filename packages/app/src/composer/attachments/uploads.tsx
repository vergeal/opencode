import { createEffect, createRoot, For, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode/ui/icon"
import { Toast, toaster } from "@opencode/ui/toast"
import { useLanguage } from "@/runtime/i18n/language"

export type Upload = {
  id: string
  filename: string
  mime: string
  size: number
  loaded: number
  cancel: () => void
  /** Set when the upload failed; the item stays listed so the row can explain why. */
  error?: string
}

// Uploads outlive the composer that started them, so one process-wide list feeds every chip
// and the single progress toast.
const [state, setState] = createStore<{ items: Upload[] }>({ items: [] })

const remove = (id: string) => setState("items", (items) => items.filter((item) => item.id !== id))

export const uploads = {
  items: () => state.items,
  dismiss: remove,
  /** Runs `work` while the upload is listed. Resolves to undefined when the user cancels it. */
  async track<T>(
    input: Pick<Upload, "id" | "filename" | "mime" | "size">,
    work: (report: (loaded: number) => void, signal: AbortSignal) => Promise<T>,
  ): Promise<T | undefined> {
    const controller = new AbortController()

    // The work may wait where it cannot observe the signal, such as a request queued behind
    // others, so cancelling settles without it.
    const cancelled = new Promise<undefined>((resolve) =>
      controller.signal.addEventListener("abort", () => resolve(undefined), { once: true }),
    )

    setState("items", (items) => [...items, { ...input, loaded: 0, cancel: () => controller.abort() }])

    try {
      const result = await Promise.race([
        work((loaded) => setState("items", (item) => item.id === input.id, "loaded", loaded), controller.signal),
        cancelled,
      ])

      remove(input.id)

      return result
    } catch (error) {
      if (controller.signal.aborted) {
        remove(input.id)

        return undefined
      }

      // Keep a failed row in place with the reason, so the failure is visible after the toast would go.
      setState("items", (item) => item.id === input.id, "error", error instanceof Error ? error.message : String(error))
      throw error
    }
  },
}

// Sonner builds toast content outside the app's Solid tree: no context and no owner. This host
// lives inside the providers, lends the toast its language instance, and gives the content a
// root of its own so progress stays reactive.
export function UploadToastHost() {
  const language = useLanguage()
  let active: { id: number; dispose: () => void } | undefined

  const dismiss = () => {
    if (!active) return
    toaster.dismiss(active.id)
    active.dispose()
    active = undefined
  }

  createEffect(
    on(
      () => state.items.length > 0,
      (uploading) => {
        if (!uploading) return dismiss()

        if (active) return

        const id = toaster.show(
          (props) =>
            createRoot((dispose) => {
              active = { id: props.toastId, dispose }

              return <UploadToast toastId={props.toastId} language={language} />
            }),
          { persistent: true, resize: () => state.items.length },
        )

        active ??= { id, dispose: () => {} }
      },
    ),
  )
  onCleanup(dismiss)

  return null
}

function UploadToast(props: { toastId: number; language: ReturnType<typeof useLanguage> }) {
  const percent = (item: Upload) => (item.size === 0 ? 100 : Math.floor((item.loaded / item.size) * 100))

  return (
    <Toast toastId={props.toastId}>
      <Toast.Content>
        <For each={state.items}>
          {(item) => (
            <Show
              when={!item.error}
              fallback={
                <div data-component="upload-row" data-error="true" role="alert">
                  <div data-slot="upload-row-label">
                    <span data-slot="upload-row-name" title={item.filename}>
                      {item.filename}
                    </span>
                    <button
                      type="button"
                      data-slot="upload-row-cancel"
                      aria-label={props.language.t("common.dismiss")}
                      onClick={() => uploads.dismiss(item.id)}
                    >
                      <Icon name="outline-xmark" />
                    </button>
                  </div>
                  <span data-slot="upload-row-error">{item.error}</span>
                </div>
              }
            >
              <div data-component="upload-row">
                <div data-slot="upload-row-label">
                  <span data-slot="upload-row-name" title={item.filename}>
                    {item.filename}
                  </span>
                  <span data-slot="upload-row-percent">
                    {props.language.t("prompt.toast.uploading.percent", { percent: percent(item) })}
                  </span>
                </div>
                <div data-slot="upload-row-track">
                  <div
                    data-component="upload-progress"
                    role="progressbar"
                    aria-label={item.filename}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent(item)}
                  >
                    <div data-slot="upload-progress-bar" style={{ width: `${percent(item)}%` }} />
                  </div>
                  <button
                    type="button"
                    data-slot="upload-row-cancel"
                    aria-label={props.language.t("prompt.toast.uploading.cancelFile", { filename: item.filename })}
                    onClick={() => item.cancel()}
                  >
                    <Icon name="outline-xmark" />
                  </button>
                </div>
              </div>
            </Show>
          )}
        </For>
      </Toast.Content>
    </Toast>
  )
}
