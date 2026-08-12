import { afterEach, beforeEach, describe, it, expect } from "vitest";
import {
  validateCodeInterpreterFileIds,
  validateMultimodalInput,
} from "../validate-input";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid base64 data URI for the given extension */
function dataUri(ext: "jpeg" | "jpg" | "png" | "webp", byteCount = 100): string {
  // Content doesn't matter for validation; we just need a plausible data URI
  const base64 = "A".repeat(byteCount);
  return `data:image/${ext};base64,${base64}`;
}

/** Build a data URI that exceeds the 20 MB limit */
function oversizeDataUri(): string {
  const twentyOneMB = 21 * 1024 * 1024;
  return `data:image/png;base64,${"A".repeat(twentyOneMB)}`;
}

// ---------------------------------------------------------------------------
// 1. No images
// ---------------------------------------------------------------------------

describe("no images", () => {
  it("returns ok:true for an empty array", () => {
    expect(validateMultimodalInput([])).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// 2. Single valid image
// ---------------------------------------------------------------------------

describe("single valid image", () => {
  it("accepts a jpeg data URI", () => {
    expect(validateMultimodalInput([dataUri("jpeg")])).toEqual({ ok: true });
  });

  it("accepts a jpg data URI", () => {
    expect(validateMultimodalInput([dataUri("jpg")])).toEqual({ ok: true });
  });

  it("accepts a png data URI", () => {
    expect(validateMultimodalInput([dataUri("png")])).toEqual({ ok: true });
  });

  it("accepts a webp data URI", () => {
    expect(validateMultimodalInput([dataUri("webp")])).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// 3. Too many images
// ---------------------------------------------------------------------------

describe("too many images", () => {
  it("rejects when more than 16 images are supplied", () => {
    const images = Array.from({ length: 17 }, () => dataUri("png"));
    const result = validateMultimodalInput(images);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/too many images/i);
    }
  });

  it("accepts exactly 16 images", () => {
    const images = Array.from({ length: 16 }, () => dataUri("png"));
    expect(validateMultimodalInput(images)).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// 4. Oversize image
// ---------------------------------------------------------------------------

describe("oversize image", () => {
  it("rejects an image that exceeds the 20 MB limit", () => {
    const result = validateMultimodalInput([oversizeDataUri()]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/exceeds maximum size/i);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Unsupported MIME type
// ---------------------------------------------------------------------------

describe("unsupported MIME type", () => {
  it("rejects a gif data URI", () => {
    const gif = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    const result = validateMultimodalInput([gif]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/filetype is not supported/i);
    }
  });

  it("rejects a bmp data URI", () => {
    const bmp = `data:image/bmp;base64,${"A".repeat(100)}`;
    const result = validateMultimodalInput([bmp]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
    }
  });

  it("rejects a data URI with no extension prefix", () => {
    const bad = "AAAA";
    const result = validateMultimodalInput([bad]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/missing file extension/i);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Mixed valid and invalid
// ---------------------------------------------------------------------------

describe("mixed images", () => {
  it("rejects at the first invalid image even if earlier ones were valid", () => {
    const images = [
      dataUri("png"),
      "data:image/gif;base64,abc123",
    ];
    const result = validateMultimodalInput(images);
    expect(result.ok).toBe(false);
  });
});

describe("Code Interpreter files", () => {
  const originalLimit = process.env.MAX_PERSONA_CI_DOCUMENT_LIMIT;

  beforeEach(() => {
    process.env.MAX_PERSONA_CI_DOCUMENT_LIMIT = "20";
  });

  afterEach(() => {
    if (originalLimit === undefined) {
      delete process.env.MAX_PERSONA_CI_DOCUMENT_LIMIT;
    } else {
      process.env.MAX_PERSONA_CI_DOCUMENT_LIMIT = originalLimit;
    }
  });

  it("accepts exactly 20 file IDs", () => {
    const fileIds = Array.from({ length: 20 }, (_, index) => `file-${index}`);
    expect(validateCodeInterpreterFileIds(fileIds)).toEqual({ ok: true });
  });

  it("rejects more than 20 file IDs", () => {
    const fileIds = Array.from({ length: 21 }, (_, index) => `file-${index}`);
    const result = validateCodeInterpreterFileIds(fileIds);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/maximum is 20/i);
    }
  });

  it("rejects invalid file IDs", () => {
    const result = validateCodeInterpreterFileIds(["file-1", ""]);
    expect(result.ok).toBe(false);
  });
});
