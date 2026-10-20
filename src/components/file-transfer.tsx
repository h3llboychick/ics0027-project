"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, FileText, Trash2, Upload } from "lucide-react";
import {
  DEFAULT_PAGE_SIZE,
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
import { authClient } from "@/lib/auth-client";

type UploadedFile = {
  id: string;
  filename: string;
  fileSizeBytes: number;
  createdAt: string;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileTransfer() {
  const router = useRouter();
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [hasMorePages, setHasMorePages] = useState(false);


  const loadFiles = useCallback(async (page: number) => {
    setLoadingFiles(true);
    setError(null);
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      const response = await fetch(`/api/files?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Could not load files (${response.status})`);
      const result = listFilesResponseSchema.parse(await response.json());

      setUploadedFiles(result.files);
      setCurrentPage(result.page);
      setHasMorePages(result.hasMorePages);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Loading files failed");
    } finally {
      setLoadingFiles(false);
    }
  }, [pageSize]);

  async function uploadFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) return;

    setUploading(true);
    setError(null);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.set("file", selectedFile);

      const response = await fetch("/api/files", {
        method: "POST",
        body: formData,
      });

      if (response.status === 401) {
        throw new Error("Please sign in before uploading a file.");
      }
      if (!response.ok) {
        throw new Error(`Upload failed (HTTP ${response.status}).`);
      }

      const result: { fileId?: string } = await response.json();
      if (!result.fileId) {
        throw new Error("The server did not return a file ID.");
      }

      setMessage(`${selectedFile.name} uploaded and encrypted.`);
      setSelectedFile(null);
      if (inputRef.current) inputRef.current.value = "";
      await loadFiles(1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      setUploading(false);
    }

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
    setDeletingId(file.id);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/files/${encodeURIComponent(file.id)}`, {
        method: "DELETE",
      });

      if (response.status === 401) {
        throw new Error("Please sign in before deleting a file.");
      }
      if (response.status === 404) {
        throw new Error("This file could not be found. Refresh the list and try again.");
      }
      if (!response.ok) {
        throw new Error(`Delete failed (HTTP ${response.status}).`);
      }

      const remainingFiles = uploadedFiles.filter((uploadedFile) => uploadedFile.id !== file.id);
      const nextPage = remainingFiles.length === 0 && currentPage > 1
        ? currentPage - 1
        : currentPage;

      setUploadedFiles(remainingFiles);
      setMessage(`${file.filename} deleted.`);
      await loadFiles(nextPage);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    void loadFiles(1);
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
                onChange={(event) => {
                  const nextPageSize = Number(event.currentTarget.value);
                  if (!SUPPORTED_PAGE_SIZES.includes(nextPageSize)) return;
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
                  disabled={downloadingId !== null || deletingId !== null}
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
                  disabled={downloadingId !== null || deletingId !== null}
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
            onClick={() => void loadFiles(currentPage - 1)}
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
            onClick={() => void loadFiles(currentPage + 1)}
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
