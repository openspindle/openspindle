import { useId } from "react"

/** Purpose-drawn diagrams: bed coordinates, never a collision or clearance simulation. */
export function CalibrationIllustration({
  kind,
}: {
  kind: "anchor" | "diameter"
}) {
  const id = useId()
  const anchor = kind === "anchor"
  return (
    <svg
      viewBox="0 0 540 260"
      role="img"
      aria-labelledby={id}
      className="w-full"
    >
      <title id={id}>
        {anchor
          ? "Top view of the bracket and the probe starting outside its inner corner"
          : "Top view of a known-width boss with left and right X contacts"}
      </title>
      <rect x="15" y="15" width="510" height="230" rx="8" fill="var(--muted)" />
      {anchor ? (
        <>
          <path
            d="M80 45 H150 V160 H370 V215 H80 Z"
            fill="var(--muted-foreground)"
          />
          <path
            d="M150 55 V160 H360"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="3"
          />
          <circle cx="150" cy="160" r="5" fill="var(--primary)" />
          <circle
            cx="120"
            cy="190"
            r="9"
            fill="var(--background)"
            stroke="var(--foreground)"
            strokeWidth="2"
          />
          <path
            d="M120 175 V130 H165 M135 190 H195 V150"
            fill="none"
            stroke="var(--foreground)"
            strokeDasharray="5 4"
          />
          <text x="195" y="100" fill="var(--foreground)">
            Clear pocket
          </text>
          <text x="170" y="145" fill="var(--foreground)">
            Anchor: inner corner
          </text>
          <text x="185" y="225" fill="var(--foreground)">
            Start over solid bracket top
          </text>
          <text x="24" y="35" fill="var(--foreground)">
            Top view · back +Y ↑ · right +X →
          </text>
          <path d="M450 75 V112" stroke="var(--foreground)" strokeWidth="3" />
          <circle
            cx="450"
            cy="118"
            r="6"
            fill="none"
            stroke="var(--foreground)"
            strokeWidth="2"
          />
          <rect
            x="420"
            y="158"
            width="75"
            height="15"
            fill="var(--muted-foreground)"
          />
          <path
            d="M470 125 V156 M465 125 H475 M465 156 H475"
            stroke="var(--primary)"
            strokeWidth="2"
          />
          <text x="405" y="64" fill="var(--foreground)">
            Side view
          </text>
          <text x="480" y="143" fill="var(--foreground)">
            ~5 mm
          </text>
          <text x="410" y="196" fill="var(--foreground)">
            Above top
          </text>
        </>
      ) : (
        <>
          <rect
            x="205"
            y="60"
            width="130"
            height="130"
            fill="var(--muted-foreground)"
          />
          <circle
            cx="190"
            cy="120"
            r="12"
            fill="var(--background)"
            stroke="var(--foreground)"
            strokeWidth="2"
          />
          <circle
            cx="350"
            cy="120"
            r="12"
            fill="var(--background)"
            stroke="var(--foreground)"
            strokeWidth="2"
          />
          <path
            d="M190 120 H350 M205 205 H335 M205 198 V212 M335 198 V212"
            stroke="var(--primary)"
            strokeWidth="2"
          />
          <text x="35" y="105" fill="var(--foreground)">
            Left: 2 touches
          </text>
          <text x="355" y="105" fill="var(--foreground)">
            Right: 2 touches
          </text>
          <text x="198" y="232" fill="var(--foreground)">
            Known width along X
          </text>
          <text x="28" y="35" fill="var(--foreground)">
            Move the reference away from the bed edges
          </text>
          <text x="235" y="110" fill="var(--background)">
            Start
          </text>
          <text x="242" y="137" fill="var(--background)">
            over
          </text>
          <text x="235" y="160" fill="var(--background)">
            center
          </text>
        </>
      )}
    </svg>
  )
}
