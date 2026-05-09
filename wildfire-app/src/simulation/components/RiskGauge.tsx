<<<<<<< Updated upstream
import { riskCategory } from '../fireEngine';
=======
import { riskCategory } from "../fireEngine";
>>>>>>> Stashed changes

interface Props {
  score: number;
  previousScore?: number | null;
}

export function RiskGauge({ score, previousScore }: Props) {
  const cat = riskCategory(score);
<<<<<<< Updated upstream
  const angle = -90 + (score / 100) * 180;
=======
  const angle = -180 + (score / 100) * 180;
>>>>>>> Stashed changes

  const cx = 110;
  const cy = 110;
  const r = 85;
  const strokeWidth = 18;

  const arc = (start: number, end: number) => {
    const sx = cx + r * Math.cos((start * Math.PI) / 180);
    const sy = cy + r * Math.sin((start * Math.PI) / 180);
    const ex = cx + r * Math.cos((end * Math.PI) / 180);
    const ey = cy + r * Math.sin((end * Math.PI) / 180);
    const large = end - start > 180 ? 1 : 0;
    return `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`;
  };

  const needleX = cx + (r - 5) * Math.cos((angle * Math.PI) / 180);
  const needleY = cy + (r - 5) * Math.sin((angle * Math.PI) / 180);

<<<<<<< Updated upstream
  const showDelta =
    previousScore != null && previousScore !== score;
  const delta = showDelta ? score - (previousScore as number) : 0;

  return (
    <div style={{ textAlign: 'center' }}>
      <svg viewBox="0 0 220 140" width="100%" style={{ maxWidth: 280 }}>
        <path d={arc(180, 225)} stroke="#3fb950" strokeWidth={strokeWidth} fill="none" strokeLinecap="round" />
        <path d={arc(225, 270)} stroke="#d29922" strokeWidth={strokeWidth} fill="none" />
        <path d={arc(270, 315)} stroke="#f85149" strokeWidth={strokeWidth} fill="none" />
        <path d={arc(315, 360)} stroke="#a371f7" strokeWidth={strokeWidth} fill="none" strokeLinecap="round" />
=======
  const showDelta = previousScore != null && previousScore !== score;
  const delta = showDelta ? score - (previousScore as number) : 0;

  return (
    <div style={{ textAlign: "center" }}>
      <svg viewBox="0 0 220 140" width="100%" style={{ maxWidth: 280 }}>
        <path
          d={arc(180, 225)}
          stroke="#3fb950"
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
        />
        <path
          d={arc(225, 270)}
          stroke="#d29922"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <path
          d={arc(315, 360)}
          stroke="#a371f7"
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
        />
        <path
          d={arc(270, 315)}
          stroke="#f85149"
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="butt"
        />
>>>>>>> Stashed changes

        <line
          x1={cx}
          y1={cy}
          x2={needleX}
          y2={needleY}
          stroke="#e8edf2"
          strokeWidth={3}
          strokeLinecap="round"
<<<<<<< Updated upstream
          style={{ transition: 'all 0.6s ease' }}
=======
          style={{ transition: "all 0.6s ease" }}
>>>>>>> Stashed changes
        />
        <circle cx={cx} cy={cy} r={6} fill="#e8edf2" />
      </svg>

      <div style={{ marginTop: -10 }}>
<<<<<<< Updated upstream
        <div style={{ fontSize: 42, fontWeight: 700, lineHeight: 1, color: cat.color }}>
          {score}
        </div>
        <div style={{ fontSize: 13, letterSpacing: 2, color: cat.color, fontWeight: 600, marginTop: 4 }}>
=======
        <div
          style={{
            fontSize: 42,
            fontWeight: 700,
            lineHeight: 1,
            color: cat.color,
          }}
        >
          {score}
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
>>>>>>> Stashed changes
          {cat.label}
        </div>
        {showDelta && (
          <div
            style={{
              marginTop: 8,
              fontSize: 13,
<<<<<<< Updated upstream
              color: delta < 0 ? '#3fb950' : '#f85149',
              fontWeight: 600,
            }}
          >
            {delta > 0 ? '+' : ''}
=======
              color: delta < 0 ? "#3fb950" : "#f85149",
              fontWeight: 600,
            }}
          >
            {delta > 0 ? "+" : ""}
>>>>>>> Stashed changes
            {delta} since last burn
          </div>
        )}
      </div>
    </div>
  );
}
