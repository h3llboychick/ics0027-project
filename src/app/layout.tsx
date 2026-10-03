import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/toast"

const geist = Geist({subsets:['latin'],variable:'--font-sans'});


export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en" className={cn("font-sans", geist.variable)}
    >
      <body>{children}</body>
      <Toaster />
    </html>
  );
}
