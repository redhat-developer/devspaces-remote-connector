import * as vscode from 'vscode';
import { CONFIG_LOG_LEVEL, CONFIG_SECTION } from '../constants';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Structured logger that writes to a VS Code OutputChannel.
 * Respects the configured log level and redacts sensitive values.
 */
export class Logger {
  private static instance: Logger;
  private channel: vscode.OutputChannel;
  private level: LogLevel = 'info';

  private constructor() {
    this.channel = vscode.window.createOutputChannel('Dev Spaces Connector');
    this.refreshLevel();
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /** Re-read the configured log level from settings. */
  refreshLevel(): void {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    this.level = config.get<LogLevel>(CONFIG_LOG_LEVEL, 'info');
  }

  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log('info', message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log('error', message, ...args);
  }

  /** Show the output channel in the VS Code panel. */
  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.level]) {
      return;
    }

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    let line = `${prefix} ${message}`;

    if (args.length > 0) {
      const extra = args
        .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
        .join(' ');
      line += ` ${extra}`;
    }

    // Redact bearer tokens and SSH keys from log output
    line = Logger.redact(line);

    this.channel.appendLine(line);
  }

  /** Redact sensitive patterns from log lines. */
  static redact(text: string): string {
    // Redact bearer tokens (keep first 8 chars)
    text = text.replace(
      /Bearer\s+([A-Za-z0-9_\-./+=]{8})[A-Za-z0-9_\-./+=]*/g,
      'Bearer $1***REDACTED***'
    );
    // Redact SSH private keys
    text = text.replace(
      /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g,
      '***SSH_KEY_REDACTED***'
    );
    // Redact sha256: tokens
    text = text.replace(
      /sha256~[A-Za-z0-9_\-]{8}[A-Za-z0-9_\-]*/g,
      'sha256~***REDACTED***'
    );
    return text;
  }
}
