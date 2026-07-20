export function Logo({
  className = "h-8 w-8",
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
          <linearGradient
            id="seGrad"
            x1="4"
            y1="2"
            x2="44"
            y2="46"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#A5B4FC" />
            <stop offset="0.55" stopColor="#6366F1" />
            <stop offset="1" stopColor="#2DD4BF" />
          </linearGradient>
        </defs>
        <rect
          x="2"
          y="2"
          width="44"
          height="44"
          rx="12"
          fill="url(#seGrad)"
          opacity="0.12"
        />
        <rect
          x="2.5"
          y="2.5"
          width="43"
          height="43"
          rx="11.5"
          stroke="url(#seGrad)"
          strokeOpacity="0.4"
        />
        <circle
          cx="21"
          cy="21"
          r="8.5"
          stroke="url(#seGrad)"
          strokeWidth="2.2"
        />
        <path
          d="M27.5 27.5L35 35"
          stroke="#5EEAD4"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
      {showWordmark && (
        <span className="leading-none">
          <span className="block text-[14px] font-semibold tracking-tight text-[var(--fg)]">
            Search
            <span className="text-[var(--primary)]">Engine</span>
          </span>
          <span className="mt-0.5 hidden text-[10px] font-medium tracking-wide text-[var(--fg-subtle)] sm:block">
            Dataset IR
          </span>
        </span>
      )}
    </span>
  );
}
