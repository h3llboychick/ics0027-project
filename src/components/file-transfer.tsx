"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Download, FileText, Trash2, Upload } from "lucide-react";
import {
  DEFAULT_PAGE_SIZE,
  FILE_OPERATION_POLL_MS,
  fileOperationResponseSchema,
  type FileOperationResponse,
  listFilesResponseSchema,
  SUPPORTED_PAGE_SIZES,
} from "@/lib/contracts/files";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type UploadedFile = {
  id: string;
  filename: string;
  fileSizeBytes: number;
  createdAt: string;
};

type Transfer = {
  key: string;
  type: "UPLOAD" | "DELETE";
  name: string;
  file?: File;
  fileId?: string;
  operationId?: string;
  status: FileOperationResponse["status"] | "SENDING" | "UNKNOWN";
};
const terminal = (status: Transfer["status"]) => ["SUCCEEDED", "FAILED", "NEEDS_ATTENTION"].includes(status);
function transferLabel(item: Transfer) {
  if (item.status === "SUCCEEDED") return item.type === "UPLOAD" ? "Ready" : "Deleted";
  if (item.status === "FAILED") return item.type === "UPLOAD" ? "Failed — choose the file again for a new upload" : "Delete request failed — retry from the file list";
  if (item.status === "NEEDS_ATTENTION") return "Requires attention — automatic retries stopped";
  if (item.status === "UNKNOWN") return "Checking result — you can retry the same request";
  return item.type === "UPLOAD" ? "Uploading / verifying…" : "Deletion accepted — waiting for completion…";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function fetchFilePage(page: number, pageSize: number, signal: AbortSignal) {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  const response = await fetch(`/api/files?${query}`, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`Could not load files (${response.status})`);
  return listFilesResponseSchema.parse(await response.json());
}

export function FileTransfer() {
  const inputRef = useRef<HTMLInputElement>(null);
  const listingRequestRef = useRef<AbortController | null>(null);
  const transferRequests = useRef(new Set<AbortController>());
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [hasMorePages, setHasMorePages] = useState(false);


  const loadFiles = useCallback((page: number) => {
    listingRequestRef.current?.abort();
    const controller = new AbortController();
    listingRequestRef.current = controller;

    return fetchFilePage(page, pageSize, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setUploadedFiles(result.files);
        setCurrentPage(result.page);
        setHasMorePages(result.hasMorePages);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Loading files failed");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingFiles(false);
      });
  }, [pageSize, setUploadedFiles, setCurrentPage, setHasMorePages, setError, setLoadingFiles]);

  async function refreshFiles(page: number) {
    setLoadingFiles(true);
    setError(null);
    await loadFiles(page);
  }

  async function sendTransfer(item: Transfer) {
    const controller = new AbortController();
    transferRequests.current.add(controller);
    setTransfers(rows => rows.map(row => row.key === item.key ? { ...row, status: "SENDING" } : row));
    try {
      const formData = new FormData();
      if (item.file) formData.set("file", item.file);
      const response = await fetch(item.type === "UPLOAD" ? "/api/files" : `/api/files/${item.fileId}`, {
        method: item.type === "UPLOAD" ? "POST" : "DELETE",
        headers: item.type === "UPLOAD" ? { "Idempotency-Key": item.key } : undefined,
        body: item.type === "UPLOAD" ? formData : undefined,
        signal: controller.signal,
      });
      if (response.status === 401) {
        controller.abort();
        for (const request of transferRequests.current) request.abort();
        setTransfers([]);
        setError("Please sign in before managing files.");
        return;
      }
      const parsed = fileOperationResponseSchema.safeParse(await response.json());
      if (controller.signal.aborted) return;
      if (parsed.success && parsed.data.error !== "IDEMPOTENCY_CONFLICT" && (response.ok || response.status === 409)) {
        const operation = parsed.data;
        setTransfers(rows => rows.map(row => row.key === item.key ? { ...row, ...operation, file: terminal(operation.status) ? undefined : row.file } : row));
        if (response.ok) await loadFiles(1);
      } else if (response.status >= 400 && response.status < 500 && response.status !== 408) {
        setTransfers(rows => rows.map(row => row.key === item.key ? { ...row, status: "FAILED", file: undefined } : row));
        setError(`Request rejected (HTTP ${response.status}).`);
      } else throw new Error("Result unknown");
    } catch {
      if (!controller.signal.aborted) {
        setTransfers(rows => rows.map(row => row.key === item.key ? { ...row, status: "UNKNOWN" } : row));
      }
    } finally { transferRequests.current.delete(controller); }
  }

  async function uploadFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) return;
    const item: Transfer = { key: crypto.randomUUID(), type: "UPLOAD", name: selectedFile.name, file: selectedFile, status: "SENDING" };
    setTransfers(rows => [...rows, item]);
    setUploading(true);
    setError(null);
    setSelectedFile(null);
    if (inputRef.current) inputRef.current.value = "";
    try { await sendTransfer(item); } finally { setUploading(false); }
  }

  async function downloadFile(file: UploadedFile) {
    setDownloadingId(file.id);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/files/${encodeURIComponent(file.id)}`);
      if (response.status === 401) {
        throw new Error("Please sign in before downloading a file.");
      }
      if (!response.ok) {
        throw new Error(`Download failed (HTTP ${response.status}).`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage(`${file.filename} downloaded.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Download failed.");
    } finally {
      setDownloadingId(null);
    }
  }

  async function deleteFile(file: UploadedFile) {
    const item: Transfer = { key: file.id, fileId: file.id, type: "DELETE", name: file.filename, status: "SENDING" };
    setTransfers(rows => rows.some(row => row.key === item.key) ? rows : [...rows, item]);
    setDeletingId(file.id);
    setError(null);
    try { await sendTransfer(item); } finally { setDeletingId(null); }
  }

  const pendingSignature = transfers.filter(row => !terminal(row.status) && row.status !== "SENDING")
    .map(row => `${row.key}:${row.operationId ?? ""}`).join(",");
  const transfersRef = useRef(transfers);
  useEffect(() => { transfersRef.current = transfers; }, [transfers]);
  useEffect(() => {
    if (!pendingSignature) return;
    const controller = new AbortController();
    let active = false;
    const timer = setInterval(async () => {
      if (active) return;
      active = true;
      try {
        for (const item of transfersRef.current) {
          if (terminal(item.status) || item.status === "SENDING") continue;
          const url = item.operationId ? `/api/file-operations/${item.operationId}` :
            `/api/file-operations?${new URLSearchParams({ type: item.type, idempotencyKey: item.key })}`;
          const response = await fetch(url, { cache: "no-store", signal: controller.signal });
          if (response.status === 401) {
            setTransfers([]);
            setError("Please sign in before managing files.");
            controller.abort();
            return;
          }
          if (!response.ok) continue;
          const operation = fileOperationResponseSchema.parse(await response.json());
          if (controller.signal.aborted) return;
          setTransfers(rows => rows.map(row => row.key === item.key ? { ...row, ...operation, file: terminal(operation.status) ? undefined : row.file } : row));
          if (terminal(operation.status)) await loadFiles(1);
        }
      } catch { /* Keep the visible row and retry status reads after network failures. */ }
      finally { active = false; }
    }, FILE_OPERATION_POLL_MS);
    return () => { clearInterval(timer); controller.abort(); };
  }, [pendingSignature, loadFiles]);

  useEffect(() => {
    const requests = transferRequests.current;
    return () => { for (const controller of requests) controller.abort(); };
  }, []);

  useEffect(() => {
    void loadFiles(1);
    return () => listingRequestRef.current?.abort();
  }, [loadFiles]);

  return (
    <>
      <Card className="gap-0 py-0">
        <CardHeader className="px-5 py-6 sm:px-8">
          <div className="flex items-start gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-primary">
              <Upload className="size-5" aria-hidden="true" />
            </span>
            <div>
              <CardTitle>Upload a file</CardTitle>
              <CardDescription className="mt-1">Files up to 25 MB are supported.</CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="px-5 pb-6 sm:px-8 sm:pb-8">
          <form onSubmit={uploadFile} className="space-y-5">
            <Field>
              <FieldLabel htmlFor="file-upload">File</FieldLabel>
              <Input
                ref={inputRef}
                id="file-upload"
                type="file"
                onChange={(event) => setSelectedFile(event.currentTarget.files?.[0] ?? null)}
                aria-describedby="file-upload-description"
              />
              <FieldDescription id="file-upload-description">
                {selectedFile
                  ? `${selectedFile.name} · ${formatBytes(selectedFile.size)}`
                  : "Choose any file up to 25 MB."}
              </FieldDescription>
            </Field>

            <Button type="submit" size="lg" className="w-full" disabled={!selectedFile || uploading}>
              <Upload className="size-4" aria-hidden="true" />
              {uploading ? "Encrypting and uploading…" : "Encrypt and upload"}
            </Button>
          </form>

          {(error || message) && (
            <p
              role={error ? "alert" : "status"}
              className={`mt-4 rounded-lg px-4 py-3 text-sm ${
                error ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground"
              }`}
            >
              {error}
              {error?.includes("sign in") && (
                <> <a className="font-semibold underline underline-offset-4" href="/sign-in">Sign in</a>.</>
              )}
              {message}
            </p>
          )}
        </CardContent>
      </Card>

      {transfers.length > 0 && (
        <section className="mt-6" aria-label="File operations">
          <ul className="divide-y rounded-2xl border bg-white" aria-live="polite">
            {transfers.map(item => (
              <li key={item.key} className="flex items-center justify-between gap-4 px-5 py-4 text-sm">
                <span className="min-w-0"><span className="block truncate font-medium">{item.name}</span>
                  <span className="mt-1 block text-muted-foreground">{transferLabel(item)}</span></span>
                {item.status === "UNKNOWN" && <button className="shrink-0 underline" onClick={() => void sendTransfer(item)}>Retry same request</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="mt-1 text-xl font-semibold">Uploaded files</h2>
          </div>
          <div className="flex items-center justify-between gap-4 sm:justify-end">
            <span className="text-sm text-[#718278]">{uploadedFiles.length} on this page</span>
            <label htmlFor="page-size" className="flex items-center gap-2 text-sm font-medium">
              Files per page
              <select
                id="page-size"
                value={pageSize}
                disabled={uploading || deletingId !== null}
                onChange={(event) => {
                  const nextPageSize = Number(event.currentTarget.value);
                  if (!SUPPORTED_PAGE_SIZES.includes(nextPageSize)) return;
                  if (nextPageSize === pageSize) return;
                  setLoadingFiles(true);
                  setError(null);
                  setPageSize(nextPageSize);
                  setCurrentPage(1);
                }}
                className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {SUPPORTED_PAGE_SIZES.map((supportedPageSize) => (
                  <option key={supportedPageSize} value={supportedPageSize}>
                    {supportedPageSize}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {loadingFiles && uploadedFiles.length === 0 ? (
          <div className="rounded-2xl border bg-white/65 px-5 py-8 text-center text-sm">
            Loading your files…
          </div>
        ) : uploadedFiles.length === 0 ? (
          <div className="rounded-2xl border bg-white/65 px-5 py-8 text-center text-sm">
            Your successful uploads will appear here with a download button.
          </div>
        ) : (
          <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
            {uploadedFiles.map((file) => (
              <li key={file.id} className="flex items-center gap-4 px-4 py-4 sm:px-5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl">
                  <FileText className="size-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{file.filename}</span>
                  <span className="mt-1 block text-xs text-[#7b8981]">{formatBytes(file.fileSizeBytes)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => downloadFile(file)}
                  disabled={downloadingId !== null || deletingId !== null || transfers.some(row => row.type === "DELETE" && row.fileId === file.id && !terminal(row.status))}
                  className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition hover:bg-[#f3f4f6] disabled:cursor-wait disabled:opacity-60"
                >
                  <Download className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">
                    {downloadingId === file.id ? "Downloading…" : "Download"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void deleteFile(file)}
                  disabled={downloadingId !== null || deletingId !== null || transfers.some(row => row.type === "DELETE" && row.fileId === file.id && !terminal(row.status))}
                  aria-label={`Delete ${file.filename}`}
                  className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-destructive/30 px-3 text-sm font-medium text-destructive transition hover:bg-destructive/10 disabled:cursor-wait disabled:opacity-60"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">
                    {deletingId === file.id ? "Deleting…" : "Delete"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <nav className="mt-4 flex items-center justify-center gap-4" aria-label="File list pages">
          <button
            type="button"
            onClick={() => void refreshFiles(currentPage - 1)}
            disabled={loadingFiles || currentPage === 1}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-[#d9e3dc] px-3 text-sm font-medium transition hover:bg-[#f3f4f6] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            Previous
          </button>
          <span className="text-sm" aria-live="polite">
            {loadingFiles ? "Loading…" : `Page ${currentPage}`}
          </span>
          <button
            type="button"
            onClick={() => void refreshFiles(currentPage + 1)}
            disabled={loadingFiles || !hasMorePages}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-[#d9e3dc] px-3 text-sm font-medium transition hover:bg-[#f3f4f6] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </nav>
      </section>

      <p className="mt-8 text-center text-xs leading-5 text-[#839087]">
        Uploads are encrypted before they are stored and are available from your account.
      </p>
    </>
  );
}
