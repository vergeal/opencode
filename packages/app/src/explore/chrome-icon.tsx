/**
 * The Chrome mark: three brand-coloured segments around a white ring and a blue hub. It marks the Chrome browser
 * integration in cards, hero headers and the install dialog, so a reader recognises the product before the name.
 * Sized by its container, or by `size`/`class` when a caller needs an explicit measurement.
 */
export function ChromeIcon(props: { size?: number | string; class?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={props.size ?? "100%"}
      height={props.size ?? "100%"}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      class={props.class}
    >
      <path d="M12 12 12 1a11 11 0 0 1 9.526 16.5Z" fill="#EA4335" />
      <path d="M12 12 21.526 17.5a11 11 0 0 1-19.052 0Z" fill="#34A853" />
      <path d="M12 12 2.474 17.5A11 11 0 0 1 12 1Z" fill="#FBBC05" />
      <circle cx="12" cy="12" r="4.6" fill="#FFFFFF" />
      <circle cx="12" cy="12" r="3.7" fill="#4285F4" />
    </svg>
  )
}
