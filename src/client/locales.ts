// dsh-mineru-plugin 设置卡片的双语词典（locale 命名空间 'mineru'）。
// 注册进 dsh 的 locale 服务后，卡片文字跟随 dsh 设置里的语言
// （设置 → 通用 → 语言 / Settings → General → Language），切换即生效。
export const zh = {
  sectionTitle: 'MinerU',
  sectionDesc: 'MinerU 文档/图片视觉桥接的设置（API key 与路由）。',
  apiKeyLabel: 'API Key',
  keyConfigured: '已配置',
  keyMissing: '未配置',
  keySetHint: '已设置 API key（不回显明文）。可随时更换。',
  keyUnsetHint: '未设置 API key。v1 路由可免 key 使用小文件，但 latex/html 输出需要 key。',
  keyPlaceholder: '粘贴 MinerU 官方 API key（sk-...）',
  keyPlaceholderSet: '留空则保留现有 key；输入即替换',
  saveKey: '保存',
  clearKey: '清除已保存的 key',
  keySaved: 'API key 已保存（脱敏存储到 ~/.mineru/config）',
  keyCleared: 'API key 已清除',
  keyEmpty: '请输入要保存的 API key',
  routeLabel: '路由',
  'route.auto': '自动',
  'route.v1': '仅 v1（免 key 轻量）',
  'route.v4': '仅 v4（精准解析）',
  routeHint:
    'auto：小文件 markdown 先试 v1，latex/html 或 v1 失败自动回退 v4；设置 key 后推荐 auto。',
  routeSaved: '路由已保存',
  loading: '加载中…',
};

export const en = {
  sectionTitle: 'MinerU',
  sectionDesc: 'Settings for the MinerU document/image vision bridge (API key and route).',
  apiKeyLabel: 'API Key',
  keyConfigured: 'Configured',
  keyMissing: 'Not configured',
  keySetHint: 'API key is set (never shown as plaintext). You can change it anytime.',
  keyUnsetHint:
    'No API key set. The v1 route works keyless for small files, but latex/html output requires a key.',
  keyPlaceholder: 'Paste a MinerU official API key (sk-...)',
  keyPlaceholderSet: 'Leave empty to keep the current key; type to replace it',
  saveKey: 'Save',
  clearKey: 'Clear saved key',
  keySaved: 'API key saved (stored privately in ~/.mineru/config)',
  keyCleared: 'API key cleared',
  keyEmpty: 'Please enter an API key to save',
  routeLabel: 'Route',
  'route.auto': 'Auto',
  'route.v1': 'v1 only (keyless, lightweight)',
  'route.v4': 'v4 only (precise parse)',
  routeHint:
    'auto: try v1 first for small markdown files, fall back to v4 for latex/html or if v1 fails; recommended after setting a key.',
  routeSaved: 'Route saved',
  loading: 'Loading…',
};
