// dsh-mineru-plugin 设置分区（settings.section 一级分区）。
// 参考 dsh-passwords 的 settings.section 模式：在设置页左侧导航注册一个独立分区，
// 分区体 = 标题 + 描述 + 子槽卡片列表（renderSlot 渲染注册进
// dsh-mineru-plugin.plugin.item 的卡片）。
import { createElement as h } from 'react';

interface SectionProps {
  /** 词典翻译（由注册时的 locale: 'mineru' 声明注入） */
  t: (key: string) => string;
  /** 渲染声明的子槽（settings.section 的 children 里声明了 dsh-mineru-plugin.plugin.item） */
  renderSlot: (key: string, owner?: unknown) => unknown;
}

export function MineruSection(props: SectionProps) {
  const { t, renderSlot } = props;
  return h(
    'div',
    { className: 'mineru-section-root' },
    h('h2', { className: 'mineru-section-heading', title: t('sectionTitle') }, t('sectionTitle')),
    h('p', { className: 'mineru-section-lede', title: t('sectionDesc') }, t('sectionDesc')),
    h('ul', { className: 'mineru-section-cards' }, renderSlot('dsh-mineru-plugin.plugin.item', {})),
  );
}
