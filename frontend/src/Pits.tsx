import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import type { Kart, Race } from './db.ts'
import { byNumber, corridors, paceColour, recordMove, redoMove, syncPits, undoMove, usePitLog } from './pits.ts'
import { ArrowUp, Redo, Undo } from './ui.tsx'

// The pit screen: the corridors at the top, every kart of the qualification below. A kart that
// comes into the pits is dragged into its corridor; the one at the front goes back below.
// Colour tells the pace: purple the fastest, grey the middle, brown the slowest.

type PitsProps = { race: Race; karts: Kart[]; onQualification: () => void; onSignedOut: () => void }

type Drag = { kart: string; pointer: number; x: number; y: number; width: number; height: number; over: number }
type Menu = { lane: number; x: number; y: number }

// How long a press on a corridor takes to open its menu, and how far the finger may wander.
const PRESS_MS = 500
const PRESS_SLOP = 10
// How often the moves made on the other phones are asked for while the pits are on screen.
const POLL_MS = 10_000

export function Pits({ race, karts, onQualification, onSignedOut }: PitsProps) {
  const log = usePitLog(race.id)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
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

  const queues = corridors(log, race.lanes)
  const pace = new Map(karts.map((kart) => [kart.kart, kart.pace]))
  const inPits = new Set(queues.flat())
  const free = karts
    .map((kart) => kart.kart)
    .filter((kart) => !inPits.has(kart))
    .sort(byNumber)
  // Every kart in sight at once: more karts, more columns and lower tiles.
  const columns = free.length <= 15 ? 5 : free.length <= 24 ? 6 : 7
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

  function startDrag(event: PointerEvent<HTMLButtonElement>, kart: string) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const box = event.currentTarget.getBoundingClientRect()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({
      kart,
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
    if (lane >= 0) await change(() => recordMove(race.id, { lane, kart: drag.kart }))
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
        {queues.map((queue, lane) => (
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
            {queue.map((kart, place) => (
              <div
                key={`${place}-${kart}`}
                data-testid="corridor-kart"
                className={`flex min-h-13 shrink basis-30.5 items-center justify-center rounded-[26px_26px_12px_12px] font-extrabold tabular-nums ${
                  race.lanes === 3 ? 'text-[2.75rem]' : 'text-[3.5rem]'
                } ${place === 0 ? 'ring-2 ring-fg' : 'ring-1 ring-white/8 ring-inset'}`}
                style={{ background: kart === null ? 'var(--color-control)' : paceColour(pace.get(kart) ?? 0.5) }}
              >
                {kart ?? '?'}
              </div>
            ))}
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

      {karts.length === 0 ? (
        <div className="mt-8 mb-6 flex flex-col items-center gap-3 text-center">
          <p className="text-name text-fg-2">Карты появятся после квалификации</p>
          <button
            type="button"
            onClick={onQualification}
            className="h-11 text-sm text-fg-3 underline underline-offset-3 active:opacity-70"
          >
            Добавить протоколы
          </button>
        </div>
      ) : (
        <div className="mt-4 grid gap-2.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {free.map((kart) => (
            <button
              key={kart}
              type="button"
              data-testid="pit-kart"
              aria-label={`Карт ${kart}`}
              onPointerDown={(event) => startDrag(event, kart)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={() => setDrag(null)}
              className={`flex touch-none items-center justify-center rounded-lg font-extrabold tabular-nums ring-1 ring-white/8 ring-inset ${tile} ${
                drag?.kart === kart ? 'opacity-25' : ''
              }`}
              style={{ background: paceColour(pace.get(kart) ?? 0.5) }}
            >
              {kart}
            </button>
          ))}
        </div>
      )}

      {drag && (
        <div
          aria-hidden="true"
          className={`pointer-events-none fixed z-50 flex scale-115 items-center justify-center rounded-lg font-extrabold tabular-nums shadow-[0_0_0_2px_var(--color-fg),0_14px_30px_rgb(0_0_0/0.85)] ${tile}`}
          style={{
            left: drag.x - drag.width / 2,
            top: drag.y - drag.height / 2,
            width: drag.width,
            height: drag.height,
            background: paceColour(pace.get(drag.kart) ?? 0.5),
          }}
        >
          {drag.kart}
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
    </div>
  )
}

function PitKey({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled: boolean }) {
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
