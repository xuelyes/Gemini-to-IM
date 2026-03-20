---
name: gemini-to-im
description: |
  Bridge Gemini CLI to Telegram, Discord, Feishu/Lark, or QQ so the user can chat
  with Gemini from their phone. Use for: setting up, starting, stopping, checking
  status, viewing logs, or diagnosing the gemini-to-im bridge daemon; any phrase
  like "gemini-to-im", "Gemini 飞书机器人", "Gemini 桥接", "手机上用 Gemini", "启动 Gemini
  桥接", "配置 Gemini bot". Subcommands: setup, start, stop, status, logs [N], doctor.
---

# Gemini-to-IM Bridge Skill

Manage the standalone Gemini CLI bridge.

User data is stored at `~/.gemini-to-im/`.
The skill directory is the directory containing this `SKILL.md`.

## Runtime model

This skill is independent from `claude-to-im`.
Do not reuse `~/.claude-to-im/`.
Always use `~/.gemini-to-im/` or an explicit `CTI_HOME` override so the Gemini bot
can run in parallel with existing Claude/Codex bots.

This skill talks to the locally installed `gemini` CLI and reuses its local login
state. Do not ask the user to configure a separate API key unless they explicitly
want to switch Gemini CLI authentication modes.

## Commands

Parse the user's intent into one of:

- `setup`
- `start`
- `stop`
- `status`
- `logs`
- `doctor`

Default `logs` to 50 lines when the user does not specify a count.

## Setup

If `~/.gemini-to-im/config.env` does not exist, show `config.env.example` and help
the user fill it. In Codex, prefer writing the file for the user when they provide
the required bot credentials.

Key fields:

- `CTI_RUNTIME=gemini`
- `CTI_ENABLED_CHANNELS=...`
- `CTI_DEFAULT_WORKDIR=...`
- `CTI_DEFAULT_MODE=code|plan|ask`
- `CTI_DEFAULT_MODEL=` optional
- `CTI_GEMINI_EXECUTABLE=` optional override for the local Gemini CLI

For Feishu credentials and two-phase event subscription, reuse
`references/setup-guides.md`.

## Start / Stop / Status / Logs

Before `start`, verify `~/.gemini-to-im/config.env` exists.

On Windows, use:

- `powershell -ExecutionPolicy Bypass -File "<skill-dir>\\scripts\\daemon.ps1" start`
- `powershell -ExecutionPolicy Bypass -File "<skill-dir>\\scripts\\daemon.ps1" stop`
- `powershell -ExecutionPolicy Bypass -File "<skill-dir>\\scripts\\daemon.ps1" status`
- `powershell -ExecutionPolicy Bypass -File "<skill-dir>\\scripts\\daemon.ps1" logs N`

If background processes launched inside the current tool session do not stay alive,
restart them outside the sandbox so the bridge can persist after the command exits.

## Doctor

When diagnosing failures:

1. Check whether `gemini -p "Reply with exactly OK" --output-format stream-json`
   works on the local machine.
2. If it fails, diagnose Gemini CLI login or local environment first.
3. If Gemini CLI works but the bridge does not, inspect `~/.gemini-to-im/logs/`.

## Safety

- Mask all secrets in output.
- Keep user allowlists enabled when possible, especially for Feishu.
- Do not modify `claude-to-im`; this skill must remain independently runnable.
