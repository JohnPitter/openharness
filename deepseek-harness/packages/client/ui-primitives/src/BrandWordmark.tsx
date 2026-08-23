// OpenHarness brand wordmark: the mascot mark. includeMark=false drops the
// glyph so sidebar.brand.name can sit beside the slotted mark.

import { FishLogo } from './FishLogo.tsx'
import type { IconProps } from './icons/props.ts'

/** Display options for the brand wordmark. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading mark; defaults to true. */
  includeMark?: boolean | undefined
}

/**
 * Render the brand mark. The product name is slotted HTML, not SVG letters.
 * @param props.size - height in px (default 24; width follows the selected artwork).
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to include the mascot; false renders an empty 24 box.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  if (!includeMark) {
    return (
      <svg
        width={size}
        height={size}
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      />
    )
  }
  return <FishLogo size={size} className={className} />
}
