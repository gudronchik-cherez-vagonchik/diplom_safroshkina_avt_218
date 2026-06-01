export class HttpError extends Error {
    statusCode;
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}
export function assertFound(value, message = 'Не найдено') {
    if (!value)
        throw new HttpError(404, message);
    return value;
}
