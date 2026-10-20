"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function ForgotPasswordForm() {
  const [requestPending, setRequestPending] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestPending(true);
    setRequestSent(false);
    setError(null);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();

    try {
      const { error: requestError } = await authClient.requestPasswordReset({
        email,
        redirectTo: new URL("/reset-password", window.location.origin).toString(),
      });

      if (requestError) {
        setError("We couldn't send a reset link right now. Please try again.");
        return;
      }

      setRequestSent(true);
    } catch {
      setError("We couldn't send a reset link right now. Please try again.");
    } finally {
      setRequestPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Forgot your password?</CardTitle>
        <CardDescription>
          Enter your account email and we&apos;ll send a password reset link if an account matches.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {requestSent ? (
          <div className="space-y-4">
            <p role="status" className="text-sm text-foreground">
              If an account matches that email, you&apos;ll receive a reset link. The link expires in one hour.
            </p>
            <FieldDescription>
              <a href="/sign-in" className="underline underline-offset-4">Back to sign in</a>
            </FieldDescription>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="forgot-password-email">Email</FieldLabel>
                <Input
                  id="forgot-password-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="m@example.com"
                  required
                  disabled={requestPending}
                />
              </Field>
              <Field>
                <Button type="submit" disabled={requestPending}>
                  {requestPending ? "Sending reset link…" : "Send reset link"}
                </Button>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <FieldDescription className="text-center">
                  <a href="/sign-in" className="underline underline-offset-4">Back to sign in</a>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
