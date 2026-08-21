// dsh 浏览器侧插件：在设置页"插件"列表里注册 dsh-mineru-plugin 卡片。
// （独立 settings.section 分区 + 卡片，跟随 dsh 设置语言）
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import { MineruCard } from './card';
import { MineruSection } from './section';
import { zh, en } from './locales';

// 样式全部使用 dsh 设计令牌（--dsw-alias-*），颜色/主题与官方 PluginCard 一致。
const CSS = `
.mineru-section-root{display:flex;flex-direction:column;gap:10px}
.mineru-section-heading{font-size:16px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary);margin:0}
.mineru-section-lede{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary);margin:0 0 4px}
.mineru-section-cards{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
.mineru-section-cards>li{min-width:0}
.mineru-card{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s,background .16s;font-size:13px;line-height:1.5;overflow:hidden}
.mineru-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.mineru-body{display:flex;flex-direction:column;gap:0;padding:4px 16px 16px}
.mineru-section{display:flex;flex-direction:column;gap:10px;padding:16px 0;border-top:1px solid var(--dsw-alias-border-l2)}
.mineru-section:first-child{border-top:0}
.mineru-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:22px}
.mineru-label{display:block;font-size:12px;font-weight:650;letter-spacing:.01em;color:var(--dsw-alias-label-secondary)}
.mineru-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.mineru-input{width:100%;box-sizing:border-box;min-width:0;padding:7px 10px;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;transition:border-color .15s,box-shadow .15s}
.mineru-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}
.mineru-input::placeholder{color:var(--dsw-alias-label-tertiary)}
select.mineru-input{height:auto;min-height:36px;max-width:320px}
.mineru-btn{appearance:none;border:0;border-radius:8px;padding:7px 14px;font-size:13px;line-height:1.35;font-weight:600;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted,#fff);cursor:pointer;white-space:nowrap;transition:filter .15s,transform .08s}
.mineru-btn:active:not(:disabled){transform:translateY(1px)}
.mineru-btn:hover:not(:disabled){filter:brightness(1.1)}
.mineru-btn:disabled{opacity:.4;cursor:default}
.mineru-btn.danger{background:none;border:1px solid var(--dsw-alias-state-error-primary,#ef4444);color:var(--dsw-alias-state-error-primary,#ef4444)}
.mineru-btn.danger:hover:not(:disabled){filter:none;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 10%,transparent)}
.mineru-badge{font-size:11px;padding:1px 8px;border-radius:999px;border:1px solid var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);margin-left:6px;white-space:nowrap}
.mineru-badge.ok{border-color:var(--dsw-alias-state-success-primary,#22c55e);color:var(--dsw-alias-state-success-primary,#22c55e)}
.mineru-badge.warn{border-color:var(--dsw-alias-state-warn-primary,#f7ad31);color:var(--dsw-alias-state-warn-primary,#f7ad31)}
.mineru-error{color:var(--dsw-alias-state-error-primary,#ef4444);font-size:12px;margin:0;padding-top:4px}
.mineru-ok{color:var(--dsw-alias-state-success-primary,#22c55e);font-size:12px;margin:0;padding-top:4px}
.mineru-hint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary);margin:0;padding:0}
`;

if (typeof document !== 'undefined') {
  const el = document.createElement('style');
  el.textContent = CSS;
  document.head.appendChild(el);
}

export const inject = ['slots', 'locale'] as const;

export function apply(ctx: ClientContext): void {
  // 独立设置分区，在设置页左侧导航注册 MinerU 一级分区
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'dsh-mineru-plugin',
        key: 'dsh-mineru-plugin',
        order: 106,
        label: () => ctx.locale.bind('mineru')('sectionTitle'),
        locale: 'mineru',
        children: { 'dsh-mineru-plugin.plugin.item': { kind: 'list', scope: 'root' } },
      },
      MineruSection,
    ),
  );

  // 设置卡片：注册进上面分区声明的子槽
  ctx.slots.inject('dsh-mineru-plugin.plugin.item', () =>
    ctx.slots.register(
      {
        name: 'dsh-mineru-plugin.plugin.item',
        id: 'dsh-mineru-plugin-card',
        key: 'dsh-mineru-plugin-card',
        order: 55,
        locale: 'mineru',
        inject: () => ({}),
      },
      MineruCard,
    ),
  );

  // 双语词典：卡片文字跟随 dsh 设置里的语言
  ctx.effect(() => ctx.locale.register('mineru', { zh, en }), 'dsh-mineru-plugin: dicts');
}
