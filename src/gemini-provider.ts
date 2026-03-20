import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { LLMProvider, StreamChatParams } from 'claude-to-im/src/lib/bridge/host.js';
import type { PendingPermissions } from './permission-gateway.js';
import { sseEvent } from './sse-utils.js';

type GeminiStreamEvent =
  | { type: 'init'; session_id?: string; model?: string }
  | { type: 'message'; role?: string; content?: string; delta?: boolean }
  | { type: 'tool_use'; tool_name?: string; tool_id?: string; parameters?: unknown }
  | { type: 'tool_result'; tool_id?: string; status?: string; output?: string; error?: { type?: string; message?: string } }
  | { type: 'result'; status?: string; stats?: Record<string, unknown> }
  | { type: 'error'; severity?: string; message?: string };

const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

function toApprovalMode(permissionMode?: string, autoApprove = false): string {
  if (autoApprove) return 'yolo';

  switch (permissionMode) {
    case 'acceptEdits': return 'auto_edit';
    case 'plan': return 'plan';
    default: return 'default';
  }
}

function buildPrompt(params: StreamChatParams, tempFiles: string[]): string {
  const imageFiles = params.files?.filter((file) => file.type.startsWith('image/')) ?? [];
  if (imageFiles.length === 0) return params.prompt;

  const lines = [params.prompt, '', 'Attached local files:'];
  for (const file of imageFiles) {
    const ext = MIME_EXT[file.type] || '.png';
    const tmpPath = path.join(
      os.tmpdir(),
      `gti-img-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`,
    );
    fs.writeFileSync(tmpPath, Buffer.from(file.data, 'base64'));
    tempFiles.push(tmpPath);
    lines.push(`@${tmpPath}`);
  }

  return lines.join('\n');
}

function getGeminiCommand(): { executable: string; preArgs: string[] } {
  if (process.env.CTI_GEMINI_EXECUTABLE) {
    return { executable: process.env.CTI_GEMINI_EXECUTABLE, preArgs: [] };
  }

  if (process.platform === 'win32') {
    const npmGlobal = process.env.APPDATA
      ? path.join(process.env.APPDATA, 'npm')
      : undefined;

    if (npmGlobal) {
      const geminiEntry = path.join(npmGlobal, 'node_modules', '@google', 'gemini-cli', 'dist', 'index.js');
      if (fs.existsSync(geminiEntry)) {
        return {
          executable: 'node',
          preArgs: ['--no-warnings=DEP0040', geminiEntry],
        };
      }
      const candidate = path.join(npmGlobal, 'gemini.cmd');
      if (fs.existsSync(candidate)) {
        return { executable: candidate, preArgs: [] };
      }
    }
    return { executable: 'gemini.cmd', preArgs: [] };
  }

  return { executable: 'gemini', preArgs: [] };
}

export class GeminiProvider implements LLMProvider {
  constructor(
    private pendingPerms: PendingPermissions,
    private autoApprove = false,
  ) {}

  streamChat(params: StreamChatParams): ReadableStream<string> {
    const pendingPerms = this.pendingPerms;
    const autoApprove = this.autoApprove;

    return new ReadableStream<string>({
      start(controller) {
        const tempFiles: string[] = [];

        (async () => {
          let stderrBuf = '';
          try {
            const prompt = buildPrompt(params, tempFiles);
            const { executable, preArgs } = getGeminiCommand();
            const args = [
              ...preArgs,
              '-p',
              prompt,
              '--output-format',
              'stream-json',
              '--approval-mode',
              toApprovalMode(params.permissionMode, autoApprove),
            ];

            if (params.model) {
              args.push('-m', params.model);
            }
            if (params.sdkSessionId) {
              args.push('--resume', params.sdkSessionId);
            }

            const child = spawn(executable, args, {
              cwd: params.workingDirectory || process.cwd(),
              env: process.env,
              stdio: ['ignore', 'pipe', 'pipe'],
              signal: params.abortController?.signal,
            });

            let childError: Error | null = null;
            child.on('error', (err) => {
              childError = err;
            });

            child.stderr?.on('data', (chunk) => {
              stderrBuf += chunk.toString();
            });

            let sawResult = false;
            let sessionId = params.sdkSessionId;
            let pendingToolRequests = new Map<string, { name?: string; input?: unknown }>();
            let stdoutBuffer = '';

            for await (const chunk of child.stdout ?? []) {
              stdoutBuffer += chunk.toString();
              const lines = stdoutBuffer.split(/\r?\n/);
              stdoutBuffer = lines.pop() ?? '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                let event: GeminiStreamEvent;
                try {
                  event = JSON.parse(trimmed) as GeminiStreamEvent;
                } catch {
                  continue;
                }

                if (params.abortController?.signal.aborted) {
                  break;
                }

                switch (event.type) {
                  case 'init':
                    sessionId = event.session_id || sessionId;
                    controller.enqueue(sseEvent('status', {
                      ...(sessionId ? { session_id: sessionId } : {}),
                      ...(event.model ? { model: event.model } : {}),
                    }));
                    break;

                  case 'message':
                    if (event.role === 'assistant' && event.content) {
                      controller.enqueue(sseEvent('text', event.content));
                    }
                    break;

                  case 'tool_use': {
                    const toolId = event.tool_id || `gemini-tool-${Date.now()}`;
                    pendingToolRequests.set(toolId, {
                      name: event.tool_name,
                      input: event.parameters,
                    });
                    controller.enqueue(sseEvent('tool_use', {
                      id: toolId,
                      name: event.tool_name || 'GeminiTool',
                      input: event.parameters ?? {},
                    }));
                    break;
                  }

                  case 'tool_result': {
                    const toolId = event.tool_id || `gemini-tool-${Date.now()}`;
                    const request = pendingToolRequests.get(toolId);
                    pendingToolRequests.delete(toolId);

                    const isError = event.status === 'error' || !!event.error;
                    controller.enqueue(sseEvent('tool_result', {
                      tool_use_id: toolId,
                      content: event.output || event.error?.message || 'Done',
                      is_error: isError,
                    }));

                    if (!autoApprove && request?.name && event.error?.type === 'USER_ABORT') {
                      controller.enqueue(sseEvent('permission_request', {
                        permissionRequestId: toolId,
                        toolName: request.name,
                        toolInput: request.input ?? {},
                        suggestions: [],
                      }));

                      const resolution = await pendingPerms.waitFor(toolId);
                      if (resolution.behavior === 'deny') {
                        controller.enqueue(sseEvent('error', resolution.message || 'Denied by user'));
                      }
                    }
                    break;
                  }

                  case 'error':
                    if (event.message) {
                      controller.enqueue(sseEvent(event.severity === 'warning' ? 'status' : 'error', event.severity === 'warning'
                        ? { warning: event.message }
                        : event.message));
                    }
                    break;

                  case 'result':
                    sawResult = true;
                    controller.enqueue(sseEvent('result', {
                      ...(sessionId ? { session_id: sessionId } : {}),
                      usage: event.stats,
                    }));
                    break;
                }
              }
            }

            const exitCode = await new Promise<number | null>((resolve) => {
              child.once('close', (code) => resolve(code));
            });

            if (childError) {
              throw childError;
            }
            if (!sawResult && exitCode !== 0) {
              throw new Error(stderrBuf.trim() || `Gemini CLI exited with code ${exitCode}`);
            }

            controller.close();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            controller.enqueue(sseEvent('error', message));
            controller.close();
          } finally {
            for (const tmp of tempFiles) {
              try { fs.unlinkSync(tmp); } catch { /* ignore */ }
            }
          }
        })();
      },
    });
  }
}
