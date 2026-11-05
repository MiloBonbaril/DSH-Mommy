# DSH Mommy

English voice lines for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), with **21 bundled WAV clips** and a persistent **0–100% volume slider** below the message composer.

No personal sound directory is required: sounds resolve relative to the installed package, independently of the working directory. This is a desktop audio plugin: sound comes from the machine running the Harness Host, even when the browser is in the background.

## Requirements

- DeepSeek Harness with Cordis bundles, the Web UI, commands, tools and the profile configuration editor. Tested with DSH `0.2.2-rc.1`.
- Linux with `paplay` on `PATH` and a working PulseAudio server or PipeWire's PulseAudio compatibility service. On Arch Linux, `paplay` is supplied by `libpulse`; on Debian/Ubuntu, by `pulseaudio-utils`.
- Node.js 22 or newer for running the repository tests.

Audio assets are portable; playback currently targets Linux. Native macOS and Windows playback are not implemented. A custom `player` must accept the same arguments as `paplay`: `--volume=0..65536` followed by the WAV path. No shell is used.

## Install

Ask the Harness agent to install this Git repository as a bundle:

```json
{
  "action": "install_bundle",
  "target": "git+https://github.com/MiloBonbaril/DSH-Mommy.git"
}
```

This is a `plugin_manager` operation, not a shell command. Read its `application` and `nextStep`: a new bundle can activate live; replacing an already loaded package may require restarting the Harness.

For a local checkout:

```sh
git clone https://github.com/MiloBonbaril/DSH-Mommy.git
```

Then ask the agent to install the checkout's absolute directory through `plugin_manager`. No npm dependencies or build step are needed. Keep a linked checkout in place while it is installed.

If the earlier **Harness voice** (`@local/harness-voice`) bundle is installed, disable it to avoid duplicate announcements.

## Volume

The **DSH Mommy · Voice volume** slider sits below the message composer in an open session. Drag it, or use the keyboard arrows. Releasing the pointer, finishing a keyboard adjustment, or leaving the control saves the setting. **0% mutes**; the default is **65%**. Save failures are shown with a retry button.

The setting belongs to the Harness profile, not the browser or session, and survives restarts. Saving a changed value reloads the Host half and stops any clip currently playing; new clips use the new value. Other open views refresh their displayed value when remounted.

The same operation is available as:

- `/mommy-volume` — read the current percentage.
- `/mommy-volume 35` — save 35%.
- `mommy_volume` agent tool — omit `volume` to read, or pass an integer from 0 to 100 to save.

## Events and sound bank

| Event | Bundled filename prefix |
| --- | --- |
| Permission requested | `permission_needed` |
| Free-text question | `Question_user_input_needed` |
| Question with choices | `decision_needed` |
| Plan review requested | `review_requested` |
| Sign-in required or account expired | `authentification_required` |
| Rejected/unavailable permission or blocked turn | `execution_blocked` |
| Tool failure or failed turn | `execution_failed` |
| Explicit security failure code | `security_warning` |
| Completed turn | `task_done` |
| Token limit, quota or rate-limit failure | `resource_limit_reached` |
| Human request still pending after two minutes | `waiting_too_long` |

A completed turn is not proof that every user objective succeeded. Security and resource announcements depend on structured failure codes/statuses; the plugin does not infer them from arbitrary output text. Generic shell nonzero exits are announced only when the tool reports a structured failure.

Variants avoid an immediate repeat. Playback is serialized across the profile, duplicate categories are suppressed, and the waiting queue is bounded. Old logs are never played on restore. Child agents are silent by default. Human requests get at most one delayed reminder, cancelled when the request settles or the turn ends.

## Configuration

Defaults are in the bundled Cordis patch. Adjust the installed entry through the Harness configuration editor, rather than editing a package after installation.

| Setting | Default | Meaning |
| --- | --- | --- |
| `volume` | `0.65` | Gain from 0 to 1; the slider presents percentages. |
| `enabled` | `true` | Enable announcements. |
| `player` | `paplay` | Executable name on PATH, or an absolute executable path. |
| `cooldownMs` | `8000` | Minimum delay for the same category in one session. |
| `waitingMs` | `120000` | Human-wait reminder delay; 0 disables reminders. |
| `includeChildren` | `false` | Announce child-agent events as well. |
| `disabledCategories` | `[]` | Silence selected categories. |

Categories: `permission`, `question`, `decision`, `authentication`, `blocked`, `failed`, `security`, `done`, `review`, `limit`, `waiting`.

An optional absolute `soundDirectory` can override the bundled bank for local use. The published defaults and patch do not contain machine-specific paths. The custom configuration validator is runtime-validated but not projected into a generated Settings form; the volume slider remains available.

## Development and backup

```sh
npm test
npm run check
npm pack --ignore-scripts --dry-run
```

Tests use the bundled sounds and mocked playback, so they do not need an audio server. A real listening test needs a running Harness and the desktop audio output. All runtime modules, locales, icon and WAV assets are included in the package's `files` list.

## Rights

The sound bank was supplied for this repository. No redistribution license for the audio has been specified. This repository currently grants no general code or audio license (`UNLICENSED`); confirm the sound rights and choose a license before offering reuse to third parties.
