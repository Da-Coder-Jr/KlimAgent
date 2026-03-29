/**
 * KlimAgent - NVIDIA NIM Provider
 * Uses NVIDIA NIM's OpenAI-compatible API for inference.
 * https://build.nvidia.com/explore/discover
 */

import OpenAI from 'openai';
import { BaseProvider } from './base-provider.js';

const NVIDIA_NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1';

// Default model - llama-3.3-70b is fast, capable, and free-tier eligible
const DEFAULT_MODEL = 'meta/llama-3.3-70b-instruct';

// Built-in tool definitions for workspace actions
const WORKSPACE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file at the given path',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or relative path to the file' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file, creating it if it does not exist',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file' },
          content: { type: 'string', description: 'Content to write' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a shell command and return its output',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          cwd: { type: 'string', description: 'Working directory (optional)' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search for files matching a pattern or containing a string',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern or string to find' },
          directory: { type: 'string', description: 'Directory to search in (optional, defaults to cwd)' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for up-to-date information',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and folders in a directory',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to list' }
        },
        required: ['path']
      }
    }
  }
];

const SYSTEM_PROMPT = `You are KlimAgent, an autonomous AI-powered workspace agent. You turn natural language into real actions on the user's computer.

You have access to workspace tools that let you:
- Read and write files
- Execute shell commands
- Search codebases
- Search the web
- List directories

When given a task, reason through it step by step and use tools as needed to accomplish the goal. Be concise and direct. Always explain what you are doing.`;

export class NvidiaNimProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.model = config.model || process.env.NVIDIA_NIM_MODEL || DEFAULT_MODEL;
    this._client = null;
    this._conversationHistories = new Map();
  }

  get name() {
    return 'nvidia-nim';
  }

  async initialize() {
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
      throw new Error('NVIDIA_API_KEY environment variable is required');
    }
    this._client = new OpenAI({
      apiKey,
      baseURL: NVIDIA_NIM_BASE_URL
    });
    console.log(`[KlimAgent] NVIDIA NIM provider initialized with model: ${this.model}`);
  }

  _getHistory(chatId) {
    if (!this._conversationHistories.has(chatId)) {
      this._conversationHistories.set(chatId, []);
    }
    return this._conversationHistories.get(chatId);
  }

  async *query({ message, chatId, model, systemPrompt }) {
    if (!this._client) {
      await this.initialize();
    }

    const abortController = this.createAbortController(chatId);
    const activeModel = model || this.model;
    const history = this._getHistory(chatId);

    // Add user message to history
    history.push({ role: 'user', content: message });

    const messages = [
      { role: 'system', content: systemPrompt || SYSTEM_PROMPT },
      ...history
    ];

    try {
      // Agentic loop: keep going until no more tool calls
      let iterations = 0;
      const MAX_ITERATIONS = 10;

      while (iterations < MAX_ITERATIONS) {
        iterations++;

        let stream;
        try {
          stream = await this._client.chat.completions.create(
            {
              model: activeModel,
              messages,
              stream: true,
              temperature: 0.2,
              top_p: 0.7,
              max_tokens: 4096,
              tools: WORKSPACE_TOOLS,
              tool_choice: 'auto'
            },
            { signal: abortController.signal }
          );
        } catch (err) {
          // Some NIM models don't support tool_choice, retry without tools
          if (err?.status === 400 || err?.message?.includes('tool')) {
            stream = await this._client.chat.completions.create(
              {
                model: activeModel,
                messages,
                stream: true,
                temperature: 0.2,
                top_p: 0.7,
                max_tokens: 4096
              },
              { signal: abortController.signal }
            );
          } else {
            throw err;
          }
        }

        let assistantContent = '';
        let toolCalls = [];
        let currentToolCall = null;

        for await (const chunk of stream) {
          if (abortController.signal.aborted) break;

          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          // Stream text content
          if (delta.content) {
            assistantContent += delta.content;
            yield { type: 'text', text: delta.content };
          }

          // Accumulate tool calls
          if (delta.tool_calls) {
            for (const tcDelta of delta.tool_calls) {
              const idx = tcDelta.index ?? 0;
              if (!toolCalls[idx]) {
                toolCalls[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
              }
              if (tcDelta.id) toolCalls[idx].id = tcDelta.id;
              if (tcDelta.function?.name) toolCalls[idx].function.name += tcDelta.function.name;
              if (tcDelta.function?.arguments) toolCalls[idx].function.arguments += tcDelta.function.arguments;
            }
          }
        }

        // Add assistant turn to messages
        const assistantMessage = { role: 'assistant', content: assistantContent };
        if (toolCalls.length > 0) {
          assistantMessage.tool_calls = toolCalls;
        }
        messages.push(assistantMessage);

        // No tool calls - we're done
        if (toolCalls.length === 0) {
          history.push({ role: 'assistant', content: assistantContent });
          break;
        }

        // Execute tool calls
        for (const tc of toolCalls) {
          if (!tc.function?.name) continue;

          let args = {};
          try {
            args = JSON.parse(tc.function.arguments || '{}');
          } catch {
            args = {};
          }

          yield {
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: args
          };

          const toolResult = await this._executeToolCall(tc.function.name, args);

          yield {
            type: 'tool_result',
            tool_use_id: tc.id,
            content: toolResult
          };

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
          });
        }

        toolCalls = [];
      }

    } catch (err) {
      if (err.name === 'AbortError' || abortController.signal.aborted) {
        yield { type: 'text', text: '\n[Stopped]' };
      } else {
        console.error('[KlimAgent] NVIDIA NIM error:', err.message);
        yield { type: 'error', error: err.message };
      }
    } finally {
      this._abortControllers.delete(chatId);
    }
  }

  async _executeToolCall(name, args) {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const fs = await import('fs/promises');
    const path = await import('path');
    const execAsync = promisify(exec);

    try {
      switch (name) {
        case 'read_file': {
          const content = await fs.readFile(args.path, 'utf-8');
          return content;
        }
        case 'write_file': {
          await fs.mkdir(path.dirname(args.path), { recursive: true });
          await fs.writeFile(args.path, args.content, 'utf-8');
          return `File written: ${args.path}`;
        }
        case 'run_command': {
          const { stdout, stderr } = await execAsync(args.command, {
            cwd: args.cwd || process.cwd(),
            timeout: 30000
          });
          return stdout + (stderr ? `\nSTDERR: ${stderr}` : '');
        }
        case 'search_files': {
          const dir = args.directory || process.cwd();
          const { stdout } = await execAsync(
            `grep -r ${JSON.stringify(args.pattern)} ${JSON.stringify(dir)} --include="*" -l 2>/dev/null | head -20 || find ${JSON.stringify(dir)} -name ${JSON.stringify(args.pattern)} 2>/dev/null | head -20`
          );
          return stdout || 'No results found';
        }
        case 'list_directory': {
          const entries = await fs.readdir(args.path, { withFileTypes: true });
          return entries.map(e => (e.isDirectory() ? `[dir] ${e.name}` : e.name)).join('\n');
        }
        case 'web_search': {
          return `Web search for "${args.query}" - Please use your knowledge or instruct the user to search.`;
        }
        default:
          return `Unknown tool: ${name}`;
      }
    } catch (err) {
      return `Error: ${err.message}`;
    }
  }

  clearHistory(chatId) {
    this._conversationHistories.delete(chatId);
  }
}
