export function Logo({
  className = "h-8 w-8",
  showWordmark = false,
  inverted = false,
}: {
  className?: string;
  showWordmark?: boolean;
  /** For dark rail / brand panels */
  inverted?: boolean;
}) {
  const titleColor = inverted ? "#ffffff" : "var(--fg)";
  const accentColor = inverted ? "#67e8f9" : "var(--cyan)";
  const subColor = inverted ? "#a5b4fc" : "var(--fg-subtle)";

  return (
    <span className="inline-flex items-center gap-2.5">
      <svg
        className={className}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <defs>
          <linearGradient
            id="seGradLively"
            x1="4"
            y1="4"
            x2="44"
            y2="44"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#A78BFA" />
            <stop offset="0.45" stopColor="#7C3AED" />
            <stop offset="1" stopColor="#0891B2" />
          </linearGradient>
          <linearGradient
            id="seGradShine"
            x1="12"
            y1="8"
            x2="36"
            y2="40"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#FFFFFF" stopOpacity="0.55" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect
          x="2"
          y="2"
          width="44"
          height="44"
          rx="14"
          fill="url(#seGradLively)"
        />
        <rect
          x="3"
          y="3"
          width="42"
          height="42"
          rx="13"
          fill="url(#seGradShine)"
        />
        <circle
          cx="21.5"
          cy="21.5"
          r="8"
          stroke="white"
          strokeWidth="2.4"
          strokeOpacity="0.95"
        />
        <path
          d="M27.5 27.5L35.5 35.5"
          stroke="white"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeOpacity="0.95"
        />
        <circle cx="21.5" cy="21.5" r="2.2" fill="white" fillOpacity="0.9" />
      </svg>
      {showWordmark && (
        <span className="leading-none">
          <span
            className="block text-[14px] font-semibold tracking-tight"
            style={{ color: titleColor, fontFamily: "var(--font-display)" }}
          >
            Search
            <span style={{ color: accentColor }}>Engine</span>
          </span>
          <span
            className="mt-0.5 hidden text-[10px] font-medium tracking-wide sm:block"
            style={{ color: subColor }}
          >
            Research workspace
          </span>
        </span>
      )}
    </span>
  );
}
