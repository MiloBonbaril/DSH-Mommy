import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createVolumeController, registerVolumeControls, validatePercent } from './volume.js';

test('client declares the command namespace dependency used by the slider', () => {
  const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');
  const injection = source.match(/inject:\s*\[([^\]]+)\]/)?.[1];
  assert.ok(injection, 'Client dependency declaration is required');
  assert.match(injection, /['"]remote['"]/);
  assert.match(injection, /['"]remote\.commands['"]/);
  const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  assert.ok(source.includes(`id: '${manifest.name}'`));
});

test('volume percentages reject invalid values', () => {
  for (const value of [-1, 101, 0.5, NaN, '65', null, undefined]) assert.throws(() => validatePercent(value));
  for (const value of [0, 65, 100]) assert.equal(validatePercent(value), value);
});

test('volume is persisted before playback changes; errors do not change runtime volume', async () => {
  const calls = [];
  const config = { volume: 0.65 };
  const service = createVolumeController(config, { setVolume(value) { calls.push(['playback', value]); config.volume = value; } }, async value => { calls.push(['persist', value]); });
  assert.deepEqual(service.read(), { volume: 65 });
  assert.deepEqual(await service.setVolume(0), { volume: 0 });
  assert.deepEqual(calls, [['persist', 0], ['playback', 0]]);
  assert.deepEqual(service.read(), { volume: 0 });
  const rejected = createVolumeController(config, { setVolume() { assert.fail('must not change playback'); } }, async () => { throw new Error('Save refused'); });
  await assert.rejects(rejected.setVolume(50), /Save refused/);
  await assert.rejects(service.setVolume(101), /0 to 100/);
});

test('command and agent tool share one persistent profile operation', async () => {
  let command, tool, provided;
  const config = { volume: 0.65 };
  const entry = { id: 'dsh-mommy' };
  let raw = { waitingMs: 120000 };
  const ctx = {
    fiber: { entry },
    configEditor: { async edit(target, change) { assert.equal(target, entry); raw = change(raw); } },
    provide(name, value) { assert.equal(name, 'mommyVoice'); provided = value; },
    commands: { register(definition) { command = definition; } },
    tools: { register(definition) { tool = definition; } },
  };
  registerVolumeControls(ctx, config, { setVolume(value) { config.volume = value; } });
  assert.deepEqual(await tool.execute({}), { volume: 65 });
  assert.equal((await command.handler({ rawInput: '35' })).text, '{"volume":35}');
  assert.deepEqual(provided.read(), { volume: 35 });
  assert.deepEqual(raw, { waitingMs: 120000, volume: 0.35 });
  assert.deepEqual(await tool.execute({ volume: 0 }), { volume: 0 });
  assert.equal((await command.handler({ rawInput: '' })).text, '{"volume":0}');
  assert.equal((await command.handler({ rawInput: 'not a number' })).kind, 'error');
});

test('missing profile entry produces an explicit command failure', async () => {
  let command;
  const ctx = { fiber: {}, provide() {}, commands: { register(value) { command = value; } }, tools: { register() {} } };
  registerVolumeControls(ctx, { volume: 0.65 }, { setVolume() { assert.fail(); } });
  const result = await command.handler({ rawInput: '80' });
  assert.equal(result.kind, 'error');
  assert.match(result.text, /profile entry/);
});
