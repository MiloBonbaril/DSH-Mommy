import { Config, validateConfig } from './config.js';
import { loadBank, createPlayer } from './player.js';
import { registerVolumeControls } from './volume.js';
export { Config };
export const inject = ['commands', 'tools', 'configEditor'];

export function questionCategory(questions) {
  if (questions.some(q => q.intent?.kind === 'approval')) return 'permission';
  if (questions.some(q => q.intent?.kind === 'plan-review')) return 'review';
  return questions.some(q => q.options?.length > 0) ? 'decision' : 'question';
}

export function failureCategory(failure) {
  if (failure?.status === 401 || failure?.status === 403) return 'authentication';
  if (failure?.status === 429 || ['RATE_LIMITED', 'CONTEXT_LENGTH_EXCEEDED', 'INSUFFICIENT_QUOTA'].includes(failure?.code)) return 'limit';
  return 'failed';
}

export function apply(ctx, input) {
  const config = validateConfig(input);
  const bank = loadBank(config.soundDirectory);
  if (!Object.values(bank).some(clips => clips.length)) throw new Error(`No voice WAV files found in ${config.soundDirectory}`);
  const player = createPlayer(config, bank, message => ctx.logger.warn(message));
  registerVoiceEvents(ctx, config, player);
  registerVolumeControls(ctx, config, player);
  ctx.logger.info(`DSH Mommy ready: ${Object.values(bank).flat().length} clips; volume ${Math.round(config.volume * 100)}%`);
}

export function registerVoiceEvents(ctx, config, player) {
  const pending = new Map();
  const isRoot = session => config.includeChildren || (!session?.header?.parentSession && session?.header?.origin !== 'subagent');
  const audible = agent => agent === undefined || isRoot(agent.session);

  ctx.effect(() => () => {
    for (const waits of pending.values()) for (const cancel of waits.values()) cancel();
    pending.clear();
    player.dispose();
  });

  function startWait(scope, key, category) {
    player.say(category, scope);
    const waits = pending.get(scope) ?? new Map();
    pending.set(scope, waits);
    waits.get(key)?.();
    const timer = config.waitingMs > 0 ? setTimeout(() => player.say('waiting', scope), config.waitingMs) : undefined;
    timer?.unref?.();
    waits.set(key, () => clearTimeout(timer));
  }

  function endWait(scope, key) {
    const waits = pending.get(scope);
    waits?.get(key)?.();
    waits?.delete(key);
    if (waits?.size === 0) pending.delete(scope);
    player.cancel(scope, 'waiting');
  }

  // Observe before an answerer claims the request; playback never delays next().
  ctx.on('user-questions/request', async (request, next) => {
    if (!audible(request.agent) || request.signal?.aborted) return next();
    const scope = request.agent?.id ?? 'global';
    const key = request.wait?.callId ?? Symbol('question');
    startWait(scope, key, questionCategory(request.questions));
    const onAbort = () => endWait(scope, key);
    request.signal?.addEventListener('abort', onAbort, { once: true });
    try { return await next(); }
    finally {
      request.signal?.removeEventListener('abort', onAbort);
      endWait(scope, key);
    }
  }, { prepend: true });

  // Live appends only: restoring a log must not replay its audio.
  ctx.on('session/event', (session, event) => {
    if (!isRoot(session)) return;
    const scope = session.id;
    if (event.type === 'approval/asked') startWait(scope, event.data.id, 'permission');
    if (event.type === 'approval/decided') {
      endWait(scope, event.data.id);
      if (['rejected', 'unavailable'].includes(event.data.outcome)) player.say('blocked', scope);
    }
    if (event.type === 'turn/end') {
      for (const cancel of pending.get(scope)?.values() ?? []) cancel();
      pending.delete(scope);
      player.cancel(scope, 'waiting');
      const reason = event.data.reason;
      if (reason.kind === 'completed') player.say('done', scope);
      else if (reason.kind === 'blocked') player.say('blocked', scope);
      else if (reason.kind === 'max-tokens') player.say('limit', scope);
      else if (reason.kind === 'error') player.say(failureCategory(reason.error), scope);
    }
  });

  ctx.on('tools/result', (exec, result) => {
    if (!audible(exec.agent) || !result.isError) return;
    const code = result.error?.info?.code;
    if (['ABORTED', 'ASK_ABORTED', 'CANCELLED'].includes(code)) return;
    const category = ['SANDBOX_DENIED', 'PERMISSION_DENIED', 'APPROVAL_REJECTED'].includes(code) ? 'blocked'
      : ['SECURITY_VIOLATION', 'SECURITY_WARNING'].includes(code) ? 'security'
      : failureCategory({ code });
    player.say(category, exec.agent?.id);
  });
  ctx.on('deepseek-account/model-sign-in-required', () => player.say('authentication'));
  ctx.on('deepseek-account/session-expired', () => player.say('authentication'));
}
