import { type KeyboardEvent, type PointerEvent, useRef } from 'react'
import { LANES, lanesLabel } from './races.ts'

// How many corridors the pit lane has: three segments, each a picture of the pit seen from
// above with two karts waiting in every corridor. A thumb slides behind the one chosen. A press
// chooses the segment under the finger and sliding moves the choice along, so a gloved hand
// does not have to catch a small handle. labelledBy is the question on the screen it answers.

type LanesPickerProps = { value: number; onChange: (lanes: number) => void; labelledBy: string }

export function LanesPicker({ value, onChange, labelledBy }: LanesPickerProps) {
  // The press in progress, and the choice to go back to if a scroll takes it over.
  const press = useRef<{ pointer: number; before: number } | null>(null)

  function laneUnder(event: PointerEvent<HTMLDivElement>): number {
    const box = event.currentTarget.getBoundingClientRect()
    const segment = Math.floor(((event.clientX - box.left) / box.width) * LANES.length)
    return Math.min(LANES.length, Math.max(1, segment + 1))
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    press.current = { pointer: event.pointerId, before: value }
    event.currentTarget.setPointerCapture(event.pointerId)
    onChange(laneUnder(event))
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (press.current?.pointer !== event.pointerId) return
    const lanes = laneUnder(event)
    if (lanes !== value) onChange(lanes)
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (press.current?.pointer === event.pointerId) press.current = null
  }

  function onPointerCancel(event: PointerEvent<HTMLDivElement>) {
    if (press.current?.pointer !== event.pointerId) return
    onChange(press.current.before)
    press.current = null
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = {
      ArrowRight: value + 1,
      ArrowDown: value + 1,
      ArrowLeft: value - 1,
      ArrowUp: value - 1,
      Home: 1,
      End: LANES.length,
    }[event.key]
    if (next === undefined) return

    event.preventDefault()
    const lanes = Math.min(LANES.length, Math.max(1, next))
    onChange(lanes)
    event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[lanes - 1]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
      className="relative flex h-25 touch-pan-y rounded-lg bg-well p-1 ring-1 ring-control select-none ring-inset"
    >
      <div
        aria-hidden="true"
        className="absolute top-1 bottom-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-md bg-thumb shadow-[var(--shadow-thumb)] transition-transform duration-[260ms] ease-[cubic-bezier(0.25,0.8,0.25,1)]"
        style={{ transform: `translateX(${(value - 1) * 100}%)` }}
      />
      {LANES.map((lanes) => {
        const chosen = lanes === value
        return (
          <button
            key={lanes}
            type="button"
            role="radio"
            aria-checked={chosen}
            aria-label={lanesLabel(lanes)}
            tabIndex={chosen ? 0 : -1}
            onClick={() => onChange(lanes)}
            className="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-inset"
          >
            <Pit lanes={lanes} chosen={chosen} />
            <span
              aria-hidden="true"
              className={`text-sm transition-colors ${chosen ? 'font-semibold text-fg' : 'text-fg-3'}`}
            >
              {lanesLabel(lanes)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

const CORRIDOR = 26
const GAP = 4
const LENGTH = 60

// The pit from above: corridors side by side, two karts nose to tail in each.
function Pit({ lanes, chosen }: { lanes: number; chosen: boolean }) {
  const width = lanes * CORRIDOR + (lanes - 1) * GAP
  // The helmet is a hole through the kart: it shows whatever is under the segment.
  const helmet = chosen ? 'fill-thumb' : 'fill-well'

  return (
    <svg
      viewBox={`0 0 ${width} ${LENGTH}`}
      aria-hidden="true"
      className={`h-15 w-auto shrink-0 fill-current transition-colors ${
        chosen ? 'text-fg' : 'text-fg-off'
      }`}
    >
      {Array.from({ length: lanes }, (_, corridor) => (
        <g key={corridor} transform={`translate(${corridor * (CORRIDOR + GAP)} 0)`}>
          <rect width={CORRIDOR} height={LENGTH} fillOpacity={0.08} />
          <path
            d={`M0.75 0V${LENGTH}M${CORRIDOR - 0.75} 0V${LENGTH}`}
            className="fill-none stroke-current"
            strokeOpacity={0.5}
            strokeWidth={1.5}
          />
          <Kart x={3} y={4} helmet={helmet} />
          <Kart x={3} y={32} helmet={helmet} />
        </g>
      ))}
    </svg>
  )
}

function Kart({ x, y, helmet }: { x: number; y: number; helmet: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={0} y={3} width={4} height={6} rx={1} />
      <rect x={16} y={3} width={4} height={6} rx={1} />
      <rect x={0} y={15} width={4} height={7} rx={1} />
      <rect x={16} y={15} width={4} height={7} rx={1} />
      <rect x={5} y={0} width={10} height={24} rx={4} />
      <circle cx={10} cy={14} r={3} className={helmet} />
    </g>
  )
}
