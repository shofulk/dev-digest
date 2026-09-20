import React from "react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import messages from "../../messages/en/skills.json";

/** Wraps a Skills Lab component in the `skills` message namespace and a fresh QueryClient. */
export function SkillsTestProviders({ children }: { children: React.ReactNode }) {
  const [qc] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}
