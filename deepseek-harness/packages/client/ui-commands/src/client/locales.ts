/** `command` namespace dictionaries (the popupSelect shell's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'search.placeholder': '搜索…',
  'search.aria': '筛选选项',
  'status.loading': '正在加载选项…',
  'status.applying': '正在应用…',
  'status.empty': '无选项',
  'overlay.aria': '/{command} 选项',
  'listbox.aria': '/{command} 匹配项',
  'notice.imagesUnsupported': '/{command} 不接受图片附件，请先移除图片',
} satisfies Record<string, string>

/** The command namespace key union. */
export type CommandKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'search.placeholder': 'Search…',
  'search.aria': 'Filter options',
  'status.loading': 'Loading options…',
  'status.applying': 'Applying…',
  'status.empty': 'No options',
  'overlay.aria': '/{command} options',
  'listbox.aria': '/{command} matches',
  'notice.imagesUnsupported': '/{command} does not accept image attachments; remove them first',
} satisfies Record<CommandKey, string>

/** pt-BR dictionary, checked complete against the zh key set. */
export const pt = {
  'search.placeholder': 'Pesquisar…',
  'search.aria': 'Filtrar opções',
  'status.loading': 'Carregando opções…',
  'status.applying': 'Aplicando…',
  'status.empty': 'Nenhuma opção',
  'overlay.aria': 'Opções de /{command}',
  'listbox.aria': 'Correspondências de /{command}',
  'notice.imagesUnsupported': '/{command} não aceita anexos de imagem; remova-os primeiro',
} satisfies Record<CommandKey, string>

/** es dictionary, checked complete against the zh key set. */
export const es = {
  'search.placeholder': 'Buscar…',
  'search.aria': 'Filtrar opciones',
  'status.loading': 'Cargando opciones…',
  'status.applying': 'Aplicando…',
  'status.empty': 'Sin opciones',
  'overlay.aria': 'Opciones de /{command}',
  'listbox.aria': 'Coincidencias de /{command}',
  'notice.imagesUnsupported': '/{command} no acepta adjuntos de imagen; quítalos primero',
} satisfies Record<CommandKey, string>
