type LogLevel = 'info' | 'warn' | 'error';

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

function emit(level: LogLevel, message: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...fields,
  });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export function createLogger(base: Record<string, unknown> = {}): Logger {
  const logger: Logger = {
    info: (m, f = {}) => emit('info', m, { ...base, ...f }),
    warn: (m, f = {}) => emit('warn', m, { ...base, ...f }),
    error: (m, f = {}) => emit('error', m, { ...base, ...f }),
    child: (fields) => createLogger({ ...base, ...fields }),
  };
  return logger;
}
