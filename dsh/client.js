// MinerU settings card (browser half) — mirrors @liustack/modlens.
// Contributes a card to the official "Settings → Plugins" list via the
// `settings.plugin.item` slot, reading/writing /api/dsh-mineru/config.
window.__ModuleLoader__.load({
  id: "dsh-mineru-plugin",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var T = {
      en: {
        title: 'MinerU', key: 'API key', cfg: 'configured', uncfg: 'not configured',
        hint1: 'A key is stored (never shown here).', hint0: 'No key set. latex/html needs a key; small markdown can use v1 keyless.',
        ph1: 'leave empty to keep current key', ph0: 'paste sk-...', save: 'Save', clear: 'Clear key',
      },
      zh: {
        title: 'MinerU', key: 'API 密钥', cfg: '已配置', uncfg: '未配置',
        hint1: '已保存密钥（不回显明文）。', hint0: '未设置密钥。latex/html 需要 key；小文件 markdown 可用 v1 免 key。',
        ph1: '留空则保留当前 key', ph0: '粘贴 sk-...', save: '保存', clear: '清除 key',
      },
    }
    function text() {
      var l = (document.documentElement.lang || '').toLowerCase()
      return l.indexOf('zh') === 0 ? T.zh : T.en
    }

    function CardFactory(react) {
      var h = react.createElement
      var useState = react.useState
      var useEffect = react.useEffect

      function load(set) {
        fetch('/api/dsh-mineru/config').then(function (r) {
          if (!r.ok) return null
          return r.json()
        }).then(function (d) {
          if (d) set({ hasKey: !!d.hasKey })
        }).catch(function () {})
      }

      return function Card() {
        var st = useState({ hasKey: false })
        var data = st[0]
        var set = st[1]
        var kd = useState('')
        var key = kd[0]
        var setKey = kd[1]
        useEffect(function () { load(set) }, [])
        var t = text()

        function postKey(v) {
          fetch('/api/dsh-mineru/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ apiKey: v }),
          }).then(function () { return load(set) }).then(function () { setKey('') }).catch(function () {})
        }
        function clear() { fetch('/api/dsh-mineru/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: '' }) }).then(function () { return load(set) }).catch(function () {}) }

        return h('div', { style: sWrap },
          h('section', { style: sSec },
            h('div', { style: sRow },
              h('span', { style: sLabel }, t.key),
              h('span', { style: badge(data.hasKey) }, data.hasKey ? t.cfg : t.uncfg),
            ),
            h('p', { style: sHint }, data.hasKey ? t.hint1 : t.hint0),
            h('div', { style: sRow },
              h('input', { type: 'text', style: sInput, placeholder: data.hasKey ? t.ph1 : t.ph0, value: key, onChange: function (e) { setKey(e.target.value) } }),
              h('button', { style: sBtn, onClick: function () { postKey(key) } }, t.save),
            ),
            data.hasKey ? h('button', { style: sBtnDanger, onClick: clear }, t.clear) : null,
          ),
        )
      }
    }

    var sWrap = { padding: '6px 16px 14px', fontSize: '13px', lineHeight: 1.5, color: 'var(--dsw-alias-label-primary, inherit)' }
    var sSec = { padding: '12px 0', display: 'flex', flexDirection: 'column', gap: '8px' }
    var sRow = { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }
    var sLabel = { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary, #888)' }
    var sHint = { margin: 0, color: 'var(--dsw-alias-label-tertiary, #999)', fontSize: '12px' }
    var sInput = { flex: 1, minWidth: 160, boxSizing: 'border-box', padding: '6px 10px', fontSize: '13px', color: 'var(--dsw-alias-label-primary, inherit)', background: 'var(--dsw-alias-bg-layer-2, inherit)', border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.25))', borderRadius: '8px' }
    var sBtn = { appearance: 'none', border: 0, background: '#1677ff', color: '#fff', borderRadius: '8px', padding: '7px 14px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }
    var sBtnDanger = { marginTop: '8px', appearance: 'none', border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', borderRadius: '8px', padding: '7px 14px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }

    function badge(ok) {
      var c = ok ? '#22c55e' : '#f7ad31'
      return { fontSize: '11px', padding: '1px 8px', borderRadius: '999px', border: '1px solid ' + c, color: c, whiteSpace: 'nowrap' }
    }

    function registerCard(ctx) {
      if (typeof ctx.inject !== 'function') return
      ctx.inject('slots', function (scope) {
        fetch('/api/dsh-mineru/config').then(function (response) {
          if (response.status === 404) return
          try {
            var react = require('react')
            var Card = CardFactory(react)
            scope.slots.inject('settings.plugin.item', function* () {
              yield scope.slots.register({ name: 'settings.plugin.item', id: "dsh-mineru-plugin", key: 'dsh-mineru', order: 30 }, Card)
            })
          } catch (e) {
            console.error('[dsh-mineru] settings card skipped: ' + e)
          }
        }).catch(function () {})
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
