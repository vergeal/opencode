import type { SkillInfo } from "@opencode/client/promise"
import { getDirectory, getFilename, containsDirectory } from "@opencode/util/path"
import { Button } from "@opencode/ui/button"
import { Loader } from "@opencode/ui/loader"
import { Switch } from "@opencode/ui/switch"
import { Textarea } from "@opencode/ui/textarea"
import { For, Show, createEffect, createMemo, createResource, on, type Component } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { ExternalLink } from "@/runtime/platform/external-link"
import { usePlatform } from "@/runtime/platform/platform"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { SettingsSearchField } from "@/settings/search-field"
import { showToast } from "@/shell/notifications/toast"
import "@/settings/settings.css"

const groups = {
  project: "settings.skills.group.project",
  global: "settings.skills.group.global",
  builtin: "settings.skills.group.builtin",
} as const

type GroupKey = keyof typeof groups

const groupOrder: GroupKey[] = ["project", "global", "builtin"]

const isVirtual = (skill: SkillInfo) => skill.path.startsWith("skill://") || skill.path.startsWith("/builtin/")

/**
 * Rewrites `metadata.opencode/autoinvoke` in a SKILL.md frontmatter block, leaving every other byte of the file
 * intact. The server reads that key before `disable-model-invocation`, so writing it always wins.
 */
