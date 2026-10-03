import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import type { Kart, Race } from './db.ts'
import { kartOf, paceOf, replay, standing, teamNumber, teams } from './pitlane.ts'
import { paceColour, recordMove, redoMove, syncPits, undoMove, usePitLog } from './pits.ts'
import { ArrowUp, Plus, Redo, TextField, Undo } from './ui.tsx'

// The pit screen. A team's number is always on the track: a team that comes in joins the end of
// a corridor, its driver gets into the kart at the front, and the number is moved onto it. So the
// corridors at the top hold karts, each named by the team that left it there, or ? for a spare
// nobody has taken yet. Below are all the teams, each on the kart it took last; a team that comes
// in is dragged into its corridor. Colour tells a kart's pace: purple the fastest, grey the
// middle, brown the slowest. A kart nobody knows the pace of has no colour and a dashed edge.

type PitsProps = { race: Race; karts: Kart[]; onQualification: () => void; onSignedOut: () => void }

type Drag = { team: string; pointer: number; x: number; y: number; width: number; height: number; over: number }
type Menu = { lane: number; x: number; y: number }

// How long a press on a corridor takes to open its menu, and how far the finger may wander.
const PRESS_MS = 500
const PRESS_SLOP = 10
// How often the moves made on the other phones are asked for while the pits are on screen.
const POLL_MS = 10_000

// A kart of a known pace has its colour and a thin light edge: dark ones would melt into the
// ground otherwise. One nobody knows the pace of has the fill of a control and a dashed edge, and
// a ? when the tile shows a number. The ? is drawn by CSS, so the tile's text stays the number. It
// hangs on the tile's corner, ringed in the colour behind it, so it stays clear of the number
// however low a corridor squeezes its karts.
const KNOWN = 'ring-1 ring-white/8 ring-inset'
const UNKNOWN = 'bg-control outline-1 -outline-offset-1 outline-dashed outline-fg-off'
const QUESTION =
  `${UNKNOWN} after:absolute after:-top-1.5 after:-right-1.5 after:flex after:size-4 after:items-center ` +
  'after:justify-center after:rounded-full after:bg-line after:text-[0.6875rem]/none after:font-bold ' +
  "after:text-fg-2 after:ring-2 after:content-['?']"
const UNKNOWN_KART = `${QUESTION} after:ring-lane`
const UNKNOWN_TEAM = `${QUESTION} after:ring-ground`

function fill(pace: number | undefined): string | undefined {
  return pace === undefined ? undefined : paceColour(pace)
}

