"use client";

import React from "react";
import { Markdown, SectionLabel } from "@devdigest/ui";
import { IntentCard } from "./_components/IntentCard";
import { BlastRadiusCard } from "./_components/BlastRadiusCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
  repoFullName: string | null;
  headSha: string;
}

export function OverviewTab({ prId, prBody, repoFullName, headSha }: OverviewTabProps) {
  return (
    <>
      <div style={s.briefRow}>
        <div style={s.briefCell}>
          <IntentCard prId={prId} />
        </div>
        <div style={s.briefCell}>
          <BlastRadiusCard prId={prId} repoFullName={repoFullName} headSha={headSha} />
        </div>
      </div>
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>
            <Markdown>{prBody}</Markdown>
          </div>
        </section>
      )}
    </>
  );
}
