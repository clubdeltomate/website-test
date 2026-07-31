import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"
import { say } from '@/lib/i18n';

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label={say("Loading")}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
