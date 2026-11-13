import type { SkillInfo } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
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
import { SkillIcon } from "./skill-icon"
import { ExploreStatus } from "./status"

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
    tab: "installed" | "discover"
    toggling?: string
    syncing: boolean
    syncError: string
  }>({
    query: "",
    tab: "discover",
    syncing: true,
    syncError: "",
  })

  const skills = installed.skills

  const [catalog] = createResource(loadCatalog)

  // Reading the resource before its first value would suspend the pane, so Discover stays empty until it lands.
  const catalogSkills = () => {
    if (catalog.state !== "ready" && catalog.state !== "refreshing") return []

    return catalog.latest?.skills ?? []
  }

  // A catalog entry that already exists in this project or globally has nothing left to install.
  const discoverable = createMemo(() => {
    // Before the server reports its skills, every entry would look uninstalled, so wait instead of flashing the list.
    if (!installed.skillsLoaded()) return []

    const known = new Set(skills().map((skill) => skill.id))

    return catalogSkills().filter((entry) => !known.has(entry.id))
  })

  // The navigation column owns the installed selection; the list and the detail page only read it.
  const selected = createMemo(() => skills().find((skill) => skill.id === layout.destination.explore.selected()))

  const catalogEntry = createMemo(() =>
    catalogSkills().find((entry) => entry.id === layout.destination.explore.catalog()),
  )

  const matches = (text: string) => {
    const needle = state.query.trim().toLowerCase()

    return !needle || text.toLowerCase().includes(needle)
  }

  const installedGroups = createMemo(() => {
    const group = (titleKey: string, virtual: boolean) => ({
      titleKey,
      items: skills().filter(
        (skill) => isVirtual(skill) === virtual && matches(`${skill.name}\n${skill.description}\n${skill.id}`),
      ),
    })

    return [group("explore.skills.group.installed", false), group("explore.skills.group.builtin", true)].filter(
      (entry) => entry.items.length > 0,
    )
  })

  const discoverEntries = createMemo(() =>
    discoverable().filter((entry) => matches(`${entry.title}\n${entry.description}\n${entry.id}`)),
  )

  // A catalog card and an installed row are two different pages, so opening one closes the other.
  const back = () => {
    layout.destination.explore.setSelected(undefined)
    layout.destination.explore.setCatalog(undefined)
  }

  const selectCatalog = (entry: CatalogSkill) => layout.destination.explore.setCatalog(entry.id)

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
          void syncSkills(directory()).then(() => layout.destination.explore.setSelected(id))
          showToast({ variant: "success", title: language.t("explore.skills.install.success") })
        }}
      />
    ))

  const installCatalog = (entry: CatalogSkill) =>
    void dialog.show(() => (
      <InstallSkillDialog
        directory={directory()}
        existing={skills().map((skill) => skill.id)}
        initial={{ id: entry.id, name: entry.title, description: entry.description, instructions: entry.instructions }}
        onInstalled={(id) => {
          void syncSkills(directory()).then(() => layout.destination.explore.setSelected(id))
          showToast({ variant: "success", title: language.t("explore.skills.install.success") })
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

  const list = () => (
    <>
      <PageHeader
        title={language.t("explore.skills.title")}
        description={language.t("explore.skills.description")}
        inset
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

      <div class="explore-catalog-body" data-scrollable>
        <div class="explore-page-inner">
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

          <div class="explore-catalog-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              class="explore-catalog-tab"
              aria-selected={state.tab === "installed"}
              data-selected={state.tab === "installed" ? "" : undefined}
              onClick={() => setState("tab", "installed")}
            >
              {language.t("explore.skills.tab.installed")}
            </button>
            <button
              type="button"
              role="tab"
              class="explore-catalog-tab"
              aria-selected={state.tab === "discover"}
              data-selected={state.tab === "discover" ? "" : undefined}
              onClick={() => setState("tab", "discover")}
            >
              {language.t("explore.skills.tab.discover")}
            </button>
          </div>

          <Show
            when={installed.skillsLoaded()}
            fallback={
              <div class="explore-loading" aria-busy="true">
                <Loader />
              </div>
            }
          >
            <Show
              when={state.tab === "installed"}
              fallback={
                <Show when={discoverEntries().length > 0} fallback={<SkillEmpty tab="discover" query={state.query} />}>
                  <section class="explore-catalog-group">
                    <h2 class="explore-catalog-group-title">{language.t("explore.skills.group.available")}</h2>
                    <div class="explore-catalog-grid">
                      <For each={discoverEntries()}>
                        {(entry) => (
                          <SkillCard
                            name={entry.title}
                            description={entry.description}
                            addLabel={language.t("explore.skills.install")}
                            onOpen={() => selectCatalog(entry)}
                            onAdd={() => installCatalog(entry)}
                          />
                        )}
                      </For>
                    </div>
                  </section>
                </Show>
              }
            >
              <Show when={installedGroups().length > 0} fallback={<SkillEmpty tab="installed" query={state.query} />}>
                <For each={installedGroups()}>
                  {(group) => (
                    <section class="explore-catalog-group">
                      <h2 class="explore-catalog-group-title">{language.t(group.titleKey)}</h2>
                      <div class="explore-catalog-grid">
                        <For each={group.items}>
                          {(skill) => (
                            <SkillCard
                              name={skill.name}
                              description={skill.description}
                              onOpen={() => layout.destination.explore.setSelected(skill.id)}
                            />
                          )}
                        </For>
                      </div>
                    </section>
                  )}
                </For>
              </Show>
            </Show>
          </Show>
        </div>
      </div>
    </>
  )

  return (
    <Show
      when={selected()}
      fallback={
        <Show when={catalogEntry()} fallback={list()}>
          {(entry) => <CatalogSkillDetail entry={entry()} onBack={back} onInstall={() => installCatalog(entry())} />}
        </Show>
      }
    >
      {(skill) => (
        <InstalledSkillDetail
          skill={skill()}
          autoinvoke={autoinvokeOn(skill())}
          toggling={state.toggling === skill().id}
          onBack={back}
          onToggle={(enabled) => void toggleAutoinvoke(skill(), enabled)}
          onCopyReference={() => void copyReference(skill())}
          onOpenEditor={() => void openInEditor(skill())}
          onReveal={() => reveal(skill())}
          onRemove={() => void remove(skill())}
        />
      )}
    </Show>
  )
}

/** One skill in the catalog grid: the row opens its page, the trailing plus installs it. */
function SkillCard(props: {
  name: string
  description?: string
  addLabel?: string
  onOpen: () => void
  onAdd?: () => void
}) {
  return (
    <div class="explore-catalog-card">
      <button type="button" class="explore-catalog-card-main" onClick={props.onOpen}>
        <span class="explore-catalog-card-icon">
          <SkillIcon />
        </span>
        <span class="explore-catalog-card-copy">
          <span class="explore-catalog-card-name">{props.name}</span>
          <Show when={props.description}>
            {(description) => <span class="explore-catalog-card-description">{description()}</span>}
          </Show>
        </span>
      </button>
      <Show when={props.onAdd}>
        <button
          type="button"
          class="explore-catalog-card-add"
          aria-label={props.addLabel}
          title={props.addLabel}
          onClick={() => props.onAdd?.()}
        >
          <Icon name="plus" />
        </button>
      </Show>
    </div>
  )
}

function SkillCrumbs(props: { current: string; onBack: () => void }) {
  const language = useLanguage()

  return (
    <nav class="explore-catalog-crumbs" aria-label={language.t("explore.skills.back")}>
      <button type="button" class="explore-catalog-crumb" onClick={props.onBack}>
        {language.t("explore.skills.title")}
      </button>
      <Icon name="outline-chevron-right" class="explore-catalog-crumb-separator" />
      <span class="explore-catalog-crumb-current">{props.current}</span>
    </nav>
  )
}

/** An installed skill's page: its reference, the autoinvoke switch, and where the file lives. */
function InstalledSkillDetail(props: {
  skill: SkillInfo
  autoinvoke: boolean
  toggling: boolean
  onBack: () => void
  onToggle: (enabled: boolean) => void
  onCopyReference: () => void
  onOpenEditor: () => void
  onReveal: () => void
  onRemove: () => void
}) {
  const language = useLanguage()
  const platform = usePlatform()

  return (
    <div class="explore-catalog-page" data-scrollable>
      <div class="explore-page-inner">
        <SkillCrumbs current={props.skill.name} onBack={props.onBack} />

        <div class="explore-catalog-page-body">
          <header class="explore-catalog-hero">
            <span class="explore-catalog-hero-icon">
              <SkillIcon />
            </span>
            <div class="explore-catalog-hero-copy">
              <h1 class="explore-catalog-hero-name">{props.skill.name}</h1>
              <p class="explore-catalog-hero-meta">
                <button
                  type="button"
                  class="explore-catalog-reference"
                  title={language.t("settings.skills.copyReference")}
                  onClick={props.onCopyReference}
                >
                  @{props.skill.id}
                </button>
                <span class="explore-catalog-path" dir="ltr" title={props.skill.path}>
                  {props.skill.path}
                </span>
              </p>
            </div>
            <Show when={!isVirtual(props.skill)}>
              <div class="explore-catalog-actions">
                <Button
                  size="small"
                  variant="ghost-muted"
                  icon="outline-code-brackets"
                  disabled={!platform.openPath}
                  onClick={props.onOpenEditor}
                >
                  {language.t("settings.skills.openEditor")}
                </Button>
                <Button
                  size="small"
                  variant="ghost-muted"
                  icon="folder"
                  disabled={!platform.revealPath && !platform.openPath}
                  onClick={props.onReveal}
                >
                  {language.t("settings.skills.reveal")}
                </Button>
                <Button size="small" variant="ghost-danger" icon="trash" onClick={props.onRemove}>
                  {language.t("explore.skills.remove")}
                </Button>
              </div>
            </Show>
          </header>

          <Show when={props.skill.description}>
            {(description) => <p class="explore-catalog-about">{description()}</p>}
          </Show>

          <div class="explore-catalog-toggle">
            <div class="explore-catalog-toggle-copy">
              <span class="explore-catalog-toggle-title">{language.t("settings.skills.autoinvoke.title")}</span>
              <p class="explore-catalog-toggle-description">
                {language.t(
                  isVirtual(props.skill)
                    ? "settings.skills.autoinvoke.builtin"
                    : "settings.skills.autoinvoke.description",
                )}
              </p>
            </div>
            <Switch
              checked={props.autoinvoke}
              disabled={isVirtual(props.skill) || props.toggling}
              hideLabel
              onChange={props.onToggle}
            >
              {language.t("settings.skills.autoinvoke.title")}
            </Switch>
          </div>

          <Show when={!isVirtual(props.skill)}>
            <p class="explore-note">{language.t("explore.skills.remove.hint")}</p>
          </Show>
        </div>
      </div>
    </div>
  )
}

/** A catalog skill this project has not installed yet: what it does, and the SKILL.md it would write. */
function CatalogSkillDetail(props: { entry: CatalogSkill; onBack: () => void; onInstall: () => void }) {
  const language = useLanguage()

  return (
    <div class="explore-catalog-page" data-scrollable>
      <div class="explore-page-inner">
        <SkillCrumbs current={props.entry.title} onBack={props.onBack} />

        <div class="explore-catalog-page-body">
          <header class="explore-catalog-hero">
            <span class="explore-catalog-hero-icon">
              <SkillIcon />
            </span>
            <div class="explore-catalog-hero-copy">
              <h1 class="explore-catalog-hero-name">{props.entry.title}</h1>
              <p class="explore-catalog-hero-meta">
                <span class="explore-catalog-path" dir="ltr">
                  {props.entry.id}
                </span>
              </p>
            </div>
            <Button variant="contrast" size="small" icon="plus" onClick={props.onInstall}>
              {language.t("explore.skills.install")}
            </Button>
          </header>

          <p class="explore-catalog-about">{props.entry.description}</p>

          <section class="explore-catalog-section">
            <h2 class="explore-catalog-section-title">{language.t("explore.skills.detail.instructions")}</h2>
            <pre class="explore-skill-preview" data-scrollable>
              <code>{props.entry.instructions}</code>
            </pre>
          </section>
        </div>
      </div>
    </div>
  )
}

/** The list's empty state: a search miss, no skills yet, or every catalog skill already installed. */
function SkillEmpty(props: { tab: "installed" | "discover"; query: string }) {
  const language = useLanguage()

  return (
    <Show
      when={!!props.query.trim()}
      fallback={
        <Show
          when={props.tab === "installed"}
          fallback={
            <ExploreStatus
              icon="post-skill"
              title={language.t("explore.skills.discover.empty.title")}
              description={language.t("explore.skills.discover.empty.description")}
            />
          }
        >
          <ExploreStatus
            icon="post-skill"
            title={language.t("explore.skills.empty.title")}
            description={language.t("explore.skills.empty.description")}
          />
        </Show>
      }
    >
      <ExploreStatus
        icon="magnifying-glass"
        title={language.t("settings.skills.noResults.title")}
        description={language.t("settings.skills.noResults.description")}
      />
    </Show>
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

  // The user never names a folder: a fresh id keeps the skill directory machine-readable.
  const fallbackId = `skill-${Date.now().toString(36)}`

  const [state, setState] = createStore({
    name: props.initial?.name ?? "",
    description: props.initial?.description ?? "",
    instructions: props.initial?.instructions ?? "",
    busy: false,
    error: "",
  })

  const id = () => props.initial?.id ?? fallbackId
  const root = () => trimDirectory(props.directory)
  const target = () => `${root()}/.opencode/skill/${id()}/SKILL.md`

  const submit = async () => {
    if (state.busy) return
    const name = state.name.trim()
    const description = state.description.trim()

    if (props.existing.includes(id())) return setState("error", language.t("explore.skills.install.exists"))

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
      props.onInstalled(id())
    } catch (error) {
      setState({ busy: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <Dialog size="x-large" containerClass="explore-skill-dialog">
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t("explore.skills.install.title")}
          description={language.t("explore.skills.install.description")}
        />
      </DialogHeader>

      <DialogBody class="explore-skill-body">
        <div class="explore-skill-scroll">
          <div data-component="document-surface" class="explore-skill-paper">
            <div class="explore-skill-page">
              <TextInput
                autofocus
                surface="invisible"
                class="explore-skill-name"
                value={state.name}
                placeholder={language.t("explore.skills.install.name.placeholder")}
                aria-label={language.t("explore.skills.install.name")}
                autocomplete="off"
                spellcheck={false}
                onInput={(event) => setState("name", event.currentTarget.value)}
              />

              <Textarea
                class="explore-skill-summary"
                rows={1}
                autoResize
                autoResizeMax={96}
                value={state.description}
                placeholder={language.t("explore.skills.install.summary.placeholder")}
                aria-label={language.t("explore.skills.install.summary")}
                onInput={(event) => setState("description", event.currentTarget.value)}
              />

              <div class="explore-skill-divider" role="presentation" />

              <Textarea
                class="explore-skill-markdown"
                rows={16}
                autoResize
                autoResizeMax={760}
                value={state.instructions}
                placeholder={language.t("explore.skills.install.body.placeholder")}
                aria-label={language.t("explore.skills.install.body")}
                spellcheck={false}
                onInput={(event) => setState("instructions", event.currentTarget.value)}
              />
            </div>
          </div>

          <div class="explore-skill-foot">
            <p class="explore-skill-hint">{language.t("explore.skills.install.hint")}</p>
            <p class="explore-skill-path" dir="ltr" title={target()}>
              {target()}
            </p>
          </div>

          <Show when={state.error}>
            {(message) => (
              <p class="explore-form-error" role="alert">
                {message()}
              </p>
            )}
          </Show>
        </div>
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
    <Dialog fit>
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
