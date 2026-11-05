import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig, categories, Config } from './config.js';
import { createPlayer, loadBank } from './player.js';
import { questionCategory, failureCategory, registerVoiceEvents } from './index.js';

function fixture(overrides = {}) {
  const children = [];
  const warnings = [];
  let time = 0;
  const player = createPlayer(validateConfig(overrides), Object.fromEntries(Object.keys(categories).map(key => [key, ['one.wav', 'two.wav']])), message => warnings.push(message), {
    now: () => time,
    spawn(command, args, options) {
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = signal => { child.killed = signal; };
      children.push({ command, args, options, child });
      return child;
    },
  });
  return { player, children, warnings, advance: ms => { time += ms; } };
}

test('configuration defaults and rejects invalid values', () => {
  assert.equal(validateConfig().volume, 0.65);
  assert.equal(validateConfig().player, 'paplay');
  assert.equal(validateConfig({ player: 'custom-audio' }).player, 'custom-audio');
  assert.equal(validateConfig({ player: process.execPath }).player, process.execPath);
  for (const input of [{ volume: NaN }, { volume: 2 }, { waitingMs: -1 }, { player: '' }, { player: 'paplay --help' }, { player: './paplay' }, { player: 'bad\0name' }, { soundDirectory: 'sounds' }, { disabledCategories: ['typo'] }, { enabld: false }]) assert.throws(() => validateConfig(input));
  assert.ok(Config['~standard'].validate({ volume: -1 }).issues);
});

test('all 21 local WAV clips are recognized without changing their names', () => {
  const directory = fileURLToPath(new URL('./sounds/', import.meta.url));
  assert.equal(validateConfig().soundDirectory, directory);
  const bank = loadBank(directory);
  const clips = Object.values(bank).flat();
  assert.deepEqual(clips.map(path => path.slice(directory.length)).sort(), readdirSync(directory).sort());
  for (const clip of clips) {
    assert.equal(dirname(clip), join(fileURLToPath(new URL('.', import.meta.url)), 'sounds'));
    const bytes = readFileSync(clip);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  }
  assert.equal(Object.values(bank).flat().length, 21);
  assert.equal(bank.question.length, 2);
  assert.equal(bank.done.length, 4);
  assert.equal(bank.authentication.length, 1);
});

test('question intent wins over generic choices', () => {
  assert.equal(questionCategory([{ question: 'x' }]), 'question');
  assert.equal(questionCategory([{ options: [{}] }]), 'decision');
  assert.equal(questionCategory([{ intent: { kind: 'plan-review' }, options: [{}] }]), 'review');
  assert.equal(questionCategory([{ intent: { kind: 'approval' } }]), 'permission');
  assert.equal(failureCategory({ status: 429 }), 'limit');
  assert.equal(failureCategory({ status: 401 }), 'authentication');
  assert.equal(failureCategory({ code: 'OTHER' }), 'failed');
});

test('serializes playback, suppresses duplicates and avoids immediate variant repeats', t => {
  const f = fixture();
  t.after(() => f.player.dispose());
  f.player.say('done', 'a');
  f.player.say('done', 'a');
  f.player.say('failed', 'a');
  assert.equal(f.children.length, 1);
  assert.equal(f.children[0].options.shell, false);
  assert.equal(f.children[0].args[0], '--volume=42598');
  f.children[0].child.emit('close', 0);
  assert.equal(f.children.length, 2);
  f.children[1].child.emit('close', 0);
  f.advance(9000);
  f.player.say('done', 'a');
  assert.notEqual(f.children[2].args[1], f.children[0].args[1]);
});

test('mute, disabled categories, cooldown and scope cancellation', t => {
  for (const config of [{ enabled: false }, { volume: 0 }, { disabledCategories: ['done'] }]) {
    const f = fixture(config);
    f.player.say('done');
    assert.equal(f.children.length, 0);
    f.player.dispose();
  }
  const f = fixture();
  t.after(() => f.player.dispose());
  f.player.say('done', 'a');
  f.children[0].child.emit('close', 0);
  f.player.say('done', 'a');
  assert.equal(f.children.length, 1);
  f.player.say('failed', 'b');
  f.player.say('waiting', 'a');
  f.player.cancel('a', 'waiting');
  f.children[1].child.emit('close', 0);
  assert.equal(f.children.length, 2);
});

