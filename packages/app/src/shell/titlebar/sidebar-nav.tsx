import { createMemo } from "solid-js"
import { Key } from "@solid-primitives/keyed"
import { Schema } from "effect"
import { DragDropProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable, useSortable } from "@dnd-kit/solid/sortable"
import { Accessibility, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { Icon } from "@opencode/ui/icon"
import type { IconName } from "@opencode/ui/icons/catalog"
import { arrayMove } from "@/runtime/array-move"
import { useLanguage } from "@/runtime/i18n/language"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"

const NavState = Persistence.struct({
  order: Schema.mutable(Schema.Array(Schema.String)),
})

const NAV_ITEMS = [
  { id: "home", labelKey: "home.title", icon: "workspace" },
  { id: "inbox", labelKey: "inbox.title", icon: "bubble-5" },
  { id: "knowledge", labelKey: "knowledge.title", icon: "file-document" },
  { id: "scheduled", labelKey: "scheduled.title", icon: "checklist" },
] as const satisfies ReadonlyArray<{ id: string; labelKey: string; icon: IconName }>

export type SidebarNavID = (typeof NAV_ITEMS)[number]["id"]

/** The fixed navigation panels of the sidebar; the user drags them into the order they visit most. */
export function SidebarNav(props: { pressed: (id: SidebarNavID) => boolean; onSelect: (id: SidebarNavID) => void }) {
  const language = useLanguage()

  const [state, setState] = persisted(Persist.global("sidebar.nav"), NavState, { order: [] })

  const items = createMemo(() => {
    if (state.order.length === 0) return NAV_ITEMS
    const saved = new Set(state.order)
    const byID = new Map<string, (typeof NAV_ITEMS)[number]>(
      NAV_ITEMS.map((item) => [item.id, item] as [string, (typeof NAV_ITEMS)[number]]),
    )

    return [...NAV_ITEMS.filter((item) => !saved.has(item.id)), ...state.order.flatMap((id) => byID.get(id) ?? [])]
  })

  return (
    <div data-slot="sidebar-nav" class="flex w-full shrink-0 flex-col gap-1 pb-2">
      <DragDropProvider
        sensors={[
          PointerSensor.configure({
            activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })],
          }),
        ]}
        modifiers={[RestrictToVerticalAxis]}
        plugins={(defaults) => [
          ...defaults.filter((plugin) => plugin !== Accessibility),
          Feedback.configure({ dropAnimation: null }),
        ]}
        onDragEnd={(event) => {
          const source = event.operation.source

          if (event.canceled || !isSortable(source) || source.initialIndex === source.index) return
          setState(
            "order",
            arrayMove(
              items().map((item) => item.id),
              source.initialIndex,
              source.index,
            ),
          )
        }}
      >
        <Key each={items()} by={(item) => item.id}>
          {(item, index) => (
            <SidebarNavRow
              id={item().id}
              index={index()}
              label={language.t(item().labelKey)}
              icon={item().icon}
              pressed={props.pressed(item().id)}
              onSelect={() => props.onSelect(item().id)}
            />
          )}
        </Key>
      </DragDropProvider>
    </div>
  )
}

function SidebarNavRow(props: {
  id: string
  index: number
  label: string
  icon: IconName
  pressed: boolean
  onSelect: () => void
}) {
  const sortable = useSortable({
    get id() {
      return props.id
    },
    get index() {
      return props.index
    },
  })

  return (
    <div ref={sortable.ref} class="relative shrink-0">
      <button
        type="button"
        data-titlebar-tab-action
        data-action={`vertical-tabs-${props.id}`}
        data-state={props.pressed ? "pressed" : undefined}
        aria-pressed={props.pressed}
        class="group flex h-7 w-full shrink-0 items-center gap-2 rounded-[6px] px-2 text-[13px] text-v2-text-text-faint hover:text-v2-text-text-base data-[state=pressed]:text-v2-text-text-base"
        onClick={props.onSelect}
      >
        <Icon name={props.icon} class="shrink-0" />
        <span class="min-w-0 truncate">{props.label}</span>
      </button>
    </div>
  )
}
