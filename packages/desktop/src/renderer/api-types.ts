import type { DesktopMenuAction, DesktopZoomLevel } from "@opencode/app/desktop-menu"
import type { DesktopNativeBundle } from "@opencode/app/i18n/desktop-native"
import type { WindowBootstrap } from "../shared/window-bootstrap"
import type {
  ClipboardImage,
  DirectoryPickerOptions,
  FatalRendererError,
  FilePickerOptions,
  PickedFiles,
  SaveFilePickerOptions,
  ServerReadyData,
  TitlebarTheme,
} from "../shared/ipc-contract"

/** One entry of a native context menu shown by the main process. */
export type ContextMenuItem = {
  id?: string
  label?: string
  type?: "normal" | "separator"
  enabled?: boolean
}

/** One file the main process found while scanning a knowledge library directory. */
export type KnowledgeFileEntry = {
  path: string
  name: string
  size: number
  kind: "document" | "spreadsheet" | "text"
  /** Folder the document was imported from; empty for a file imported on its own. */
  root: string
  /** Absolute path of the original document, kept to show where it came from. */
  source: string
}

export type KnowledgeReadFileInput = { libraryID: string; path: string }

/** What one import looked at, kept and dropped. */
export type KnowledgeImportStats = {
  scanned: number
  kept: number
  /** Files whose content already existed in the library. */
  duplicates: number
  /** Files whose content nearly matched an existing document. */
  similar: number
  /** Non-documents, empty files and documents whose text could not be read. */
  skipped: number
}

/** Opening text of one kept document, used to describe the library. */
export type KnowledgeFileExcerpt = { path: string; excerpt: string }

/** Why one file was left out of a library. */
export type KnowledgeDiscardReason = "duplicate" | "similar" | "unsupported" | "noise" | "tooLarge" | "empty"

export type KnowledgeDiscard = {
  reason: KnowledgeDiscardReason
  /** Absolute path of the original file. */
  path: string
  name: string
  /** Library path of the document this one duplicated or nearly matched. */
  matched?: string
}

export type KnowledgeImportResult = {
  files: ReadonlyArray<KnowledgeFileEntry>
  stats: KnowledgeImportStats
  excerpts: ReadonlyArray<KnowledgeFileExcerpt>
  discards: ReadonlyArray<KnowledgeDiscard>
}

/** One step of an import, reported while it runs. */
export type KnowledgeImportProgress = {
  libraryID: string
  /** `scan` walks folders, `convert` reads documents, `dedupe` compares them, `done` ends the run. */
  stage: "scan" | "convert" | "dedupe" | "done"
  /** Folder being walked, or the document being read. */
  current: string
  processed: number
  /** Zero while a folder is still being walked. */
  total: number
  kept: number
  duplicates: number
  similar: number
  skipped: number
}

export type ElectronAPI = {
  awaitInitialization(): Promise<ServerReadyData>
  reconnectService(signal?: AbortSignal): Promise<ServerReadyData>
  onSidecarChanged(cb: (data: ServerReadyData) => void): () => void
  readyDeepLinks(): void
  acknowledgeDeepLinks(attempt: number): void
  isFirstLaunchOnboardingPending(): Promise<boolean>
  finishFirstLaunchOnboarding(createDefaultProject: boolean): Promise<string | null>
  checkAppExists(appName: string): Promise<boolean>
  resolveAppPath(appName: string): Promise<string | null>
  storeItems(name: string): Promise<{ items: Record<string, string>; revision: number }>
  storeUpdate(name: string, insert: Record<string, string>, remove: string[]): Promise<number>
  storeClear(name: string): Promise<void>
  onStoreChanged(
    cb: (name: string, insert: Record<string, string>, remove: string[], revision: number) => void,
  ): () => void
  draftGet(key: string): Promise<string | null>
  draftSet(key: string, value: string, strict: boolean): Promise<string[]>
  draftDelete(key: string): Promise<void>
  draftBlobPut(data: ArrayBuffer): Promise<string>
  draftBlobGet(id: string): Promise<ArrayBuffer | null>
  getWindowID(): string
  getWindowBootstrap(): WindowBootstrap
  themeReady(): Promise<void>
  onMenuCommand(cb: (id: string) => void): () => void
  onDeepLink(cb: (delivery: { attempt: number; urls: string[] }) => void): () => void
  openDirectoryPicker(opts?: DirectoryPickerOptions): Promise<string | string[] | null>
  openFilePicker(opts?: FilePickerOptions): Promise<PickedFiles | null>
  readPickedFile(token: string, path: string): Promise<ArrayBuffer>
  releasePickedFiles(token: string): Promise<void>
  getPathForFile(file: File): string
  saveFile(opts: SaveFilePickerOptions, content: string): Promise<boolean>
  openExternal(url: string): void
  openBrowser(url: string): Promise<boolean>
  openLocalFile(url: string): void
  openPath(path: string, app?: string): Promise<string | undefined>
  revealPath(path: string): Promise<boolean>
  readClipboardImage(): Promise<ClipboardImage | null>
  writeClipboardText(text: string): Promise<void>
  getWindowFocused(): Promise<boolean>
  requestMicrophone(): Promise<boolean>
  setVoiceCallActive(active: boolean): Promise<void>
  getWindowFullscreen(): Promise<boolean>
  onWindowFullscreenChanged(cb: (fullscreen: boolean) => void): () => void
  setWindowFocus(): Promise<void>
  showWindow(): Promise<void>
  relaunch(): void
  getZoomFactor(): Promise<number>
  setZoomFactor(factor: number): Promise<void>
  getPinchZoomEnabled(): Promise<boolean>
  setPinchZoomEnabled(enabled: boolean): Promise<void>
  onPinchZoomEnabledChanged(cb: (enabled: boolean) => void): () => void
  getZoomLevel(): Promise<DesktopZoomLevel>
  setZoomLevel(level: DesktopZoomLevel): Promise<void>
  onZoomChanged(cb: (zoom: { factor: number; level: DesktopZoomLevel }) => void): () => void
  setTitlebar(theme: TitlebarTheme): Promise<void>
  setTrafficLightsPosition(position: { x: number; y: number }): Promise<void>
  runDesktopMenuAction(action: DesktopMenuAction): Promise<void>
  showContextMenu(items: ContextMenuItem[], position?: { x: number; y: number }): Promise<string | undefined>
  pickKnowledgeSources(): Promise<{ paths: string[] }>
  importKnowledgePaths(input: { libraryID: string; paths: string[] }): Promise<KnowledgeImportResult>
  readKnowledgeFile(input: KnowledgeReadFileInput): Promise<{ text: string }>
  deleteKnowledgeFiles(libraryID: string, paths: string[]): Promise<void>
  listKnowledgeFiles(libraryID: string): Promise<{ files: KnowledgeFileEntry[] }>
  knowledgeImportStatus(libraryID: string): Promise<{ progress: KnowledgeImportProgress | null }>
  onKnowledgeImportProgress(cb: (progress: KnowledgeImportProgress) => void): () => void
  setBackgroundColor(color: string): Promise<void>
  exportDebugLogs(): Promise<string>
  setForceFocus(enabled: boolean): Promise<void>
  getSpellcheckEnabled(): Promise<boolean>
  setSpellcheckEnabled(enabled: boolean): Promise<void>
  recordFatalRendererError(error: FatalRendererError): Promise<void>
  setNativeTranslations(bundle: DesktopNativeBundle): Promise<void>
}
