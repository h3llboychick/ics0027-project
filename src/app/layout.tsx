import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/toast"
import { connection } from 'next/server';

const geist = Geist({subsets:['latin'],variable:'--font-sans'});


export default async function RootLayout({ children }: LayoutProps<"/">) {
  // A CSP nonce must be applied during rendering, never reused from static HTML.
  await connection();
  return (
    <html
      lang="en" className={cn("font-sans", geist.variable)}
    >
      <body>
          {children}
      </body>
      <Toaster />
    </html>
  );
}
