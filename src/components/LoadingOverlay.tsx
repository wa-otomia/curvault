// Full-content-area overlay that locks interaction while a view loads.
// The spinner is the Curvault C-mark broken into three layers that spin at
// different speeds in opposite directions, with the center dot pulsing.
//
// Drop this at the top of any view's return JSX; pass `show={busy}` —
// while show is true the overlay covers .content, blurs it, and steals
// pointer events.

interface LoadingOverlayProps {
  show: boolean;
  label?: string;
}

export default function LoadingOverlay({ show, label }: LoadingOverlayProps) {
  if (!show) return null;
  return (
    <div className="loading-overlay" aria-busy="true" aria-live="polite">
      <div className="loading-stack">
        <svg
          className="loading-spinner"
          viewBox="0 0 120 120"
          width="84"
          height="84"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="loadGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#36c5ff" />
              <stop offset="1" stopColor="#1b4fd6" />
            </linearGradient>
          </defs>

          {/* Outer C: brand gradient, slow clockwise */}
          <g className="loading-ring-outer">
            <path
              d="M 86.87 33.13 A 38 38 0 1 0 86.87 86.87"
              fill="none"
              stroke="url(#loadGrad)"
              strokeWidth="9"
              strokeLinecap="round"
            />
          </g>

          {/* Inner C: white, faster counter-clockwise */}
          <g className="loading-ring-inner">
            <path
              d="M 76.97 43.03 A 24 24 0 1 0 76.97 76.97"
              fill="none"
              stroke="#fff"
              strokeWidth="6"
              strokeLinecap="round"
              opacity=".9"
            />
          </g>

          {/* Center dot: pulse */}
          <g className="loading-dot">
            <circle cx="60" cy="60" r="6.5" fill="#fff" />
          </g>
        </svg>

        {label && <div className="loading-label">{label}</div>}
      </div>
    </div>
  );
}
