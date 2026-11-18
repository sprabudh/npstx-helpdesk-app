/** The artifact's icon set, drawn from the same path data. */
const ICONS: Record<string, string[]> = {
  home: ['M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z'], user: ['c12,8,4', 'M4 21c0-4 4-6 8-6s8 2 8 6'], clock: ['c12,12,9', 'M12 7v5l3 2'],
  cal: ['r3,5,18,16', 'M3 10h18M8 3v4M16 3v4'], wallet: ['r3,6,18,14', 'M16 14h2M3 10h18'], book: ['M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2.5z', 'M8 7h8'],
  target: ['c12,12,9', 'c12,12,5', 'c12,12,1'], help: ['c12,12,9', 'c12,12,4', 'M5.6 5.6l3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6'],
  gear: ['c12,12,3', 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1'], plus: ['M12 5v14M5 12h14'], search: ['c11,11,7', 'M20 20l-4-4'],
  bell: ['M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z', 'M10 21a2 2 0 0 0 4 0'], flag: ['M5 21V4h12l-2.5 4.5L17 13H5'], lock: ['r5,11,14,10', 'M8 11V7a4 4 0 0 1 8 0v4'],
  clip: ['M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7'], x: ['M6 6l12 12M18 6L6 18'], back: ['M15 18l-6-6 6-6'], up: ['M12 19V5M5 12l7-7 7 7'],
  at: ['c12,12,4', 'M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1'], eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', 'c12,12,3'], check: ['M5 12l5 5 9-10'],
  file: ['M6 2h9l5 5v15H6z', 'M14 2v6h6'], users: ['c9,8,3.5', 'M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5', 'M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2.4.5 4 2.3 4 5.5'],
  refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7'], down: ['M12 4v12M6 10l6 6 6-6M4 20h16'], chev: ['M6 9l6 6 6-6'], reopen: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5'],
  cloud: ['M7 18h10a4 4 0 0 0 .6-8 6 6 0 0 0-11.4 1.5A3.3 3.3 0 0 0 7 18z'], cap: ['M2 9l10-5 10 5-10 5z', 'M6 11v5c3 2 9 2 12 0v-5'], hr: ['c12,7,3.5', 'M5 20c0-4 3-6 7-6s7 2 7 6'],
  info: ['c12,12,9', 'M12 11v6M12 7.5v.5'], laptop: ['r4,5,16,11', 'M2 20h20'], building: ['r5,3,14,18', 'M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M11 21v-3h2v3'],
  mic: ['M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z', 'M5 11a7 7 0 0 0 14 0', 'M12 18v3'], send: ['M4 12l16-8-6 16-2-7z'], stop: ['r7,7,10,10'],
  spark: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z'], chart: ['M4 20V10M10 20V4M16 20v-7M22 20H2'],
};
export function Icon({ n, s = 16 }: { n: string; s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {(ICONS[n] || []).map((d, i) => {
        if (d[0] === 'c') {
          const [a, b, r] = d.slice(1).split(',');
          return <circle key={i} cx={a} cy={b} r={r} />;
        }
        if (d[0] === 'r') {
          const [x, y, w, h] = d.slice(1).split(',');
          return <rect key={i} x={x} y={y} width={w} height={h} rx="2" />;
        }
        return <path key={i} d={d} />;
      })}
    </svg>
  );
}
