window.__ModuleLoader__.load({
  id: '@milobonbaril/dsh-mommy',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    return {
      inject: ['slots', 'locale', 'remote', 'remote.commands'],
      apply(ctx) {
        const dictionaries = {
          en: { title: 'DSH Mommy', volume: 'Voice volume', saving: 'Saving…', saved: 'Saved', loading: 'Loading…', error: 'Volume could not be saved', retry: 'Retry', muted: 'Muted' },
          fr: { title: 'DSH Mommy', volume: 'Volume de la voix', saving: 'Enregistrement…', saved: 'Enregistré', loading: 'Chargement…', error: 'Impossible d’enregistrer le volume', retry: 'Réessayer', muted: 'Muet' },
          zh: { title: 'DSH Mommy', volume: '语音音量', saving: '正在保存…', saved: '已保存', loading: '正在加载…', error: '无法保存音量', retry: '重试', muted: '静音' },
        };
        for (const [language, dictionary] of Object.entries(dictionaries)) ctx.locale.register('dsh-mommy', language, dictionary);
        const t = ctx.locale.bind('dsh-mommy');

        function VolumeControl(props) {
          React.useSyncExternalStore(callback => ctx.locale.subscribe(callback), () => ctx.locale.getSnapshot());
          const [volume, setVolume] = React.useState(null);
          const [status, setStatus] = React.useState('loading');
          const [error, setError] = React.useState('');
          const saved = React.useRef(null);
          const request = React.useRef(null);
          const busy = React.useRef(false);
          const mounted = React.useRef(false);
          const allowed = props.useAccess('commands/execute');
          const inputId = React.useId();

          async function execute(percent) {
            const controller = new AbortController();
            request.current?.abort();
            request.current = controller;
            const result = await ctx.remote.commands.execute(props.sessionId, `/mommy-volume${percent === undefined ? '' : ` ${percent}`}`, [], controller.signal);
            if (!result.ok) throw new Error(result.error.message);
            const execution = result.value;
            if (!execution || execution.result.kind !== 'success') throw new Error(execution?.result.text ?? 'DSH Mommy command is unavailable');
            const state = JSON.parse(execution.result.text);
            if (!Number.isInteger(state.volume) || state.volume < 0 || state.volume > 100) throw new Error('Invalid volume response');
            return state.volume;
          }

          async function load() {
            if (busy.current || !allowed) return;
            busy.current = true;
            setError('');
            setStatus('loading');
            try {
              const current = await execute();
              if (mounted.current) { saved.current = current; setVolume(current); setStatus('saved'); }
            } catch (failure) {
              if (mounted.current) { setError(failure.message); setStatus('error'); }
            } finally { busy.current = false; }
          }

          async function commit(value) {
            if (busy.current || value === null || value === saved.current || !allowed) return;
            busy.current = true;
            setStatus('saving');
            setError('');
            try {
              const current = await execute(value);
              if (mounted.current) { saved.current = current; setVolume(current); setStatus('saved'); }
            } catch (failure) {
              if (mounted.current) { setError(failure.message); setStatus('error'); }
            } finally { busy.current = false; }
          }

          React.useEffect(() => {
            mounted.current = true;
            load();
            return () => { mounted.current = false; request.current?.abort(); };
          }, [props.sessionId, allowed]);

          return h('div', { className: 'mommy-volume', style: { width: '100%', minWidth: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } },
            h('style', null, '.mommy-volume input:focus-visible,.mommy-volume button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}.mommy-volume input:disabled{opacity:.5}.mommy-volume button{color:inherit;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:3px 8px;cursor:pointer}'),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 0' } },
              h('label', { htmlFor: inputId, style: { color: 'var(--dsw-alias-label-primary)' } }, `${t('title')} · ${t('volume')}`),
              h('input', {
                id: inputId, type: 'range', min: 0, max: 100, step: 1,
                value: volume ?? 0, disabled: volume === null || status === 'saving' || !allowed,
                'aria-valuetext': volume === 0 ? t('muted') : `${volume ?? 0}%`,
                style: { width: 130, maxWidth: '100%', accentColor: 'var(--dsw-alias-brand-primary)', cursor: 'pointer' },
                onChange: event => { setVolume(Number(event.target.value)); setStatus('edited'); },
                onPointerUp: event => commit(Number(event.currentTarget.value)),
                onKeyUp: event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commit(Number(event.currentTarget.value)); },
                onBlur: event => commit(Number(event.currentTarget.value)),
              }),
              h('output', { htmlFor: inputId, style: { minWidth: 32, fontVariantNumeric: 'tabular-nums' } }, volume === null ? '—' : `${volume}%`),
              h('span', { role: 'status', 'aria-live': 'polite' }, status === 'saving' ? t('saving') : status === 'loading' ? t('loading') : status === 'saved' ? t('saved') : ''),
              status === 'error' ? h('button', { type: 'button', onClick: () => volume === null ? load() : commit(volume) }, t('retry')) : null),
            error ? h('div', { role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary)' } }, `${t('error')} : ${error}`) : null);
        }
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock', id: 'dsh-mommy-volume', order: 20,
          label: () => t('volume'),
        }, VolumeControl));
      },
    };
  },
});
