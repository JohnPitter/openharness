/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-08-13.1'

/** The complete editable internal-testing notice in both supported GUI locales. */
export const WELCOME_NOTICE_COPY = {
  zh: {
    title: '内测声明',
    body: 'OpenHarness 目前的 0.1 版本仍处在面向开发者进行测试的阶段，还有许多地方需要持续改进和打磨，希望听取广大开发者的反馈建议。预计 OpenHarness 的核心插件以及基础 API 都会在接下来的一段时间内快速迭代、持续演化。\n\n我们期待与全球开发者一起，在开源、开放、可复用、可组合的基础设施之上，共同探索智能上限。',
    continueLabel: '继续',
  },
  en: {
    title: 'Internal Testing Notice',
    body: "OpenHarness 0.1 remains in testing. Many areas need further improvement, and we welcome feedback from the developer community. OpenHarness's core plugins and foundational APIs will continue to evolve rapidly over the coming months.\n\nWe look forward to exploring the limits of intelligence with developers around the world, building on open-source, open, reusable, and composable infrastructure.",
    continueLabel: 'Continue',
  },
  pt: {
    title: 'Aviso de teste interno',
    body: 'O OpenHarness 0.1 ainda está em fase de testes. Muitas áreas precisam de melhorias, e agradecemos o feedback da comunidade de desenvolvedores. Os plugins principais e as APIs fundamentais do OpenHarness continuarão evoluindo rapidamente nos próximos meses.\n\nEsperamos explorar os limites da inteligência com desenvolvedores do mundo todo, construindo sobre uma infraestrutura de código aberto, aberta, reutilizável e combinável.',
    continueLabel: 'Continuar',
  },
  es: {
    title: 'Aviso de prueba interna',
    body: 'OpenHarness 0.1 sigue en fase de pruebas. Muchas áreas necesitan mejoras y agradecemos los comentarios de la comunidad de desarrolladores. Los plugins principales y las APIs fundamentales de OpenHarness seguirán evolucionando rápidamente en los próximos meses.\n\nEsperamos explorar los límites de la inteligencia junto a desarrolladores de todo el mundo, construyendo sobre una infraestructura de código abierto, abierta, reutilizable y componible.',
    continueLabel: 'Continuar',
  },
} as const
