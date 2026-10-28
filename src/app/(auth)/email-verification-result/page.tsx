import { EmailVerificationResult } from "@/components/email-verification-result";

export default async function Page({ searchParams }: PageProps<"/email-verification-result">) {
  const params = await searchParams;
  const from = Array.isArray(params.from) ? params.from[0] : params.from;
  const error = Array.isArray(params.error) ? params.error[0] : params.error;

  return <EmailVerificationResult fromEmail={from === "email"} verificationError={error ?? null} />;
}
