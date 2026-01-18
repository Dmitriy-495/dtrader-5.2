/**
 * Logger - JSON структурированное логирование для Bot
 */

export type LogLevel = "info" | "error" | "warn";

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  service: string;
  event: string;
  data?: any;
  error?: string;
}

export class Logger {
  private service: string = "bot";

  log(level: LogLevel, event: string, data?: any, error?: string): void {
    const logEntry: LogEntry = {
      timestamp: Date.now(),
      level,
      service: this.service,
      event,
      ...(data && { data }),
      ...(error && { error }),
    };

    if (level === "error") {
      console.error(JSON.stringify(logEntry));
    } else {
      console.log(JSON.stringify(logEntry));
    }
  }

  info(event: string, data?: any): void {
    this.log("info", event, data);
  }

  error(event: string, error: string | Error, data?: any): void {
    const errorMsg = error instanceof Error ? error.message : error;
    this.log("error", event, data, errorMsg);
  }

  warn(event: string, data?: any): void {
    this.log("warn", event, data);
  }
}

export default Logger;
