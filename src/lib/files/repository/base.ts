export type CreateFileMetadata = {
    id: string,
    ownedBy: string;
    filename: string;
    fileSizeBytes: number;
    protectedEncryptionKey: Uint8Array<ArrayBuffer>;
    protectedEncryptionKeyIV: Uint8Array<ArrayBuffer>;
    protectedEncryptionKeyAuthTag: Uint8Array<ArrayBuffer>;
    encryptedFileIV: Uint8Array<ArrayBuffer>;
    encryptedFileAuthTag: Uint8Array<ArrayBuffer>;
}

export type FileMetadata = {
    id: string,
    ownedBy: string;
    filename: string;
    fileSizeBytes: number;
    createdAt: Date;
}

export type FileEncryptionMetadata = FileMetadata & {
    encryptedFileAuthTag: Uint8Array<ArrayBuffer>;
    encryptedFileIV: Uint8Array<ArrayBuffer>;
    protectedEncryptionKey: Uint8Array<ArrayBuffer>;
    protectedEncryptionKeyIV: Uint8Array<ArrayBuffer>;
    protectedEncryptionKeyAuthTag: Uint8Array<ArrayBuffer>;
}

export type FileListings = {
    files: FileMetadata[],
    page: number,
    hasMorePages: boolean
}

export interface FileRepository {
    create(input: CreateFileMetadata): Promise<FileMetadata>;
    findById(id: string, ownerId: string): Promise<FileMetadata | null>;
    getFileEncryptionMetadata(id: string, ownerId: string): Promise<FileEncryptionMetadata | null>;
    listByOwner(ownerId: string, page: number, pageSize: number): Promise<FileListings>
    deleteById(id: string, ownerId: string): Promise<void>;
}

