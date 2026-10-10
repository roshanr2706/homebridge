// Hand-drawn-feeling illustrations, all inline SVG (no image assets, works offline and in mainland China).
import { C } from '../theme';

const S = { stroke: C.ink, strokeWidth: 2.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect x="2" y="2" width="60" height="60" rx="18" fill={C.coral} {...S} strokeWidth={3} />
      <path d="M10 45 Q32 13 54 45" fill="none" {...S} strokeWidth={4.5} />
      <path d="M9 45h46" {...S} strokeWidth={4.5} />
      <path d="M20 45v-9M32 45V29M44 45v-9" {...S} strokeWidth={3} />
      <circle cx="32" cy="22" r="4.5" fill={C.sun} {...S} strokeWidth={2.4} />
    </svg>
  );
}

/** Dad: Encik Rahman in KL. Songkok, round glasses, a proud moustache. */
export function DadAvatar({ size = 64, bg = C.grape, wave = false }: { size?: number; bg?: string; wave?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-label="Dad" role="img">
      <circle cx="50" cy="50" r="46" fill={bg} {...S} strokeWidth={3} />
      {/* shirt */}
      <path d="M18 92 Q22 72 50 70 Q78 72 82 92" fill={C.sky} {...S} />
      <path d="M42 71 L50 82 L58 71" fill="#fff" {...S} strokeWidth={2.2} />
      {/* neck + face */}
      <path d="M43 64 v8 h14 v-8" fill="#C68B59" {...S} strokeWidth={2.2} />
      <path d="M29 44 Q28 68 50 69 Q72 68 71 44 Q70 30 50 30 Q30 30 29 44Z" fill="#D69A66" {...S} />
      <path d="M28 46 q-5 1 -4 7 q1 5 6 4" fill="#D69A66" {...S} strokeWidth={2.2} />
      <path d="M72 46 q5 1 4 7 q-1 5 -6 4" fill="#D69A66" {...S} strokeWidth={2.2} />
      {/* songkok */}
      <path d="M30 36 Q30 18 50 17 Q70 18 70 36 Q50 31 30 36Z" fill={C.ink} {...S} />
      <path d="M33 30 Q50 26 67 30" fill="none" stroke={C.sun} strokeWidth={2} strokeLinecap="round" opacity={0.85} />
      {/* glasses */}
      <circle cx="41" cy="47" r="6.5" fill="#fff" fillOpacity={0.55} {...S} strokeWidth={2.2} />
      <circle cx="59" cy="47" r="6.5" fill="#fff" fillOpacity={0.55} {...S} strokeWidth={2.2} />
      <path d="M47.5 47h5" {...S} strokeWidth={2.2} />
      <circle cx="41.5" cy="47.5" r="1.8" fill={C.ink} />
      <circle cx="59.5" cy="47.5" r="1.8" fill={C.ink} />
      {/* moustache + smile */}
      <path d="M40 58 Q45 54 50 57 Q55 54 60 58 Q55 60.5 50 59 Q45 60.5 40 58Z" fill={C.ink} {...S} strokeWidth={1.6} />
      <path d="M44 62.5 Q50 66.5 56 62.5" fill="none" {...S} strokeWidth={2.2} />
      <circle cx="35" cy="56" r="3" fill={C.coral} opacity={0.35} />
      <circle cx="65" cy="56" r="3" fill={C.coral} opacity={0.35} />
      {wave && (
        <g className="hb-wave" style={{ transformOrigin: '84px 70px' }}>
          <path d="M80 72 q-2 -10 3 -14 q4 -2 5 3 l1 -6 q1 -4 4 -2 q2 2 0 9 q4 -3 5 1 q0 5 -8 11 q-6 3 -10 -2Z" fill="#D69A66" {...S} strokeWidth={2} />
        </g>
      )}
    </svg>
  );
}

