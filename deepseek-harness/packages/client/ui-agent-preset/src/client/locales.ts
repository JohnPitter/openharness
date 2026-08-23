/** Locale bundles for the agent-preset settings row, hero chip, header control, and management section. */

/** Locale keys these surfaces render. */
export type AgentPresetSettingsKey =
  | 'title' | 'description' | 'loading' | 'error' | 'userTrust' | 'seatHint' | 'headerHint' | 'headerBusy'
  | 'nav' | 'sectionIntro' | 'builtIn' | 'setDefault' | 'view'
  | 'presetStandardName' | 'presetStandardDescription'
  | 'presetCodeName' | 'presetCodeDescription'
  | 'presetMinimalName' | 'presetMinimalDescription'
  | 'presetCordisName' | 'presetCordisDescription'
  | 'presetWorkflowName' | 'presetWorkflowDescription'
  | 'duplicate' | 'duplicateUnavailable' | 'delete' | 'presetId' | 'presetIdPlaceholder' | 'copyOf'
  | 'displayName' | 'displayNamePlaceholder'
  | 'inUse' | 'noDescription' | 'builtInGroup' | 'customGroup'
  | 'brokenBadge' | 'brokenNoCopy'
  | 'composition' | 'cancel' | 'close' | 'retry'
  | 'copyTitle' | 'copyIntro' | 'create' | 'creating' | 'creatorDraft'
  | 'openLocation' | 'showLocation' | 'revealedPathLabel'
  | 'idRequired' | 'idInvalid' | 'idTaken'
  | 'deleteTitle' | 'deleteDescription' | 'deleteConfirm' | 'deleting'

/** English copy. */
export const en: Record<AgentPresetSettingsKey, string> = {
  title: 'Agent preset',
  description: 'Applies to sessions you start from now on. Running sessions keep the preset they began with.',
  loading: 'Loading presets…',
  error: 'Could not load agent presets.',
  userTrust: 'Custom',
  seatHint: 'Agent preset for the session you are about to start',
  headerHint: 'The agent preset this session runs',
  headerBusy: 'Wait until this turn finishes to switch preset',
  nav: 'Agent presets',
  sectionIntro:
    'A preset is the plugin composition one session\'s agent runs — its tools, prompt, and capabilities. '
    + 'Duplicate an existing one and make it yours, or let the agent draft one for you in Creator mode.',
  builtIn: 'Built-in',
  setDefault: 'Set as default',
  view: 'View',
  presetStandardName: 'Standard mode',
  presetStandardDescription:
    'Full coding agent with file editing, shell, file and web search, skills, planning, goals, subagents, and workflows. Construction follows the J-Space protocol by default.',
  presetCodeName: 'PTC mode',
  presetCodeDescription:
    'All Standard mode capabilities, with tools exposed through the Code Mode SDK so the model can combine multi-step operations in one TypeScript program. Construction follows the J-Space protocol by default.',
  presetMinimalName: 'Minimal mode',
  presetMinimalDescription:
    'Two-tool coding agent with persistent bash and str_replace_editor.',
  presetCordisName: 'Creator mode',
  presetCordisDescription:
    'Built for creating custom agent presets, with all Standard mode capabilities plus runtime inspection, plugin experiments, and preset-authoring guidance.',
  presetWorkflowName: 'Workflow mode',
  presetWorkflowDescription:
    'Orchestrator and planner with Standard tools. Pick a planner model for this session and a worker model for subagents and construction. Construction follows the J-Space protocol by default.',
  duplicate: 'Duplicate',
  duplicateUnavailable: 'This deployment has no writable preset directory',
  delete: 'Delete',
  presetId: 'Identifier',
  presetIdPlaceholder: 'my-agent',
  displayName: 'Name',
  displayNamePlaceholder: 'Shown in the picker; defaults to the identifier',
  inUse: 'In use',
  builtInGroup: 'Built-in',
  customGroup: 'Custom',
  noDescription: 'No description.',
  brokenBadge: 'Failed to load',
  brokenNoCopy: 'A preset that failed to load cannot be duplicated',
  copyOf: 'Copied from',
  composition: 'Composition (agent.cordis.yml)',
  cancel: 'Cancel',
  close: 'Close',
  retry: 'Retry',
  copyTitle: 'Duplicate preset',
  copyIntro:
    'The whole preset is copied on this machine. The identifier becomes its directory name and cannot '
    + 'be changed later; everything else is edited in the preset\'s own files.',
  create: 'Create',
  creating: 'Creating…',
  creatorDraft: 'Draft a custom preset with Creator mode',
  openLocation: 'Open folder',
  showLocation: 'Show location',
  revealedPathLabel: 'Preset files:',
  idRequired: 'Give the preset an identifier.',
  idInvalid: 'Use lowercase letters, digits, and hyphens, starting with a letter or digit.',
  idTaken: 'A preset with this identifier already exists.',
  deleteTitle: 'Delete this preset?',
  deleteDescription:
    'The preset directory is deleted. Sessions already running on it keep working; new sessions cannot select it.',
  deleteConfirm: 'Delete',
  deleting: 'Deleting…',
}

