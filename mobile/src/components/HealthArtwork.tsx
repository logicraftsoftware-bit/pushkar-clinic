import React, { useId } from 'react';
import Svg, {
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';

// Original, scalable artwork inspired by the supplied healthcare reference.
// Shared across native screens so there are no network image dependencies.
export function HeaderArt({ home = false }: { home?: boolean }) {
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox={home ? '0 0 390 175' : '0 0 390 100'}
      preserveAspectRatio="none"
    >
      <Path d="M0 0H390V30Q290 10 183 41T0 15Z" fill="#039fd0" opacity=".18" />
      <Path d="M0 0Q65 80 111 31T246 0Z" fill="#05b9df" opacity=".23" />
      <Path
        d={
          home
            ? 'M0 136Q91 187 201 145T390 131V175H0Z'
            : 'M0 65Q110 112 224 73T390 70V100H0Z'
        }
        fill="#004f99"
        opacity=".28"
      />
      <Path
        d={
          home
            ? 'M0 144C78 186 158 153 218 146C280 133 306 184 390 133V175H0Z'
            : 'M0 82C90 111 150 89 218 85C289 79 314 105 390 77V100H0Z'
        }
        fill="#b9e9ff"
      />
      <Path
        d={
          home
            ? 'M0 153C85 183 148 160 218 150C282 139 313 186 390 145V175H0Z'
            : 'M0 89C88 112 159 94 218 91C285 85 317 110 390 86V100H0Z'
        }
        fill="#f4faff"
      />
      {home && (
        <Path
          d="M204 108H239L244 101 249 112 255 92 261 120 266 106 272 110H296"
          stroke="#0fbee2"
          strokeWidth="1.7"
          opacity=".55"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </Svg>
  );
}
export function BodyWaves() {
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox="0 0 390 760"
      preserveAspectRatio="none"
    >
      <Defs>
        <LinearGradient id="bodyGlow" x1="0" y1="0" x2="1" y2="1">
          <Stop stopColor="#e4f5ff" stopOpacity=".1" />
          <Stop offset="1" stopColor="#8bddf4" stopOpacity=".45" />
        </LinearGradient>
      </Defs>
      <Path d="M0 0H390V130Q340 41 221 52T0 25Z" fill="#d9f3ff" opacity=".5" />
      <Path
        d="M390 170Q328 153 270 227T136 336Q286 365 390 283Z"
        fill="url(#bodyGlow)"
      />
      <Path
        d="M0 535Q95 482 174 542T390 506V760H0Z"
        fill="#e1f4ff"
        opacity=".65"
      />
      <Path
        d="M0 672Q93 593 192 659T390 629V760H0Z"
        fill="#cceeff"
        opacity=".6"
      />
    </Svg>
  );
}
export function ClinicLandscape() {
  const id = 'scene' + useId().replace(/\W/g, '');
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox="0 0 390 170"
      preserveAspectRatio="none"
    >
      <Defs>
        <LinearGradient id={id + 'hill'} x2="1" y2="1">
          <Stop stopColor="#d7edff" />
          <Stop offset="1" stopColor="#a4e2f5" />
        </LinearGradient>
        <LinearGradient id={id + 'tree'} x2="1" y2="1">
          <Stop stopColor="#8ce0c3" />
          <Stop offset="1" stopColor="#23a995" />
        </LinearGradient>
        <LinearGradient id={id + 'glass'} x2="1" y2="1">
          <Stop stopColor="#9eddf5" />
          <Stop offset="1" stopColor="#2096c6" />
        </LinearGradient>
        <LinearGradient id={id + 'wall'} x2="1" y2="1">
          <Stop stopColor="#f8fdff" />
          <Stop offset="1" stopColor="#bfdfef" />
        </LinearGradient>
      </Defs>
      <Path d="M0 72Q59 29 143 73T293 72T390 17V170H0Z" fill="#e0f3ff" />
      <Path
        d="M0 116Q50 88 103 118T212 108T390 110V170H0Z"
        fill={'url(#' + id + 'hill)'}
      />
      <G opacity=".7">
        <Rect x="69" y="69" width="10" height="30" rx="3" fill="#9dd8fb" />
        <Rect x="59" y="79" width="30" height="10" rx="3" fill="#9dd8fb" />
      </G>
      <G transform="translate(216 52)">
        <Ellipse cx="57" cy="99" rx="80" ry="9" fill="#5bc0d8" opacity=".22" />
        <Path d="M0 38L63 22 113 43V100H0Z" fill={'url(#' + id + 'wall)'} />
        <Path d="M63 22L113 43V100H63Z" fill="#90c8e3" />
        <Path d="M-4 35L63 18 117 39 114 44 63 25 0 41Z" fill="#bad9ed" />
        <Path d="M21 2L61 -7 85 2V100H21Z" fill={'url(#' + id + 'wall)'} />
        <Path d="M61 -7L85 2V100H61Z" fill="#95c8df" />
        <Path d="M18 0L61 -11 89 0 86 5 61 -5 21 6Z" fill="#7fbbdb" />
        {[0, 1].map(i => (
          <G key={i}>
            <Rect
              x="4"
              y={48 + i * 22}
              width="12"
              height="15"
              fill={'url(#' + id + 'glass)'}
            />
            <Rect
              x="90"
              y={50 + i * 22}
              width="17"
              height="14"
              fill={'url(#' + id + 'glass)'}
            />
            <Rect
              x="26"
              y={42 + i * 20}
              width="29"
              height="13"
              fill={'url(#' + id + 'glass)'}
            />
          </G>
        ))}
        <Path
          d="M0 67H21M0 88H21M85 67L113 70M85 88L113 91"
          stroke="#eefbff"
          strokeWidth="3"
        />
        <Rect
          x="30"
          y="78"
          width="23"
          height="22"
          rx="1"
          fill="#55b2dc"
          stroke="#fff"
          strokeWidth="2"
        />
        <Path d="M41 80V99" stroke="#e8faff" strokeWidth="2" />
        <Rect
          x="39"
          y="10"
          width="7"
          height="22"
          rx="2"
          fill="#29a5d0"
          stroke="#fff"
          strokeWidth="1.4"
        />
        <Rect
          x="32"
          y="17"
          width="21"
          height="7"
          rx="2"
          fill="#29a5d0"
          stroke="#fff"
          strokeWidth="1.4"
        />
        <Path d="M26 102H58L64 107H20Z" fill="#b4ddec" />
      </G>
      {[
        { x: 199, y: 100, k: 1 },
        { x: 350, y: 96, k: 1.04 },
        { x: 183, y: 133, k: 0.58 },
      ].map(({ x, y, k }) => (
        <G key={x} transform={`translate(${x} ${y}) scale(${k})`}>
          <Path
            d="M-12 12C-26 6 -23 -13 -12 -17C-17 -43 15 -44 15 -20C31 -12 28 11 14 15Z"
            fill={'url(#' + id + 'tree)'}
            stroke="#7ccfb9"
            strokeWidth=".8"
          />
          <Path
            d="M1 42V-12M1 10L-9 0M1 20L11 9"
            stroke="#398e89"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
        </G>
      ))}
      {[158, 172, 185, 211, 332, 368].map((x, i) => (
        <Ellipse
          key={x}
          cx={x}
          cy={151 - (i % 2) * 4}
          rx={8 + (i % 3)}
          ry={14 + (i % 2) * 4}
          fill={i % 2 ? '#62cbbd' : '#8ad9cf'}
        />
      ))}
      <Path d="M0 159Q89 125 177 154T390 148V170H0Z" fill="#b6e7ed" />
      <Path
        d="M0 152Q62 145 132 165T267 160T390 155V170H0Z"
        fill="#8bd6e6"
        opacity=".65"
      />
      <G transform="translate(15 157)" fill="#9bd8ed">
        <Ellipse rx="5" ry="17" transform="rotate(-33)" />
        <Ellipse cx="10" cy="3" rx="5" ry="15" transform="rotate(31)" />
        <Ellipse cx="-7" cy="4" rx="4" ry="14" transform="rotate(-65)" />
      </G>
    </Svg>
  );
}
