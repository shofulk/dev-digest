"use client";

import React from "react";
import { Markdown, SectionLabel } from "@devdigest/ui";
import { BriefBanner } from "./_components/BriefBanner";
import { IntentCard } from "./_components/IntentCard";
import { BlastRadiusCard } from "./_components/BlastRadiusCard";
import { RiskAreas } from "./_components/RiskAreas";
import { ReviewFocusCard } from "./_components/ReviewFocusCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
  repoFullName: string | null;
  headSha: string;
  /** Opens the Files changed tab at a cited file/line (AC-58). L1: accepted, unused. */
  onOpenFile?: (path: string, line: number | null) => void;
}

/** AC-36 order: PR Brief banner, Intent+Blast row, Review focus, Description. */
export function OverviewTab({ prId, prBody, repoFullName, headSha, onOpenFile }: OverviewTabProps) {
  return (
    <>
      <BriefBanner prId={prId} />
      <div style={s.briefRow}>
        <div style={s.briefCell}>
          <IntentCard prId={prId} riskAreas={<RiskAreas prId={prId} onOpenFile={onOpenFile} />} />
        </div>
        <div style={s.briefCell}>
          <BlastRadiusCard prId={prId} repoFullName={repoFullName} headSha={headSha} />
        </div>
      </div>
      <ReviewFocusCard prId={prId} onOpenFile={onOpenFile} />
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
