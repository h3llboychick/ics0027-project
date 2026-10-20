import { FileStorage, StorageKey } from "./base"
import fs from "node:fs/promises";
import path from "node:path"; 
import { FileStorageError, FileUploadRollbackError } from "../errors";

const STORAGE_DIRECTORY = "storage/"

export const diskStorage: FileStorage = {
    async get(key: StorageKey): Promise<Uint8Array<ArrayBuffer> | null> {
        try {
            return await fs.readFile(path.join(STORAGE_DIRECTORY, key));
        } catch (err) {
            if (isNodeError(err) && err.code === "ENOENT") return null;
            throw new FileStorageError("Could not read stored file", { cause: err });
        }
    },
    async put(key: StorageKey, contents: Uint8Array<ArrayBuffer>): Promise<void> {
        const filePath = path.join(STORAGE_DIRECTORY, key);
        try {
            await fs.mkdir(STORAGE_DIRECTORY, { recursive: true });
            await fs.writeFile(filePath, contents);
        } catch (err) {
            try {
                await fs.rm(filePath, { force: true });
            } catch (cleanupError) {
                throw new FileUploadRollbackError({ cause: new AggregateError([err, cleanupError]) });
            }
            throw new FileStorageError("Could not write stored file", { cause: err });
        }
    },
    async delete(key: StorageKey): Promise<void> {
        try {
            const filePath = path.join(STORAGE_DIRECTORY, key)
            await fs.rm(filePath, { force: true });
        } catch (err) {
            throw new FileStorageError("Could not remove stored file", { cause: err });
        }
    }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error;
}
