/** Machine value of the preset that requires an explicit GUI risk gate. */
export const FULL_ACCESS_PRESET = 'danger-full-access'

/**
 * Convert conventional kebab-case preset names into user-facing title case.
 * @param name - host-supplied preset label or key.
 * @returns the title-cased conventional key, or a non-kebab label unchanged.
 */
export function displayPresetName(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name
  return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/**
 * Render a permission preset under its locale product label.
 * @param value - preset machine value.
 * @param name - host-supplied preset name.
 * @param t - locale lookup for the known product labels; absent keeps English fallbacks.
 * @returns the locale product label, or the conventional display name.
 */
export function displayPermissionPreset(
  value: string,
  name: string,
  t?: (key: 'preset.fullAccess' | 'preset.readOnly' | 'preset.workspaceWrite') => string,
): string {
  if (value === FULL_ACCESS_PRESET) return t?.('preset.fullAccess') ?? 'Full access'
  if (t !== undefined && value === 'read-only') return t('preset.readOnly')
  if (t !== undefined && value === 'workspace-write') return t('preset.workspaceWrite')
  return displayPresetName(name)
}
