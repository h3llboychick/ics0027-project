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

export function SignupForm({ ...props }: React.ComponentProps<typeof Card>) {
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const form = new FormData(event.currentTarget)
    const name = String(form.get("name"))
    const email = String(form.get("email"))
    const password = String(form.get("password"))
    const confirmPassword = String(form.get("confirm-password"))

    if (password !== confirmPassword) {
      const id = toast.add({
          type: "error",
          title: "Passwords doesn't match",
          description: "Please, ensure that the string entered in password and confrim password fields match",
          actionProps: { 
            children: "Undo",
            onClick() {
              toast.close(id) // allows to close toast notification
            },
          }
      })
      return;
    }
    try {
      const { error } = await authClient.signUp.email({
        name,
        email,
        password,
        callbackURL: "/email-confirmed"
      })

      if (error) {
        console.error(error);
        const id = toast.add({
          type: "error",
          title: "Error occured",
          description: `${error.message}`,
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
          description: "Please, try again later",
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
        title: "Account has been created",
        description: "Please, check your email.",
        actionProps: { 
          children: "Undo",
          onClick() {
            toast.close(id) // allows to close toast notification
          },
        }
    })
  }
  
  return (
    <Card {...props}>
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>
          Enter your information below to create your account
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="name">Full Name</FieldLabel>
              <Input id="name" name="name" type="text" placeholder="John Doe" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="m@example.com"
                required
              />
              <FieldDescription>
                We&apos;ll use this to contact you. We will not share your email
                with anyone else.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input id="password" name="password" type="password" required />
              <FieldDescription>
                Must be at least 8 characters long.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="confirm-password">
                Confirm Password
              </FieldLabel>
              <Input id="confirm-password" name="confirm-password" type="password" required />
              <FieldDescription>Please confirm your password.</FieldDescription>
            </Field>
            <FieldGroup>
              <Field>
                <Button type="submit">Sign Up</Button>
                <FieldDescription className="px-6 text-center">
                  Already have an account? <a href="/sign-in">Sign in</a>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
