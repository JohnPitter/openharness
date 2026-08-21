/** `workflowRun` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'workflowRun'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'run.title': '{name}',
  'run.members.one': '{count} 个成员',
  'run.members.other': '{count} 个成员',
  'run.empty': '没有启动成员',
  'phase.unassigned': '未分阶段',
  'phase.empty': '空阶段名',
  'statusCount.running': '运行中 {count}',
  'statusCount.completed': '已完成 {count}',
  'statusCount.failed': '失败 {count}',
  'statusCount.cancelled': '已取消 {count}',
  'statusCount.interrupted': '已中断 {count}',
  'member.empty': '空成员名',
  'member.open': '打开 {name}',
  'status.running': '运行中',
  'status.completed': '已完成',
  'status.failed': '失败',
  'status.cancelled': '已取消',
  'status.interrupted': '已中断',
}

/** English dictionary (same key set). */
export const en: Record<WorkflowRunKey, string> = {
  'run.title': '{name}',
  'run.members.one': '{count} member',
  'run.members.other': '{count} members',
  'run.empty': 'No members started',
  'phase.unassigned': 'Unphased',
  'phase.empty': 'Empty phase name',
  'statusCount.running': 'Running {count}',
  'statusCount.completed': 'Completed {count}',
  'statusCount.failed': 'Failed {count}',
  'statusCount.cancelled': 'Cancelled {count}',
  'statusCount.interrupted': 'Interrupted {count}',
  'member.empty': 'Empty member name',
  'member.open': 'Open {name}',
  'status.running': 'Running',
  'status.completed': 'Completed',
  'status.failed': 'Failed',
  'status.cancelled': 'Cancelled',
  'status.interrupted': 'Interrupted',
}

/** pt-BR dictionary, checked complete against the zh key set. */
export const pt: Record<WorkflowRunKey, string> = {
  'run.title': '{name}',
  'run.members.one': '{count} membro',
  'run.members.other': '{count} membros',
  'run.empty': 'Nenhum membro iniciado',
  'phase.unassigned': 'Sem fase',
  'phase.empty': 'Nome de fase vazio',
  'statusCount.running': 'Em execução {count}',
  'statusCount.completed': 'Concluídos {count}',
  'statusCount.failed': 'Com falha {count}',
  'statusCount.cancelled': 'Cancelados {count}',
  'statusCount.interrupted': 'Interrompidos {count}',
  'member.empty': 'Nome de membro vazio',
  'member.open': 'Abrir {name}',
  'status.running': 'Em execução',
  'status.completed': 'Concluído',
  'status.failed': 'Falhou',
  'status.cancelled': 'Cancelado',
  'status.interrupted': 'Interrompido',
}

/** es dictionary, checked complete against the zh key set. */
export const es: Record<WorkflowRunKey, string> = {
  'run.title': '{name}',
  'run.members.one': '{count} miembro',
  'run.members.other': '{count} miembros',
  'run.empty': 'Ningún miembro iniciado',
  'phase.unassigned': 'Sin fase',
  'phase.empty': 'Nombre de fase vacío',
  'statusCount.running': 'En ejecución {count}',
  'statusCount.completed': 'Completados {count}',
  'statusCount.failed': 'Con error {count}',
  'statusCount.cancelled': 'Cancelados {count}',
  'statusCount.interrupted': 'Interrumpidos {count}',
  'member.empty': 'Nombre de miembro vacío',
  'member.open': 'Abrir {name}',
  'status.running': 'En ejecución',
  'status.completed': 'Completado',
  'status.failed': 'Error',
  'status.cancelled': 'Cancelado',
  'status.interrupted': 'Interrumpido',
}

/** Union of this namespace's dictionary keys. */
export type WorkflowRunKey = keyof typeof zh
