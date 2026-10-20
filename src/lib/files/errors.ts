export type FileErrorCode =
  | "FILE_ENCRYPTION_FAILED"
  | "FILE_STORAGE_FAILED"
  | "FILE_METADATA_FAILED"
  | "FILE_UPLOAD_FAILED"
  | "FILE_UPLOAD_ROLLBACK_FAILED";

/** Errors from file operations that are safe to translate at an HTTP boundary. */
export class FileOperationError extends Error {
  constructor(
    message: string,
    readonly code: FileErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class FileStorageError extends FileOperationError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "FILE_STORAGE_FAILED", options);
  }
}

export class FileMetadataError extends FileOperationError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "FILE_METADATA_FAILED", options);
  }
}

export class FileUploadRollbackError extends FileOperationError {
  constructor(options?: ErrorOptions) {
    super("File upload failed and its stored data could not be removed", "FILE_UPLOAD_ROLLBACK_FAILED", options);
  }
}

export class FileUploadError extends FileOperationError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "FILE_UPLOAD_FAILED", options);
  }
}

export class FileEncryptionError extends FileOperationError {
    constructor(message: string, options?: ErrorOptions) {
        super(message, 'FILE_ENCRYPTION_FAILED', options);
    }
}
