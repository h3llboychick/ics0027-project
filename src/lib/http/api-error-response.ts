import { NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/auth-guard";
import { FileOperationError } from "@/lib/files/errors";
import { ZodError } from "zod";

/** Translate application errors into the API's public error shape. */
export function apiErrorResponse(error: unknown, context: string): NextResponse {
  if (error instanceof UnauthenticatedError) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  if (error instanceof ZodError) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 422 });
  }

  if (error instanceof FileOperationError) {
    console.error(JSON.stringify({ context, code: error.code }));
    return NextResponse.json({ error: error.code }, { status: 500 });
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return NextResponse.json({ error: 'REQUEST_CANCELLED' }, { status: 408 });
  }
  console.error(JSON.stringify({ context, code: 'DEPENDENCY_UNAVAILABLE' }));
  return NextResponse.json({ error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
}
