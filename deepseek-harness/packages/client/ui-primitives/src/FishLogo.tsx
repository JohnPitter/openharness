// OpenHarness mascot: cream head in a blue open-ring harness with mint node
// clasps. Native 24×24 square so the sidebar rail mark shares the same box as
// the other 36px controls. Brand inks are fixed so the character stays
// recognizable in both themes.

import type { IconProps } from './icons/props.ts'

/** Shared mascot geometry in a 24×24 box. */
function MascotGlyph() {
  return (
    <>
      <path
        d="M 5 10 A 7 7 0 1 1 19 10"
        stroke="#4F8CFF"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="5" cy="10" r="2.15" fill="#7DDB6A" />
      <circle cx="19" cy="10" r="2.15" fill="#7DDB6A" />
      <circle cx="12" cy="8.2" r="5.35" fill="#F4EFE6" />
      <ellipse cx="10.15" cy="8" rx="0.95" ry="1.25" fill="#1A1A24" />
      <ellipse cx="13.85" cy="8" rx="0.95" ry="1.25" fill="#1A1A24" />
      <path
        d="M 10.2 7.05 Q 10.15 6.45 10.85 6.55"
        stroke="#1A1A24"
        strokeWidth="0.7"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M 13.8 7.05 Q 13.85 6.45 13.15 6.55"
        stroke="#1A1A24"
        strokeWidth="0.7"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M 10.55 10.15 Q 12 11.2 13.45 10.15"
        stroke="#1A1A24"
        strokeWidth="0.75"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="8.35" cy="16.35" r="1.45" fill="#F4EFE6" />
      <circle cx="15.65" cy="16.35" r="1.45" fill="#F4EFE6" />
    </>
  )
}

/**
 * Render the OpenHarness mascot.
 * @param props.size - edge in px (default 24).
 * @param props.className - extra class for layout placement.
 * @returns the mascot svg (aria-hidden; pair with the wordmark for accessibility).
 */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <MascotGlyph />
    </svg>
  )
}
