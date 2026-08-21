// OpenHarness brand wordmark: open-ring logo + "OH" letterforms.
// Ink rides currentColor so it works in both themes. includeMark=false
// drops the ring so sidebar.brand.name can sit beside the slotted mark.

import type { IconProps } from './icons/props.ts'

/** Display options for the brand wordmark. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading mark; defaults to true. */
  includeMark?: boolean | undefined
}

/**
 * Render the full brand wordmark.
 * @param props.size - height in px (default 24; width follows the selected artwork).
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to include the leading ring mark.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  const width = includeMark ? 52 : 24
  return (
    <svg
      width={(size * width) / 24}
      height={size}
      className={className}
      viewBox={includeMark ? '0 0 52 24' : '28 0 24 24'}
      fill="none"
      aria-hidden="true"
    >
      {includeMark
        ? (
          <>
            <path d="M 19.8 16.6 A 9 9 0 1 1 19.8 7.4" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none"/>
            <circle cx="19.8" cy="16.6" r="2.2" fill="currentColor"/>
            <circle cx="19.8" cy="7.4" r="2.2" fill="currentColor"/>
          </>
        )
        : null}
      <text
        x="28"
        y="17.2"
        fill="currentColor"
        fontSize="13"
        fontFamily="inherit"
        fontWeight="600"
        letterSpacing="0.4"
      >OH</text>
    </svg>
  )
}
