---
name: macos-ui-design
description: 设计、改造或审查 opencode 的 app 与 desktop 界面时使用；覆盖设置页、主从分栏、列表与详情、工具栏、菜单、选中/悬停/焦点态、材质与深浅色。要求克制、结构优先、只读优先，并落到本仓库真实的 token、i18n 与组件约定。
---

# macOS-Style UI Design

macOS style here means restraint, clear structure and predictable behavior. Hierarchy comes from spacing, alignment and tonal layering, not from gradients, saturated color or shadow.

Read the reference surface before designing: `packages/app/src/settings/settings.css` and `packages/app/src/settings/providers/extensions.tsx`. The settings screen is the closest existing expression of this style.

The consolidated, repo-wide rules live in `docs/opencode-ui-standard.md`. It merges this skill with the density, skeleton sizes and status language of the scheduled-workbench design, and maps every value onto real `--v2-*` tokens. Read it when the task touches layout sizes, component specs, page patterns or the acceptance checklist.

## When To Use

- Designing or reshaping an app or desktop surface: settings, a list/detail pane, a toolbar, a menu, a picker or a confirmation flow.
- Reviewing a change for macOS feel: selection, hover, focus, density, materials, light/dark parity.
- Deciding where a new control, panel or empty state belongs.

## When Not To Use

- Marketing or onboarding pages, where a louder visual language is intentional.
- Terminal output, diffs, code and logs: use the existing code/terminal metrics instead of UI density rules.
- A surface that already has a shared component variant; extend the variant rather than restyling a copy.

## Design Workflow

1. Write the layout and state plan first: panes, widths, what is selected, what is empty, what is loading, what is destructive. Do not start from a component.
2. Read the owning rules before writing CSS or JSX: `packages/app/AGENTS.md` sections Typography, Fonts, Scrolling, Localization, State Machines; `packages/ui/AGENTS.md` for shared components.
3. Ship read-only management first: browse, search, open a directory, rescan. Defer enable/disable/delete to a later phase, behind an explicit confirmation.
4. Pick tokens by semantic role before writing markup. If no token names the role, extend the theme; do not borrow a nearby color.
5. Implement and verify light mode, then dark mode. A design that only works in light mode is unfinished.
6. Verify behavior and computed styles, not screenshots: focus order, hit areas, overflow, both themes, reduced motion.

## Layout

- Prefer one master/detail split: a left list and a right detail pane. Do not stack both into a single scrolling column.
- Settings dimensions, reuse them: 264px sidebar (220px between 800 and 1047px), 720px content max, 32px content inset, 1048px centered shell. See `--settings-*` in `settings.css`.
- Give the sidebar and the detail pane independent scroll. The detail pane owns its own header and scrollport.
- Keep one toolbar per pane. A page header sits at the top of the detail pane, sticky, with the title on the left and actions aligned to the title's line box, not to the description. One row, 44–48px tall; put search in the list pane, not in the page header.
- Limit toolbar actions to two icon buttons plus an overflow menu. Every icon button keeps an accessible label.
- Rows: 44px minimum for settings rows, 30px for sidebar/navigation items, 28px for menu items. Keep row height explicit; do not let line height and padding drift.
- Group headers are 24px high, 11px quiet text (`--v2-text-text-faint`), no icon and no accent. They label a section; they are not controls.
- Add a right inspector only when the selected row has secondary detail that should stay visible. Default 300px, range 260–460px, collapsible, never open with an empty selection. This matches the existing inspector pane in `packages/app/src/components-lab/lab.tsx`.
- Do not show sidebar, detail and inspector at once when the content width is tight. Drop the inspector first, then collapse the sidebar; do not squeeze the detail pane below a readable width.
- Collapse by container, not viewport: the settings shell switches at `@container settings-screen (max-width: 799px)`. Below that, replace the sidebar with a menu trigger instead of squeezing both columns.
- An empty detail pane is a designed state: keep the list visible, show a short instruction in the detail area.
- Do not nest scroll containers. A panel that scrolls should not contain another panel that also scrolls.

## Visual Language