export function Pits({ race, karts, onQualification, onSignedOut }: PitsProps) {
  const log = usePitLog(race.id)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [other, setOther] = useState(false)
  const lanes = useRef<(HTMLDivElement | null)[]>([])
  const press = useRef<{ pointer: number; x: number; y: number; timer: number } | null>(null)
  // The finger that opened the menu is still down: lifting it must not count as a tap outside.
  const held = useRef(false)

  useEffect(() => {
    if (!menu) return
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setMenu(null)
    const lifted = () => window.setTimeout(() => (held.current = false))
    held.current = true
    window.addEventListener('keydown', close)
    window.addEventListener('pointerup', lifted, { once: true })
    return () => {
      window.removeEventListener('keydown', close)
      window.removeEventListener('pointerup', lifted)
    }
  }, [menu])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void syncPits(onSignedOut)
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [onSignedOut])

  // A press still held when the screen goes away must not open a menu.
  useEffect(
    () => () => {
      if (press.current) window.clearTimeout(press.current.timer)
    },
    [],
  )

  if (log === undefined) return null
  if (log === null) {
    return (
      <p role="alert" className="mt-6 text-center text-sm text-amber-400">
        Не удалось прочитать пит-стопы на телефоне.
      </p>
    )
  }

  const moves = standing(log)
  const pitlane = replay(moves)
  const pace = new Map(karts.map((kart) => [kart.kart, kart.pace]))
  const all = teams(karts.map((kart) => kart.kart), moves)
  // The pace of the kart a team is on the track with.
  const riding = (team: string) => paceOf(kartOf(pitlane.riding, team), pace)
  // Every team in sight at once, and the key for another number after them: more tiles, more
  // columns and lower tiles.
  const tiles = all.length + 1
  const columns = tiles <= 15 ? 5 : tiles <= 24 ? 6 : 7
  const tile = { 5: 'h-15.5 text-[1.875rem]', 6: 'h-13 text-[1.625rem]', 7: 'h-11.5 text-[1.375rem]' }[columns]

  function laneAt(x: number, y: number): number {
    return lanes.current.findIndex((lane) => {
      const box = lane?.getBoundingClientRect()
      return box !== undefined && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
    })
  }

  // Kept on the phone first, then sent to the server when there is a network.
  async function change(write: () => Promise<void>) {
    await write()
    void syncPits(onSignedOut)
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>, team: string) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const box = event.currentTarget.getBoundingClientRect()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({
      team,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: box.width,
      height: box.height,
      over: -1,
    })
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    if (drag?.pointer !== event.pointerId) return
    setDrag({ ...drag, x: event.clientX, y: event.clientY, over: laneAt(event.clientX, event.clientY) })
  }

  async function endDrag(event: PointerEvent<HTMLButtonElement>) {
    if (drag?.pointer !== event.pointerId) return
    const lane = laneAt(event.clientX, event.clientY)
    setDrag(null)
    if (lane >= 0) await change(() => recordMove(race.id, { lane, kart: drag.team }))
  }

  function startPress(event: PointerEvent<HTMLDivElement>, lane: number) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    cancelPress()
    const { clientX: x, clientY: y } = event
    const timer = window.setTimeout(() => {
      press.current = null
      navigator.vibrate?.(10)
      setMenu({ lane, x, y })
    }, PRESS_MS)
    press.current = { pointer: event.pointerId, x, y, timer }
  }

  function movePress(event: PointerEvent<HTMLDivElement>) {
    const start = press.current
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > PRESS_SLOP) cancelPress()
  }

  function cancelPress() {
    if (press.current) window.clearTimeout(press.current.timer)
    press.current = null
  }

  async function addUnknown() {
    if (!menu) return
    setMenu(null)
    await change(() => recordMove(race.id, { lane: menu.lane, kart: null }))
  }

  return (
    <div className="flex flex-1 flex-col select-none [-webkit-touch-callout:none]">
      <div aria-hidden="true" className="mt-3 flex items-center justify-center gap-1.5 text-xs tracking-[0.08em] text-fg-3 uppercase">
        <ArrowUp />
        трасса
      </div>

      <div
        className={`mt-2 grid min-h-50 flex-1 basis-0 gap-6 ${race.lanes === 1 ? 'w-45 self-center' : ''}`}
        // The corridors take what the karts below leave them, and their karts get lower to fit.
        style={{ gridTemplateColumns: `repeat(${race.lanes}, minmax(0, 1fr))`, gridTemplateRows: 'minmax(0, 1fr)' }}
      >
        {/* The corridors the race has no more keep their karts, out of sight. */}
        {pitlane.corridors.slice(0, race.lanes).map((queue, lane) => (
          <div
            key={lane}
            ref={(element) => {
              lanes.current[lane] = element
            }}
            role="group"
            aria-label={`Коридор ${lane + 1}`}
            data-testid="corridor"
            onPointerDown={(event) => startPress(event, lane)}
            onPointerMove={movePress}
            onPointerUp={cancelPress}
            onPointerCancel={cancelPress}
            onPointerLeave={cancelPress}
            onContextMenu={(event) => event.preventDefault()}
            className={`flex min-h-0 flex-col gap-3.5 overflow-hidden border-x-2 py-3.5 ${race.lanes === 3 ? 'px-2.5' : 'px-4.5'} ${
              drag?.over === lane ? 'border-solid border-fg bg-lane-over' : 'border-dashed border-line bg-lane'
            }`}
          >
            {queue.map((kart, place) => {
              const known = paceOf(kart, pace)
              // The kart at the front goes out next.
              const edge = place === 0 ? 'ring-2 ring-fg' : known === undefined ? '' : KNOWN
              const unknown = known !== undefined ? '' : kart.leftBy === null ? UNKNOWN : UNKNOWN_KART
              return (
                <div
                  key={kart.id}
                  data-testid="corridor-kart"
                  data-pace={known ?? 'unknown'}
                  className={`relative flex min-h-13 shrink basis-30.5 items-center justify-center rounded-[26px_26px_12px_12px] font-extrabold tabular-nums ${
                    race.lanes === 3 ? 'text-[2.75rem]' : 'text-[3.5rem]'
                  } ${edge} ${unknown}`}
                  style={{ background: fill(known) }}
                >
                  {kart.leftBy ?? '?'}
                </div>
              )
            })}
            {queue.length === 0 && (
              <p className="m-auto px-1 text-center text-sm text-fg-3">Удерживайте, чтобы добавить тачку</p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <PitKey onClick={() => change(() => undoMove(race.id))} disabled={log.count === 0}>
          <Undo />
          Отменить
        </PitKey>
        <PitKey onClick={() => change(() => redoMove(race.id))} disabled={log.count === log.moves.length}>
          Вернуть
          <Redo />
        </PitKey>
      </div>

      <div className="mt-4 grid gap-2.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {all.map((team) => {
          const known = riding(team)
          return (
            <button
              key={team}
              type="button"
              data-testid="pit-kart"
              data-pace={known ?? 'unknown'}
              aria-label={`Номер ${team}`}
              onPointerDown={(event) => startDrag(event, team)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={() => setDrag(null)}
              className={`relative flex touch-none items-center justify-center rounded-lg font-extrabold tabular-nums ${tile} ${
                known === undefined ? UNKNOWN_TEAM : KNOWN
              } ${drag?.team === team ? 'opacity-25' : ''}`}
              style={{ background: fill(known) }}
            >
              {team}
            </button>
          )
        })}
        <button
          type="button"
          aria-label="Другой номер"
          onClick={() => setOther(true)}
          className={`flex items-center justify-center rounded-lg text-fg-2 active:opacity-70 ${tile} ${UNKNOWN}`}
        >
          <Plus />
        </button>
      </div>

      {karts.length === 0 && (
        <div className="mt-6 mb-2 flex flex-col items-center gap-1 text-center">
          <p className="text-sm text-fg-2">Скорость картов появится после квалификации</p>
          <button
            type="button"
            onClick={onQualification}
            className="h-11 text-sm text-fg-3 underline underline-offset-3 active:opacity-70"
          >
            Добавить протоколы
          </button>
        </div>
      )}

      {drag && (
        <div
          aria-hidden="true"
          className={`pointer-events-none fixed z-50 flex scale-115 items-center justify-center rounded-lg font-extrabold tabular-nums shadow-[0_0_0_2px_var(--color-fg),0_14px_30px_rgb(0_0_0/0.85)] ${tile} ${
            riding(drag.team) === undefined ? UNKNOWN_TEAM : ''
          }`}
          style={{
            left: drag.x - drag.width / 2,
            top: drag.y - drag.height / 2,
            width: drag.width,
            height: drag.height,
            background: fill(riding(drag.team)),
          }}
        >
          {drag.team}
        </div>
      )}

      {menu && (
        <>
          <div className="fixed inset-0 z-40 bg-black/45" onClick={() => held.current || setMenu(null)} />
          <div
            role="menu"
            aria-label={`Коридор ${menu.lane + 1}`}
            className="fixed z-50 w-65 overflow-hidden rounded-xl bg-sheet shadow-[0_0_0_1px_var(--color-line),0_18px_40px_rgb(0_0_0/0.8)]"
            style={{
              left: Math.min(Math.max(menu.x - 130, 16), window.innerWidth - 276),
              top: Math.min(menu.y + 12, window.innerHeight - 120),
            }}
          >
            <p className="px-4 pt-3 pb-1.5 text-xs tracking-[0.06em] text-fg-3 uppercase">Коридор {menu.lane + 1}</p>
            <button
              type="button"
              role="menuitem"
              onClick={addUnknown}
              className="flex h-14 w-full items-center gap-3 px-4 text-left text-name active:opacity-70"
            >
              <span className="flex size-7 items-center justify-center rounded-md bg-line font-extrabold">?</span>
              Добавить неизвестную тачку
            </button>
          </div>
        </>
      )}

      {other && (
        <OtherNumber
          lanes={race.lanes}
          onPick={(lane, team) => change(() => recordMove(race.id, { lane, kart: team }))}
          onClose={() => setOther(false)}
        />
      )}
    </div>
  )
}

function PitKey({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-13 items-center justify-center gap-2 rounded-lg bg-control text-body font-semibold ring-1 ring-line ring-inset active:opacity-70 disabled:bg-field disabled:text-fg-off disabled:ring-control"
    >
      {children}
    </button>
  )
}

type OtherNumberProps = { lanes: number; onPick: (lane: number, team: string) => void; onClose: () => void }

// A team that is not in the grid: one with no time in the protocols, or any team before them.
// Its number is typed in, and the corridor it came into picked; from then on it is in the grid.
function OtherNumber({ lanes, onPick, onClose }: OtherNumberProps) {
  const sheet = useRef<HTMLDialogElement>(null)
  const [text, setText] = useState('')
  const [wrong, setWrong] = useState(false)

  useEffect(() => {
    // Opening focuses the field, the first thing in it.
    sheet.current?.showModal()
  }, [])

  function pick(lane: number) {
    const team = teamNumber(text)
    if (team === null) return setWrong(true)
    sheet.current?.close()
    onPick(lane, team)
  }

  return (
    <dialog
      ref={sheet}
      onClose={onClose}
      // A tap on the dimmed screen around it closes it.
      onClick={(event) => event.target === sheet.current && sheet.current.close()}
      aria-label="Другой номер"
      // At the top of the screen: the keyboard takes the bottom half. Selectable again: Safari carries
      // the screen's no-select into the field, and a field that cannot be selected takes no typing.
      className="mx-auto mt-[calc(env(safe-area-inset-top)+1rem)] w-[calc(100%-2rem)] max-w-sm rounded-xl bg-sheet text-fg shadow-[0_0_0_1px_var(--color-line),0_18px_40px_rgb(0_0_0/0.8)] select-text [-webkit-touch-callout:default] backdrop:bg-black/60"
    >
      <div className="flex flex-col px-4 pt-3 pb-2">
        <p className="pb-3 text-xs tracking-[0.06em] text-fg-3 uppercase">Другой номер</p>
        <TextField
          label="Номер"
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setWrong(false)
          }}
          // The return key of the keyboard takes the one corridor there is, or puts the keyboard away.
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            if (lanes === 1) pick(0)
            else event.currentTarget.blur()
          }}
          aria-invalid={wrong}
          autoCapitalize="characters"
          enterKeyHint="done"
          autoComplete="off"
        />
        {wrong && (
          <p role="alert" className="pt-2 text-sm text-amber-400">
            Номер — до трёх цифр, можно с буквой: 7, 12A
          </p>
        )}
        <p className="pt-4 pb-2 text-sm text-fg-3">Заехал в коридор</p>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${lanes}, minmax(0, 1fr))` }}>
          {Array.from({ length: lanes }, (_, lane) => (
            <PitKey key={lane} onClick={() => pick(lane)}>
              Коридор {lane + 1}
            </PitKey>
          ))}
        </div>
        <button
          type="button"
          onClick={() => sheet.current?.close()}
          className="mt-1 h-12 text-body text-fg-2 active:opacity-70"
        >
          Отмена
        </button>
      </div>
    </dialog>
  )
}
