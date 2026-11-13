import type { OpenCodeClient } from "@opencode/client"
import type { CredentialApi, ExperimentalGenerateApi, PluginApi } from "@opencode/client/promise/api"
import type { Display } from "@opencode/schema/plugin"
import type { Location } from "@opencode/schema/location"
import type { PluginOptions } from "../options.js"
import type { App } from "../app.js"
import type { AgentDomain } from "./agent.js"
import type { ExperimentalArtifactDomain } from "./artifact.js"
import type { AISDKDomain } from "./aisdk.js"
import type { CommandDomain } from "./command.js"
import type { EventDomain } from "./event.js"
import type { InboxDomain } from "./inbox.js"
import type { IntegrationDomain } from "./integration.js"
import type { MCPDomain } from "./mcp.js"
import type { ModelDomain } from "./model.js"
import type { PermissionDomain } from "./permission.js"
import type { ProviderDomain } from "./provider.js"
import type { ReferenceDomain } from "./reference.js"
import type { RpcDomain } from "./rpc.js"
import type { SessionDomain } from "./session.js"
import type { ShellDomain } from "./shell.js"
import type { SkillDomain } from "./skill.js"
import type { StorageDomain } from "./storage.js"
import type { ToolDomain } from "./tool.js"
import type { VcsDomain } from "./vcs.js"
import type { WebSearchDomain } from "./websearch.js"
import type { WorktreeDomain } from "./worktree.js"

export interface Context {
  readonly app: App
  readonly location: Location.Info
  readonly options: PluginOptions
  readonly agent: AgentDomain
  readonly aisdk: AISDKDomain
  readonly command: CommandDomain
  readonly credential: Pick<CredentialApi, "activate">
  readonly event: EventDomain
  readonly experimental: {
    readonly terminal: Pick<OpenCodeClient["experimental"]["persistentPty"], "read">
    /** Stateless generation with a model and a prompt: no session, history or tools. */
    readonly generate: ExperimentalGenerateApi
    readonly artifact: ExperimentalArtifactDomain
  }
  /** Messages this plugin published into the app's inbox. */
  readonly inbox: InboxDomain
  readonly integration: IntegrationDomain
  readonly mcp: MCPDomain
  readonly model: ModelDomain
  /** @deprecated Use `experimental.generate.text`. */
  readonly generate: Pick<ExperimentalGenerateApi, "text">
  readonly permission: PermissionDomain
  readonly plugin: Pick<PluginApi, "list">
  readonly provider: ProviderDomain
  readonly reference: ReferenceDomain
  readonly rpc: RpcDomain
  readonly session: SessionDomain
  readonly shell: ShellDomain
  readonly skill: SkillDomain
  readonly storage: StorageDomain
  /** Directories owned by this plugin: `data` and `log` survive uninstall, `cache` does not. */
  readonly paths: {
    readonly data: string
    readonly cache: string
    readonly log: string
  }
  /**
   * The interpreter environment the host prepared from the manifest's `runtime`. Present only for a plugin that
   * declared one; `python` is undefined until the environment is ready.
   */
  readonly runtime: {
    /** Absolute path to this plugin's prepared Python, or undefined when it declared no runtime or it is not ready. */
    readonly python: string | undefined
  }
  /** Values encrypted with a machine-local key. Plain text is never written. */
  readonly secrets: {
    get(key: string): Promise<string | undefined>
    set(key: string, value: string): Promise<void>
    delete(key: string): Promise<void>
  }
  /** The flat, user-level configuration declared by the plugin's manifest. */
  readonly config: {
    get(): Promise<Record<string, unknown>>
    update(patch: Record<string, unknown>): Promise<void>
    onChange(callback: (next: Record<string, unknown>) => void): void
  }
  readonly tool: ToolDomain
  readonly vcs: VcsDomain
  readonly websearch: WebSearchDomain
  readonly worktree: WorktreeDomain
}

export type Cleanup = () => Promise<void> | void

export type Entry = (context: Context) => Promise<Cleanup | void> | Cleanup | void

export interface Plugin {
  readonly id: string
  /** What the app's plugin browser shows. Omit it to keep an internal plugin out of the browser. */
  readonly display?: Display
  /**
   * Whether this built-in plugin runs without a config entry. Defaults to true. Set false for a plugin that ships
   * with the app but stays dormant until the user installs it from the plugin browser.
   */
  readonly defaultEnabled?: boolean
  /** The plugin's entry, equivalent to VSCode's `activate`. Runs once per load. */
  readonly activate?: Entry
  /** @deprecated Use `activate`. Removed in the next minor. */
  readonly setup?: Entry
  /** Runs once, on the first load of this plugin in the current process. Must be idempotent. */
  readonly onInstall?: (context: Context) => Promise<void> | void
  /** Runs on the running instance right before the plugin's files are removed. */
  readonly onUninstall?: (context: Context) => Promise<void> | void
}

export function define<P extends Plugin>(plugin: P & ({ activate: Entry } | { setup: Entry })) {
  return plugin
}
