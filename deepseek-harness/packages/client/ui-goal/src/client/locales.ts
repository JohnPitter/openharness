/** `goal` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'phase.active': '进行中的目标',
  'phase.paused': '已暂停的目标',
  'phase.blocked': '受阻的目标',
  'objective.aria': '目标内容',
  'commandInput.aria': '命令输入',
  'action.save': '保存目标',
  'action.cancel': '取消编辑',
  'action.pause': '暂停目标',
  'action.resume': '恢复目标',
  'action.edit': '编辑目标',
  'action.clear': '清除目标',
} satisfies Record<string, string>

/** The goal namespace key union. */
export type GoalKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'phase.active': 'Ongoing Goal',
  'phase.paused': 'Paused Goal',
  'phase.blocked': 'Blocked Goal',
  'objective.aria': 'Goal objective',
  'commandInput.aria': 'Command input',
  'action.save': 'Save goal',
  'action.cancel': 'Cancel edit',
  'action.pause': 'Pause goal',
  'action.resume': 'Resume goal',
  'action.edit': 'Edit goal',
  'action.clear': 'Clear goal',
} satisfies Record<GoalKey, string>

/** pt-BR dictionary, checked complete against the zh key set. */
export const pt = {
  'phase.active': 'Meta em andamento',
  'phase.paused': 'Meta pausada',
  'phase.blocked': 'Meta bloqueada',
  'objective.aria': 'Objetivo da meta',
  'commandInput.aria': 'Entrada de comando',
  'action.save': 'Salvar meta',
  'action.cancel': 'Cancelar edição',
  'action.pause': 'Pausar meta',
  'action.resume': 'Retomar meta',
  'action.edit': 'Editar meta',
  'action.clear': 'Limpar meta',
} satisfies Record<GoalKey, string>

/** es dictionary, checked complete against the zh key set. */
export const es = {
  'phase.active': 'Meta en curso',
  'phase.paused': 'Meta en pausa',
  'phase.blocked': 'Meta bloqueada',
  'objective.aria': 'Objetivo de la meta',
  'commandInput.aria': 'Entrada de comando',
  'action.save': 'Guardar meta',
  'action.cancel': 'Cancelar edición',
  'action.pause': 'Pausar meta',
  'action.resume': 'Reanudar meta',
  'action.edit': 'Editar meta',
  'action.clear': 'Limpiar meta',
} satisfies Record<GoalKey, string>
