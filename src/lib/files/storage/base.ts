export type StorageKey = string;
export interface FileStorage {
  stage(key: StorageKey, contents: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<void>;
  publish(partKey: StorageKey, finalKey: StorageKey): Promise<void>;
  get(key: StorageKey, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer> | null>;
  delete(key: StorageKey): Promise<void>;
  inspect(key: StorageKey): Promise<{ modifiedAt: Date } | null>;
  legacyKeys(): AsyncIterable<string>;
  generations(): AsyncIterable<{ key: string; modifiedAt: Date }>;
}
