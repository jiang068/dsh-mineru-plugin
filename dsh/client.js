// MinerU settings card (browser half) — mirrors @liustack/modlens.
// Contributes a card to the official "Settings → Plugins" list via the
// `settings.plugin` item slot, reading/writing /api/dsh-mineru/config.
//
// The card chrome is the official native plugin card's, copied from the
// working modlens implementation (@liustack/modlens/dsh/client.js): a
// collapsible header row (title + subtitle + rotating chevron) that opens a
// body section, with field controls drawn from the official
// `@deepseek-ai/dsh-client-ui-primitives` package (`ui.Input`) — not from
// hand-written styling. This makes the card a sibling of the built-in three
// (终端 / Agent 循环 / 网页搜索) rather than a lodger.
window.__ModuleLoader__.load({
  id: 'dsh-mineru',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var T = {
      en: {
        title: 'MinerU', subtitle: 'Document / image → Markdown vision bridge.',
        key: 'API key', cfg: 'configured', uncfg: 'not configured',
        hint1: 'A key is stored (never shown here).', hint0: 'No key set. latex/html needs a key; small markdown can use v1 keyless.',
        ph1: 'leave empty to keep current key', ph0: 'paste sk-...',
        route: 'Route', r_auto: 'auto（auto: v1 first, v4 fallback）', r_v1: 'v1 only (keyless)', r_v4: 'v4 only (needs key)',
        save: 'Save', clear: 'Clear key', loading: 'Loading…', saved: 'Saved', failed: 'Save failed',
      },
      zh: {
        title: 'MinerU', subtitle: '文档 / 图片 → Markdown 视觉桥。',
        key: 'API 密钥', cfg: '已配置', uncfg: '未配置',
        hint1: '已保存密钥（不回显明文）。', hint0: '未设置密钥。latex/html 需要 key；小文件 markdown 可用 v1 免 key。',
        ph1: '留空则保留当前 key', ph0: '粘贴 sk-...',
        route: '路由', r_auto: 'auto（优先 v1，失败降级 v4）', r_v1: '仅 v1（免 key）', r_v4: '仅 v4（需 key）',
        save: '保存', clear: '清除 key', loading: '加载中…', saved: '已保存', failed: '保存失败',
      },
    }

    function ConfigCard(react, ui, localeRef) {
      var h = react.createElement
      var Input = ui.Input

      function labels() {
        var l = (document.documentElement.lang || '').toLowerCase()
        return l.indexOf('zh') === 0 ? T.zh : T.en
      }

      return function MineruCard() {
        var openState = react.useState(false)
        var open = openState[0]
        var setOpen = openState[1]

        var summaryState = react.useState(null)
        var summary = summaryState[0]

        var draftState = react.useState('')
        var draft = draftState[0]
        var setDraft = draftState[1]

        var routeState = react.useState('auto')
        var route = routeState[0]
        var setRoute = routeState[1]

        var noteState = react.useState('')
        var note = noteState[0]
        var setNote = noteState[1]

        var t = labels()

        var load = react.useCallback(function () {
          fetch('/api/dsh-mineru/config')
            .then(function (r) { return r.json() })
            .then(function (d) {
              summaryState[1]({ hasKey: Boolean(d && d.hasKey) })
              routeState[1]((d && d.route) || 'auto')
              setNote('')
            })
            .catch(function () { setNote(t.failed) })
        }, [])

        react.useEffect(function () {
          if (open && summary === null) load()
        }, [open, summary, load])

        function saveKey() {
          setNote(t.saving || '')
          fetch('/api/dsh-mineru/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ apiKey: draft }),
          })
            .then(function () { return load() })
            .then(function () { setDraft(''); setNote(t.saved) })
            .catch(function () { setNote(t.failed) })
        }
        function clearKey() {
          setNote(t.saving || '')
          fetch('/api/dsh-mineru/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ apiKey: '' }),
          })
            .then(function () { return load() })
            .then(function () { setNote(t.saved) })
            .catch(function () { setNote(t.failed) })
        }
        function changeRoute(r) {
          setRoute(r)
          fetch('/api/dsh-mineru/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ route: r }),
          }).then(function () { return load() }).catch(function () { setNote(t.failed) })
        }

        // Native collapsible-card chrome (copied from modlens-default cards).
        var chevron = function (isOpen) {
          return h(
            'svg',
            {
              width: 16,
              height: 16,
              viewBox: '0 0 16 16',
              style: {
                color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                flex: 'none',
                transition: 'transform .16s',
                transform: isOpen ? 'rotate(180deg)' : 'none',
              },
            },
            h('path', {
              d: 'M4 6l4 4 4-4',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.5,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            }),
          )
        }

        var fieldRow = function (label, control, key) {
          return h(
            'label',
            { key: key, style: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px 0', borderTop: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))' } },
            h('div', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary, inherit)' } }, label),
            control,
          )
        }

        var body = null
        if (open) {
          if (summary === null) {
            body = h('div', { style: { padding: '12px 0', color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))', fontSize: '13px' } }, note || t.loading)
          } else {
            body = h(
              'div',
              null,
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '12px 0', color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))', fontSize: '13px' } },
                (summary.hasKey ? t.hint1 : t.hint0)),
              fieldRow(
                t.key,
                h(Input, {
                  type: 'password',
                  value: draft,
                  placeholder: summary.hasKey ? t.ph1 : t.ph0,
                  autoComplete: 'off',
                  onChange: function (e) { setDraft(e.target.value); setNote('') },
                  style: { width: '100%', boxSizing: 'border-box' },
                }),
                'key',
              ),
              h(
                'div',
                {
                  key: 'route',
                  style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 0', borderTop: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))' },
                },
                h('span', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary, inherit)' } }, t.route),
                h(
                  'select',
                  {
                    value: route,
                    onChange: function (e) { changeRoute(e.target.value) },
                    style: {
                      appearance: 'auto',
                      flex: 1,
                      padding: '6px 10px',
                      borderRadius: '8px',
                      border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                      background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.10))',
                      color: 'inherit',
                      font: 'inherit',
                      fontSize: '13px',
                    },
                  },
                  h('option', { value: 'auto' }, t.r_auto),
                  h('option', { value: 'v1' }, t.r_v1),
                  h('option', { value: 'v4' }, t.r_v4),
                ),
              ),
              h(
                'div',
                {
                  key: 'footer',
                  style: {
                    borderTop: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '12px 0 4px',
                  },
                },
                h('span', { style: { marginRight: 'auto', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))' } }, note),
                summary.hasKey
                  ? h(
                      'button',
                      {
                        type: 'button',
                        onClick: clearKey,
                        style: {
                          appearance: 'none', font: 'inherit', fontSize: '13px', lineHeight: 1.5, cursor: 'pointer',
                          border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))', borderRadius: '8px',
                          padding: '5px 14px', background: 'none', color: 'var(--dsw-alias-label-secondary, inherit)',
                        },
                      },
                      t.clear,
                    )
                  : null,
                h(
                  'button',
                  {
                    type: 'button',
                    onClick: saveKey,
                    style: {
                      appearance: 'none', font: 'inherit', fontSize: '13px', lineHeight: 1.5, cursor: 'pointer',
                      border: '1px solid transparent', borderRadius: '8px', padding: '5px 14px',
                      background: 'var(--dsw-alias-label-primary, currentColor)', color: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.05))',
                    },
                  },
                  t.save,
                ),
              ),
            )
          }
        }

        return h(
          'div',
          {
            style: {
              border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
              background: open ? 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.10))' : 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.05))',
              borderRadius: '12px',
              transition: 'border-color .16s, background .16s',
            },
          },
          h(
            'button',
            {
              type: 'button',
              'aria-expanded': open,
              onClick: function () { setOpen(!open) },
              style: {
                appearance: 'none', width: '100%', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer',
                background: 'none', border: 0, borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px',
              },
            },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: '14px', fontWeight: 600 } }, t.title),
              h('div', { style: { color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))', fontSize: '13px', lineHeight: 1.5 } }, t.subtitle),
            ),
            chevron(open),
          ),
          open ? h('div', { style: { margin: '0 16px', paddingBottom: '8px' } }, body) : null,
        )
      }
    }

    function registerCard(ctx) {
      if (typeof ctx.inject !== 'function') return
      ctx.inject(['slots'], function (scope) {
        fetch('/api/dsh-mineru/config')
          .then(function (response) {
            if (response.status === 404) return
            try {
              var react = require('react')
              var ui = require('@deepseek-ai/dsh-client-ui-primitives')
              var Card = ConfigCard(react, ui)
              scope.slots.inject('settings.plugin.item', function* () {
                yield scope.slots.register({ name: 'settings.plugin.item', id: 'mineru', key: 'mineru', order: 30 }, Card)
              })
            } catch (error) {
              console.error('[dsh-mineru] settings card skipped: ' + error)
            }
          })
          .catch(function () {})
      })
    }

    function apply(ctx) {
      registerCard(ctx)
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})
