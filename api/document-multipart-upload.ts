import Busboy, { type BusboyHeaders } from "@fastify/busboy";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  MAX_UPLOAD_ERROR_MESSAGE,
  MAX_UPLOAD_FILE_SIZE_BYTES,
} from "@contracts/upload-limits";

const MAX_MULTIPART_FIELDS = 8;
const MAX_MULTIPART_PARTS = MAX_MULTIPART_FIELDS + 1;
const MAX_FIELD_SIZE_BYTES = 64 * 1024;
const MAX_HEADER_SIZE_BYTES = 16 * 1024;

export class DocumentMultipartUploadError extends Error {
  readonly status: 400 | 413;

  constructor(
    message: string,
    status: 400 | 413,
  ) {
    super(message);
    this.name = "DocumentMultipartUploadError";
    this.status = status;
  }
}

export type ParsedDocumentMultipartUpload = {
  fields: Record<string, string>;
  fileName: string;
  fileType: string;
  fileSize: number;
  tempDirectory: string;
  tempFilePath: string;
};

type ParseOptions = {
  maxFileSizeBytes?: number;
};

export async function cleanupDocumentMultipartUpload(
  upload: Pick<ParsedDocumentMultipartUpload, "tempDirectory"> | undefined,
): Promise<void> {
  if (!upload) return;
  await rm(upload.tempDirectory, { recursive: true, force: true });
}

export async function parseDocumentMultipartUpload(
  request: Request,
  options: ParseOptions = {},
): Promise<ParsedDocumentMultipartUpload> {
  if (!request.body) {
    throw new DocumentMultipartUploadError("No request body provided.", 400);
  }

  const maxFileSizeBytes = options.maxFileSizeBytes ?? MAX_UPLOAD_FILE_SIZE_BYTES;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "odm-upload-"));
  const tempFilePath = path.join(tempDirectory, "upload.bin");
  const fields: Record<string, string> = Object.create(null);
  let fileSeen = false;
  let fileName = "";
  let fileType = "application/octet-stream";
  let fileSize = 0;
  let oversized = false;
  let parseFailure: DocumentMultipartUploadError | undefined;
  let fileWriteFinished: Promise<void> | undefined;

  const fail = (message: string, status: 400 | 413 = 400) => {
    parseFailure ??= new DocumentMultipartUploadError(message, status);
  };

  try {
    const headers = Object.fromEntries(request.headers.entries()) as BusboyHeaders;
    const busboy = new Busboy({
      headers,
      limits: {
        fieldNameSize: 100,
        fieldSize: MAX_FIELD_SIZE_BYTES,
        fields: MAX_MULTIPART_FIELDS,
        fileSize: maxFileSizeBytes + 1,
        files: 1,
        parts: MAX_MULTIPART_PARTS,
        headerPairs: 32,
        headerSize: MAX_HEADER_SIZE_BYTES,
      },
    });

    busboy.on("file", (fieldName, file, incomingFileName, _encoding, mimeType) => {
      if (fileSeen || fieldName !== "file") {
        fail("Exactly one file field named file is required.");
        file.resume();
        return;
      }

      fileSeen = true;
      fileName = incomingFileName;
      fileType = mimeType || "application/octet-stream";
      file.on("data", (chunk: Buffer) => {
        fileSize += chunk.byteLength;
        if (fileSize > maxFileSizeBytes) oversized = true;
      });
      file.once("limit", () => {
        oversized = true;
      });

      const output = createWriteStream(tempFilePath, { flags: "wx" });
      fileWriteFinished = pipeline(file, output);
    });

    busboy.on("field", (fieldName, value, nameTruncated, valueTruncated) => {
      if (nameTruncated || valueTruncated) {
        fail("Multipart field exceeds the allowed size.");
        return;
      }
      fields[fieldName] = value;
    });
    busboy.once("filesLimit", () => fail("Only one uploaded file is allowed."));
    busboy.once("fieldsLimit", () => fail("Too many multipart fields."));
    busboy.once("partsLimit", () => fail("Too many multipart parts."));

    const requestStream = Readable.fromWeb(request.body as any);
    await pipeline(requestStream, busboy);
    if (fileWriteFinished) await fileWriteFinished;

    if (oversized || fileSize > maxFileSizeBytes) {
      throw new DocumentMultipartUploadError(MAX_UPLOAD_ERROR_MESSAGE, 413);
    }
    if (parseFailure) throw parseFailure;
    if (!fileSeen) {
      throw new DocumentMultipartUploadError("No file provided.", 400);
    }

    return {
      fields,
      fileName,
      fileType,
      fileSize,
      tempDirectory,
      tempFilePath,
    };
  } catch (error) {
    if (fileWriteFinished) await fileWriteFinished.catch(() => undefined);
    await rm(tempDirectory, { recursive: true, force: true });
    if (error instanceof DocumentMultipartUploadError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (message === MAX_UPLOAD_ERROR_MESSAGE) {
      throw new DocumentMultipartUploadError(MAX_UPLOAD_ERROR_MESSAGE, 413);
    }
    throw new DocumentMultipartUploadError(`Invalid multipart upload: ${message}`, 400);
  }
}
