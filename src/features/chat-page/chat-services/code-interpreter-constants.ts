// Supported file extensions for Code Interpreter
export const DEFAULT_CODE_INTERPRETER_FILE_LIMIT = 20;

export function getCodeInterpreterFileLimit(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_CODE_INTERPRETER_FILE_LIMIT;
}

export const CODE_INTERPRETER_SUPPORTED_EXTENSIONS = [
  // Data files
  "CSV", "JSON", "XML", "XLSX", "XLS",
  // Documents
  "PDF", "TXT", "MD", "HTML", "HTM",
  // Code files
  "PY", "JS", "TS", "C", "CPP", "H", "HPP", "JAVA", "CS", "PHP", "RB", "TEX",
  // Config files
  "CSS", "SH", "BAT",
  // Images (for analysis)
  "JPEG", "JPG", "PNG", "GIF", "WEBP",
  // Archives
  "ZIP", "TAR",
  // Other
  "PKL", "PPTX", "DOCX"
];

/**
 * Check if a file extension is supported by Code Interpreter
 */
export function isCodeInterpreterSupportedFile(fileName: string): boolean {
  const extension = fileName.split(".").pop()?.toUpperCase();
  return !!extension && CODE_INTERPRETER_SUPPORTED_EXTENSIONS.includes(extension);
}
