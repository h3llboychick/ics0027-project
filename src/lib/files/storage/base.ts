export type StorageKey = string;

export interface FileStorage {
  put(key: StorageKey, contents: Uint8Array<ArrayBuffer>): Promise<void>;
  get(key: StorageKey): Promise<Uint8Array<ArrayBuffer> | null>;
  delete(key: StorageKey): Promise<void>;
}
