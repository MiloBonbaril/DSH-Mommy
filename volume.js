export function validatePercent(value) {
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new TypeError('Volume must be an integer from 0 to 100');
  return value;
}

export function createVolumeController(config, player, persist) {
  return {
    read() { return { volume: Math.round(config.volume * 100) }; },
    async setVolume(percent) {
      validatePercent(percent);
      // A config edit restarts the Host half; resolve only after that edit is durable.
      await persist(percent / 100);
      player.setVolume(percent / 100);
      return { volume: percent };
    },
  };
}

export function registerVolumeControls(ctx, config, player) {
  const service = createVolumeController(config, player, async volume => {
    const entry = ctx.fiber.entry;
    if (entry === undefined) throw new Error('DSH Mommy volume cannot be saved without a profile entry');
    await ctx.configEditor.edit(entry, current => ({ ...current, volume }));
  });
  ctx.provide('mommyVoice', service);
  ctx.commands.register({
    name: 'mommy-volume',
    description: 'Read DSH Mommy volume, or save a volume from 0 to 100 (0 mutes).',
    input: { hint: '0–100; leave empty to read' },
    async handler(invocation) {
      try {
        const raw = invocation.rawInput.trim();
        const state = raw === '' ? service.read() : await service.setVolume(/^\d{1,3}$/.test(raw) ? Number(raw) : NaN);
        return { kind: 'success', text: JSON.stringify(state) };
      } catch (error) {
        return { kind: 'error', text: error.message };
      }
    },
  });
  ctx.tools.register({
    name: 'mommy_volume',
    description: 'Read or save the profile-wide DSH Mommy voice volume. Returns the volume percentage.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { volume: { type: 'integer', minimum: 0, maximum: 100, description: 'Volume percentage; 0 mutes. Omit to read without changing it.' } },
    },
    output: {
      schema: { type: 'object', properties: { volume: { type: 'integer' } }, required: ['volume'] },
      render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }]; },
    },
    async execute(args) {
      return args.volume === undefined ? service.read() : service.setVolume(args.volume);
    },
  });
  return service;
}