- Build hierarchy with background layers: `--v2-background-bg-base` for the page, `--v2-background-bg-layer-01` for a grouped surface, `--v2-background-bg-layer-02/03` for hover and selection. Prefer tonal steps over borders, and borders over shadows.
- Spacing scale: 2, 4, 8, 12, 16, 20, 24, 32. Use 2–4px inside a row, 8px between related controls, 20–24px between sections, 32px for page inset.
- Radii: 4px controls and menu rows, 8px menu surface or grouped list, 10px popover, panel or settings card, 12px dialog, 9999px for pills. Keep one radius per surface class.
- Separators are 0.5px: `border-bottom: 0.5px solid var(--v2-border-border-base)` or `box-shadow: inset 0 0 0 0.5px var(--v2-border-border-muted)` for a card outline. Do not use 1px gray lines plus a shadow.
- Shadows are for detached layers only: `--v2-elevation-raised` for a panel lifted off the page, `--v2-elevation-floating` for menus and popovers, `--v2-elevation-overlay` for modals. Flat rows and cards get no drop shadow.
- Materials are for floating surfaces only: `--v2-material-surface-strong` plus `--v2-material-blur-thick` for menus, `--v2-material-surface` plus `--v2-material-blur-regular` for lighter overlays. Use the `*-opaque` twin as the reduced-transparency fallback. Never blur a content pane or every row.
- Selection uses a neutral fill, not the accent: `--v2-background-bg-layer-02/03` or `--v2-overlay-simple-overlay-pressed`. Reserve `--v2-background-bg-accent`, `--v2-text-text-accent` and `--v2-icon-icon-accent` for primary actions, links and focus.
- Hover is lighter than selection: `--v2-overlay-simple-overlay-hover`. Pressed is `--v2-overlay-simple-overlay-pressed`.
- Limit each pane to two tonal steps. A card inside a card means the hierarchy is wrong; flatten it or move the inner group to a section header.
- Text contrast stays readable on every layer: `--v2-text-text-base` for primary copy, `--v2-text-text-muted` for descriptions, `--v2-text-text-faint` for metadata only. Do not use faint text for actionable labels.
- Focus is always visible and distinct from both: 3px `--v2-focus-ring-color` with 1–2px offset on controls; use an inset 2px ring when the ring would be clipped by an overflow container.
- Control labels are quiet by default. In settings, buttons, field labels, tags and row titles render at weight 400; reserve weight for the page title and real emphasis.

## Typography And Density

- Follow `packages/app/AGENTS.md` Typography and Fonts. Use `13px` with `var(--line-height-compact)` for compact UI text and `var(--line-height-base)` for body copy. Never use `leading-none`, `line-height: 1` or a 13px line box for normal text; Inter descenders clip in truncation.
- Use the token, not a copied number. The values live in `packages/ui/src/styles/tokens/theme.css`; do not restate them in feature CSS.
- Font roles: UI text inherits or uses `var(--font-family-sans)` / `var(--v2-font-family-sans)`; code, paths and logs use `var(--font-family-mono)` / `var(--v2-font-family-code)`. Never write a literal family.
- Titles are 20px with `-0.2px` letter spacing; 13px UI text uses `-0.04px` where the surrounding surface already does. Do not invent a new tracking value per component.
- Density is compact rows plus readable prose: keep 44px rows for settings, but let descriptions keep `var(--line-height-base)`. Do not shrink a description's line height to make the row shorter.

## States

- Empty: one quiet sentence and one next action. No large illustration, no colored panel.
- Loading: `Loader` from `@opencode/ui/loader` for page, pane, search, connect and install states. `Spinner` from `@opencode/ui/spinner` means the AI is working and nothing else. Never restyle either.
- Refreshing: keep the previous data visible and show a quiet inline `Loader` in the header. Do not blank the pane or reset its scroll to re-read.
- Error: `--v2-state-fg-danger` text, a one-line cause and a retry action in place. Do not report a persistent failure only through a toast.
- Partial failure: render the rows that loaded, then one inline row-level error. Do not replace the whole list with one error page.
- Disabled: keep the label readable, use the disabled token/opacity convention of the shared control, and explain why on hover or in the description. Do not fake disabled with reduced contrast alone.
- Selected: exactly one selection per list; pointer selection and keyboard selection must render the same state and keep the detail pane in sync.
- Long lists: search first, then grouping with quiet group headers, then a sticky header if needed. Pages use native overflow; menus and dialog result lists use `MenuScroll`.

