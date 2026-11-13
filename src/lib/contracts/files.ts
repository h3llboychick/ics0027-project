import * as z from "zod"

export const MAX_FILENAME_LENGTH = 255;
export const MAX_UPLOAD_SIZE = 1024 * 1024 * 25; // 25MB
export const ALLOWED_FILE_EXTENSIONS = ['txt', 'csv', 'json', 'pdf', 'png', 'jpg', 'jpeg'] as const;
export const FILE_ACCEPT = ALLOWED_FILE_EXTENSIONS.map(extension => `.${extension}`).join(',');
export const SUPPORTED_PAGE_SIZES = [10, 20, 40];
export const DEFAULT_PAGE_SIZE = 10;
export const FILE_OPERATION_POLL_MS = z.coerce.number().int().min(100).max(60_000)
    .parse(process.env.NEXT_PUBLIC_FILE_OPERATION_POLL_MS ?? '2000');
const controlCharacters = /[\u0000-\u001F\u007F-\u009F]/u;

export const idempotencyKeySchema = z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const operationLookupSchema = z.object({
    type: z.enum(['UPLOAD', 'DELETE']),
    idempotencyKey: idempotencyKeySchema,
});
export const fileOperationResponseSchema = z.object({
    operationId: z.uuid(),
    fileId: z.uuid(),
    type: z.enum(['UPLOAD', 'DELETE']),
    status: z.enum(['PENDING','RUNNING','RETRY_WAIT','SUCCEEDED','FAILED','NEEDS_ATTENTION']),
    phase: z.string(),
    error: z.string().nullable(),
});
export type FileOperationResponse = z.infer<typeof fileOperationResponseSchema>;

const filenameSchema = z
  .string()
  .min(1, "Filename cannot be empty")
  .max(MAX_FILENAME_LENGTH, "Filename is too long")
  .refine((name) => name.trim().length > 0, "Filename cannot be blank")
  .refine((name) => name !== "." && name !== "..", "Filename is invalid")
  .refine(
    (name) => !controlCharacters.test(name),
    "Filename cannot contain control characters",
  );

const fileListing = z.object({
    id: z.uuid(),
    filename: filenameSchema,
    fileSizeBytes: z.number().int().nonnegative(),
    createdAt: z.iso.datetime()
})


export const uploadFileRequestSchema = z
    .file()
    .max(MAX_UPLOAD_SIZE, `File must be no larger than ${MAX_UPLOAD_SIZE} bytes`)
    .refine(
        (file) => filenameSchema.safeParse(file.name).success,
        { path: ["name"], message: "Filename is invalid" },
    )
    .refine(file => !/[\\/:]/u.test(file.name), 'Filename cannot contain path separators')
    .refine(file => ALLOWED_FILE_EXTENSIONS.some(extension => file.name.toLowerCase().endsWith(`.${extension}`)),
        'Supported file types: TXT, CSV, JSON, PDF, PNG and JPEG');
    
export const listFilesRequestSchema = z.object({
    page: z.coerce.number().int().positive().max(1_000_000).optional().default(1),
    pageSize: z.coerce.number().int().optional().default(DEFAULT_PAGE_SIZE),
    search: z.string().trim().max(100).refine(value => !controlCharacters.test(value)).optional().default(''),
}).refine(({pageSize}) => {
    return SUPPORTED_PAGE_SIZES.includes(pageSize);
}, `Unsupported page size. Supported values: ${SUPPORTED_PAGE_SIZES}`)

export const listFilesResponseSchema = z.object({
    files: z.array(fileListing),
    page: z.number(),
    hasMorePages:  z.boolean(),
    storage: z.object({ usedBytes: z.number().nonnegative(), limitBytes: z.number().positive() }),
})

export const getFileRequestSchema = z.uuid()
export const getFileResponseSchema = z.object({
    id: z.uuid(),
    filename: filenameSchema,
    createdAt: z.date()
})
