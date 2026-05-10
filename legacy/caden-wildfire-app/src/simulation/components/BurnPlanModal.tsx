import { useEffect, useState } from "react";
import type { BurnPlan } from "../burnPlan";
import { burnPlanToText } from "../burnPlan";

interface Props {
  plan: BurnPlan;
  onClose: () => void;
}

const STATUS_COLOR: Record<string, string> = {
  DERIVED: "#3fb950",
  TBD: "#e3b341",
  REVIEW: "#1f6feb",
};

export function BurnPlanModal({ plan, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(burnPlanToText(plan));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — user can still read the plan on screen.
    }
  };

  const handleDownload = () => {
    const blob = new Blob([burnPlanToText(plan)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `burn-plan-${plan.title
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(5, 7, 9, 0.7)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(900px, 100%)",
          maxHeight: "90vh",
          background: "#0b0f14",
          border: "1px solid #1f2630",
          borderRadius: 14,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            padding: "18px 22px",
            borderBottom: "1px solid #1f2630",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 11,
                letterSpacing: 2,
                color: "#8b949e",
                marginBottom: 4,
              }}
            >
              NWCG PMS 484 — INTERAGENCY PRESCRIBED FIRE BURN PLAN
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#e8edf2" }}>
              {plan.title}
            </div>
          </div>
          <button
            onClick={handleCopy}
            style={btnStyle("#21262d", "#e8edf2")}
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
          <button
            onClick={handleDownload}
            style={btnStyle("#21262d", "#e8edf2")}
          >
            Download .txt
          </button>
          <button onClick={onClose} style={btnStyle("#1f6feb", "white")}>
            Close
          </button>
        </header>
        <div
          style={{
            padding: "12px 22px",
            background: "#3d2a14",
            borderBottom: "1px solid #5a3c1d",
            color: "#e8c389",
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          <strong>NOT AN APPROVED PLAN.</strong> Generated from current sim
          state as a planning template. A real burn plan requires a qualified
          RXB1/RXB2 burn boss, agency line-officer signature, NEPA/CEQA
          documentation, state smoke-management clearance, and complexity
          analysis (PMS 424-1).
        </div>
        <main
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {plan.elements.map((el) => (
            <article
              key={el.number}
              style={{
                background: "#0e141b",
                border: "1px solid #1f2630",
                borderRadius: 10,
                padding: "12px 16px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "#6e7681",
                    fontWeight: 700,
                    width: 24,
                  }}
                >
                  {el.number}.
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#cdd9e8",
                    flex: 1,
                  }}
                >
                  {el.title}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 1,
                    padding: "3px 8px",
                    borderRadius: 4,
                    background: `${STATUS_COLOR[el.status]}22`,
                    color: STATUS_COLOR[el.status],
                    border: `1px solid ${STATUS_COLOR[el.status]}55`,
                  }}
                >
                  {el.status}
                </div>
              </div>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: 12,
                  color: "#8b949e",
                  lineHeight: 1.5,
                }}
              >
                {el.body}
              </pre>
            </article>
          ))}
        </main>
      </div>
    </div>
  );
}

function btnStyle(bg: string, color: string): React.CSSProperties {
  return {
    background: bg,
    color,
    border: "1px solid #30363d",
    padding: "8px 14px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  };
}