/** pt-BR dictionary, checked complete against the zh key set. */
export const pt = {
  title: 'Preset de agente',
  description: 'Aplica-se às sessões iniciadas a partir de agora. Sessões em execução mantêm o preset com que começaram.',
  loading: 'Carregando presets…',
  error: 'Não foi possível carregar os presets de agente.',
  userTrust: 'Personalizado',
  seatHint: 'Preset de agente da sessão que você está prestes a iniciar',
  headerHint: 'O preset de agente que esta sessão executa',
  headerBusy: 'Espere o turno terminar para trocar o preset',
  nav: 'Presets de agente',
  sectionIntro:
    'Um preset é a composição de plugins que o agente de uma sessão executa — suas ferramentas, prompt e capacidades. '
    + 'Duplique um existente e personalize-o, ou deixe o agente criar um para você no modo Creator.',
  builtIn: 'Integrado',
  setDefault: 'Definir como padrão',
  view: 'Ver',
  presetStandardName: 'Modo Standard',
  presetStandardDescription:
    'Agente de codificação completo, com edição de arquivos, shell, busca em arquivos e na web, skills, planejamento, objetivos, subagentes e fluxos de trabalho. A construção segue o protocolo J-Space por padrão.',
  presetCodeName: 'Modo PTC',
  presetCodeDescription:
    'Todas as capacidades do modo Standard, com ferramentas expostas pelo Code Mode SDK para que o modelo combine operações em várias etapas num único programa TypeScript. A construção segue o protocolo J-Space por padrão.',
  presetMinimalName: 'Modo Minimal',
  presetMinimalDescription:
    'Agente de codificação com duas ferramentas: bash persistente e str_replace_editor.',
  presetCordisName: 'Modo Creator',
  presetCordisDescription:
    'Feito para criar presets de agente personalizados, com todas as capacidades do modo Standard, além de inspeção de runtime, experimentos com plugins e orientação de autoria de presets.',
  presetWorkflowName: 'Modo Workflow',
  presetWorkflowDescription:
    'Orquestrador e planejador com as ferramentas do modo Standard. Escolha um modelo planejador para esta sessão e um modelo trabalhador para subagentes e construção. A construção segue o protocolo J-Space por padrão.',
  duplicate: 'Duplicar',
  duplicateUnavailable: 'Esta implantação não tem um diretório de presets gravável',
  delete: 'Excluir',
  presetId: 'Identificador',
  presetIdPlaceholder: 'my-agent',
  displayName: 'Nome',
  displayNamePlaceholder: 'Exibido no seletor; por padrão usa o identificador',
  inUse: 'Em uso',
  builtInGroup: 'Integrados',
  customGroup: 'Personalizados',
  noDescription: 'Sem descrição.',
  brokenBadge: 'Falha ao carregar',
  brokenNoCopy: 'Um preset que falhou ao carregar não pode ser duplicado',
  copyOf: 'Copiado de',
  composition: 'Composição (agent.cordis.yml)',
  cancel: 'Cancelar',
  close: 'Fechar',
  retry: 'Tentar novamente',
  copyTitle: 'Duplicar preset',
  copyIntro:
    'Todo o preset é copiado nesta máquina. O identificador torna-se o nome do diretório e não pode '
    + 'ser alterado depois; todo o resto é editado nos arquivos do próprio preset.',
  create: 'Criar',
  creating: 'Criando…',
  creatorDraft: 'Rascunhe um preset personalizado com o modo Creator',
  openLocation: 'Abrir pasta',
  showLocation: 'Mostrar localização',
  revealedPathLabel: 'Arquivos do preset:',
  idRequired: 'Informe um identificador para o preset.',
  idInvalid: 'Use letras minúsculas, dígitos e hífens, começando com letra ou dígito.',
  idTaken: 'Já existe um preset com este identificador.',
  deleteTitle: 'Excluir este preset?',
  deleteDescription:
    'O diretório do preset será excluído. Sessões já em execução nele continuam funcionando; novas sessões não poderão selecioná-lo.',
  deleteConfirm: 'Excluir',
  deleting: 'Excluindo…',
} satisfies Record<AgentPresetSettingsKey, string>