test('volume changes affect subsequent clips, not active playback', t => {
  const f = fixture({ player: 'custom-audio' });
  t.after(() => f.player.dispose());
  f.player.say('done');
  f.player.say('failed');
  f.player.setVolume(0.25);
  assert.equal(f.children[0].command, 'custom-audio');
  assert.equal(f.children[0].args[0], '--volume=42598');
  assert.equal(f.children[0].child.killed, undefined);
  f.children[0].child.emit('close', 0);
  assert.equal(f.children[1].args[0], '--volume=16384');
  f.player.setVolume(1);
  f.player.say('permission');
  f.children[1].child.emit('close', 0);
  assert.equal(f.children[2].args[0], '--volume=65536');
  for (const value of [-1, 1.01, NaN, Infinity, '0.5', null, undefined]) {
    assert.throws(() => f.player.setVolume(value), /volume/);
  }
});

test('muting stops audio and queue; delayed exit cannot affect resumed playback', t => {
  const f = fixture();
  t.after(() => f.player.dispose());
  f.player.say('done');
  f.player.say('failed');
  f.player.setVolume(0);
  assert.equal(f.children[0].child.killed, 'SIGKILL');
  f.player.say('permission');
  assert.equal(f.children.length, 1);
  f.player.setVolume(0.5);
  f.player.say('question');
  assert.equal(f.children.length, 2);
  f.player.say('review');
  f.children[0].child.emit('close', null, 'SIGKILL');
  f.children[0].child.emit('error', new Error('late exit'));
  assert.equal(f.children.length, 2);
  assert.deepEqual(f.warnings, []);
  f.children[1].child.emit('close', 0);
  assert.equal(f.children.length, 3);
  f.children[2].child.emit('close', 0);
  assert.equal(f.children.length, 3);
});

test('muting handles synchronous player exit without reporting an error', t => {
  const f = fixture();
  t.after(() => f.player.dispose());
  f.player.say('done');
  f.player.say('failed');
  f.children[0].child.kill = signal => f.children[0].child.emit('close', null, signal);
  f.player.setVolume(0);
  assert.equal(f.children.length, 1);
  assert.deepEqual(f.warnings, []);
});

test('contains missing player errors without a shell or an audio server', t => {
  const warnings = [];
  const config = validateConfig({ player: 'missing-audio-command' });
  const player = createPlayer(config, { done: ['one.wav'] }, message => warnings.push(message), {
    spawn(command, args, options) {
      assert.equal(command, 'missing-audio-command');
      assert.equal(options.shell, false);
      throw new Error('ENOENT');
    },
  });
  t.after(() => player.dispose());
  assert.doesNotThrow(() => player.say('done'));
  assert.match(warnings[0], /ENOENT/);
});

test('drops stale audio and contains player errors; disposal kills playback', () => {
  const f = fixture();
  f.player.say('done');
  f.player.say('waiting');
  f.advance(21000);
  f.children[0].child.emit('close', 0);
  assert.equal(f.children.length, 1);
  f.player.say('failed');
  f.children[1].child.emit('error', new Error('no audio server'));
  assert.match(f.warnings[0], /no audio server/);
  f.children[1].child.emit('close', 1);
  assert.equal(f.warnings.length, 1);
  f.player.say('permission');
  f.player.dispose();
  assert.equal(f.children[2].child.killed, 'SIGKILL');
  f.player.say('done');
  assert.equal(f.children.length, 3);
});

test('waterfall observer is prepended, preserves answers/errors, and removes timers', async () => {
  const listeners = new Map();
  const cleanups = [];
  const ctx = {
    logger: { info() {}, warn() {} },
    on(name, callback, options) { listeners.set(name, { callback, options }); },
    effect(effect) { cleanups.push(effect()); },
  };
  const config = validateConfig({ player: process.execPath, volume: 0, waitingMs: 60000 });
  const player = createPlayer(config, loadBank(config.soundDirectory), () => {});
  registerVoiceEvents(ctx, config, player);
  try {
    const observer = listeners.get('user-questions/request');
    assert.equal(observer.options.prepend, true);
    const expected = { answers: [] };
    assert.equal(await observer.callback({ questions: [{}], agent: { id: 'root', session: { header: {} } } }, async () => expected), expected);
    const error = new Error('answerer failed');
    await assert.rejects(observer.callback({ questions: [{}] }, async () => { throw error; }), error);
    assert.equal(await observer.callback({ agent: { session: { header: { parentSession: 'root' } } } }, async () => expected), expected);
  } finally { cleanups.forEach(cleanup => cleanup()); }
});
