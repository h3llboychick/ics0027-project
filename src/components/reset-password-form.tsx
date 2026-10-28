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

export function ResetPasswordForm({ token }: { token: string | null }) {
  const [resetPending, setResetPending] = useState(false);
  const [resetComplete, setResetComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!token) {
      setError("This reset link is invalid or has expired. Request a new one.");
      return;
    }

    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirm-password") ?? "");

    if (newPassword !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    setResetPending(true);

    try {
      const { error: resetError } = await authClient.resetPassword({ newPassword, token });

      if (resetError) {
        setError("This reset link is invalid or has expired. Request a new one.");
        return;
      }

      setResetComplete(true);
    } catch {
      setError("We couldn't reset your password right now. Please try again.");
    } finally {
      setResetPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>
          Choose a new password between 8 and 32 characters.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {resetComplete ? (
          <div className="space-y-4">
            <p role="status" className="text-sm text-foreground">
              Your password has been updated. Sign in with your new password.
            </p>
            <FieldDescription>
              <a href="/sign-in" className="underline underline-offset-4">Back to sign in</a>
            </FieldDescription>
          </div>
        ) : !token ? (
          <div className="space-y-4">
            <p role="alert" className="text-sm text-destructive">
              This reset link is invalid or has expired. Request a new one.
            </p>
            <FieldDescription>
              <a href="/forgot-password" className="underline underline-offset-4">Request a new reset link</a>
            </FieldDescription>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="reset-password">New password</FieldLabel>
                <Input
                  id="reset-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={32}
                  required
                  disabled={resetPending}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="reset-password-confirm">Confirm new password</FieldLabel>
                <Input
                  id="reset-password-confirm"
                  name="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={32}
                  required
                  disabled={resetPending}
                />
              </Field>
              <Field>
                <Button type="submit" disabled={resetPending}>
                  {resetPending ? "Updating password…" : "Update password"}
                </Button>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              </Field>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