/** es dictionary, checked complete against the zh key set. */
export const es = {
  title: 'Preset de agente',
  description: 'Se aplica a las sesiones que inicies a partir de ahora. Las sesiones en ejecución conservan el preset con el que comenzaron.',
  loading: 'Cargando presets…',
  error: 'No se pudieron cargar los presets de agente.',
  userTrust: 'Personalizado',
  seatHint: 'Preset de agente de la sesión que estás a punto de iniciar',
  headerHint: 'El preset de agente que ejecuta esta sesión',
  headerBusy: 'Espera a que termine el turno para cambiar el preset',
  nav: 'Presets de agente',
  sectionIntro:
    'Un preset es la composición de plugins que ejecuta el agente de una sesión: sus herramientas, prompt y capacidades. '
    + 'Duplica uno existente y hazlo tuyo, o deja que el agente cree uno para ti en modo Creator.',
  builtIn: 'Integrado',
  setDefault: 'Establecer como predeterminado',
  view: 'Ver',
  presetStandardName: 'Modo Standard',
  presetStandardDescription:
    'Agente de codificación completo con edición de archivos, shell, búsqueda en archivos y en la web, skills, planificación, objetivos, subagentes y flujos de trabajo. La construcción sigue el protocolo J-Space por defecto.',
  presetCodeName: 'Modo PTC',
  presetCodeDescription:
    'Todas las capacidades del modo Standard, con herramientas expuestas a través del Code Mode SDK para que el modelo combine operaciones de varios pasos en un solo programa TypeScript. La construcción sigue el protocolo J-Space por defecto.',
  presetMinimalName: 'Modo Minimal',
  presetMinimalDescription:
    'Agente de codificación con dos herramientas: bash persistente y str_replace_editor.',
  presetCordisName: 'Modo Creator',
  presetCordisDescription:
    'Diseñado para crear presets de agente personalizados, con todas las capacidades del modo Standard más inspección del runtime, experimentos con plugins y guía de autoría de presets.',
  presetWorkflowName: 'Modo Workflow',
  presetWorkflowDescription:
    'Orquestador y planificador con las herramientas del modo Standard. Elige un modelo planificador para esta sesión y un modelo trabajador para subagentes y construcción. La construcción sigue el protocolo J-Space por defecto.',
  duplicate: 'Duplicar',
  duplicateUnavailable: 'Esta implementación no tiene un directorio de presets con permiso de escritura',
  delete: 'Eliminar',
  presetId: 'Identificador',
  presetIdPlaceholder: 'my-agent',
  displayName: 'Nombre',
  displayNamePlaceholder: 'Se muestra en el selector; por defecto usa el identificador',
  inUse: 'En uso',
  builtInGroup: 'Integrados',
  customGroup: 'Personalizados',
  noDescription: 'Sin descripción.',
  brokenBadge: 'Error al cargar',
  brokenNoCopy: 'Un preset que no se pudo cargar no puede duplicarse',
  copyOf: 'Copiado de',
  composition: 'Composición (agent.cordis.yml)',
  cancel: 'Cancelar',
  close: 'Cerrar',
  retry: 'Reintentar',
  copyTitle: 'Duplicar preset',
  copyIntro:
    'Todo el preset se copia en esta máquina. El identificador pasa a ser el nombre del directorio y no puede '
    + 'cambiarse después; todo lo demás se edita en los archivos del propio preset.',
  create: 'Crear',
  creating: 'Creando…',
  creatorDraft: 'Crea un borrador de preset personalizado con el modo Creator',
  openLocation: 'Abrir carpeta',
  showLocation: 'Mostrar ubicación',
  revealedPathLabel: 'Archivos del preset:',
  idRequired: 'Asigna un identificador al preset.',
  idInvalid: 'Usa letras minúsculas, dígitos y guiones, comenzando con una letra o un dígito.',
  idTaken: 'Ya existe un preset con este identificador.',
  deleteTitle: '¿Eliminar este preset?',
  deleteDescription:
    'El directorio del preset se eliminará. Las sesiones que ya se ejecutan en él seguirán funcionando; las nuevas sesiones no podrán seleccionarlo.',
  deleteConfirm: 'Eliminar',
  deleting: 'Eliminando…',
} satisfies Record<AgentPresetSettingsKey, string>

