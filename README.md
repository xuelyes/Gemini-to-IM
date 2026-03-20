# Gemini-to-IM

Bridge Gemini CLI sessions to IM platforms including Telegram, Discord, Feishu/Lark, and QQ.

This repository is structured as a Codex skill plus the runnable bridge implementation behind it.

## What is included

- `SKILL.md`: Skill trigger metadata and operating instructions
- `agents/openai.yaml`: Skill UI metadata
- `src/`: Bridge runtime source code
- `scripts/`: Build, daemon, and platform supervisor scripts
- `references/`: Setup and troubleshooting guides

## Core use cases

- Set up a Gemini bot for Telegram, Discord, Feishu/Lark, or QQ
- Start, stop, and inspect the bridge daemon
- Diagnose Gemini CLI or bridge runtime issues
- Keep Gemini bridge state isolated from `claude-to-im`

## Development

Requirements:

- Node.js `>=20`
- A working local `gemini` CLI when running the actual bridge

Common commands:

```bash
npm install
npm run build
npm test
```

## Skill entry points

- Main skill definition: `SKILL.md`
- UI metadata: `agents/openai.yaml`

If you want Codex to use this skill directly, install the repository contents as a skill directory named `gemini-to-im`.