## Interaction

- Make every action keyboard reachable. Lists move with arrow keys, Enter opens, Escape closes the top overlay, and focus returns to the trigger.
- Keep focus visible on rows, tabs, menu items and icon buttons. A selected row with no focus indicator is a regression.
- Menus, popovers and dialog result lists scroll with `MenuScroll` from `@opencode/ui/menu-scroll`. Put list padding on `viewportClass`, not on the menu surface. Use its ref for reveal and keyboard scroll.
- Menu surface uses 2px padding and an 8px radius; rows are 28px with a 4px radius. Show a trailing check for the current value. Use icons in menus only when they disambiguate commands, never as decoration.
- Tooltips explain a control; they do not repeat its label. Trigger them from the label, not from a decorative icon.
- Confirm destructive actions in a dialog that names the object, defaults to cancel, and uses a danger-styled confirm. The confirm label repeats the verb and the object, never "OK". Read-only actions need no confirmation.
- Use short motion with a job: 90–150ms ease-out for control state, 180ms for a panel entering. Check both `@media (prefers-reduced-motion: reduce)` and `:root[data-motion="reduce"]`, because the app mirrors the OS setting into `data-motion`.
- Render icons through `Icon` from `@opencode/ui/icon` with a catalog name (`packages/ui/src/icons/catalog.ts`, `additional-icons.ts`). Do not import an icon family directly or inline a different SVG per row; keep icons monochrome through `currentColor` and `--v2-icon-*`.

## Checklist

- [ ] Every user-visible string goes through `language.t(...)` or `language.plural(...)`; no hardcoded English, and no hardcoded Chinese either. Chinese comes from the locale file (`packages/app/src/runtime/i18n/zh.ts`).
- [ ] Colors come from `--v2-*` tokens. No hex, `rgb()`, or one-off color values in feature CSS.
- [ ] Fonts come from `--font-family-sans` / `--v2-font-family-sans` / `--font-family-mono` / `--v2-font-family-code`. No literal family, no new `@font-face`.
- [ ] Pages and panels use `overflow-y-auto` plus `min-h-0` and `data-scrollable`; menus and result lists use `MenuScroll`. No `ScrollView` outside the timeline/Home, no `scrollbar-width: thin|auto`, no `scrollbar-color`.
- [ ] 13px text uses `var(--line-height-compact)`; body copy uses `var(--line-height-base)`. No `leading-none`.
- [ ] Selection is neutral, hover is lighter, focus is visible and distinct. Accent is reserved for primary actions and focus.
- [ ] Light and dark both checked, including borders, selection, disabled and empty states.
- [ ] Loading uses `Loader`, AI work uses `Spinner`; neither is restyled.
- [ ] Motion respects reduced motion and has a stated purpose.
- [ ] Lifecycle phases come from an explicit state machine with pure selectors, not several booleans.
- [ ] Destructive actions are deferred, confirmed and name their target.
- [ ] Acceptance is verified through DOM, computed styles, focus order and overflow, not screenshots alone.

## Anti-Patterns

- A single column that stacks list and detail with one scrollbar.
- A colored icon per row, or a different accent for every category.
- Selected rows filled with saturated blue in a neutral list; the accent is not a selection color here.
- Large gradients, glassmorphism on content panes, or a blur on every card.
- Drop shadows on flat rows and 1px gray borders used together to fake depth.
- Rounded 16px "web card" corners inside a desktop panel; keep the surface radius scale above.
- Full-width danger buttons, or destructive actions placed next to navigation without confirmation.
- Hardcoded English or Chinese copy, literal `Inter`/`monospace`, or a raw hex color.
- `leading-none` on 13px text, or a fixed 13px line box inside a truncating row.
- A spinner reused for page loading, or a custom loading indicator next to a shared one.
- Custom scrollbars, `scrollbar-width: thin`, or `ScrollView` added just to change a thumb.
- Booleans such as `loading`, `saving` and `open` encoding one lifecycle in parallel.
