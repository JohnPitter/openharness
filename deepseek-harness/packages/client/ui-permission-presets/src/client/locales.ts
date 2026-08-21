/** `settings.permission` namespace dictionaries (the Permission row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '权限',
  'description': '选择新会话的默认权限模式',
  'loading': '加载中',
  'unavailable': '不可用',
  'confirm.title': '确认启用 Full access？',
  'confirm.description': '启用 Full access 后，新会话将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任后续任务时使用。',
  'confirm.acknowledge': '我已了解风险，并愿意继续',
  'confirm.cancel': '取消',
  'confirm.enable': '启用 Full access',
} satisfies Record<string, string>

/** The settings.permission namespace key union. */
export type PermissionSettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Permission',
  'description': 'Choose the default permission mode for new sessions',
  'loading': 'Loading',
  'unavailable': 'Unavailable',
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access lets new sessions reduce confirmation steps and perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust subsequent tasks.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
} satisfies Record<PermissionSettingsKey, string>

/** pt-BR dictionary, checked complete against the zh key set. */
export const pt = {
  'title': 'Permissão',
  'description': 'Escolha o modo de permissão padrão para novas sessões',
  'loading': 'Carregando',
  'unavailable': 'Indisponível',
  'confirm.title': 'Ativar Full access?',
  'confirm.description': 'Com o Full access, as novas sessões reduzem as etapas de confirmação e podem executar mais ações diretamente, incluindo operações sensíveis, alterações de arquivos ou comandos externos. Use apenas quando confiar nas tarefas seguintes.',
  'confirm.acknowledge': 'Entendo os riscos e desejo continuar',
  'confirm.cancel': 'Cancelar',
  'confirm.enable': 'Ativar Full access',
} satisfies Record<PermissionSettingsKey, string>

/** es dictionary, checked complete against the zh key set. */
export const es = {
  'title': 'Permiso',
  'description': 'Elige el modo de permiso predeterminado para las nuevas sesiones',
  'loading': 'Cargando',
  'unavailable': 'No disponible',
  'confirm.title': '¿Activar Full access?',
  'confirm.description': 'Full access permite que las nuevas sesiones reduzcan los pasos de confirmación y realicen más acciones directamente, incluidas operaciones sensibles, cambios de archivos o comandos externos. Úsalo solo cuando confíes en las tareas siguientes.',
  'confirm.acknowledge': 'Entiendo los riesgos y deseo continuar',
  'confirm.cancel': 'Cancelar',
  'confirm.enable': 'Activar Full access',
} satisfies Record<PermissionSettingsKey, string>

/** Simplified Chinese dictionary for the current-session popup gate. */
export const accessZh = {
  'confirm.title': '确认启用 Full access？',
  'confirm.description': '启用 Full access 后，agent 将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。',
  'confirm.acknowledge': '我已了解风险，并愿意继续',
  'confirm.cancel': '取消',
  'confirm.enable': '启用 Full access',
} satisfies Record<string, string>

/** Current-session popup-gate key union. */
export type PermissionAccessKey = keyof typeof accessZh

/** English dictionary for the current-session popup gate. */
export const accessEn = {
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access reduces confirmation steps and lets the agent perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust the current task.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
} satisfies Record<PermissionAccessKey, string>

/** pt-BR dictionary for the current-session popup gate. */
export const accessPt = {
  'confirm.title': 'Ativar Full access?',
  'confirm.description': 'Com o Full access, o agente reduz as etapas de confirmação e pode executar mais ações diretamente, incluindo operações sensíveis, alterações de arquivos ou comandos externos. Use apenas quando confiar na tarefa atual.',
  'confirm.acknowledge': 'Entendo os riscos e desejo continuar',
  'confirm.cancel': 'Cancelar',
  'confirm.enable': 'Ativar Full access',
} satisfies Record<PermissionAccessKey, string>

/** es dictionary for the current-session popup gate. */
export const accessEs = {
  'confirm.title': '¿Activar Full access?',
  'confirm.description': 'Full access reduce los pasos de confirmación y permite que el agente realice más acciones directamente, incluidas operaciones sensibles, cambios de archivos o comandos externos. Úsalo solo cuando confíes en la tarea actual.',
  'confirm.acknowledge': 'Entiendo los riesgos y deseo continuar',
  'confirm.cancel': 'Cancelar',
  'confirm.enable': 'Activar Full access',
} satisfies Record<PermissionAccessKey, string>
