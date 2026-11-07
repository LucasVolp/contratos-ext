export type ErrorBody = {
  message: string;
  [key: string]: unknown;
};
export class HttpError extends Error {
  readonly body: ErrorBody;
  getStatus() {
    return this.statusCode;
  }
  getResponse() {
    return this.body;
  }
  constructor(
    readonly statusCode: number,
    body: string | ErrorBody,
  ) {
    super(typeof body === "string" ? body : body.message);
    this.body = typeof body === "string" ? { message: body } : body;
  }
}
export class BadRequestException extends HttpError {
  constructor(body: string | ErrorBody) {
    super(400, body);
  }
}
export class NotFoundException extends HttpError {
  constructor(body: string | ErrorBody) {
    super(404, body);
  }
}
export class ConflictException extends HttpError {
  constructor(body: string | ErrorBody) {
    super(409, body);
  }
}
export class UnprocessableEntityException extends HttpError {
  constructor(body: string | ErrorBody) {
    super(422, body);
  }
}
export class InternalServerErrorException extends HttpError {
  constructor(body: string | ErrorBody) {
    super(500, body);
  }
}
export class BadGatewayException extends HttpError {
  constructor(body: string | ErrorBody) {
    super(502, body);
  }
}
export class ServiceUnavailableException extends HttpError {
  constructor(body: string | ErrorBody) {
    super(503, body);
  }
}

export class UnauthorizedException extends HttpError {
  constructor(body: string | ErrorBody) {
    super(401, body);
  }
}
export class ForbiddenException extends HttpError {
  constructor(body: string | ErrorBody) {
    super(403, body);
  }
}
