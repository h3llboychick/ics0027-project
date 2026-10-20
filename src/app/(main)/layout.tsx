import { Header } from "@/components/header"

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen px-5 py-10 font-sans text-foreground sm:px-8 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <Header />
        <main>{children}</main>
      </div>
    </div>
  )
}
