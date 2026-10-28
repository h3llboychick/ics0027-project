import { ResetPasswordForm } from "@/components/reset-password-form";

export default async function Page({ searchParams }: PageProps<"/reset-password">) {
  const params = await searchParams;
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const validToken = params.error === undefined ? token ?? null : null;

  return <ResetPasswordForm key={validToken ?? "invalid"} token={validToken} />;
}
