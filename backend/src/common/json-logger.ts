import { ConsoleLogger, LogLevel } from '@nestjs/common';

/** Structured JSON logs (one line per entry). Messages never include ticket text or personal data. */
export class JsonLogger extends ConsoleLogger {
  protected printMessages(messages: unknown[], context = '', logLevel: LogLevel = 'log') {
    for (const m of messages) {
      const line = { t: new Date().toISOString(), level: logLevel, ctx: context, msg: typeof m === 'string' ? m : m instanceof Error ? m.message : m };
      process[logLevel === 'error' ? 'stderr' : 'stdout'].write(JSON.stringify(line) + '\n');
    }
  }
}
