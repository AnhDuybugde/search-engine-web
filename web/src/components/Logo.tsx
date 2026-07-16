export function Logo({
  className = "h-10 w-10",
  showWordmark = false,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
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
          <linearGradient id="seGrad" x1="4" y1="2" x2="44" y2="46" gradientUnits="userSpaceOnUse">
            <stop stopColor="#A5B4FC" />
            <stop offset="0.5" stopColor="#818CF8" />
            <stop offset="1" stopColor="#2DD4BF" />
          </linearGradient>
          <filter id="seBlur" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect x="2" y="2" width="44" height="44" rx="14" fill="url(#seGrad)" opacity="0.16" />
        <rect
          x="2.5"
          y="2.5"
          width="43"
          height="43"
          rx="13.5"
          stroke="url(#seGrad)"
          strokeOpacity="0.45"
        />
        <circle
          cx="21"
          cy="21"
          r="9"
          stroke="url(#seGrad)"
          strokeWidth="2.4"
          filter="url(#seBlur)"
        />
        <path
          d="M27.5 27.5L35 35"
          stroke="#5EEAD4"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <path
          d="M17 21h8M21 17v8"
          stroke="#C7D2FE"
          strokeWidth="1.8"
          strokeLinecap="round"
          opacity="0.9"
        />
      </svg>
      {showWordmark && (
        <span className="leading-tight">
          <span className="block text-[15px] font-semibold tracking-tight text-white">
            Search<span className="bg-gradient-to-r from-indigo-300 to-teal-300 bg-clip-text text-transparent">Engine</span>
          </span>
          <span className="hidden text-[11px] text-[var(--fg-muted)] sm:block">
            research with citations
          </span>
        </span>
      )}
    </span>
  );
}
