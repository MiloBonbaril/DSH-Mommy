import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { categories } from './config.js';

export function loadBank(directory) {
  const files = readdirSync(directory);
  return Object.fromEntries(Object.entries(categories).map(([category, prefix]) => {
    const pattern = new RegExp(`^${prefix}_[0-9]+\\.wav$`, 'i');
    return [category, files.filter(name => pattern.test(name)).sort().map(name => join(directory, name)).filter(path => statSync(path).isFile())];
  }));
}

// One bounded queue for the whole profile, not one player per session or browser tab.
export function createPlayer(config, bank, warn, dependencies = {}) {
  const launch = dependencies.spawn ?? spawn;
  const now = dependencies.now ?? Date.now;
  const last = new Map();
  const previous = new Map();
  let queue = [];
  let active;
  let watchdog;
  let disposed = false;

  function pump() {
    if (disposed || active) return;
    const item = queue.shift();
    if (!item) return;
    if (now() - item.time > 20000) return pump();
    const clips = bank[item.category];
    const candidates = clips.filter(path => path !== previous.get(item.category));
    const options = candidates.length ? candidates : clips;
    const file = options[Math.floor(Math.random() * options.length)];
    previous.set(item.category, file);
    let child;
    try {
      child = launch(config.player, [`--volume=${Math.round(config.volume * 65536)}`, file], { shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      warn(`Voice playback failed: ${error.message}`);
      queue = [];
      return;
    }
    active = { child, category: item.category, scope: item.scope, stop: () => {
      finish();
      child.kill('SIGKILL');
    } };
    let stderr = '';
    child.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-1000); });
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      active = undefined;
      if (error && !disposed) {
        warn(`Voice playback failed: ${error}`);
        queue = [];
      }
      pump();
    };
    child.once('error', error => finish(error.message));
    child.once('close', (code, signal) => finish(code === 0 || disposed ? undefined : `${signal ?? code}: ${stderr.trim()}`));
    watchdog = setTimeout(() => {
      child.kill('SIGKILL');
      finish('audio player exceeded 30 seconds');
    }, 30000);
    watchdog.unref?.();
  }

  return {
    say(category, scope = 'global') {
      if (disposed || !config.enabled || config.volume === 0 || config.disabledCategories.includes(category) || !bank[category]?.length) return;
      const time = now();
      const key = `${scope}:${category}`;
      if (time - (last.get(key) ?? -Infinity) < config.cooldownMs) return;
      if (active?.category === category || queue.some(item => item.category === category)) return;
      last.delete(key);
      last.set(key, time);
      if (last.size > 512) last.delete(last.keys().next().value);
      if (queue.length >= 3) queue.shift();
      queue.push({ category, scope, time });
      pump();
    },
    cancel(scope, category) {
      queue = queue.filter(item => item.scope !== scope || (category && item.category !== category));
    },
    setVolume(volume) {
      if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new TypeError('volume must be between 0 and 1');
      config.volume = volume;
      if (volume === 0) {
        queue = [];
        active?.stop();
      }
    },
    dispose() {
      disposed = true;
      queue = [];
      clearTimeout(watchdog);
      active?.stop();
    },
  };
}
