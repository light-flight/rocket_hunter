import { useEffect, useRef } from 'react'
import iconGlints from './assets/icon-glints.svg'
import palmGlints from './assets/palm-glints.svg'
import palmTiles from './assets/palm-tiles.svg'

// The material of the app, see STYLE.md: the palm of a karting glove. Glossy black tiles on a
// matte ground, and sunlight that wanders over them and picks out the tiles that face it.

// A soft spot of light. It circles the centre of its patch (radius r, f turns per loop).
type Blob = { w: number; h: number; ox: number; oy: number; r: number; f: number; ph: number }

// A patch of light: a few blobs, so its outline has no shape to recognise and keeps changing.
// The centre follows two sines per axis. All the frequencies are whole turns per loop, so the
// path closes where it began.
type Patch = {
  cx: number
  cy: number
  ax: number
  ay: number
  fx: number
  fy: number
  px: number
  py: number
  blobs: Blob[]
}

const LOOP_MS = 90_000
const STEPS = 120

// A bell curve instead of a straight ramp: the light has no edge to see.
const SPOT = `radial-gradient(ellipse closest-side, ${[0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9]
  .map((d) => `rgb(0 0 0 / ${(0.8 * Math.exp(-((d / 0.45) ** 2))).toFixed(3)}) ${d * 100}%`)
  .join(', ')}, transparent)`

// In the pixels of the palm image, 448 by 504.
const PALM_LIGHT: Patch[] = [
  {
    cx: 179, cy: 360, ax: 130, ay: 110, fx: 2, fy: 3, px: 0.4, py: 2.2,
    blobs: [
      { w: 300, h: 240, ox: -50, oy: -20, r: 45, f: 5, ph: 0.3 },
      { w: 240, h: 320, ox: 60, oy: 30, r: 55, f: 7, ph: 2.1 },
      { w: 360, h: 200, ox: 10, oy: -50, r: 40, f: 4, ph: 4.0 },
    ],
  },
  {
    cx: 289, cy: 300, ax: 150, ay: 140, fx: 3, fy: 2, px: 2.6, py: 0.9,
    blobs: [
      { w: 260, h: 260, ox: -30, oy: 20, r: 50, f: 6, ph: 1.2 },
      { w: 200, h: 300, ox: 50, oy: -30, r: 60, f: 5, ph: 3.4 },
    ],
  },
  {
    cx: 224, cy: 420, ax: 170, ay: 90, fx: 1, fy: 4, px: 4.1, py: 3.3,
    blobs: [
      { w: 420, h: 220, ox: -40, oy: 0, r: 50, f: 4, ph: 5.0 },
      { w: 260, h: 280, ox: 70, oy: 20, r: 45, f: 7, ph: 0.9 },
      { w: 300, h: 200, ox: -10, oy: 50, r: 55, f: 6, ph: 2.7 },
    ],
  },
]

// In the pixels of the icon, 116 by 116. The same sun, but seldom: the patch spends most of
// its path off the icon.
const ICON_LIGHT: Patch[] = [
  {
    cx: 58, cy: 58, ax: 150, ay: 120, fx: 2, fy: 3, px: 1.1, py: 4.0,
    blobs: [
      { w: 150, h: 120, ox: 0, oy: 0, r: 14, f: 5, ph: 0.5 },
      { w: 110, h: 160, ox: 20, oy: -10, r: 18, f: 7, ph: 2.4 },
    ],
  },
]

// Where the blobs are at the point t (0 to 1) of the loop, as a mask-position.
function positions(patches: Patch[], t: number): string {
  const turn = 2 * Math.PI
  return patches
    .flatMap((patch) =>
      patch.blobs.map((blob) => {
        const x =
          patch.cx +
          patch.ax * Math.sin(turn * patch.fx * t + patch.px) +
          0.35 * patch.ax * Math.sin(turn * (patch.fx + 3) * t + patch.py) +
          blob.ox +
          blob.r * Math.sin(turn * blob.f * t + blob.ph)
        const y =
          patch.cy +
          patch.ay * Math.sin(turn * patch.fy * t + patch.py) +
          0.35 * patch.ay * Math.sin(turn * (patch.fy + 3) * t + patch.px) +
          blob.oy +
          blob.r * Math.cos(turn * (blob.f + 1) * t + blob.ph * 1.3)
        return `${Math.round(x - blob.w / 2)}px ${Math.round(y - blob.h / 2)}px`
      }),
    )
    .join(', ')
}

type GlintsProps = { src: string; patches: Patch[]; className: string }

