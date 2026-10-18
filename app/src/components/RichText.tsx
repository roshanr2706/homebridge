// Minimal markdown for assistant replies: paragraphs, bullet / numbered lists and **bold**.
// LLM replies often use these; the offline engine returns plain text. Nothing here renders HTML.
import { Text, View } from 'react-native';

import { fontWeightOf, useFontSet, useTheme } from '../theme';

function Inline({ text, color }: { text: string; color: string }) {
  const fonts = useFontSet();
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <Text key={i} style={{ fontFamily: fonts.bodyBold, fontWeight: fontWeightOf(fonts.bodyBold), color }}>
            {p.slice(2, -2)}
          </Text>
        ) : (
          <Text key={i}>{p}</Text>
        ),
      )}
    </>
  );
}

export function RichText({ text, color, size = 15 }: { text: string; color?: string; size?: number }) {
  const t = useTheme();
  const fonts = useFontSet();
  const c = color ?? t.text;
  const blocks = text.replace(/\r/g, '').split('\n');
  const base = { fontFamily: fonts.body, fontWeight: fontWeightOf(fonts.body), color: c, fontSize: size, lineHeight: size * 1.45 };
  return (
    <View style={{ gap: 4 }}>
      {blocks.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        const heading = trimmed.match(/^#{1,4}\s+(.*)/);
        if (heading)
          return (
            <Text key={i} style={[base, { fontFamily: fonts.bodyBold, fontWeight: fontWeightOf(fonts.bodyBold) }]}>
              <Inline text={heading[1]} color={c} />
            </Text>
          );
        const bullet = trimmed.match(/^([-*•]|\d+[.)])\s+(.*)/);
        if (bullet)
          return (
            <View key={i} style={{ flexDirection: 'row', gap: 8, paddingLeft: 2 }}>
              <Text style={[base, { color: t.muted, minWidth: 14 }]}>{/\d/.test(bullet[1]) ? bullet[1] : '•'}</Text>
              <Text style={[base, { flex: 1 }]}>
                <Inline text={bullet[2]} color={c} />
              </Text>
            </View>
          );
        return (
          <Text key={i} style={base}>
            <Inline text={trimmed} color={c} />
          </Text>
        );
      })}
    </View>
  );
}
