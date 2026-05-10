import { useEffect, useRef, useState } from "react";
import { riskCategory } from "../fireEngine";

interface Props {
  score: number;
  previousScore?: number | null;
}

export function RiskGauge({ score, previousScore }: Props) {
  const [displayedScore, setDisplayedScore] = useState(score);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    if (animRef.current !== null) {
      clearInterval(animRef.current);
      animRef.current = null;
    }

    if (previousScore != null && previousScore > score) {
      setDisplayedScore(previousScore);
      animRef.current = window.setInterval(() => {
        setDisplayedScore((cur) => {
          const next = cur - 1.2;
          if (next <= score) {
            if (animRef.current !== null) {
              clearInterval(animRef.current);
              animRef.current = null;
            }
            return score;
          }
          return next;
        });
      }, 80);
    } else {
      setDisplayedScore(score);
    }

    return () => {
      if (animRef.current !== null) {
        clearInterval(animRef.current);
        animRef.current = null;
      }
    };
  }, [score, previousScore]);

  const rounded = Math.round(displayedScore);
  const cat = riskCategory(rounded);
  const angle = -180 + (rounded / 100) * 180;

  const cx = 110,
    cy = 110,
    r = 85,
    sw = 18;

  const arc = (start: number, end: number) => {
    const sx = cx + r * Math.cos((start * Math.PI) / 180);
    const sy = cy + r * Math.sin((start * Math.PI) / 180);
    const ex = cx + r * Math.cos((end * Math.PI) / 180);
    const ey = cy + r * Math.sin((end * Math.PI) / 180);
    return `M ${sx} ${sy} A ${r} ${r} 0 ${
      end - start > 180 ? 1 : 0
    } 1 ${ex} ${ey}`;
  };

  const needleX = cx + (r - 5) * Math.cos((angle * Math.PI) / 180);
  const needleY = cy + (r - 5) * Math.sin((angle * Math.PI) / 180);

  const animDone = animRef.current === null;
  const showDelta =
    previousScore != null && previousScore !== score && animDone;
  const delta = showDelta ? score - (previousScore as number) : 0;

  return (
    <div style={{ textAlign: "center" }}>
      <svg viewBox="0 0 220 140" width="100%" style={{ maxWidth: 280 }}>
        {/* Green — LOW (0–25) */}
        <path
          d={arc(180, 225)}
          stroke="#3fb950"
          strokeWidth={sw}
          fill="none"
          strokeLinecap="round"
        />
        {/* Yellow — MODERATE (25–50) */}
        <path d={arc(225, 270)} stroke="#e3b341" strokeWidth={sw} fill="none" />
        {/* Orange — HIGH (50–75) */}
        <path
          d={arc(315, 360)}
          stroke="#f85149"
          strokeWidth={sw}
          fill="none"
          strokeLinecap="round"
        />
        <path
          d={arc(270, 315)}
          stroke="#e8822a"
          strokeWidth={sw}
          fill="none"
          strokeLinecap="butt"
        />
        <line
          x1={cx}
          y1={cy}
          x2={needleX}
          y2={needleY}
          stroke="#e8edf2"
          strokeWidth={3}
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={6} fill="#e8edf2" />
      </svg>

      <div style={{ marginTop: -10 }}>
        <div
          style={{
            fontSize: 42,
            fontWeight: 700,
            lineHeight: 1,
            color: cat.color,
          }}
        >
          {rounded}
        </div>
        <div
          style={{
            fontSize: 13,
            letterSpacing: 2,
            color: cat.color,
            fontWeight: 600,
            marginTop: 4,
          }}
        >
          {cat.label}
        </div>
        {showDelta && (
          <div
            style={{
              marginTop: 8,
              fontSize: 13,
              color: delta < 0 ? "#3fb950" : "#f85149",
              fontWeight: 600,
            }}
          >
            {delta > 0 ? "+" : ""}
            {delta} since last burn
          </div>
        )}
      </div>
    </div>
  );
}
