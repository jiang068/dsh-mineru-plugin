// dsh-mineru-plugin 设置卡片：查看/设置 MinerU API key 与路由。
// 数据面：GET/POST /api/dsh-mineru/config（由 dsh/index.js 的 webServer 路由提供）。
// key 不回显明文，只显示"已配置/未配置"；POST 时新 key 一次写入即脱敏存储到
// ~/.mineru/config（mode 0600）。
import { createElement as h, useEffect, useRef } from 'react';

import { useState } from 'react';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';

export interface ConfigState {
  hasKey: boolean;
  route?: string;
  apiKeySet?: boolean;
  maskKey?: string | null;
}

type ApiError = { error?: string };

function api<T>(path: string, body?: unknown): Promise<T> {
  return fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (res) => {
    const data = (await res.json().catch(() => ({}))) as ApiError & T;
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data as T;
  });
}

const ROUTES = ['auto', 'v1', 'v4'] as const;
type Route = (typeof ROUTES)[number];

export function MineruCard(props: PropsLocale<'mineru'>) {
  const t = props.t;
  const [state, setState] = useState<ConfigState | null>(null);
  const [route, setRoute] = useState<Route>('auto');
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = () => {
    fetch('/api/dsh-mineru/config')
      .then((r) => r.json())
      .then((d: ConfigState) => {
        setState(d);
        setRoute((d.route as Route) || 'auto');
        setError('');
      })
      .catch((e) => setError(String(e?.message || e)));
  };

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    load();
    const iv = setInterval(load, 30000); // 30s 自动刷新状态
    return () => {
      mounted.current = false;
      clearInterval(iv);
    };
  }, []);

  const saveKey = async () => {
    if (!keyInput.trim() && keyInput !== '') {
      setError(t('keyEmpty'));
      return;
    }
    setBusy(true);
    try {
      await api('/api/dsh-mineru/config', { apiKey: keyInput.trim() || '' });
      setKeyInput('');
      setNotice(keyInput.trim() ? t('keySaved') : t('keyCleared'));
      setError('');
      load();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const saveRoute = async (r: Route) => {
    setBusy(true);
    try {
      await api('/api/dsh-mineru/config', { route: r });
      setRoute(r);
      setNotice(t('routeSaved'));
      setError('');
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const badge = state?.hasKey
    ? h('span', { className: 'mineru-badge ok' }, t('keyConfigured'))
    : h('span', { className: 'mineru-badge warn' }, t('keyMissing'));

  return h(
    'div',
    { className: 'mineru-card' },
    h(
      'div',
      { className: 'mineru-body' },
      // ── API key 区 ──
      h('section', { className: 'mineru-section' },
        h('div', { className: 'mineru-section-head' },
          h('label', { className: 'mineru-label' }, t('apiKeyLabel')),
          badge,
        ),
        state === null
          ? h('p', { className: 'mineru-hint' }, t('loading'))
          : h('p', { className: 'mineru-hint' }, t(state.hasKey ? 'keySetHint' : 'keyUnsetHint')),
        h('div', { className: 'mineru-row' },
          h('input', {
            className: 'mineru-input',
            type: 'password',
            placeholder: state?.hasKey ? t('keyPlaceholderSet') : t('keyPlaceholder'),
            value: keyInput,
            onChange: (e) => setKeyInput((e.target as HTMLInputElement).value),
            spellCheck: false,
            autoComplete: 'off',
          }),
          h('button', { className: 'mineru-btn', disabled: busy, onClick: saveKey }, t('saveKey')),
        ),
        state?.hasKey
          ? h('button', {
              className: 'mineru-btn danger',
              disabled: busy,
              onClick: async () => {
                try {
                  await api('/api/dsh-mineru/config', { apiKey: '' });
                  setNotice(t('keyCleared'));
                  setError('');
                  load();
                } catch (e) {
                  setError(String(e?.message || e));
                }
              },
            }, t('clearKey'))
          : null,
      ),
      // ── 路由区 ──
      h('section', { className: 'mineru-section' },
        h('label', { className: 'mineru-label' }, t('routeLabel')),
        h(
          'select',
          {
            className: 'mineru-input',
            value: route,
            disabled: busy || state === null,
            onChange: (e) => saveRoute((e.target as HTMLSelectElement).value as Route),
          },
          ROUTES.map((r) => h('option', { value: r, key: r }, t('route.' + r))),
        ),
        h('p', { className: 'mineru-hint' }, t('routeHint')),
      ),
      error ? h('p', { className: 'mineru-error' }, error) : null,
      notice ? h('p', { className: 'mineru-ok' }, notice) : null,
    ),
  );
}
