'use client'

import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Logo } from "./ui/logo";
import { LogOut } from "lucide-react";

export function Header() {
    const router = useRouter();
    const { data: session, isPending: isSessionPending } = authClient.useSession();

    const [signingOut, setSigningOut] = useState(false);
    const [signOutError, setSignOutError] = useState<string | null>(null);

    async function signOut() {
        setSigningOut(true);
        setSignOutError(null);

        try {
            const { error: authError } = await authClient.signOut();
            if (authError) {
                setSignOutError(authError.message || "Could not sign out. Please try again.");
                return;
            }

            router.replace("/sign-in");
            router.refresh();
        } catch {
            setSignOutError("Could not sign out. Please try again.");
        } finally {
            setSigningOut(false);
        }
    }


    return <>
        <header className="mb-12 flex items-center justify-between">
            <Logo/>
            <div className="flex items-center gap-2 sm:gap-3">
                <span
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-card-foreground"
                aria-live="polite"
                >
                <span
                    className={`size-2 rounded-full ${
                    session?.user ? "bg-emerald-600" : isSessionPending ? "bg-muted-foreground" : "bg-destructive"
                    }`}
                    aria-hidden="true"
                />
                {isSessionPending
                    ? "Checking session…"
                    : session?.user?.name || session?.user?.email || "Session unavailable"}
                </span>
                <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={signOut}
                disabled={signingOut || isSessionPending}
                aria-label={signingOut ? "Signing out" : "Sign out"}
                >
                <LogOut className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">{signingOut ? "Signing out…" : "Sign out"}</span>
                </Button>
            </div>
        </header>

        {signOutError && (
          <p role="alert" className="mb-6 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {signOutError}
          </p>
        )}
    </>
}