export function withAutoinvoke(text: string, enabled: boolean) {
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

export const SettingsSkills: Component<{ directory: string }> = (props) => {
  const language = useLanguage()
  const data = useData()
  const serverSdk = useServerSDK()
  const platform = usePlatform()

  const [state, setState] = createStore<{
    query: string
    selected?: string
    tick: number
    editing: boolean
    draft: string
    toggling?: string
    rescanning: boolean
    notice: boolean
    save: { status: "idle" | "saving" | "error"; message?: string }
  }>({
    query: "",
    tick: 0,
    editing: false,
    draft: "",
    rescanning: false,
    notice: false,
    save: { status: "idle" },
  })

  const skills = () => data.location.skill.list({ directory: props.directory }) ?? []

  const groupOf = (skill: SkillInfo): GroupKey => {
    if (isVirtual(skill)) return "builtin"

    return containsDirectory(props.directory, getDirectory(skill.path)) ? "project" : "global"
  }

  const filtered = createMemo(() => {
    const query = state.query.trim().toLowerCase()
    const buckets: Record<GroupKey, SkillInfo[]> = { project: [], global: [], builtin: [] }

    for (const skill of skills()) {
      const haystack = `${skill.name}\n${skill.description ?? ""}\n${skill.id}`.toLowerCase()

      if (query && !haystack.includes(query)) continue

      buckets[groupOf(skill)].push(skill)
    }

    return groupOrder.flatMap((key) => {
      const items = buckets[key].toSorted((a, b) => a.name.localeCompare(b.name))

      return items.length > 0 ? [{ key, items }] : []
    })
  })

  const visible = createMemo(() => filtered().flatMap((group) => group.items))
  const selected = createMemo(() => skills().find((skill) => skill.id === state.selected))

  createEffect(() => {
    const current = state.selected
    const items = visible()

    if (state.editing) return

    if (current && items.some((skill) => skill.id === current)) return

    if (!current && items.length === 0) return

    setState("selected", items[0]?.id)
  })

  const [raw] = createResource(
    () => {
      const skill = selected()

      return skill ? { skill, tick: state.tick } : undefined
    },
    async ({ skill }) => {
      if (isVirtual(skill)) return { text: skill.content, virtual: true }

      const bytes = await serverSdk.api.file.read({
        path: getFilename(skill.path),
        location: { directory: getDirectory(skill.path) },
      })

      return { text: readText(bytes), virtual: false }
    },
  )

  const file = () => (raw.state === "ready" || raw.state === "refreshing" ? raw.latest : undefined)
  const loading = () => raw.state === "unresolved" || raw.state === "pending"
  const dirty = () => state.editing && file() !== undefined && state.draft !== file()!.text

  const selectSkill = (skill: SkillInfo) => {
    if (skill.id === state.selected) return

    if (state.editing) {
      setState("notice", true)

      return
    }

    setState({ selected: skill.id, notice: false })
  }

  createEffect(
    on(
      () => state.selected,
      () => setState({ editing: false, draft: "", notice: false, save: { status: "idle" } }),
    ),
  )

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

  const writeSkill = (skill: SkillInfo, text: string) =>
    serverSdk.api.experimental.file.write({
      path: skill.path,
      payload: new TextEncoder().encode(text),
      location: { directory: props.directory },
    })

  const readSkill = async (skill: SkillInfo) => {
    if (isVirtual(skill)) return skill.content

    const bytes = await serverSdk.api.file.read({
      path: getFilename(skill.path),
      location: { directory: getDirectory(skill.path) },
    })

    return readText(bytes)
  }

  const toggleAutoinvoke = async (skill: SkillInfo, enabled: boolean) => {
    if (isVirtual(skill) || state.toggling) return

    setState("toggling", skill.id)

    try {
      await writeSkill(skill, withAutoinvoke(await readSkill(skill), enabled))
      setAutoinvoke(skill.id, enabled)
      setState("tick", (tick) => tick + 1)
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

  const startEditing = () => {
    const value = file()

    if (!value) return

    setState({ editing: true, draft: value.text, notice: false, save: { status: "idle" } })
  }

  const save = async (skill: SkillInfo) => {
    if (state.save.status === "saving") return

    setState("save", { status: "saving" })

    try {
      await writeSkill(skill, state.draft)
      setState({ editing: false, notice: false, save: { status: "idle" } })
      setState("tick", (tick) => tick + 1)
    } catch (error) {
      setState("save", { status: "error", message: error instanceof Error ? error.message : undefined })
    }
  }

  const reveal = (skill: SkillInfo) => {
    const directory = getDirectory(skill.path).replace(/[\\/]+$/, "")

    if (platform.revealPath) {
      void platform.revealPath(directory).then((shown) => {
        if (!shown) void platform.openPath?.(directory)
      })

      return
    }

    void platform.openPath?.(directory)
  }

  const rescan = async () => {
    if (state.rescanning) return

    setState("rescanning", true)

    try {
      await data.location.skill.sync({ directory: props.directory })
    } finally {
      setState("rescanning", false)
    }
  }

  return (
    <div class="settings-skills">
      <aside class="settings-skills-list">
        <div class="settings-skills-search">
          <SettingsSearchField
            value={state.query}
            placeholder={language.t("settings.skills.search.placeholder")}
            active={true}
            onInput={(query) => setState("query", query)}
          />
        </div>

        <div class="settings-skills-scroll" data-scrollable>
          <Show
            when={filtered().length > 0}
            fallback={
              <div class="settings-skills-empty">
                <p class="settings-skills-empty-title">
                  {language.t(
                    skills().length === 0 ? "settings.skills.empty.title" : "settings.skills.noResults.title",
                  )}
                </p>
                <p class="settings-skills-empty-description">
                  {language.t(
                    skills().length === 0
                      ? "settings.skills.empty.description"
                      : "settings.skills.noResults.description",
                  )}
                </p>
              </div>
            }
          >
            <For each={filtered()}>
              {(group) => (
                <div class="settings-skills-group">
                  <div class="settings-skills-group-title">
                    <span>{language.t(groups[group.key])}</span>
                    <span class="settings-skills-count">{group.items.length}</span>
                  </div>
                  <For each={group.items}>
                    {(skill) => (
                      <button
                        type="button"
                        class="settings-skills-row"
                        data-selected={state.selected === skill.id ? "" : undefined}
                        data-quiet={autoinvokeOn(skill) ? undefined : ""}
                        onClick={() => selectSkill(skill)}
                      >
                        <span class="settings-skills-row-name">{skill.name}</span>
                      </button>
                    )}
                  </For>
                </div>
              )}
            </For>
          </Show>
        </div>

        <div class="settings-skills-footer">
          <Button
            size="small"
            variant="ghost-muted"
            icon="refresh"
            disabled={state.rescanning}
            aria-busy={state.rescanning}
            onClick={() => void rescan()}
          >
            {language.t("settings.skills.rescan")}
          </Button>
          <ExternalLink class="settings-extension-link text-13-regular" href="https://opencode.ai/v2/docs/skills">
            {language.t("settings.extensions.addSkills")}
          </ExternalLink>
        </div>
      </aside>

      <section class="settings-skills-detail">
        <Show
          when={selected()}
          fallback={
            <div class="settings-skills-placeholder">
              <p class="settings-skills-placeholder-title">{language.t("settings.skills.select.title")}</p>
              <p class="settings-skills-placeholder-description">{language.t("settings.skills.select.description")}</p>
            </div>
          }
        >
          {(skill) => (
            <>
              <div class="settings-skills-header">
                <div class="settings-skills-heading">
                  <h3 class="settings-skills-title">{skill().name}</h3>
                  <p class="settings-skills-path" title={skill().path}>
                    {skill().path}
                  </p>
                </div>
                <Show when={!isVirtual(skill())}>
                  <Button
                    size="small"
                    variant="ghost-muted"
                    icon="folder"
                    onClick={() => reveal(skill())}
                    disabled={!platform.revealPath && !platform.openPath}
                  >
                    {language.t("settings.skills.reveal")}
                  </Button>
                </Show>
              </div>

              <Show when={skill().description}>
                {(description) => <p class="settings-skills-description">{description()}</p>}
              </Show>

              <Show when={state.notice}>
                <p class="settings-skills-notice">{language.t("settings.skills.unsavedHint")}</p>
              </Show>

              <div class="settings-skills-toggle">
                <div class="settings-skills-toggle-copy">
                  <span class="settings-skills-toggle-title">{language.t("settings.skills.autoinvoke.title")}</span>
                  <p class="settings-skills-toggle-description">
                    {language.t(
                      isVirtual(skill())
                        ? "settings.skills.autoinvoke.builtin"
                        : "settings.skills.autoinvoke.description",
                    )}
                  </p>
                </div>
                <Switch
                  checked={autoinvokeOn(skill())}
                  disabled={isVirtual(skill()) || state.editing || !!state.toggling}
                  hideLabel
                  onChange={(enabled) => void toggleAutoinvoke(skill(), enabled)}
                >
                  {language.t("settings.skills.autoinvoke.title")}
                </Switch>
              </div>

              <div class="settings-skills-content">
                <div class="settings-skills-content-header">
                  <span class="settings-skills-content-title">
                    {isVirtual(skill()) ? "SKILL.md" : getFilename(skill().path)}
                    <Show when={dirty()}>
                      <span class="settings-skills-dirty">{language.t("settings.skills.unsaved")}</span>
                    </Show>
                  </span>
                  <Show when={!isVirtual(skill())}>
                    <Show
                      when={state.editing}
                      fallback={
                        <Button
                          size="small"
                          variant="ghost-muted"
                          icon="edit"
                          disabled={!file()}
                          onClick={startEditing}
                        >
                          {language.t("settings.skills.edit")}
                        </Button>
                      }
                    >
                      <div class="settings-skills-edit-actions">
                        <Button
                          size="small"
                          variant="ghost-muted"
                          onClick={() => setState({ editing: false, notice: false, save: { status: "idle" } })}
                        >
                          {language.t("settings.skills.cancel")}
                        </Button>
                        <Button
                          size="small"
                          variant="contrast"
                          disabled={state.save.status === "saving"}
                          aria-busy={state.save.status === "saving"}
                          onClick={() => void save(skill())}
                        >
                          {language.t(
                            state.save.status === "saving" ? "settings.skills.saving" : "settings.skills.save",
                          )}
                        </Button>
                      </div>
                    </Show>
                  </Show>
                </div>

                <Show when={state.save.status === "error"}>
                  <p class="settings-skills-error">
                    {language.t("settings.skills.saveFailed")}
                    <Show when={state.save.status === "error" ? state.save.message : undefined}>
                      {(message) => <span>{message()}</span>}
                    </Show>
                  </p>
                </Show>

                <div class="settings-skills-content-body" data-scrollable>
                  <Show
                    when={!loading()}
                    fallback={
                      <div class="settings-skills-loading">
                        <Loader />
                      </div>
                    }
                  >
                    <Show
                      when={raw.state !== "errored"}
                      fallback={
                        <div class="settings-skills-loading">
                          <p>{language.t("settings.skills.loadFailed")}</p>
                          <Button
                            size="small"
                            variant="ghost-muted"
                            onClick={() => setState("tick", (tick) => tick + 1)}
                          >
                            {language.t("settings.skills.retry")}
                          </Button>
                        </div>
                      }
                    >
                      <Show when={file()}>
                        {(value) => (
                          <Show
                            when={state.editing}
                            fallback={<pre class="settings-skills-preview">{value().text}</pre>}
                          >
                            <Textarea
                              class="settings-skills-editor"
                              value={state.draft}
                              spellcheck={false}
                              onInput={(event) => setState("draft", event.currentTarget.value)}
                            />
                          </Show>
                        )}
                      </Show>
                    </Show>
                  </Show>
                </div>
              </div>
            </>
          )}
        </Show>
      </section>
    </div>
  )
}
