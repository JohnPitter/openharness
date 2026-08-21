// OpenHarness logo: open ring with two node dots at the gap ends.
// Native 24×24 square so the sidebar rail mark shares the same box as
// the other 36px controls; color rides currentColor.

import type { IconProps } from './icons/props.ts'

/**
 * Render the OpenHarness logo.
 * @param props.size - edge in px (default 24).
 * @param props.className - extra class for layout placement.
 * @returns the logo svg (aria-hidden; pair with the wordmark for accessibility).
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
      <path d="M 19.2 16.5 A 7.2 7.2 0 1 1 19.2 7.5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" fill="none"/>
      <circle cx="19.2" cy="16.5" r="1.8" fill="currentColor"/>
      <circle cx="19.2" cy="7.5" r="1.8" fill="currentColor"/>
    </svg>
  )
}
