/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '关闭',
  'openDocument': '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'general.nav': '通用设置',
  'connection.error': '连接异常',
  'connection.retry': '立即重连',
  'connection.connecting': '连接中',
  'connection.connected': '连接成功',
  'connection.reconnect': '连接异常，点击立即重连',
  'connection.restart': '连接中，点击立即重连',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
  'connection.error': 'Disconnected',
  'connection.retry': 'Reconnect now',
  'connection.connecting': 'Connecting',
  'connection.connected': 'Connected',
  'connection.reconnect': 'Disconnected, reconnect now',
  'connection.restart': 'Connecting, restart now',
} satisfies Record<SettingsKey, string>

/** pt-BR dictionary, checked complete against the zh key set. */
export const pt = {
  'trigger': 'Configurações',
  'title': 'Configurações',
  'close': 'Fechar',
  'openDocument': 'Abrir arquivo de configuração',
  'openDocument.error': 'Não foi possível abrir o arquivo de configuração',
  'general.nav': 'Geral',
  'connection.error': 'Desconectado',
  'connection.retry': 'Reconectar agora',
  'connection.connecting': 'Conectando',
  'connection.connected': 'Conectado',
  'connection.reconnect': 'Desconectado, reconectar agora',
  'connection.restart': 'Conectando, reconectar agora',
} satisfies Record<SettingsKey, string>

/** es dictionary, checked complete against the zh key set. */
export const es = {
  'trigger': 'Configuración',
  'title': 'Configuración',
  'close': 'Cerrar',
  'openDocument': 'Abrir archivo de configuración',
  'openDocument.error': 'No se pudo abrir el archivo de configuración',
  'general.nav': 'General',
  'connection.error': 'Desconectado',
  'connection.retry': 'Reconectar ahora',
  'connection.connecting': 'Conectando',
  'connection.connected': 'Conectado',
  'connection.reconnect': 'Desconectado, reconectar ahora',
  'connection.restart': 'Conectando, reconectar ahora',
} satisfies Record<SettingsKey, string>
