import type { Context, Hono, MiddlewareHandler } from "hono";
import {
  getRequestBodyLimitConfig,
  type RequestBodyLimitConfig,
} from "./upload-body-limit";

const INVALID_CONTENT_LENGTH_MESSAGE = "Invalid Content-Length.";

type LimitResolver = (path: string) => RequestBodyLimitConfig;

export class RequestBodyLimitExceededError extends Error {
  readonly config: RequestBodyLimitConfig;

  constructor(config: RequestBodyLimitConfig) {
    super(config.errorMessage);
    this.name = "RequestBodyLimitExceededError";
    this.config = config;
  }
}

function getTrpcPaths(c: Context): string[] {
  const prefix = "/api/trpc/";
  if (!c.req.path.startsWith(prefix)) return [];
  return c.req.path.slice(prefix.length).split(",").filter(Boolean);
}

export function payloadTooLargeResponse(c: Context, config: RequestBodyLimitConfig): Response {
  if (!config.isAffectedUpload) {
    return c.text(config.errorMessage, 413);
  }

  const trpcPaths = getTrpcPaths(c);
  if (trpcPaths.length > 0) {
    const errors = trpcPaths.map((path) => ({
      error: {
        json: {
          message: config.errorMessage,
          code: -32013,
          data: {
            code: "PAYLOAD_TOO_LARGE",
            httpStatus: 413,
            path,
          },
        },
      },
    }));
    const isBatch = new URL(c.req.url).searchParams.get("batch") === "1";
    return c.json(isBatch ? errors : errors[0], 413);
  }

  return c.json({ error: config.errorMessage }, 413);
}

function parseContentLength(value: string): bigint | null {
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export function createRequestBodyGuard(
  resolveLimit: LimitResolver = getRequestBodyLimitConfig,
): MiddlewareHandler {
  return async (c, next) => {
    const rawBody = c.req.raw.body;
    if (!rawBody) {
      await next();
      return;
    }

    const config = resolveLimit(c.req.path);
    const contentLengthHeader = c.req.header("content-length");
    const transferEncoding = c.req.header("transfer-encoding");

    if (contentLengthHeader !== undefined) {
      const contentLength = parseContentLength(contentLengthHeader);
      if (contentLength === null) {
        return c.json({ error: INVALID_CONTENT_LENGTH_MESSAGE }, 400);
      }
      if (contentLength > BigInt(config.maxSizeBytes)) {
        return payloadTooLargeResponse(c, config);
      }
      if (!transferEncoding) {
        await next();
        return;
      }
    }

    let bytesRead = 0;
    let exceeded = false;
    const limitedBody = rawBody.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytesRead += chunk.byteLength;
        if (bytesRead > config.maxSizeBytes) {
          exceeded = true;
          controller.error(new RequestBodyLimitExceededError(config));
          return;
        }
        controller.enqueue(chunk);
      },
    }));

    c.req.raw = new Request(c.req.raw, {
      body: limitedBody,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    try {
      await next();
    } catch (error) {
      if (!exceeded) throw error;
    }

    if (exceeded) {
      return payloadTooLargeResponse(c, config);
    }
  };
}

export function installRequestBodyGuard(
  app: Hono<any>,
  resolveLimit: LimitResolver = getRequestBodyLimitConfig,
): void {
  app.onError((error, c) => {
    if (error instanceof RequestBodyLimitExceededError) {
      return payloadTooLargeResponse(c, error.config);
    }
    console.error(error);
    return c.text("Internal Server Error", 500);
  });
  app.use("*", createRequestBodyGuard(resolveLimit));
}

export { INVALID_CONTENT_LENGTH_MESSAGE };
