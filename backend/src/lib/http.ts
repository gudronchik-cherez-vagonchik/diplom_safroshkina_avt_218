export class HttpError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function assertFound<T>(value: T | null | undefined, message = 'Не найдено'): T {
  if (!value) throw new HttpError(404, message);
  return value;
}
