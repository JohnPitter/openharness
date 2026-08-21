/** `skill` namespace dictionaries for the dedicated tool row. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'skill'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'row.running': '正在加载 skill',
  'row.failed': 'skill 加载失败',
  'row.stopped': 'skill 加载已中止',
  'row.instructions': '说明',
  'menu.userOnly': '仅用户',
} satisfies Record<string, string>

/** The skill namespace key union. */
export type SkillKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'row.running': 'Loading skill',
  'row.failed': 'Skill load failed',
  'row.stopped': 'Skill load stopped',
  'row.instructions': 'Instructions',
  'menu.userOnly': 'user-only',
} satisfies Record<SkillKey, string>

/** pt-BR dictionary, checked complete against the zh key set. */
export const pt = {
  'row.running': 'Carregando skill',
  'row.failed': 'Falha ao carregar skill',
  'row.stopped': 'Carregamento de skill interrompido',
  'row.instructions': 'Instruções',
  'menu.userOnly': 'somente usuário',
} satisfies Record<SkillKey, string>

/** es dictionary, checked complete against the zh key set. */
export const es = {
  'row.running': 'Cargando skill',
  'row.failed': 'Error al cargar skill',
  'row.stopped': 'Carga de skill detenida',
  'row.instructions': 'Instrucciones',
  'menu.userOnly': 'solo usuario',
} satisfies Record<SkillKey, string>
