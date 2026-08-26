/** Compact Codex-style rhythm: 8px per tick from the top, not stretched. */
export const TICK_STEP_PX = 8
export const TICK_PAD_PX = 6
/** Gap between the tick's right edge and the preview. */
export const PREVIEW_GAP_PX = 8
/** Viewport inset the preview must keep. */
export const PREVIEW_MARGIN_PX = 8
/** Slack that still counts as "at the tail" for follow-scroll. */
export const TRACK_TAIL_SLACK_PX = TICK_STEP_PX * 2

/**
 * Packed stack height for `count` waypoints, including end pads.
 * @param count - waypoint count (empty stacks still get one tick of height).
 * @returns CSS pixel height of the tick column.
 */
export function packedTrackHeight(count: number): number {
  return TICK_PAD_PX * 2 + Math.max(count, 1) * TICK_STEP_PX
}

/**
 * Tick offset from the top of the packed stack.
 * @param index - waypoint index from the top.
 * @returns CSS `top` value.
 */
export function tickTop(index: number): string {
  return `${TICK_PAD_PX + index * TICK_STEP_PX}px`
}

/**
 * Whether the track is scrolled to (or within slack of) its tail.
 * @param track - a scrollable tick column.
 * @returns true when new ticks should keep the tail in view.
 */
export function shouldFollowTrackTail(track: {
  readonly scrollHeight: number
  readonly scrollTop: number
  readonly clientHeight: number
}): boolean {
  return track.scrollHeight - track.scrollTop - track.clientHeight <= TRACK_TAIL_SLACK_PX
}

/**
 * Whether the packed stack is taller than the visible track.
 * `clientHeight === 0` is unmeasured (jsdom); that is not overflow.
 * @param track - a scrollable tick column.
 * @returns true when the track should expose a scrollbar.
 */
export function trackOverflows(track: {
  readonly scrollHeight: number
  readonly clientHeight: number
}): boolean {
  return track.clientHeight > 0 && track.scrollHeight > track.clientHeight
}

/**
 * Viewport-fixed preview coordinates: right of the tick, vertically
 * centered, then clamped so the conversation scroller and composer cannot
 * clip the card.
 * @param tick - the active tick's viewport rect.
 * @param panel - measured preview size; zeros skip that axis's clamp (first paint).
 * @param viewport - `window.innerWidth` / `innerHeight`.
 * @returns CSS `left` / `top` for `position: fixed`.
 */
export function placeRailPreview(
  tick: Pick<DOMRect, 'top' | 'right' | 'height'>,
  panel: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
): { left: number; top: number } {
  let left = tick.right + PREVIEW_GAP_PX
  let top = tick.top + tick.height / 2 - panel.height / 2
  if (panel.width > 0) {
    left = Math.min(
      Math.max(left, PREVIEW_MARGIN_PX),
      Math.max(PREVIEW_MARGIN_PX, viewport.width - panel.width - PREVIEW_MARGIN_PX),
    )
  }
  if (panel.height > 0) {
    top = Math.min(
      Math.max(top, PREVIEW_MARGIN_PX),
      Math.max(PREVIEW_MARGIN_PX, viewport.height - panel.height - PREVIEW_MARGIN_PX),
    )
  }
  return { left, top }
}
