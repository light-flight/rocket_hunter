import { useState } from 'react'
import {
  choosePalette,
  DEFAULT_PALETTE,
  KNOWN_EDGE,
  paceColour,
  usePalette,
  type Palette,
} from './palette.ts'
import { Sheet } from './Sheet.tsx'
import { Pipette } from './ui.tsx'

const STEPS = [
  { step: 0, label: 'Быстрый' },
  { step: 1, label: 'Средний' },
  { step: 2, label: 'Медленный' },
] as const

// Seven steps of the scale. The first, the middle and the last are the anchors, and the places
// where a colour is chosen.
const PREVIEW = [0, 1 / 6, 1 / 3, 0.5, 2 / 3, 5 / 6, 1]
const ANCHOR = [0, 3, 6]

// Analogous sets: three neighbouring hues, in order, about as far apart as the traffic lights.
// The mix between two stops stays on that same stretch of the wheel. Purple is only the fast end
// of the default set: in racing it is the quickest, never the slowest.
const PRESETS: { name: string; palette: Palette }[] = [
  { name: 'По умолчанию', palette: DEFAULT_PALETTE },
  { name: 'Светофор', palette: ['#00c853', '#ffd600', '#ff1744'] },
  { name: 'Зелень', palette: ['#c6ff00', '#00e676', '#00acc1'] },
  { name: 'Лайм', palette: ['#76ff03', '#ffd600', '#ff6d00'] },
  { name: 'Тёплые', palette: ['#ffea00', '#ff9100', '#ff1744'] },
  { name: 'Холодные', palette: ['#2979ff', '#00e5ff', '#00c853'] },
]

const BUTTON =
  'h-14 rounded-lg bg-control text-body font-semibold ring-1 ring-line ring-inset outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-inset active:opacity-70'

// The colours of the karts, in the manager's menu: a key that opens the sheet where they are chosen.
export function PaletteSettings() {
  const palette = usePalette()
  const [open, setOpen] = useState(false)

  return (
    <div className="pb-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={`flex w-full items-center justify-between gap-3 px-4 ${BUTTON}`}
      >
        Палитра
        <span aria-hidden="true" className="flex shrink-0 items-center gap-1">
          {STEPS.map(({ step }) => (
            <span
              key={step}
              className={`size-5 rounded-md ${KNOWN_EDGE}`}
              style={{ background: palette[step] }}
            />
          ))}
        </span>
      </button>
      {open && <PaletteSheet onClose={() => setOpen(false)} />}
    </div>
  )
}

function PaletteSheet({ onClose }: { onClose: () => void }) {
  const palette = usePalette()

  function apply(step: 0 | 1 | 2, colour: string) {
    const next: Palette = [palette[0], palette[1], palette[2]]
    next[step] = colour
    choosePalette(next)
  }

  return (
    <Sheet label="Палитра" onClose={onClose}>
      <div className="flex flex-col gap-6">
        <h2 className="text-name font-semibold">Палитра</h2>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-fg-3">Быстрые слева, медленные справа</p>
          <div className="grid grid-cols-7 gap-1">
            {PREVIEW.map((pace, index) => {
              const colour = paceColour(pace, palette)
              const anchor = ANCHOR.indexOf(index)
              if (anchor === -1) {
                return (
                  <span
                    key={pace}
                    aria-hidden="true"
                    className={`block aspect-square rounded-md ${KNOWN_EDGE}`}
                    style={{ background: colour }}
                  />
                )
              }
              const { step, label } = STEPS[anchor]
              return (
                <label
                  key={pace}
                  className={`relative block aspect-square rounded-md outline-none focus-within:ring-2 focus-within:ring-fg ${KNOWN_EDGE}`}
                  style={{ background: colour }}
                >
                  <input
                    type="color"
                    value={palette[step]}
                    aria-label={`${label}: выбрать цвет`}
                    onChange={(event) => apply(step, event.target.value)}
                    className="absolute inset-0 size-full cursor-pointer opacity-0"
                  />
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="flex size-6 items-center justify-center rounded-full bg-black/50 text-white shadow-[0_0_0_1px_rgb(255_255_255/0.7)]">
                      <Pipette />
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-fg-3">Готовые палитры</p>
          {PRESETS.map((preset) => {
            const chosen = preset.palette.every((colour, index) => colour === palette[index])
            return (
              <button
                key={preset.name}
                type="button"
                aria-pressed={chosen}
                onClick={() => choosePalette(preset.palette)}
                className={`flex h-12 items-center justify-between gap-3 rounded-lg px-3 ring-1 ring-line ring-inset outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-inset ${
                  chosen ? 'bg-thumb font-semibold text-fg shadow-[var(--shadow-thumb)]' : 'text-fg-2 active:opacity-70'
                }`}
              >
                {preset.name}
                <span
                  aria-hidden="true"
                  className={`h-6 w-16 shrink-0 rounded-md ${KNOWN_EDGE}`}
                  style={{
                    background: `linear-gradient(90deg, ${preset.palette[0]}, ${preset.palette[1]}, ${preset.palette[2]})`,
                  }}
                />
              </button>
            )
          })}
        </div>
      </div>
    </Sheet>
  )
}
