import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const defaults = {
  enabled: true,
  soundDirectory: fileURLToPath(new URL('./sounds/', import.meta.url)),
  player: 'paplay',
  volume: 0.65,
  cooldownMs: 8000,
  waitingMs: 120000,
  includeChildren: false,
  disabledCategories: [],
};

export const categories = {
  permission: 'permission_needed',
  question: 'Question_user_input_needed',
  decision: 'decision_needed',
  authentication: 'authentification_required',
  blocked: 'execution_blocked',
  failed: 'execution_failed',
  security: 'security_warning',
  done: 'task_done',
  review: 'review_requested',
  limit: 'resource_limit_reached',
  waiting: 'waiting_too_long',
};

export function validateConfig(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Voice configuration must be an object');
  for (const key of Object.keys(input)) if (!(key in defaults)) throw new TypeError(`Unknown voice setting: ${key}`);
  const config = { ...defaults, ...input };
  for (const key of ['enabled', 'includeChildren']) if (typeof config[key] !== 'boolean') throw new TypeError(`${key} must be boolean`);
  if (typeof config.soundDirectory !== 'string' || !isAbsolute(config.soundDirectory)) throw new TypeError('soundDirectory must be an absolute path');
  if (typeof config.player !== 'string' || !config.player || config.player.includes('\0') || (!isAbsolute(config.player) && !/^[\w.-]+$/.test(config.player))) throw new TypeError('player must be a command name or an absolute path');
  for (const [key, min, max] of [['volume', 0, 1], ['cooldownMs', 0, 600000], ['waitingMs', 0, 3600000]]) {
    if (!Number.isFinite(config[key]) || config[key] < min || config[key] > max) throw new TypeError(`${key} must be between ${min} and ${max}`);
  }
  if (!Array.isArray(config.disabledCategories) || config.disabledCategories.some(key => !Object.hasOwn(categories, key))) throw new TypeError('disabledCategories must contain voice category names');
  return config;
}

export const Config = {
  '~standard': {
    version: 1,
    vendor: 'harness-voice',
    validate(input) {
      try { return { value: validateConfig(input) }; }
      catch (error) { return { issues: [{ message: error.message }] }; }
    },
  },
};
