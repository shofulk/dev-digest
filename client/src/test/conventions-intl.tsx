import React from "react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import common from "../../messages/en/common.json";
import conventions from "../../messages/en/conventions.json";
import skills from "../../messages/en/skills.json";

/**
 * Wraps a Conventions Extractor component in a fresh QueryClient and the real `en`
 * messages. The `skills` namespace is provided too because the create-skill modal reuses
 * the Skills Lab `BodyEditor`, which translates against `skills` — without it every label
 * in that panel renders as a missing-message error. `common` carries the shared
 * "no repo selected" empty state the board falls back to for an unknown :repoId.
 */
export function ConventionsTestProviders({ children }: { children: React.ReactNode }) {
  const [qc] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ common, conventions, skills }}>
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}
