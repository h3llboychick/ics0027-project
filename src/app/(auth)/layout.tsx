import { Logo } from "@/components/ui/logo"

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-5 py-10 font-sans text-foreground sm:px-8 sm:py-14">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <main>{children}</main>
      </div>
    </div>
  )
}
