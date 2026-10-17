interface LogMethod {
  (context: object, message: string): void
  (message: string): void
}

export interface ILogger {
  debug: LogMethod
  info: LogMethod
  warn: LogMethod
  error: LogMethod
}
