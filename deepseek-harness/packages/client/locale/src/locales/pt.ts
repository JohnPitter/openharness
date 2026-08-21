import type { CommonKey } from './zh.ts'

/** pt-BR base dictionary for the common namespace, checked complete against the zh key set. */
export const pt = {
  'ok': 'OK',
  'cancel': 'Cancelar',
  'close': 'Fechar',
  'copy': 'Copiar',
  'copied': 'Copiado',
  'retry': 'Tentar novamente',
  'loading': 'Carregando…',
  'load.failed': 'Falha ao carregar',
  'submit': 'Enviar',
  'submitting': 'Enviando…',
  'next': 'Próximo',
  'previous': 'Anterior',
  'skip': 'Pular',
  'delete': 'Excluir',
  'edit': 'Editar',
  'save': 'Salvar',
  'search': 'Buscar',
  'more': 'Mais',
  'collapse': 'Recolher',
  'expand': 'Expandir',
  'back': 'Voltar',
  'unknown': 'Desconhecido',
  'none': 'Nenhum',
  'truncated': 'Truncado',
} satisfies Record<CommonKey, string>
