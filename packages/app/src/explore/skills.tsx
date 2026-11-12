import type { SkillInfo } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Switch } from "@opencode/ui/switch"
import { TextInput } from "@opencode/ui/text-input"
import { Textarea } from "@opencode/ui/textarea"
import { getDirectory, getFilename } from "@opencode/util/path"
import { For, Show, createEffect, createMemo, createResource, on, type Component } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useExploreInstalled } from "@/explore/installed"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { showToast } from "@/shell/notifications/toast"
import { PageHeader } from "@/shell/page"
import { useLayout } from "@/shell/state/layout"
import "./explore.css"
import { loadCatalog, type CatalogSkill } from "./catalog"

const isVirtual = (skill: SkillInfo) => skill.path.startsWith("skill://") || skill.path.startsWith("/builtin/")

/**
 * Rewrites `metadata.opencode/autoinvoke` in a SKILL.md frontmatter block, leaving every other byte of the file
 * intact. The server reads that key before `disable-model-invocation`, so writing it always wins.
 */
function withAutoinvoke(text: string, enabled: boolean) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const value = String(enabled)
  const match = /^(---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/.exec(text)

  if (!match) return `---${eol}metadata:${eol}  opencode/autoinvoke: ${value}${eol}---${eol}${text}`

  const [, open, frontmatter, close] = match
  const lines = frontmatter.split(/\r?\n/)
  const metadata = lines.findIndex((line) => /^metadata[ \t]*:[ \t]*(?:#.*)?$/.test(line))

  if (metadata === -1) {
    if (lines.some((line) => /^metadata[ \t]*:/.test(line))) throw new Error("unsupported frontmatter")

    lines.push("metadata:", `  opencode/autoinvoke: ${value}`)
  } else {
    const end = lines.findIndex((line, index) => index > metadata && line.trim() !== "" && !/^[ \t]/.test(line))
    const stop = end === -1 ? lines.length : end

    const existing = lines.findIndex(
      (line, index) => index > metadata && index < stop && /^([ \t]+)opencode\/autoinvoke[ \t]*:/.test(line),
    )

    if (existing !== -1) {
      const indent = /^[ \t]+/.exec(lines[existing])![0]

      lines[existing] = `${indent}opencode/autoinvoke: ${value}`
    } else {
      const child = lines.slice(metadata + 1, stop).find((line) => line.trim() !== "")
      const indent = child ? (/^[ \t]+/.exec(child)?.[0] ?? "  ") : "  "

      lines.splice(metadata + 1, 0, `${indent}opencode/autoinvoke: ${value}`)
    }
  }

  return `${open}${lines.join(eol)}${close}${text.slice(match[0].length)}`
}

function readText(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes)
}

function trimDirectory(directory: string) {
  return directory.replace(/[\\/]+$/, "")
}

/** The SKILL.md a new skill needs: frontmatter, then the instructions the model reads. */
function composeSkill(input: { name: string; description: string; instructions: string }) {
  const body = input.instructions.trim() || `# ${input.name}\n\n${input.description}`

  return [
    "---",
    `name: ${JSON.stringify(input.name)}`,
    `description: ${JSON.stringify(input.description)}`,
    "---",
    "",
    body,
    "",
  ].join("\n")
}

export const ExploreSkills: Component = () => {
  const language = useLanguage()
  const data = useData()
  const serverSdk = useServerSDK()
  const platform = usePlatform()
  const layout = useLayout()
  const dialog = useDialog()
  const installed = useExploreInstalled()

  const directory = installed.directory

  const [state, setState] = createStore<{
    query: string
    catalog?: string
    toggling?: string
    syncing: boolean
    syncError: string
  }>({
    query: "",
    syncing: true,
    syncError: "",
  })

  const skills = installed.skills

  const [catalog] = createResource(loadCatalog)

  // Reading the resource before its first value would suspend the skills pane, so Discover stays empty until it lands.
  const catalogSkills = () => {
    if (catalog.state !== "ready" && catalog.state !== "refreshing") return []

    return catalog.latest?.skills ?? []
  }

  // A catalog entry that already exists in this project or globally has nothing left to install.
  const discoverable = createMemo(() => {
    // Before the server reports its skills, every entry would look uninstalled, so wait instead of flashing the list.
    if (!installed.skillsLoaded()) return []

    const known = new Set(skills().map((skill) => skill.id))
    const needle = state.query.trim().toLowerCase()

    return catalogSkills().filter((entry) => {
      if (known.has(entry.id)) return false

      if (!needle) return true

      return `${entry.title}\n${entry.description}\n${entry.id}`.toLowerCase().includes(needle)
    })
  })

  const catalogEntry = createMemo(() => discoverable().find((entry) => entry.id === state.catalog))

  // The navigation column owns the installed selection; the pane only shows whichever skill it names.
  const selected = createMemo(() => skills().find((skill) => skill.id === layout.destination.explore.selected()))

  // Selecting a catalog entry replaces whatever installed skill the column had open.
  createEffect(
    on(
      () => layout.destination.explore.selected(),
      (id) => {
        if (id) setState("catalog", undefined)
      },
    ),
  )

  // A catalog selection the search no longer shows clears back to the selected skill or the placeholder.
  createEffect(() => {
    const current = state.catalog

    if (!current) return

    if (discoverable().some((entry) => entry.id === current)) return

    setState("catalog", undefined)
  })

  const selectCatalog = (entry: CatalogSkill) => {
    if (entry.id === state.catalog) return

    layout.destination.explore.setSelected(undefined)
    setState("catalog", entry.id)
  }

  // The switch is optimistic until the rescan reports the written value, then it follows the server again.
  const [autoinvoke, setAutoinvoke] = createStore<Record<string, boolean>>({})
  const autoinvokeOn = (skill: SkillInfo) => autoinvoke[skill.id] ?? skill.autoinvoke !== false

  createEffect(() => {
    const settled = skills()
      .filter((skill) => autoinvoke[skill.id] !== undefined && (skill.autoinvoke !== false) === autoinvoke[skill.id])
      .map((skill) => skill.id)

    if (settled.length === 0) return

    setAutoinvoke(
      produce((draft) => {
        for (const id of settled) delete draft[id]
      }),
    )
  })

  const writeSkillFile = (path: string, text: string) =>
    serverSdk.api.experimental.file.write({
      path,
      payload: new TextEncoder().encode(text),
      location: { directory: directory() },
    })

  const readSkill = async (skill: SkillInfo) => {
    if (isVirtual(skill)) return skill.content

    const bytes = await serverSdk.api.file.read({
      path: getFilename(skill.path),
      location: { directory: getDirectory(skill.path) },
    })

    return readText(bytes)
  }

  const syncSkills = async (target: string) => {
    setState({ syncing: true, syncError: "" })

    try {
      await data.location.skill.sync({ directory: target })
    } catch (error) {
      setState("syncError", error instanceof Error ? error.message : String(error))
    } finally {
      setState("syncing", false)
    }
  }

  // One read follows the location and a reconnect; it does not loop on the state it writes.
  createEffect(
    on([directory, () => serverSdk.connection.status()], ([target, status]) => {
      if (!target) return

      if (status !== "connected") {
        setState("syncing", false)

        return
      }

      void syncSkills(target)
    }),
  )

  const toggleAutoinvoke = async (skill: SkillInfo, enabled: boolean) => {
    if (isVirtual(skill) || state.toggling) return

    setState("toggling", skill.id)

    try {
      await writeSkillFile(skill.path, withAutoinvoke(await readSkill(skill), enabled))
      setAutoinvoke(skill.id, enabled)
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.skills.saveFailed"),
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setState("toggling", undefined)
    }
  }

  const reveal = (skill: SkillInfo) => {
    const target = getDirectory(skill.path).replace(/[\\/]+$/, "")

    if (platform.revealPath) {
      void platform.revealPath(target).then((shown) => {
        if (!shown) void platform.openPath?.(target)
      })

      return
    }

    void platform.openPath?.(target)
  }

  // VS Code is the default editor; other systems fall back to whatever app owns the file.
  const openInEditor = async (skill: SkillInfo) => {
    if (!platform.openPath) return

    const application = platform.os === "macos" ? "Visual Studio Code" : undefined

    try {
      await platform.openPath(skill.path, application)
    } catch {
      if (!application) {
        showToast({ variant: "error", title: language.t("settings.skills.openEditorFailed") })

        return
      }

      try {
        await platform.openPath(skill.path)
      } catch {
        showToast({ variant: "error", title: language.t("settings.skills.openEditorFailed") })
      }
    }
  }

  const copyReference = async (skill: SkillInfo) => {
    try {
      await (platform.writeClipboardText?.(`@${skill.id}`) ?? navigator.clipboard.writeText(`@${skill.id}`))
      showToast({ variant: "success", title: language.t("settings.skills.copiedReference") })
    } catch {
      showToast({ variant: "error", title: language.t("settings.skills.copyFailed") })
    }
  }

  const install = () =>
    void dialog.show(() => (
      <InstallSkillDialog
        directory={directory()}
        existing={skills().map((skill) => skill.id)}
        onInstalled={(id) => {
          void syncSkills(directory()).then(() => {
            layout.destination.explore.setSelected(id)
            setState("catalog", undefined)
          })
          showToast({ variant: "success", title: language.t("explore.skills.install.success", { id }) })
        }}
      />
    ))

  const installCatalog = (entry: CatalogSkill) =>
    void dialog.show(() => (
      <InstallSkillDialog
        directory={directory()}
        existing={skills().map((skill) => skill.id)}
        initial={{ id: entry.id, name: entry.id, description: entry.description, instructions: entry.instructions }}
        onInstalled={(id) => {
          void syncSkills(directory()).then(() => {
            layout.destination.explore.setSelected(id)
            setState("catalog", undefined)
          })
          showToast({ variant: "success", title: language.t("explore.skills.install.success", { id }) })
        }}
      />
    ))

  const remove = async (skill: SkillInfo) => {
    if (isVirtual(skill)) return

    const text = await readSkill(skill).catch((error) => {
      showToast({
        variant: "error",
        title: language.t("explore.skills.remove.failed"),
        description: error instanceof Error ? error.message : undefined,
      })

      return undefined
    })

    if (text === undefined) return

    void dialog.show(() => (
      <RemoveSkillDialog
        skill={skill}
        text={text}
        directory={directory()}
        onRemoved={() => {
          layout.destination.explore.setSelected(undefined)
          void syncSkills(directory())
          showToast({ variant: "success", title: language.t("explore.skills.remove.success", { name: skill.name }) })
        }}
      />
    ))
  }

  return (
    <>
      <PageHeader
        title={language.t("explore.skills.title")}
        description={language.t("explore.skills.description")}
        actions={
          <>
            <div class="explore-page-search">
              <TextInput
                type="search"
                appearance="base"
                leadingIcon={<Icon name="magnifying-glass" size="small" />}
                value={state.query}
                placeholder={language.t("settings.skills.search.placeholder")}
                aria-label={language.t("settings.skills.search.placeholder")}
                showClearButton={!!state.query}
                clearIcon="circle-xmark"
                onClearClick={() => setState("query", "")}
                onInput={(event) => setState("query", event.currentTarget.value)}
                spellcheck={false}
                autocorrect="off"
                autocomplete="off"
                autocapitalize="off"
              />
            </div>
            <Button
              size="small"
              variant="ghost-muted"
              icon="refresh"
              disabled={state.syncing}
              aria-busy={state.syncing}
              onClick={() => void syncSkills(directory())}
            >
              {language.t("settings.skills.rescan")}
            </Button>
            <Button size="small" variant="contrast" icon="plus" onClick={install}>
              {language.t("explore.skills.install")}
            </Button>
          </>
        }
      />

      <div class="explore-skills">
        <aside class="explore-skills-list">
          <div class="explore-skills-scroll" data-scrollable>
            <Show when={state.syncError}>
              {(message) => (
                <div class="explore-error" role="alert">
                  <Icon name="outline-hexagonal-warning" size="small" class="shrink-0" />
                  <span class="min-w-0 flex-1 break-words">{message()}</span>
                  <Button size="small" variant="ghost-muted" onClick={() => void syncSkills(directory())}>
                    {language.t("explore.plugins.error.retry")}
                  </Button>
                </div>
              )}
            </Show>

            <Show
              when={discoverable().length > 0}
              fallback={
                <Show when={!!state.query.trim()}>
                  <div class="explore-skills-empty">
                    <p class="explore-skills-empty-title">{language.t("settings.skills.noResults.title")}</p>
                    <p class="explore-skills-empty-description">
                      {language.t("settings.skills.noResults.description")}
                    </p>
                  </div>
                </Show>
              }
            >
              <div class="explore-skills-group">
                <div class="explore-skills-group-title">
                  <span>{language.t("explore.skills.discover.title")}</span>
                  <span class="explore-skills-count">{discoverable().length}</span>
                </div>
                <For each={discoverable()}>
                  {(entry) => (
                    <button
                      type="button"
                      class="explore-skills-row"
                      data-discover=""
                      data-selected={state.catalog === entry.id ? "" : undefined}
                      onClick={() => selectCatalog(entry)}
                    >
                      <span class="explore-skills-row-name">{entry.title}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </aside>

        <section class="explore-skills-detail" data-scrollable>
          <Show
            when={selected()}
            fallback={
              <Show
                when={catalogEntry()}
                fallback={
                  <div class="explore-skills-placeholder">
                    <p class="explore-skills-placeholder-title">{language.t("settings.skills.select.title")}</p>
                    <p class="explore-skills-placeholder-description">
                      {language.t("settings.skills.select.description")}
                    </p>
                  </div>
                }
              >
                {(entry) => <CatalogSkillDetail entry={entry()} onInstall={() => installCatalog(entry())} />}
              </Show>
            }
          >
            {(skill) => (
              <>
                <div class="explore-skills-header">
                  <div class="explore-skills-heading">
                    <h3 class="explore-skills-title">{skill().name}</h3>
                    <div class="explore-skills-meta">
                      <button
                        type="button"
                        class="explore-skills-reference"
                        title={language.t("settings.skills.copyReference")}
                        onClick={() => void copyReference(skill())}
                      >
                        @{skill().id}
                      </button>
                      <span class="explore-skills-path" title={skill().path}>
                        {skill().path}
                      </span>
                    </div>
                  </div>
                  <Show when={!isVirtual(skill())}>
                    <div class="explore-skills-actions">
                      <Button
                        size="small"
                        variant="ghost-muted"
                        icon="outline-code-brackets"
                        disabled={!platform.openPath}
                        onClick={() => void openInEditor(skill())}
                      >
                        {language.t("settings.skills.openEditor")}
                      </Button>
                      <Button
                        size="small"
                        variant="ghost-muted"
                        icon="folder"
                        onClick={() => reveal(skill())}
                        disabled={!platform.revealPath && !platform.openPath}
                      >
                        {language.t("settings.skills.reveal")}
                      </Button>
                      <Button size="small" variant="ghost-danger" icon="trash" onClick={() => void remove(skill())}>
                        {language.t("explore.skills.remove")}
                      </Button>
                    </div>
                  </Show>
                </div>

                <Show when={skill().description}>
                  {(description) => <p class="explore-skills-description">{description()}</p>}
                </Show>

                <div class="explore-skills-toggle">
                  <div class="explore-skills-toggle-copy">
                    <span class="explore-skills-toggle-title">{language.t("settings.skills.autoinvoke.title")}</span>
                    <p class="explore-skills-toggle-description">
                      {language.t(
                        isVirtual(skill())
                          ? "settings.skills.autoinvoke.builtin"
                          : "settings.skills.autoinvoke.description",
                      )}
                    </p>
                  </div>
                  <Switch
                    checked={autoinvokeOn(skill())}
                    disabled={isVirtual(skill()) || !!state.toggling}
                    hideLabel
                    onChange={(enabled) => void toggleAutoinvoke(skill(), enabled)}
                  >
                    {language.t("settings.skills.autoinvoke.title")}
                  </Switch>
                </div>

                <Show when={!isVirtual(skill())}>
                  <p class="explore-note">{language.t("explore.skills.remove.hint")}</p>
                </Show>
              </>
            )}
          </Show>
        </section>
      </div>
    </>
  )
}

/** A catalog skill this project has not installed yet: what it does, and the SKILL.md it would write. */
function CatalogSkillDetail(props: { entry: CatalogSkill; onInstall: () => void }) {
  const language = useLanguage()

  return (
    <>
      <div class="explore-skills-header">
        <div class="explore-skills-heading">
          <h3 class="explore-skills-title">{props.entry.title}</h3>
          <div class="explore-skills-meta">
            <span class="explore-skills-path" dir="ltr">
              {props.entry.id}
            </span>
          </div>
        </div>
        <Button size="small" variant="contrast" icon="plus" onClick={props.onInstall}>
          {language.t("explore.skills.install")}
        </Button>
      </div>

      <p class="explore-skills-description">{props.entry.description}</p>

      <pre class="explore-skill-preview" data-scrollable>
        <code>{props.entry.instructions}</code>
      </pre>
    </>
  )
}

function InstallSkillDialog(props: {
  directory: string
  existing: readonly string[]
  /** A catalog entry fills the form, so installing it is a review rather than a retype. */
  initial?: { id: string; name: string; description: string; instructions: string }
  onInstalled: (id: string) => void
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const serverSdk = useServerSDK()

  const [state, setState] = createStore({
    id: props.initial?.id ?? "",
    name: props.initial?.name ?? "",
    description: props.initial?.description ?? "",
    instructions: props.initial?.instructions ?? "",
    busy: false,
    error: "",
  })

  const root = () => trimDirectory(props.directory)
  const target = () => `${root()}/.opencode/skill/${state.id.trim() || "<id>"}/SKILL.md`

  const submit = async () => {
    if (state.busy) return
    const id = state.id.trim()
    const name = state.name.trim()
    const description = state.description.trim()

    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return setState("error", language.t("explore.skills.install.invalidId"))

    if (props.existing.includes(id)) return setState("error", language.t("explore.skills.install.exists"))

    if (!name) return setState("error", language.t("explore.skills.install.requiredName"))

    if (!description) return setState("error", language.t("explore.skills.install.requiredDescription"))

    setState({ busy: true, error: "" })

    try {
      await serverSdk.api.experimental.file.write({
        path: target(),
        payload: new TextEncoder().encode(composeSkill({ name, description, instructions: state.instructions })),
        location: { directory: props.directory },
      })
      dialog.close()
      props.onInstalled(id)
    } catch (error) {
      setState({ busy: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <Dialog>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("explore.skills.install.title")}
          description={language.t("explore.skills.install.description")}
        />
      </DialogHeader>

      <DialogBody class="explore-install-body">
        <label class="explore-field">
          <span class="explore-field-label">{language.t("explore.skills.install.id")}</span>
          <TextInput
            autofocus
            value={state.id}
            placeholder={language.t("explore.skills.install.id.placeholder")}
            aria-label={language.t("explore.skills.install.id")}
            spellcheck={false}
            onInput={(event) => setState("id", event.currentTarget.value)}
          />
          <span class="explore-field-hint">{language.t("explore.skills.install.id.description")}</span>
        </label>

        <label class="explore-field">
          <span class="explore-field-label">{language.t("explore.skills.install.name")}</span>
          <TextInput
            value={state.name}
            placeholder={language.t("explore.skills.install.name.placeholder")}
            aria-label={language.t("explore.skills.install.name")}
            onInput={(event) => setState("name", event.currentTarget.value)}
          />
        </label>

        <label class="explore-field">
          <span class="explore-field-label">{language.t("explore.skills.install.summary")}</span>
          <Textarea
            rows={2}
            value={state.description}
            placeholder={language.t("explore.skills.install.summary.placeholder")}
            aria-label={language.t("explore.skills.install.summary")}
            onInput={(event) => setState("description", event.currentTarget.value)}
          />
        </label>

        <label class="explore-field">
          <span class="explore-field-label">{language.t("explore.skills.install.instructions")}</span>
          <Textarea
            rows={5}
            value={state.instructions}
            placeholder={language.t("explore.skills.install.instructions.placeholder")}
            aria-label={language.t("explore.skills.install.instructions")}
            onInput={(event) => setState("instructions", event.currentTarget.value)}
          />
        </label>

        <div class="explore-field">
          <span class="explore-field-label">{language.t("explore.skills.install.path")}</span>
          <code class="explore-install-path" dir="ltr">
            {target()}
          </code>
        </div>

        <Show when={state.error}>
          {(message) => (
            <p class="explore-form-error" role="alert">
              {message()}
            </p>
          )}
        </Show>
      </DialogBody>

      <DialogFooter>
        <Button variant="neutral" disabled={state.busy} onClick={() => dialog.close()}>
          {language.t("explore.skills.install.cancel")}
        </Button>
        <Button variant="submit" disabled={state.busy} aria-busy={state.busy} onClick={() => void submit()}>
          {language.t("explore.skills.install.submit")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function RemoveSkillDialog(props: { skill: SkillInfo; text: string; directory: string; onRemoved: () => void }) {
  const language = useLanguage()
  const dialog = useDialog()
  const serverSdk = useServerSDK()
  const [state, setState] = createStore({ busy: false, error: "" })

  const backup = () => `${props.skill.path}.disabled`

  const remove = async () => {
    setState({ busy: true, error: "" })

    try {
      const write = (path: string, text: string) =>
        serverSdk.api.experimental.file.write({
          path,
          payload: new TextEncoder().encode(text),
          location: { directory: props.directory },
        })

      // Keep the original bytes, then empty SKILL.md so the file stays but no longer registers as a skill.
      await write(backup(), props.text)
      await write(props.skill.path, "")
      dialog.close()
      props.onRemoved()
    } catch (error) {
      setState({ busy: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <Dialog>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("explore.skills.remove.title", { name: props.skill.name })}
          description={language.t("explore.skills.remove.description")}
        />
      </DialogHeader>

      <DialogBody class="explore-install-body">
        <p class="explore-install-text">{language.t("explore.skills.remove.backup")}</p>
        <code class="explore-install-path" dir="ltr">
          {backup()}
        </code>
        <Show when={state.error}>
          {(message) => (
            <p class="explore-form-error" role="alert">
              {message()}
            </p>
          )}
        </Show>
      </DialogBody>

      <DialogFooter>
        <Button variant="neutral" disabled={state.busy} onClick={() => dialog.close()}>
          {language.t("explore.skills.remove.cancel")}
        </Button>
        <Button variant="danger" disabled={state.busy} aria-busy={state.busy} onClick={() => void remove()}>
          {language.t("explore.skills.remove.confirm")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
