import { describe, expect, it } from 'vitest'
import {
  packedTrackHeight,
  placeRailPreview,
  shouldFollowTrackTail,
  tickTop,
  trackOverflows,
} from '../src/client/chat/rail-preview.ts'

describe('rail-preview', () => {
  it('packs ticks from the top pad on an 8px rhythm', () => {
    expect(tickTop(0)).toBe('6px')
    expect(tickTop(1)).toBe('14px')
    expect(packedTrackHeight(0)).toBe(20)
    expect(packedTrackHeight(40)).toBe(332)
    expect(packedTrackHeight(81)).toBe(660)
  })

  it('treats an unmeasured track as not overflowing', () => {
    expect(trackOverflows({ scrollHeight: 400, clientHeight: 0 })).toBe(false)
    expect(trackOverflows({ scrollHeight: 400, clientHeight: 400 })).toBe(false)
    expect(trackOverflows({ scrollHeight: 400, clientHeight: 80 })).toBe(true)
  })

  it('follows the tail within two ticks of the end', () => {
    expect(shouldFollowTrackTail({ scrollHeight: 400, scrollTop: 304, clientHeight: 80 })).toBe(true)
    expect(shouldFollowTrackTail({ scrollHeight: 400, scrollTop: 0, clientHeight: 80 })).toBe(false)
  })

  it('places the preview to the right of the tick and centers it', () => {
    expect(placeRailPreview(
      { top: 40, right: 100, height: 8 },
      { width: 120, height: 40 },
      { width: 1024, height: 768 },
    )).toEqual({ left: 108, top: 24 })
  })

  it('clamps a preview that would overflow the right or bottom edge', () => {
    expect(placeRailPreview(
      { top: 750, right: 980, height: 8 },
      { width: 200, height: 80 },
      { width: 1024, height: 768 },
    )).toEqual({ left: 816, top: 680 })
  })

  it('clamps a preview that would overflow the left or top edge', () => {
    expect(placeRailPreview(
      { top: 4, right: -40, height: 8 },
      { width: 200, height: 80 },
      { width: 1024, height: 768 },
    )).toEqual({ left: 8, top: 8 })
  })

  it('skips clamping while the panel size is still unmeasured', () => {
    expect(placeRailPreview(
      { top: 40, right: 100, height: 8 },
      { width: 0, height: 0 },
      { width: 1024, height: 768 },
    )).toEqual({ left: 108, top: 44 })
  })

  it('keeps the margin when the panel is wider than the viewport', () => {
    expect(placeRailPreview(
      { top: 40, right: 100, height: 8 },
      { width: 2000, height: 2000 },
      { width: 320, height: 240 },
    )).toEqual({ left: 8, top: 8 })
  })
})