// An image of gloss that shows only where the light is: the mask is the light, and it moves.
function Glints({ src, patches, className }: GlintsProps) {
  const image = useRef<HTMLImageElement>(null)
  const blobs = patches.flatMap((patch) => patch.blobs)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const frames = Array.from({ length: STEPS + 1 }, (_, step) => ({
      maskPosition: positions(patches, step / STEPS),
    }))
    const animation = image.current?.animate(frames, { duration: LOOP_MS, iterations: Infinity })
    return () => animation?.cancel()
  }, [patches])

  return (
    <img
      ref={image}
      src={src}
      alt=""
      className={className}
      style={{
        maskImage: blobs.map(() => SPOT).join(', '),
        maskSize: blobs.map((blob) => `${blob.w}px ${blob.h}px`).join(', '),
        maskRepeat: 'no-repeat',
        maskPosition: positions(patches, 0),
      }}
    />
  )
}

// How far up the screen the palm reaches, and how long it takes to fade into the black.
const PALM_SIZES = {
  full: ['h-126 max-h-[60dvh]', 'h-75'],
  low: ['h-75 max-h-[40dvh]', 'h-45'],
  short: ['h-60 max-h-[30dvh]', 'h-36'],
}

// The background of a screen: the palm rises from the bottom edge out of the black. The more
// there is to read on the screen, the lower it stays. The parent must be positioned and isolated.
export function Palm({ size = 'full' }: { size?: keyof typeof PALM_SIZES }) {
  const [height, fade] = PALM_SIZES[size]
  // The image is as wide as the column of the app; a narrower screen shows its middle.
  const image = 'absolute bottom-0 left-1/2 h-126 w-112 max-w-none -translate-x-1/2'
  // On a screen wider than the column (a phone on its side) the palm fades out at the sides too.
  const side = 'absolute inset-y-0 hidden w-16 from-ground to-transparent min-[449px]:block'

  return (
    <div aria-hidden="true" className={`absolute inset-x-0 bottom-0 -z-10 overflow-hidden ${height}`}>
      {/* In the light look the tiles are pale rubber on a pale ground. Their gloss is white light,
          which would not show on them: the light look has none. */}
      <img src={palmTiles} alt="" className={`${image} light:invert light:hue-rotate-180`} />
      <Glints src={palmGlints} patches={PALM_LIGHT} className={`${image} light:hidden`} />
      <div className={`absolute inset-x-0 top-0 bg-linear-to-b from-ground from-14% to-transparent ${fade}`} />
      <div className={`${side} left-0 bg-linear-to-r`} />
      <div className={`${side} right-0 bg-linear-to-l`} />
    </div>
  )
}

// The app icon as an object on the screen: its tiles catch the same sun, and a faint pink
// glow behind gives it depth. The small one is the same icon scaled down, light and all.
function AppIcon({ small }: { small: boolean }) {
  return (
    <div className={`relative ${small ? 'size-18' : 'size-29'}`}>
      <div
        aria-hidden="true"
        className={`absolute top-1/2 left-1/2 -z-10 -translate-1/2 animate-halo rounded-full bg-radial from-brand/32 via-brand/10 via-42% to-transparent to-70% opacity-75 motion-reduce:animate-none ${
          small ? 'size-55' : 'size-[min(20rem,100vw)]'
        }`}
      />
      <div
        className={`absolute top-0 left-0 size-29 origin-top-left overflow-hidden rounded-[27px] ring-1 ring-line ${
          small ? 'scale-[0.62]' : ''
        }`}
      >
        <img src="/logo.svg" alt="" className="size-full" />
        <Glints src={iconGlints} patches={ICON_LIGHT} className="absolute inset-0 size-full" />
      </div>
    </div>
  )
}

type MastheadProps = {
  // Higher on the screen: there is a heading and a line to read under it, and the key at the
  // bottom must stay in sight on a short screen.
  raised?: boolean
  // Smaller and at the very top: there are steps to read under it.
  compact?: boolean
}

// The top of a screen that is not the app yet: the icon and the name.
export function Masthead({ raised = false, compact = false }: MastheadProps) {
  const place = compact ? 'gap-4.5 pt-4 pb-4' : `gap-7.5 pb-5 ${raised ? 'pt-[6dvh]' : 'pt-[13dvh]'}`

  return (
    <div className={`flex flex-col items-center ${place}`}>
      <AppIcon small={compact} />
      <h1
        className={`-skew-x-10 font-display tracking-wordmark uppercase ${compact ? 'text-xl/none' : 'text-wordmark'}`}
      >
        Rocket Hunter
      </h1>
    </div>
  )
}
