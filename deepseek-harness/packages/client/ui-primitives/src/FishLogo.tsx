// OpenHarness mascot: the 3D cream-headed character in the blue open-ring
// harness with mint node clasps. Native 24×24 square so the sidebar rail
// mark shares the same box as the other 36px controls. The raster lives at
// `/mascot.png` (no tile fill); contrast on light chrome comes from the
// blue ring and mint nodes.

import type { IconProps } from './icons/props.ts'

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
      <image href="/mascot.png" width="24" height="24" />
    </svg>
  )
}
