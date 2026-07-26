import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";
import { getAuthHeaders } from "@/lib/auth";

export const trpc = createTRPCReact<AppRouter>();

const apiOrigin =
  import.meta.env.VITE_TRPC_ORIGIN?.trim() || "";
const trpcUrl = `${apiOrigin}/api/trpc`;

const queryClient = new QueryClient();
const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: trpcUrl,
      transformer: superjson,
      headers() {
        // attaches `Authorization: Bearer <jwt>` when signed in (src/lib/auth)
        return getAuthHeaders();
      },
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

export function TRPCProvider({ children }: { children: ReactNode }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
