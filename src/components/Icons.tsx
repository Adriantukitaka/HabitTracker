type P = { size?: number; color?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const Check = ({ size = 18, color = 'currentColor' }: P) => (
  <svg {...base(size)} stroke={color} strokeWidth={2.4}>
    <path d="M5 12l5 5L20 7" />
  </svg>
);

export const Plus = ({ size = 16, color = 'currentColor' }: P) => (
  <svg {...base(size)} stroke={color} strokeWidth={2.2}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const ChevronRight = ({ size = 20, color = 'currentColor' }: P) => (
  <svg {...base(size)} stroke={color} strokeWidth={2}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export const ChevronLeft = ({ size = 20, color = 'currentColor' }: P) => (
  <svg {...base(size)} stroke={color} strokeWidth={2}>
    <path d="M15 6l-6 6 6 6" />
  </svg>
);

export const ChevronDown = ({ size = 18, color = 'currentColor' }: P) => (
  <svg {...base(size)} stroke={color} strokeWidth={2}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const Calendar = ({ size = 22, color = 'currentColor' }: P) => (
  <svg {...base(size)} stroke={color} strokeWidth={1.9}>
    <rect x="4" y="5" width="16" height="15" rx="2" />
    <path d="M8 3v4M16 3v4M4 10h16" />
  </svg>
);

export const Grid = ({ size = 22, color = 'currentColor' }: P) => (
  <svg {...base(size)} stroke={color} strokeWidth={1.9}>
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <rect x="14" y="14" width="6" height="6" rx="1" />
  </svg>
);

export const Bell = ({ size = 22, color = 'currentColor' }: P) => (
  <svg {...base(size)} stroke={color} strokeWidth={1.9}>
    <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

export const Trend = ({ size = 16, color = 'currentColor' }: P) => (
  <svg {...base(size)} stroke={color} strokeWidth={2}>
    <path d="M4 19l5-6 4 3 7-9" />
  </svg>
);

export const Trash = ({ size = 18, color = 'currentColor' }: P) => (
  <svg {...base(size)} stroke={color} strokeWidth={2}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
);

export const Clock = ({ size = 18, color = 'currentColor' }: P) => (
  <svg {...base(size)} stroke={color} strokeWidth={2}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const Warn = ({ size = 18, color = 'currentColor' }: P) => (
  <svg {...base(size)} stroke={color} strokeWidth={2}>
    <path d="M12 3l9.5 17h-19z" />
    <path d="M12 10v4" />
    <path d="M12 17.5v.01" />
  </svg>
);
