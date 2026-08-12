/**
 * validate-input.ts
 *
 * Pure, synchronous validation of multimodal image inputs.
 * Extracted from chat-api.ts (ChatAPIEntry) — no service dependencies.
 */

import { SupportedFileExtensionsInputImages } from "../models";
import { getCodeInterpreterFileLimit } from "../code-interpreter-constants";

// OpenAI Responses API limits for vision input
// https://platform.openai.com/docs/guides/images?api-mode=responses#image-input-requirements
const MAX_IMAGE_COUNT = 16;

// ~20 MB encoded as base64 ≈ 14.9 MB binary; the API limit is 20 MB per image.
// We enforce 20 MB on the raw base64 string (includes the data: prefix) as a
// conservative upper bound that avoids false rejections.
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

/**
 * Validates an array of multimodal images supplied as base64 data URIs or File
 * objects.
 *
 * Rules (mirrors ChatAPIEntry in chat-api.ts):
 * - At most MAX_IMAGE_COUNT images.
 * - Each image must carry a recognised MIME extension in its data URI prefix.
 * - Each image must be within the byte-size limit.
 * - Supported file extensions: JPEG, JPG, PNG, WEBP (SupportedFileExtensionsInputImages).
 */
export function validateMultimodalInput(
  images: (string | File)[]
): ValidationResult {
  if (images.length === 0) {
    return { ok: true };
  }

  if (images.length > MAX_IMAGE_COUNT) {
    return {
      ok: false,
      error: `Too many images: ${images.length} supplied, maximum is ${MAX_IMAGE_COUNT}.`,
      status: 400,
    };
  }

  for (const image of images) {
    // File objects are validated by the browser before upload; skip byte-level
    // checks here since we cannot read them synchronously.
    if (image instanceof File) {
      const ext = image.name.split(".").pop()?.toUpperCase() ?? "";
      if (
        !Object.values(SupportedFileExtensionsInputImages).includes(
          ext as SupportedFileExtensionsInputImages
        )
      ) {
        return {
          ok: false,
          error: `Filetype is not supported: .${ext.toLowerCase()}`,
          status: 400,
        };
      }
      continue;
    }

    // base64 data URI path (the dominant runtime case from chat-api.ts)
    const matches = image.match(/^data:image\/([a-zA-Z]+);base64,/);
    const fileExtension = matches ? matches[1] : null;

    if (!fileExtension) {
      return { ok: false, error: "Missing File Extension", status: 400 };
    }

    if (
      !Object.values(SupportedFileExtensionsInputImages).includes(
        fileExtension.toUpperCase() as SupportedFileExtensionsInputImages
      )
    ) {
      return { ok: false, error: "Filetype is not supported", status: 400 };
    }

    if (image.length > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        error: `Image exceeds maximum size of ${MAX_IMAGE_BYTES} bytes.`,
        status: 400,
      };
    }
  }

  return { ok: true };
}

export function validateCodeInterpreterFileIds(
  fileIds: unknown
): ValidationResult {
  if (fileIds === undefined) {
    return { ok: true };
  }

  if (
    !Array.isArray(fileIds) ||
    fileIds.some((fileId) => typeof fileId !== "string" || fileId.length === 0)
  ) {
    return {
      ok: false,
      error: "Code Interpreter file IDs must be non-empty strings.",
      status: 400,
    };
  }

  const maxFileCount = getCodeInterpreterFileLimit(
    process.env.MAX_PERSONA_CI_DOCUMENT_LIMIT
  );
  if (fileIds.length > maxFileCount) {
    return {
      ok: false,
      error: `Too many Code Interpreter files: ${fileIds.length} supplied, maximum is ${maxFileCount}.`,
      status: 400,
    };
  }

  return { ok: true };
}
