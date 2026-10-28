export function createFileDownloadResponse(file: File): Response {
  const filename = file.name.replace(/[\u0000-\u001F\u007F-\u009F]/gu, "_") || "download";
  const fallback = filename.replace(/[^\x20-\x7E]|["\\%]/gu, "_");
  const encodedFilename = encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return new Response(file, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encodedFilename}`,
    },
  });
}
