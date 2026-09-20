/* StatTile — one headline number with an uppercase label and a one-line caption naming what
   the number is attributed to. `aside` carries an optional gauge (the accept-rate ring). */
import React from "react";
import { Card } from "@devdigest/ui";
import { s } from "./styles";

export function StatTile({
  label,
  value,
  caption,
  aside,
}: {
  label: string;
  value: string;
  caption: string;
  aside?: React.ReactNode;
}) {
  return (
    <Card style={s.card}>
      <div style={s.label}>{label}</div>
      <div style={s.main}>
        <div className="tnum" style={s.value}>
          {value}
        </div>
        {aside}
      </div>
      <div style={s.caption}>{caption}</div>
    </Card>
  );
}
