import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export async function proxy(request: NextRequest) {
    const session = await auth.api.getSession({
        headers: await headers()
    })

    if (!session) {
        return NextResponse.redirect(new URL("/sign-in", request.url));
    }
    // TODO: Create redirects for users with unverified emails


    return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard"]
};