/** Aisha: UBC student, hijab in sunshine yellow, big grin. */
export function AishaAvatar({ size = 40, bg = C.coral }: { size?: number; bg?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-label="Aisha" role="img">
      <circle cx="50" cy="50" r="46" fill={bg} {...S} strokeWidth={3} />
      <path d="M22 94 Q22 72 50 70 Q78 72 78 94" fill={C.mint} {...S} />
      <path d="M26 52 Q24 20 50 19 Q76 20 74 52 Q74 74 50 80 Q26 74 26 52Z" fill={C.sun} {...S} />
      <path d="M33 48 Q33 31 50 31 Q67 31 67 48 Q67 66 50 67 Q33 66 33 48Z" fill="#C98B5E" {...S} />
      <path d="M42 46 q2 -2 4 0" fill="none" {...S} strokeWidth={2.4} />
      <path d="M54 46 q2 -2 4 0" fill="none" {...S} strokeWidth={2.4} />
      <path d="M42 55 Q50 63 58 55" fill="#fff" {...S} strokeWidth={2.2} />
      <circle cx="38" cy="54" r="3" fill={C.coral} opacity={0.4} />
      <circle cx="62" cy="54" r="3" fill={C.coral} opacity={0.4} />
    </svg>
  );
}

export function ShieldArt({ size = 64, tone = 'ok' }: { size?: number; tone?: 'ok' | 'bad' | 'meh' }) {
  const fill = tone === 'bad' ? C.tomato : tone === 'meh' ? C.sun : C.mint;
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" aria-hidden>
      <path d="M40 8 L66 18 Q67 48 40 72 Q13 48 14 18Z" fill={fill} {...S} strokeWidth={3} />
      <path d="M40 15 L60 23 Q60 46 40 64" fill="none" stroke="#fff" strokeOpacity={0.45} strokeWidth={4} strokeLinecap="round" />
      {tone === 'bad' ? (
        <path d="M31 31 L49 49 M49 31 L31 49" {...S} strokeWidth={5} />
      ) : tone === 'meh' ? (
        <path d="M40 28 v14 M40 50 v0.5" {...S} strokeWidth={5} />
      ) : (
        <path d="M29 40 L37 48 L52 31" fill="none" {...S} strokeWidth={5} />
      )}
      <path d="M70 8 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2Z" fill={C.sun} {...S} strokeWidth={1.6} />
      <circle cx="10" cy="62" r="3" fill={C.sky} {...S} strokeWidth={1.6} />
    </svg>
  );
}

export function GradCap({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <path d="M6 24 L32 13 L58 24 L32 35Z" fill={C.ink} {...S} />
      <path d="M17 29 v11 Q32 49 47 40 V29 L32 35Z" fill={C.grape} {...S} />
      <path d="M54 26 v14" {...S} />
      <circle cx="54" cy="43" r="3.5" fill={C.sun} {...S} strokeWidth={2} />
    </svg>
  );
}

export function Flame({ size = 36, lit = true }: { size?: number; lit?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path d="M24 4 Q34 16 34 24 Q38 20 37 15 Q44 24 42 32 Q39 44 24 44 Q9 44 7 32 Q6 22 15 14 Q15 22 19 24 Q17 12 24 4Z" fill={lit ? C.coral : C.inkSoft} {...S} />
      <path d="M24 24 Q31 31 29 37 Q27 41 24 41 Q19 41 18.5 36 Q18 31 24 24Z" fill={lit ? C.sun : '#E4E2EB'} {...S} strokeWidth={2} />
    </svg>
  );
}

export function Hourglass({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path d="M11 5 h26 M11 43 h26" {...S} strokeWidth={3.2} />
      <path d="M14 6 Q14 18 24 24 Q34 18 34 6Z" fill={C.skySoft} {...S} />
      <path d="M14 42 Q14 30 24 24 Q34 30 34 42Z" fill={C.skySoft} {...S} />
      <path d="M17 41 Q20 33 24 32 Q28 33 31 41Z" fill={C.sun} {...S} strokeWidth={1.8} />
      <path d="M24 25 v6" stroke={C.sun} strokeWidth={2.2} strokeLinecap="round" />
    </svg>
  );
}

