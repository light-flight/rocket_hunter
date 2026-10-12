import { type FormEvent, type ReactNode, useId, useRef, useState } from 'react'
import { type Final, FIRST, LIMITS, type Progress, clock, isFinal, progressOf } from './final.ts'
import { useNow } from './now.ts'
import type { PitMove } from './pitlane.ts'
import { Sheet, type SheetHandle } from './Sheet.tsx'
import { MainAction, TextField } from './ui.tsx'
import { plural } from './words.ts'

// The final going on, above the corridors of the pit screen. Before the start: what the final is like,
// a tap to set it up, and «Старт» for the moment it starts. Then, to the second: when the pit lane
// closes, how many of the stops every pilot must make are made, and with lights in the corridors how
// long the corridors need for the stops left against how long the window has, and how long till the
// queue under the red is bound to come. After the window: till the finish. After the finish: the next
// final. The sums are in final.ts.

type FinalPanelProps = {
  final: Final | null
  // The moves that stand, and the corridors of the pit lane.
  moves: PitMove[]
  lanes: number
  onSave: (final: Final) => void
}

export function FinalPanel({ final, moves, lanes, onSave }: FinalPanelProps) {
  // The sheet open on the final as it is, or on the next one, which has the pilots to type in.
  const [editing, setEditing] = useState<'this' | 'next' | null>(null)
  const now = useNow()
  const progress = final ? progressOf(final, moves, lanes, now) : null

  return (
    <section aria-label="Финал" data-testid="final" className="mt-1 mb-3 flex flex-col gap-1.5">
      {final === null || progress === null ? (
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-fg-3">Задайте финал, чтобы видеть окно пит-стопов</p>
          <FinalKey onClick={() => setEditing('next')}>Настроить финал</FinalKey>
        </div>
      ) : progress.kind === 'waiting' ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setEditing('this')}
            className="min-w-0 flex-1 text-left text-sm text-fg-2 active:opacity-70"
          >
            <Caption>Финал</Caption>
            <span className="block">{summary(final)}</span>
          </button>
          <FinalKey onClick={() => onSave({ ...final, start: Date.now() })}>Старт</FinalKey>
        </div>
      ) : progress.kind === 'open' ? (
        <Open final={final} progress={progress} onEdit={() => setEditing('this')} />
      ) : progress.kind === 'closed' ? (
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-body text-fg-2">
            Пит закрыт · до финиша <span className="tabular-nums">{clock(progress.endsIn)}</span>
          </p>
          <Stops done={progress.done} needed={progress.needed} small />
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-body text-fg-2">
            Финал окончен · смены{' '}
            <span className="tabular-nums">
              {progress.done}/{progress.needed}
            </span>
          </p>
          <FinalKey onClick={() => setEditing('next')}>Следующий финал</FinalKey>
        </div>
      )}

      {editing && (
        <FinalSheet
          final={final}
          next={editing === 'next'}
          onSave={(saved) => onSave(saved)}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}

type OpenProps = { final: Final; progress: Extract<Progress, { kind: 'open' }>; onEdit: () => void }

// The window open: the clock, the stops, and with lights the bar of the corridors' time against the
// window's.
function Open({ final, progress, onEdit }: OpenProps) {
  const { closesIn, done, needed, left, busy, spare, alarm } = progress
  const warn = alarm !== 'calm'

  return (
    <>
      <button type="button" onClick={onEdit} className="flex items-end justify-between gap-3 text-left active:opacity-70">
        <span>
          <Caption>Пит закроется через</Caption>
          <span className="block text-[1.75rem] leading-8 font-bold tabular-nums" data-testid="closes-in">
            {clock(closesIn)}
          </span>
        </span>
        <Stops done={done} needed={needed} />
      </button>
      {busy !== null && (
        <div
          role="img"
          aria-label={`Коридорам нужно ${clock(busy)} из ${clock(closesIn)}`}
          className="h-1.5 overflow-hidden rounded-full bg-well ring-1 ring-control ring-inset"
        >
          <div
            className={`h-full rounded-full ${warn ? 'bg-warn' : 'bg-fg-2'}`}
            style={{ width: `${Math.min(1, busy / Math.max(1, closesIn)) * 100}%` }}
          />
        </div>
      )}
      <p data-testid="final-advice" className={`text-sm tabular-nums ${warn ? 'font-semibold text-warn' : 'text-fg-3'}`}>
        {advice(final, left, needed, busy, spare, alarm)}
      </p>
    </>
  )
}

// What the line under the clock says: what is left, and whether to hurry.
function advice(
  final: Final,
  left: number,
  needed: number,
  busy: number | null,
  spare: number | null,
  alarm: 'calm' | 'soon' | 'late',
): string {
  if (needed === 0) return 'Обязательных смен нет'
  if (left === 0) return 'Все обязательные смены сделаны'
  const stops = `${left} ${plural(left, 'смена', 'смены', 'смен')}`
  if (!final.lights || busy === null || spare === null) {
    return alarm === 'soon' ? `Пора менять · осталось ${stops}` : `Осталось ${stops}`
  }
  if (alarm === 'late') return `Без очереди не успеть · последнему стоять ≥ ${clock(-spare)}`
  if (alarm === 'soon') return `Пора менять · запас ${clock(spare)}`
  return `Осталось ${stops} ≈ ${clock(busy)} · запас ${clock(spare)}`
}

// What a final is like, in a line: «12 пилотов · 25 мин · пит закрывается за 5 мин · 1 смена · светофор 40 с».
function summary(final: Final): string {
  return [
    `${final.pilots} ${plural(final.pilots, 'пилот', 'пилота', 'пилотов')}`,
    `${final.minutes} мин`,
    final.closes === 0 ? 'пит до финиша' : `пит закрывается за ${final.closes} мин`,
    `${final.stops} ${plural(final.stops, 'смена', 'смены', 'смен')}`,
    final.lights ? `светофор ${final.change} с` : 'без светофора',
  ].join(' · ')
}

function Caption({ children }: { children: ReactNode }) {
  return <span className="block text-xs tracking-[0.08em] text-fg-3 uppercase">{children}</span>
}

function Stops({ done, needed, small = false }: { done: number; needed: number; small?: boolean }) {
  return (
    <span className="shrink-0 text-right" data-testid="final-stops">
      {!small && <Caption>Смены</Caption>}
      <span className={`block tabular-nums ${small ? 'text-body text-fg-2' : 'text-[1.75rem] leading-8 font-bold'}`}>
        {small && 'смены '}
        {done}/{needed}
      </span>
    </span>
  )
}

function FinalKey({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 shrink-0 items-center justify-center rounded-lg bg-control px-4 text-body font-semibold ring-1 ring-line ring-inset active:opacity-70"
    >
      {children}
    </button>
  )
}

type FinalSheetProps = {
  final: Final | null
  // The next final: the pilots are typed in again, the rest is as the last one had it, and it has not
  // started. Else the final as it is, its start kept.
  next: boolean
  onSave: (final: Final) => void
  onClose: () => void
}

type Field = 'pilots' | 'stops' | 'minutes' | 'closes' | 'change'

// The final set up: how many pilots, the stops each must make, how long it goes, when the pit lane
// closes, and the lights. Whole numbers only, in the ranges the server keeps.
function FinalSheet({ final, next, onSave, onClose }: FinalSheetProps) {
  const sheet = useRef<SheetHandle>(null)
  const first = useRef<HTMLInputElement>(null)
  const base = final ?? { ...FIRST, pilots: 0, start: null }
  const [text, setText] = useState<Record<Field, string>>({
    pilots: next ? '' : String(base.pilots),
    stops: String(base.stops),
    minutes: String(base.minutes),
    closes: String(base.closes),
    change: String(base.change),
  })
  const [lights, setLights] = useState(base.lights)
  const [wrong, setWrong] = useState<string | null>(null)

  function field(name: Field, label: string) {
    return (
      <TextField
        ref={name === 'pilots' ? first : undefined}
        label={label}
        value={text[name]}
        onChange={(event) => {
          setText({ ...text, [name]: event.target.value })
          setWrong(null)
        }}
        inputMode="numeric"
        enterKeyHint="next"
        autoComplete="off"
        aria-invalid={wrong !== null}
      />
    )
  }

  function save(event: FormEvent) {
    event.preventDefault()
    const number = (name: Field) => (/^\d{1,4}$/.test(text[name].trim()) ? Number(text[name].trim()) : NaN)
    const change = number('change')
    const saved = {
      pilots: number('pilots'),
      stops: number('stops'),
      minutes: number('minutes'),
      closes: number('closes'),
      lights,
      // With no lights the time of a change is out of sight: a wrong one typed before keeps the last.
      change: lights || (change >= LIMITS.change[0] && change <= LIMITS.change[1]) ? change : base.change,
      start: next ? null : base.start,
    }
    const problem = problemOf(saved)
    if (problem) return setWrong(problem)
    if (!isFinal(saved)) return setWrong('Проверьте числа')
    sheet.current?.close()
    onSave(saved)
  }

  return (
    // A final to set up opens with the keyboard for the pilots.
    <Sheet ref={sheet} label="Финал" focus={next ? first : undefined} onClose={onClose}>
      {/* Selectable again: Safari carries the screen's no-select into the fields, and a field that
          cannot be selected takes no typing. */}
      <form onSubmit={save} className="flex flex-col gap-4 select-text [-webkit-touch-callout:default]">
        <div className="grid grid-cols-2 items-end gap-x-3 gap-y-4">
          {field('pilots', 'Пилотов')}
          {field('stops', 'Обязательных смен')}
          {field('minutes', 'Длится, мин')}
          {field('closes', 'Пит закрывается, мин до конца')}
        </div>
        <div className="grid grid-cols-2 items-end gap-x-3">
          <Lights value={lights} onChange={setLights} />
          {lights && field('change', 'Смена, с')}
        </div>
        {wrong && (
          <p role="alert" className="text-sm text-warn">
            {wrong}
          </p>
        )}
        <MainAction submit secondary>
          Сохранить
        </MainAction>
      </form>
    </Sheet>
  )
}

// What is wrong with the numbers typed, in words, or null.
function problemOf(final: Omit<Final, 'start'>): string | null {
  const out = (key: keyof typeof LIMITS) =>
    !Number.isInteger(final[key]) || final[key] < LIMITS[key][0] || final[key] > LIMITS[key][1]
  if (out('pilots')) return `Пилотов — от ${LIMITS.pilots[0]} до ${LIMITS.pilots[1]}`
  if (out('stops')) return `Обязательных смен — от ${LIMITS.stops[0]} до ${LIMITS.stops[1]}`
  if (out('minutes')) return `Финал длится от ${LIMITS.minutes[0]} до ${LIMITS.minutes[1]} минут`
  if (out('closes') || final.closes >= final.minutes) return 'Пит должен закрываться раньше конца финала'
  if (out('change')) return `Смена — от ${LIMITS.change[0]} до ${LIMITS.change[1]} секунд`
  return null
}

// Whether the corridors have lights: no or yes, a thumb behind the one chosen, as the corridors are chosen.
function Lights({ value, onChange }: { value: boolean; onChange: (lights: boolean) => void }) {
  const label = useId()

  return (
    <div className="flex flex-col gap-2">
      <span id={label} className="text-sm text-fg-3">
        Светофор
      </span>
      <div role="radiogroup" aria-labelledby={label} className="flex h-14 rounded-lg bg-well p-1 ring-1 ring-control ring-inset">
        {[false, true].map((lights) => (
          <button
            key={String(lights)}
            type="button"
            role="radio"
            aria-checked={value === lights}
            onClick={() => onChange(lights)}
            className={`flex-1 rounded-md text-body ${
              value === lights ? 'bg-thumb font-semibold text-fg shadow-[var(--shadow-thumb)]' : 'text-fg-3'
            }`}
          >
            {lights ? 'Есть' : 'Нет'}
          </button>
        ))}
      </div>
    </div>
  )
}
