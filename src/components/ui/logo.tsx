import { LockKeyhole } from "lucide-react";

export function Logo() {
    return <a href="/" className="flex items-center gap-3" aria-label="File safe home">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-[#000] text-white">
        <LockKeyhole className="size-5" aria-hidden="true" />
        </span>
    </a>
}