/** Simplified Chinese copy. */
export const zh: Record<AgentPresetSettingsKey, string> = {
  title: 'Agent 预设',
  description: '对此后新建的会话生效。运行中的会话保持它开始时的预设。',
  loading: '正在加载预设…',
  error: '无法加载 Agent 预设。',
  userTrust: '自定义',
  seatHint: '即将开始的这个会话所用的 Agent 预设',
  headerHint: '本会话运行的 Agent 预设',
  headerBusy: '等本轮结束后再切换预设',
  nav: 'Agent 预设',
  sectionIntro: '预设即一个会话的 Agent 所运行的插件组装 —— 它的工具、提示词与能力。复制一份既有预设改成自己的，或用「创造模式」让 Agent 帮你创建。',
  builtIn: '内置',
  setDefault: '设为默认',
  view: '查看',
  presetStandardName: '标准模式',
  presetStandardDescription: '功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。构建默认遵循 J-Space 协议。',
  presetCodeName: 'PTC 模式',
  presetCodeDescription: '具备标准模式的全部能力，并通过 Code Mode SDK 呈现工具，让模型用一个 TypeScript 程序组合多步操作。构建默认遵循 J-Space 协议。',
  presetMinimalName: '极简模式',
  presetMinimalDescription: '仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。',
  presetCordisName: '创造模式',
  presetCordisDescription: '用于创建自定义 Agent preset：具备标准模式的全部能力，并提供运行时检查、插件实验和 preset 创作指导。',
  presetWorkflowName: '工作流模式',
  presetWorkflowDescription: '编排与规划会话，具备标准模式工具。为本会话选择规划模型，并为子代理与构建选择工人模型。构建默认遵循 J-Space 协议。',
  duplicate: '复制',
  duplicateUnavailable: '此部署未配置可写的预设目录',
  delete: '删除',
  presetId: '标识符',
  presetIdPlaceholder: 'my-agent',
  displayName: '名称',
  displayNamePlaceholder: '选择器中显示的名字，缺省用标识符',
  inUse: '当前使用',
  builtInGroup: '内置',
  customGroup: '自定义',
  noDescription: '暂无描述。',
  brokenBadge: '加载失败',
  brokenNoCopy: '预设加载失败，不能复制',
  copyOf: '复制自',
  composition: '组装（agent.cordis.yml）',
  cancel: '取消',
  close: '关闭',
  retry: '重试',
  copyTitle: '复制预设',
  copyIntro: '整个预设会在本机复制一份。标识符将成为目录名，事后无法更改；其余内容之后直接在预设自己的文件里编辑。',
  create: '创建',
  creating: '正在创建…',
  creatorDraft: '用「创造模式」创作自定义预设',
  openLocation: '打开目录',
  showLocation: '查看路径',
  revealedPathLabel: '预设文件：',
  idRequired: '请填写标识符。',
  idInvalid: '只能使用小写字母、数字与连字符，且以字母或数字开头。',
  idTaken: '该标识符已被占用。',
  deleteTitle: '删除该预设？',
  deleteDescription: '预设目录将被删除。已在其上运行的会话不受影响；新会话将无法再选择它。',
  deleteConfirm: '删除',
  deleting: '正在删除…',
}

/** Preset roster fields needed to resolve Web display copy. */
export interface PresetDisplaySource {
  /** Stable preset id. */
  readonly id: string
  /** Whether the deployment ships the preset or the user owns it. */
  readonly trust: 'system' | 'user'
  /** Unlocalized name published by the preset. */
  readonly name?: string
  /** Unlocalized description published by the preset. */
  readonly description?: string
}

/** Display copy resolved for the active Web locale. */
export interface PresetDisplayText {
  /** Localized built-in name or the preset's own fallback name. */
  readonly name: string
  /** Localized built-in description or the preset's own description. */
  readonly description?: string
}

interface PresetLocaleKeys {
  readonly name: AgentPresetSettingsKey
  readonly description: AgentPresetSettingsKey
}

const BUILT_IN_PRESET_KEYS: Readonly<Partial<Record<string, PresetLocaleKeys>>> = {
  standard: { name: 'presetStandardName', description: 'presetStandardDescription' },
  code: { name: 'presetCodeName', description: 'presetCodeDescription' },
  minimal: { name: 'presetMinimalName', description: 'presetMinimalDescription' },
  cordis: { name: 'presetCordisName', description: 'presetCordisDescription' },
  workflow: { name: 'presetWorkflowName', description: 'presetWorkflowDescription' },
}

/**
 * Resolve preset display copy without making user-authored metadata translatable.
 * @param preset - roster row whose copy is being rendered.
 * @param t - active Web locale lookup.
 * @returns localized copy for a known shipped preset, otherwise file metadata.
 */
export function presetDisplayText(
  preset: PresetDisplaySource,
  t: (key: AgentPresetSettingsKey) => string,
): PresetDisplayText {
  const keys = preset.trust === 'system' ? BUILT_IN_PRESET_KEYS[preset.id] : undefined
  if (keys !== undefined) return { name: t(keys.name), description: t(keys.description) }
  return {
    name: preset.name ?? preset.id,
    ...preset.description === undefined ? {} : { description: preset.description },
  }
}
