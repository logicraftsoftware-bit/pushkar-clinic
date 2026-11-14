import React, { useId } from 'react';
import Svg, {
  Circle,
  Ellipse,
  Path,
  Rect,
  G,
  Defs,
  LinearGradient,
  Stop,
} from 'react-native-svg';
// Local illustrations keep the prototype offline; replace branding here later.
export function Avatar({
  size = 56,
  female = false,
  doctor = false,
}: {
  size?: number;
  female?: boolean;
  doctor?: boolean;
}) {
  const id = 'avatar' + useId().replace(/\W/g, '');
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id={id + 'bg'} x2="1" y2="1">
          <Stop stopColor="#ebf9ff" />
          <Stop offset="1" stopColor="#c8e9fb" />
        </LinearGradient>
        <LinearGradient id={id + 'skin'} x2="1" y2="1">
          <Stop stopColor="#ffdbbc" />
          <Stop offset="1" stopColor="#f3b88d" />
        </LinearGradient>
        <LinearGradient id={id + 'shirt'} x2="1" y2="1">
          <Stop
            stopColor={doctor ? '#ffffff' : female ? '#e3c5ee' : '#a9e3fa'}
          />
          <Stop
            offset="1"
            stopColor={doctor ? '#e9f3fb' : female ? '#bd91d3' : '#65bce6'}
          />
        </LinearGradient>
      </Defs>
      <Circle
        cx="50"
        cy="50"
        r="49"
        fill={'url(#' + id + 'bg)'}
        stroke="#effaff"
        strokeWidth="1.5"
      />
      <Path
        d={
          female
            ? 'M25 65V35C25 5 75 5 75 35V73Z'
            : 'M29 40V30C29 9 71 9 71 32V43Z'
        }
        fill="#16283c"
      />
      <Path
        d="M12 100V86Q15 65 40 65H60Q85 65 88 86V100Z"
        fill={'url(#' + id + 'shirt)'}
      />
      <Path d="M43 56H57V70L50 78 43 70Z" fill="#edb58f" />
      <Ellipse cx="31" cy="44" rx="3.8" ry="6" fill="#f1b58b" />
      <Ellipse cx="69" cy="44" rx="3.8" ry="6" fill="#f1b58b" />
      <Ellipse cx="50" cy="42" rx="19" ry="24" fill={'url(#' + id + 'skin)'} />
      <Ellipse cx="39" cy="50" rx="4" ry="2" fill="#eea68e" opacity=".3" />
      <Ellipse cx="61" cy="50" rx="4" ry="2" fill="#eea68e" opacity=".3" />
      <Path d="M49 45L47 49H51" fill="none" stroke="#d69678" strokeWidth=".8" />
      <Path
        d="M30 36Q28 13 49 15Q73 13 71 37L62 24Q48 32 35 26Z"
        fill="#172b40"
      />
      <Path
        d="M38 36Q42 34 46 36M54 36Q58 34 62 36"
        stroke="#23394d"
        strokeWidth="1.3"
        fill="none"
        strokeLinecap="round"
      />
      <Circle cx="43" cy="42" r="1.5" fill="#172b40" />
      <Circle cx="57" cy="42" r="1.5" fill="#172b40" />
      <Path
        d="M45 54Q50 58 56 53"
        fill="none"
        stroke="#a65e49"
        strokeWidth="1.5"
      />
      {doctor && (
        <G>
          <Path
            d="M39 69L30 96M61 69L70 96M39 69L50 82 61 69M50 82V100"
            stroke="#a5bdd1"
            strokeWidth="2"
            fill="none"
          />
          <Path
            d="M35 73V84Q35 94 45 91M65 73V87"
            stroke="#075592"
            strokeWidth="2.5"
            fill="none"
          />
          <Circle cx="65" cy="88" r="4" fill="#1685c7" />
          {!female && (
            <G stroke="#24445d" strokeWidth="1.7" fill="none">
              <Rect x="34" y="36" width="13" height="12" rx="4" />
              <Rect x="53" y="36" width="13" height="12" rx="4" />
              <Path d="M47 40H53" />
            </G>
          )}
        </G>
      )}
    </Svg>
  );
}
export function ClinicArt({
  width = 112,
  height = 100,
}: {
  width?: number | '100%';
  height?: number;
}) {
  return (
    <Svg
      width={width}
      height={height}
      viewBox="0 0 360 210"
      preserveAspectRatio="xMidYMid slice"
    >
      <Defs>
        <LinearGradient id="sky" x2="0" y2="1">
          <Stop stopColor="#94d1f1" />
          <Stop offset="1" stopColor="#e5f4fb" />
        </LinearGradient>
      </Defs>
      <Rect width="360" height="210" fill="url(#sky)" />
      <Ellipse cx="75" cy="45" rx="58" ry="15" fill="#fff" opacity=".6" />
      <Path d="M32 184V65L159 24 314 64V185Z" fill="#f4f6f7" />
      <Path d="M159 24L314 64V185H159Z" fill="#d2dce4" />
      <Path d="M40 67L151 33V168H40Z" fill="#80b7d3" />
      {[0, 1, 2, 3].map(i => (
        <G key={i}>
          <Path
            d={`M${46 + i * 26} ${69 - i * 8}V168`}
            stroke="#f0f5f9"
            strokeWidth="8"
          />
          <Rect x={176 + i * 30} y="77" width="18" height="82" fill="#4183a8" />
        </G>
      ))}
      <Path
        d="M40 102L151 78M40 137L151 123M166 110H302M166 142H302"
        stroke="#eef4f7"
        strokeWidth="5"
      />
      <Rect x="131" y="155" width="68" height="37" fill="#153d5d" />
      <Rect x="154" y="160" width="22" height="32" fill="#79bed9" />
      <Rect x="233" y="43" width="13" height="34" rx="2" fill="#087db9" />
      <Rect x="223" y="53" width="33" height="13" rx="2" fill="#087db9" />
      <Path d="M0 192Q80 163 123 193T360 184V210H0Z" fill="#5c8c52" />
      <Path d="M126 210L151 186H182L216 210Z" fill="#d1d7dc" />
      <Circle cx="25" cy="151" r="28" fill="#467c49" />
      <Circle cx="335" cy="153" r="33" fill="#467c49" />
    </Svg>
  );
}
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Svg
      width={compact ? 28 : 76}
      height={compact ? 28 : 70}
      viewBox="0 0 80 72"
    >
      <Defs>
        <LinearGradient id="brand" x2="1" y2="1">
          <Stop stopColor="#21a8dd" />
          <Stop offset="1" stopColor="#084a88" />
        </LinearGradient>
      </Defs>
      <Rect x="29" y="4" width="22" height="58" rx="5" fill="url(#brand)" />
      <Rect x="9" y="24" width="62" height="22" rx="5" fill="url(#brand)" />
      <Path d="M30 61Q38 27 76 21Q68 56 30 61Z" fill="#fff" />
      <Path d="M34 58Q46 34 72 25Q59 53 34 58Z" fill="#075592" />
    </Svg>
  );
}
