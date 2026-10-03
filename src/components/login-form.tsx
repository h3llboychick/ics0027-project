import { cn } from "cn"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { toast } from "./ui/toast"
import { authClient } from "@/lib/auth-client"

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const form = new FormData(event.currentTarget)
    const email = String(form.get("email"))
    const password = String(form.get("password"))

    try {
      const { error } = await authClient.signIn.email({
        email,
        password,
        callbackURL: "/dashboard"
      })

      if (error) {
        let title = "Unable to sign in"
        let description = "Please try again later."

        switch (error.code) {
          case "INVALID_EMAIL_OR_PASSWORD":
            title = "Invalid email or password"
            description = "Check your credentials and try again."
            break
          case "EMAIL_NOT_VERIFIED":
            title = "Verify your email"
            description = "Check your inbox for the verification link before signing in."
            break
          case "INVALID_EMAIL":
            title = "Invalid email address"
            description = "Enter a valid email address and try again."
            break
          case "EMAIL_PASSWORD_DISABLED":
          case "FAILED_TO_CREATE_SESSION":
            title = "Sign in is unavailable"
            break
          default:
            if (error.status === 429) {
              title = "Too many attempts"
              description = "Please wait a moment before trying again."
            }
            else {
              title = "Unexpected error"
              description = "Please try again later"
            }
        }

        const id = toast.add({
          type: "error",
          title,
          description,
          actionProps: { 
            children: "Undo",
            onClick() {
              toast.close(id) // allows to close toast notification
            },
          }
        })
        return;
      }
    } catch (e) {
      console.log("unexpected error occured", e);
      const id = toast.add({
          type: "error",
          title: "Unexpected error",
          description: "Please try again later",
          actionProps: { 
            children: "Undo",
            onClick() {
              toast.close(id) // allows to close toast notification
            },
          }
      })
      return;
    }

    const id = toast.add({
        type: "success",
        title: "You have successfully logged in",
        actionProps: { 
          children: "Undo",
          onClick() {
            toast.close(id) // allows to close toast notification
          },
        }
    })
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle>Login to your account</CardTitle>
          <CardDescription>
            Enter your email below to login to your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  name="email"
                  placeholder="m@example.com"
                  required
                />
              </Field>
              <Field>
                <div className="flex items-center">
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <a
                    href="#"
                    className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                  >
                    Forgot your password?
                  </a>
                </div>
                <Input id="password" type="password" name="password" required />
              </Field>
              <Field>
                <Button type="submit">Login</Button>
                <FieldDescription className="text-center">
                  Don&apos;t have an account? <a href="/sign-up">Sign up</a>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
