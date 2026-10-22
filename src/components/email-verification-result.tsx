"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type ResultKind =
  | "checking"
  | "confirmed"
  | "confirmed-no-session"
  | "failed"
  | "failed-signed-in"
  | "missing";

function failureDescription(errorCode: string | null) {
  switch (errorCode) {
    case "TOKEN_EXPIRED":
      return "This verification link has expired. If your email is already verified, sign in. Otherwise, request a fresh link.";
    case "INVALID_TOKEN":
      return "This verification link is not valid. Request a fresh link, or sign in if your email is already verified.";
    default:
      return "We couldn't confirm your email with this link. You can request another link or sign in if you have already verified your email.";
  }
}

export function EmailVerificationResult() {
  const router = useRouter();
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const [kind, setKind] = useState<ResultKind>("checking");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resendRequested, setResendRequested] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  useEffect(() => {
    if (isSessionPending) return;

    const params = new URLSearchParams(window.location.search);
    const verificationError = params.get("error");
    setErrorCode(verificationError);

    if (params.get("from") !== "email") {
      setKind("missing");
      return;
    }

    if (verificationError) {
      setKind(session?.user?.emailVerified ? "failed-signed-in" : "failed");
      return;
    }

    if (session?.user?.emailVerified) {
      setKind("confirmed");
      const redirectTimer = window.setTimeout(() => {
        router.replace("/");
      }, 3000);

      return () => window.clearTimeout(redirectTimer);
    }

    if (!session?.user) {
      setKind("confirmed-no-session");
      return;
    }

    setKind("failed");
    setErrorCode("EMAIL_NOT_VERIFIED");
  }, [isSessionPending, router, session]);

  async function requestAnotherLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResending(true);
    setResendRequested(false);
    setResendError(null);

    const emailToUse = session?.user?.email ?? email.trim();

    try {
      const { error } = await authClient.sendVerificationEmail({
        email: emailToUse,
        callbackURL: "/email-verification-result?from=email",
      });

      if (error) {
        setResendError("We couldn't request a new link right now. Please try again later.");
        return;
      }

      setResendRequested(true);
    } catch {
      setResendError("We couldn't request a new link right now. Please try again later.");
    } finally {
      setResending(false);
    }
  }

  async function signOutToRetry() {
    setSignOutError(null);
    try {
      const { error } = await authClient.signOut();
      if (error) {
        setSignOutError("We couldn't sign you out. Please try again.");
        return;
      }
      window.location.reload();
    } catch {
      setSignOutError("We couldn't sign you out. Please try again.");
    }
  }

  if (kind === "checking") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Checking your verification</CardTitle>
          <CardDescription>Please wait while we check your account.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (kind === "confirmed") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Email confirmed</CardTitle>
          <CardDescription>Your email is verified. Taking you to your files in a few seconds.</CardDescription>
        </CardHeader>
        <CardContent>
          <a className="text-sm font-medium underline underline-offset-4" href="/">
            Continue to your files now
          </a>
        </CardContent>
      </Card>
    );
  }

  if (kind === "confirmed-no-session") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Email already confirmed</CardTitle>
          <CardDescription>Your email is verified. Sign in to continue to your files.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" onClick={() => router.push("/sign-in")}>Sign in</Button>
        </CardContent>
      </Card>
    );
  }

  if (kind === "failed-signed-in") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{errorCode === "TOKEN_EXPIRED" ? "Verification link expired" : "Couldn't use this verification link"}</CardTitle>
          <CardDescription>{failureDescription(errorCode)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p role="status" className="text-sm text-foreground">
            The currently signed-in account is already verified. Continue to its files, or sign out before verifying a different address.
          </p>
          <Button type="button" onClick={() => router.replace("/")}>Continue to files</Button>
          <Button type="button" variant="outline" onClick={() => void signOutToRetry()}>
            Sign out to request another link
          </Button>
          {signOutError && <p role="alert" className="text-sm text-destructive">{signOutError}</p>}
        </CardContent>
      </Card>
    );
  }

  if (kind === "missing") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No verification result</CardTitle>
          <CardDescription>Open the verification link from your email to confirm your account.</CardDescription>
        </CardHeader>
        <CardContent>
          <a className="text-sm font-medium underline underline-offset-4" href="/sign-in">
            Back to sign in
          </a>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{errorCode === "TOKEN_EXPIRED" ? "Verification link expired" : "Couldn't confirm your email"}</CardTitle>
        <CardDescription>{failureDescription(errorCode)}</CardDescription>
      </CardHeader>
      <CardContent>
        {resendRequested ? (
          <p role="status" className="text-sm text-foreground">
            If this address needs verification, a fresh link will be sent. If it is already verified, no email is needed; you can sign in.
          </p>
        ) : (
          <form onSubmit={requestAnotherLink} className="space-y-4">
            <FieldGroup>
              {!session?.user && (
                <Field>
                  <FieldLabel htmlFor="verification-email">Email</FieldLabel>
                  <Input
                    id="verification-email"
                    type="email"
                    autoComplete="email"
                    placeholder="m@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.currentTarget.value)}
                    required
                    disabled={resending}
                  />
                </Field>
              )}
              <Field>
                <Button type="submit" disabled={resending || (!session?.user && !email.trim())}>
                  {resending ? "Requesting link…" : "Request another link"}
                </Button>
                {resendError && <p role="alert" className="text-sm text-destructive">{resendError}</p>}
              </Field>
            </FieldGroup>
          </form>
        )}

        <p className="mt-4 text-sm text-muted-foreground">
          Already confirmed your email? <a className="font-medium underline underline-offset-4" href="/sign-in">Sign in</a>.
        </p>
      </CardContent>
    </Card>
  );
}
