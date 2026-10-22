/**
 * Extension contracts, not implementations of cloud services.
 * A provider is available only after real callable methods are registered.
 * No credentials, user material, or events are persisted by this module.
 */
export const PROVIDER_TYPES = Object.freeze({
  INPUT: 'input',
  LLM: 'llm',
  TTS: 'tts',
  MUSIC: 'music',
  ACCOUNT: 'account',
  LIBRARY: 'library',
  RECOMMENDATION: 'recommendation',
  MICROINTERACTION: 'microinteraction',
  BILLING: 'billing',
});

export const GENERATION_MODES = Object.freeze({
  SOURCE_ONLY: 'source-only',
  FREE_EXAMPLES: 'free-examples',
  FREE_EXPANSION: 'free-expansion',
});

export const GENERATION_MODE_LABELS = Object.freeze({
  [GENERATION_MODES.SOURCE_ONLY]: '仅原文内容与例子',
  [GENERATION_MODES.FREE_EXAMPLES]: '自由举例',
  [GENERATION_MODES.FREE_EXPANSION]: '自由拓展',
});

export const EXTENSION_POINTS = Object.freeze([
  Object.freeze({
    kind: 'input',
    method: 'extractText',
    title: '资料提取',
    plannedFormats: Object.freeze(['text', 'txt', 'pdf', 'docx', 'image-ocr', 'web-url']),
  }),
  Object.freeze({
    kind: 'llm',
    method: 'generateScript',
    title: '可替换知识整理模型',
    modes: Object.freeze(Object.values(GENERATION_MODES)),
  }),
  Object.freeze({ kind: 'tts', method: 'synthesizeSpeech', title: '流式或分句配音' }),
  Object.freeze({ kind: 'music', method: 'openSource', title: '音乐来源与本地歌单' }),
  Object.freeze({ kind: 'music', method: 'analyzeFrame', title: '节拍与音乐特征' }),
  Object.freeze({ kind: 'account', method: 'signIn', title: '全平台账号登录' }),
  Object.freeze({ kind: 'account', method: 'sync', title: '跨设备同步' }),
  Object.freeze({ kind: 'library', method: 'save', title: '文案库保存' }),
  Object.freeze({ kind: 'library', method: 'like', title: '点赞' }),
  Object.freeze({ kind: 'library', method: 'download', title: '本地文案下载' }),
  Object.freeze({ kind: 'library', method: 'listFiles', title: '临时协作库文件列表' }),
  Object.freeze({ kind: 'library', method: 'uploadFile', title: '临时协作库文件上传' }),
  Object.freeze({ kind: 'library', method: 'downloadFile', title: '临时协作库文件读取' }),
  Object.freeze({ kind: 'library', method: 'removeFile', title: '临时协作库本人文件删除' }),
  Object.freeze({ kind: 'recommendation', method: 'rank', title: '内容与表现方式推荐' }),
  Object.freeze({ kind: 'recommendation', method: 'recordFeedback', title: '兴趣与行为反馈' }),
  Object.freeze({ kind: 'microinteraction', method: 'onInteraction', title: '可扩展微交互' }),
  Object.freeze({ kind: 'billing', method: 'getEntitlements', title: '订阅与生成额度权益' }),
  Object.freeze({ kind: 'billing', method: 'checkBudget', title: '用量与费用上限检查' }),
  Object.freeze({ kind: 'billing', method: 'recordUsage', title: '实际生成用量记录' }),
]);

export const PRODUCT_DEFAULTS = Object.freeze({
  name: '字真的在跳动',
  englishName: 'Words Actually Dance',
  newConfigurationEmail: 'lexzeonstudio@gmail.com',
  // Interim privacy default. Public/private publishing rules need product confirmation.
  contentVisibility: 'private',
  visibilityDecision: 'pending-product-confirmation',
});

/**
 * Register: registry.register({ id, kind, title, methods: { generateScript: fn } })
 * Or: registry.register('llm', { id, title, methods: { generateScript: fn } })
 * methods must contain real implementations; absent providers remain absent.
 */
export function createProviderRegistry() {
  const providers = new Map();
  const validKinds = new Set(Object.values(PROVIDER_TYPES));

  function register(kindOrProvider, suppliedProvider) {
    const provider =
      typeof kindOrProvider === 'string' ? { ...suppliedProvider, kind: kindOrProvider } : kindOrProvider;
    if (!provider || typeof provider !== 'object') throw new TypeError('Provider must be an object.');
    const { id, kind, methods } = provider;
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('Provider id must be a non-empty string.');
    if (!validKinds.has(kind)) throw new TypeError(`Unknown provider kind: ${kind}`);
    if (providers.has(id)) throw new Error(`Provider already registered: ${id}`);
    if (!methods || typeof methods !== 'object' || Array.isArray(methods))
      throw new TypeError('Provider methods must be an object.');
    const methodEntries = Object.entries(methods);
    if (methodEntries.length === 0 || methodEntries.some(([, method]) => typeof method !== 'function')) {
      throw new TypeError(
        'A provider needs at least one implemented function; placeholders cannot be registered.',
      );
    }
    const registered = Object.freeze({
      id,
      kind,
      title: provider.title || id,
      capabilities: Object.freeze(methodEntries.map(([name]) => name)),
      methods: Object.freeze({ ...methods }),
      ...(provider.dispose ? { dispose: provider.dispose } : {}),
    });
    providers.set(id, registered);
    return registered;
  }

  function get(id) {
    return providers.get(id);
  }

  function list(filter = {}) {
    const normalized = typeof filter === 'string' ? { kind: filter } : filter;
    return [...providers.values()].filter(
      (provider) =>
        (!normalized.kind || provider.kind === normalized.kind) &&
        (!normalized.capability || provider.capabilities.includes(normalized.capability)),
    );
  }

  function unregister(id) {
    return providers.delete(id);
  }

  return Object.freeze({ register, get, list, unregister });
}

/**
 * Displayable extension status. Planned adapters are never marked as connected.
 */
export function getExtensionStatus(registry) {
  return EXTENSION_POINTS.map((point) => ({
    ...point,
    available: registry.list({ kind: point.kind, capability: point.method }).length > 0,
  }));
}

export const providerRegistry = createProviderRegistry();
export default providerRegistry;