export function ChatBuddy({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.8} viewBox="0 0 150 120" aria-hidden>
      <path d="M18 20 Q18 8 32 8 H104 Q118 8 118 20 V62 Q118 74 104 74 H56 L36 92 L40 74 H32 Q18 74 18 62Z" fill={C.coral} {...S} strokeWidth={3} />
      <circle cx="52" cy="40" r="5" fill={C.ink} />
      <circle cx="84" cy="40" r="5" fill={C.ink} />
      <path d="M58 54 Q68 63 78 54" fill="none" {...S} strokeWidth={3.4} />
      <path d="M96 60 Q96 52 106 52 H134 Q142 52 142 60 V82 Q142 90 134 90 H130 L132 102 L118 90 H106 Q96 90 96 82Z" fill={C.sun} {...S} strokeWidth={3} />
      <path d="M108 66 h22 M108 76 h14" {...S} strokeWidth={3} />
      <path d="M130 14 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2Z" fill={C.mint} {...S} strokeWidth={1.6} />
      <circle cx="10" cy="96" r="4" fill={C.grape} {...S} strokeWidth={1.8} />
    </svg>
  );
}

export function LockArt({ size = 40, locked }: { size?: number; locked: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path d={locked ? 'M15 22 V15 Q15 6 24 6 Q33 6 33 15 V22' : 'M15 22 V15 Q15 6 24 6 Q32 6 33 13'} fill="none" {...S} strokeWidth={3.4} />
      <rect x="9" y="21" width="30" height="22" rx="7" fill={locked ? C.tomato : C.mint} {...S} strokeWidth={2.8} />
      <circle cx="24" cy="31" r="3" fill={C.ink} />
      <path d="M24 33 v4" {...S} strokeWidth={2.6} />
    </svg>
  );
}

const CONFETTI = [C.coral, C.sun, C.mint, C.grape, C.sky];

/** Celebration burst. Pure CSS animation; respects reduced motion via the stylesheet. */
export function Confetti({ count = 36 }: { count?: number }) {
  return (
    <div className="hb-confetti" aria-hidden>
      {Array.from({ length: count }, (_, i) => {
        const left = (i * 37) % 100;
        const delay = (i % 9) * 0.07;
        const dur = 1.6 + ((i * 13) % 10) / 10;
        const rot = (i * 47) % 360;
        const round = i % 3 === 0;
        return (
          <span
            key={i}
            style={{
              left: `${left}%`,
              background: CONFETTI[i % CONFETTI.length],
              animationDelay: `${delay}s`,
              animationDuration: `${dur}s`,
              transform: `rotate(${rot}deg)`,
              borderRadius: round ? '50%' : 3,
              width: round ? 10 : 8,
              height: round ? 10 : 14,
            }}
          />
        );
      })}
    </div>
  );
}

export function BigCheck({ size = 96, color = C.mint }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className="hb-pop">
      <path d="M50 6 Q62 4 70 12 Q82 12 86 24 Q96 32 92 46 Q98 58 88 68 Q88 82 74 86 Q66 96 52 92 Q38 98 30 88 Q16 86 14 72 Q4 62 10 50 Q4 36 16 28 Q18 14 32 12 Q40 4 50 6Z" fill={color} {...S} strokeWidth={3.2} />
      <path d="M32 51 L45 64 L69 37" fill="none" {...S} strokeWidth={7} />
    </svg>
  );
}

export function Squiggle({ color = C.coral, width = 120 }: { color?: string; width?: number }) {
  return (
    <svg width={width} height={12} viewBox="0 0 120 12" aria-hidden style={{ display: 'block' }}>
      <path d="M2 7 Q12 1 22 7 T42 7 T62 7 T82 7 T102 7 T122 7" fill="none" stroke={color} strokeWidth={3.2} strokeLinecap="round" />
    </svg>
  );
}
