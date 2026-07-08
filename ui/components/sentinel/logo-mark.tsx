export function SentinelMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="sm-bg" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#1c1a14" />
          <stop offset="100%" stopColor="#0A0A0A" />
        </radialGradient>
        <linearGradient id="sm-visor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFD166" />
          <stop offset="100%" stopColor="#C8961C" />
        </linearGradient>
        <linearGradient id="sm-ring" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e0ac2a" />
          <stop offset="60%" stopColor="#C8961C" />
          <stop offset="100%" stopColor="#7a5800" />
        </linearGradient>
        <filter id="sm-glow">
          <feGaussianBlur stdDeviation="1" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <circle cx="16" cy="16" r="15" fill="url(#sm-bg)" />
      <circle cx="16" cy="16" r="15" stroke="url(#sm-ring)" strokeWidth="1" fill="none" />
      <circle cx="16" cy="16" r="12.5" stroke="#C8961C" strokeWidth="0.3" fill="none" opacity="0.25" />
      <path d="M16 5 L8 9.5 L8 18 Q8 24.5 16 27 Q24 24.5 24 18 L24 9.5 Z" fill="#0d0d0d" stroke="#C8961C" strokeWidth="0.6" opacity="0.9" />
      <ellipse cx="16" cy="13.5" rx="5" ry="5.5" fill="#0A0A0A" />
      <path d="M11 13.5 Q11 8.5 16 8.5 Q21 8.5 21 13.5" fill="#111" stroke="#C8961C" strokeWidth="0.5" opacity="0.5" />
      {/* V visor */}
      <path d="M13 11.5 L16 15.5 L19 11.5" stroke="#FFD166" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.12" />
      <path d="M13 11.5 L16 15.5 L19 11.5" stroke="url(#sm-visor)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" filter="url(#sm-glow)" />
      {/* Shoulders */}
      <path d="M8 12 L11.5 10.5" stroke="#C8961C" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
      <path d="M24 12 L20.5 10.5" stroke="#C8961C" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
      {/* Chest */}
      <path d="M13 19 L13 23 Q16 24 19 23 L19 19 Q16 18 13 19Z" fill="none" stroke="#C8961C" strokeWidth="0.5" opacity="0.4" />
      <circle cx="16" cy="21" r="1" fill="#C8961C" opacity="0.6" />
      {/* Ring ticks */}
      <path d="M16 1.5 L16 3" stroke="#C8961C" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
      <path d="M16 29 L16 30.5" stroke="#C8961C" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
      <path d="M1.5 16 L3 16" stroke="#C8961C" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
      <path d="M29 16 L30.5 16" stroke="#C8961C" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}
