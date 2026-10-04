import { type PointerEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import type { Kart, PitLog, Race } from './db.ts'
import { LanesPicker } from './Lanes.tsx'
import {
  kartOf,
  lanesOf,
  paceOf,
  type PitKart,
  type PitMove,
  replay,
  standing,
  teamNumber,
  teams,
  untimed,
} from './pitlane.ts'
import { chooseLanes, paceColour, recordMove, redoMove, resetPits, syncPits, undoMove, usePitLog } from './pits.ts'
import { syncFiles } from './qualification.ts'
import { ActionArea, ArrowUp, History, MainAction, More, Plus, Redo, SHEET, TextField, Undo } from './ui.tsx'

// The pit screen. A team's number is always on the track: a team that comes in joins the end of
// a corridor, its driver gets into the kart at the front, and the number is moved onto it. So the
// corridors at the top hold karts with no number on them, and below are all the teams, each on the
// kart it took last; a team that comes in is dragged into its corridor. Colour tells a kart's pace:
// purple the fastest, grey the middle, brown the slowest. A kart nobody knows the pace of has no
// colour, only a bold dashed edge. The first time the pits are opened they ask how many corridors
// the pit lane has, and the corridors stay so until the pits are started over from the ⋯ menu. The
// journal tells which team came into which corridor, and when.

type PitsProps = { race: Race; karts: Kart[]; onQualification: () => void; onSignedOut: () => void }

type Drag = { team: string; pointer: number; x: number; y: number; width: number; height: number; over: number }
type Menu = { lane: number; x: number; y: number }

// How long a press on a corridor takes to open its menu, and how far the finger may wander.
const PRESS_MS = 500
const PRESS_SLOP = 10
// How often the moves made on the other phones, and the protocols added there, are asked for while
// the pits are on screen.
const POLL_MS = 10_000
// How long the pits wait for the server before asking for the corridors: another phone may have set
// them up already.
const ASK_MS = 3000

// A kart of a known pace has its colour and a thin light edge: dark ones would melt into the
// ground otherwise. One nobody knows the pace of has no colour at all, only a bold dashed edge,
// light enough to see on the black of a corridor. The key for another number is dashed too, but
// thinner and darker: it is not a kart.
const KNOWN = 'ring-1 ring-white/8 ring-inset'
const UNKNOWN = 'outline-2 -outline-offset-2 outline-dashed outline-fg-3'
const OTHER = 'outline-1 -outline-offset-1 outline-dashed outline-fg-off'

function fill(pace: number | undefined): string | undefined {
  return pace === undefined ? undefined : paceColour(pace)
}

// A kart's pace in words, for those who listen to the screen rather than look at it.
function paceWord(pace: number | undefined): string {
  if (pace === undefined) return 'скорость неизвестна'
  return pace < 1 / 3 ? 'быстрый' : pace <= 2 / 3 ? 'средний' : 'медленный'
}

export function Pits({ race, karts, onQualification, onSignedOut }: PitsProps) {
  const log = usePitLog(race.id)
  // The server has been asked, or has not answered for a while.
  const [asked, setAsked] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setAsked(true), ASK_MS)
    void syncPits(onSignedOut).then(() => setAsked(true))
    return () => clearTimeout(timer)
  }, [onSignedOut])

  // What the other phones enter comes in while the pits are on screen, and so do the teams of a
  // protocol added there.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void syncPits(onSignedOut)
      void syncFiles(onSignedOut)
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [onSignedOut])

  if (log === undefined) return null
  if (log === null) {
    return (
      <p role="alert" className="mt-6 text-center text-sm text-amber-400">
        Не удалось прочитать пит-стопы на телефоне.
      </p>
    )
  }

  // Kept on the phone first, then sent to the server when there is a network.
  async function change(write: () => Promise<void>) {
    await write()
    void syncPits(onSignedOut)
  }

  const moves = standing(log)
  const corridors = lanesOf(log.lanes, moves)
  // Not set up yet, or started over, here or on another phone. Whatever was open on the pits before
  // goes with them: a drag, a menu, the journal. Pits this phone has not read yet may be set up on
  // another phone: the question waits for the server, rather than showing and going away under the
  // finger.
  if (corridors === null) {
    return asked ? <Setup onChoose={(chosen) => change(() => chooseLanes(race.id, chosen))} /> : null
  }
  return (
    <PitLane
      raceId={race.id}
      log={log}
      moves={moves}
      corridors={corridors}
      karts={karts}
      onQualification={onQualification}
      change={change}
    />
  )
}

type PitLaneProps = {
  raceId: string
  log: PitLog
  // The moves that stand, and the corridors of the pit lane.
  moves: PitMove[]
  corridors: number
  karts: Kart[]
  onQualification: () => void
  change: (write: () => Promise<void>) => Promise<void>
}

// The pits once their corridors are chosen.
function PitLane({ raceId, log, moves, corridors, karts, onQualification, change }: PitLaneProps) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [more, setMore] = useState(false)
  const [other, setOther] = useState(false)
  const [journal, setJournal] = useState(false)
  const lanes = useRef<(HTMLDivElement | null)[]>([])
  const moreKey = useRef<HTMLButtonElement>(null)
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
    if (!more) return
    const key = moreKey.current
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setMore(false)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('keydown', close)
      // Closed whichever way: the focus goes back to the key that opened it, not to the top of the page.
      key?.focus()
    }
  }, [more])

  // A press still held when the screen goes away must not open a menu.
  useEffect(
    () => () => {
      if (press.current) window.clearTimeout(press.current.timer)
    },
    [],
  )

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
    if (lane >= 0) await change(() => recordMove(raceId, { lane, kart: drag.team }))
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
    await change(() => recordMove(raceId, { lane: menu.lane, kart: null }))
  }

  // Asked first: it takes every stop away, on every phone.
  async function startOver() {
    setMore(false)
    const asked = 'Начать пит-стопы сначала? Смены сотрутся на всех телефонах, коридоры выберете заново.'
    if (!window.confirm(asked)) return
    await change(() => resetPits(raceId))
  }

  return (
    <div className="flex flex-1 flex-col select-none [-webkit-touch-callout:none]">
      <div className="relative mt-2 grid h-7 grid-cols-[1fr_auto_1fr] items-center">
        <div aria-hidden="true" className="col-start-2 flex items-center gap-1.5 text-xs tracking-[0.08em] text-fg-3 uppercase">
          <ArrowUp />
          трасса
        </div>
        <button
          ref={moreKey}
          type="button"
          aria-label="Ещё"
          aria-haspopup="menu"
          aria-expanded={more}
          onClick={() => setMore(true)}
          className="-my-2 -mr-2.5 flex size-11 items-center justify-center justify-self-end text-fg-2 active:opacity-70"
        >
          <More />
        </button>
        {more && (
          <>
            <div className="fixed inset-0 z-40 bg-black/45" onClick={() => setMore(false)} />
            <div role="menu" aria-label="Пит-стопы" className={`absolute top-full right-0 z-50 mt-1 w-65 overflow-hidden ${SHEET}`}>
              <button
                type="button"
                role="menuitem"
                autoFocus
                onClick={startOver}
                className="flex h-14 w-full items-center px-4 text-left text-name active:opacity-70"
              >
                Начать сначала
              </button>
            </div>
          </>
        )}
      </div>

      <div
        className={`mt-1 grid min-h-50 flex-1 basis-0 gap-6 ${corridors === 1 ? 'w-45 self-center' : ''}`}
        // The corridors take what the karts below leave them, and their karts get lower to fit.
        style={{ gridTemplateColumns: `repeat(${corridors}, minmax(0, 1fr))`, gridTemplateRows: 'minmax(0, 1fr)' }}
      >
        {/* Moves into a corridor the lane does not have (entered offline while another phone started the
            pits over) keep their karts there, out of sight. */}
        {pitlane.corridors.slice(0, corridors).map((queue, lane) => (
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
            className={`flex min-h-0 flex-col gap-3.5 overflow-hidden border-x-2 py-3.5 ${corridors === 3 ? 'px-2.5' : 'px-4.5'} ${
              drag?.over === lane ? 'border-solid border-fg bg-lane-over' : 'border-dashed border-line bg-lane'
            }`}
          >
            {/* A kart in a corridor has no number: the number went out on the kart at the front. */}
            {queue.map((kart, place) => {
              const known = paceOf(kart, pace)
              // The kart at the front goes out next.
              const edge = place === 0 ? 'ring-2 ring-fg' : known === undefined ? '' : KNOWN
              return (
                <div
                  key={kart.id}
                  role="img"
                  aria-label={`${place + 1}-й, ${paceWord(known)}`}
                  data-testid="corridor-kart"
                  data-kart={kart.id}
                  data-pace={known ?? 'unknown'}
                  className={`min-h-8 shrink basis-30.5 rounded-[26px_26px_12px_12px] ${edge} ${
                    known === undefined ? UNKNOWN : ''
                  }`}
                  style={{ background: fill(known) }}
                />
              )
            })}
            {queue.length === 0 && (
              <p className="m-auto px-1 text-center text-sm text-fg-3">Удерживайте, чтобы добавить тачку</p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-[1fr_1fr_3.25rem] gap-3">
        <PitKey onClick={() => change(() => undoMove(raceId))} disabled={moves.length === 0}>
          <Undo />
          Отменить
        </PitKey>
        <PitKey onClick={() => change(() => redoMove(raceId))} disabled={log.redo.length === 0}>
          Вернуть
          <Redo />
        </PitKey>
        <PitKey label="Журнал" onClick={() => setJournal(true)}>
          <History />
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
              className={`flex touch-none items-center justify-center rounded-lg font-extrabold tabular-nums ${tile} ${
                known === undefined ? UNKNOWN : KNOWN
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
          className={`flex items-center justify-center rounded-lg text-fg-2 active:opacity-70 ${tile} ${OTHER}`}
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
          // A kart of no known pace has no colour, but the ground under it, not the tiles it passes.
          className={`pointer-events-none fixed z-50 flex scale-115 items-center justify-center rounded-lg font-extrabold tabular-nums shadow-[0_0_0_2px_var(--color-fg),0_14px_30px_rgb(0_0_0/0.85)] ${tile} ${
            riding(drag.team) === undefined ? `${UNKNOWN} bg-ground` : ''
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
            className={`fixed z-50 w-65 overflow-hidden ${SHEET}`}
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
              <span aria-hidden="true" className={`size-7 shrink-0 rounded-md ${UNKNOWN}`} />
              Добавить неизвестную тачку
            </button>
          </div>
        </>
      )}

      {other && (
        <OtherNumber
          lanes={corridors}
          onPick={(lane, team) => change(() => recordMove(raceId, { lane, kart: team }))}
          onClose={() => setOther(false)}
        />
      )}

      {journal && <Journal moves={moves} took={pitlane.took} pace={pace} onClose={() => setJournal(false)} />}
    </div>
  )
}

// The first time the pits are opened: how many corridors the pit lane has. Asked once, before the
// first kart stands in them: after that the karts in a corridor would have nowhere to go.
function Setup({ onChoose }: { onChoose: (lanes: number) => void }) {
  const [lanes, setLanes] = useState(1)
  const question = useId()

  return (
    <div className="flex flex-1 flex-col">
      <div className="mt-[14dvh] mb-6 flex flex-col gap-1.5 px-2 text-center text-balance">
        <h2 id={question} className="text-name font-semibold">
          Сколько коридоров в пите?
        </h2>
        <p className="text-sm text-fg-3">Поменять потом можно, только начав пит-стопы сначала</p>
      </div>
      <LanesPicker value={lanes} onChange={setLanes} labelledBy={question} />
      <ActionArea>
        <MainAction onClick={() => onChoose(lanes)}>Готово</MainAction>
      </ActionArea>
    </div>
  )
}

type PitKeyProps = { children: ReactNode; onClick: () => void; disabled?: boolean; label?: string }

function PitKey({ children, onClick, disabled, label }: PitKeyProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
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
      className={`mx-auto mt-[calc(env(safe-area-inset-top)+1rem)] w-[calc(100%-2rem)] max-w-sm ${SHEET} select-text [-webkit-touch-callout:default] backdrop:bg-black/60`}
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

// To the second, by this phone's clock: «12:04:37».
const TIME = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

type JournalProps = {
  moves: PitMove[]
  took: ReadonlyMap<string, PitKart>
  pace: ReadonlyMap<string, number>
  onClose: () => void
}

// Every move that stands, the last first: which team came into which corridor, when it was entered
// to the second, and the kart the team went out on. A move kept from before moves had times has none,
// and neither has one entered again from it.
function Journal({ moves, took, pace, onClose }: JournalProps) {
  const sheet = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    sheet.current?.showModal()
  }, [])

  return (
    <dialog
      ref={sheet}
      onClose={onClose}
      // A tap on the dimmed screen around it closes it.
      onClick={(event) => event.target === sheet.current && sheet.current.close()}
      aria-label="Журнал"
      className={`mx-auto mt-[calc(env(safe-area-inset-top)+1rem)] max-h-[calc(100dvh-env(safe-area-inset-top)-2rem)] w-[calc(100%-2rem)] max-w-sm flex-col ${SHEET} backdrop:bg-black/60 open:flex`}
    >
      <p className="shrink-0 px-4 pt-3 pb-1 text-xs tracking-[0.06em] text-fg-3 uppercase">Журнал</p>
      {moves.length === 0 ? (
        <p className="px-4 py-6 text-center text-body text-fg-2">Смен ещё нет</p>
      ) : (
        // A long race scrolls inside, under the title and above the key that closes it.
        <ol className="min-h-0 overflow-y-auto overscroll-contain px-4">
          {[...moves].reverse().map((move) => {
            const kart = took.get(move.id)
            const known = kart && paceOf(kart, pace)
            return (
              <li key={move.id} className="flex min-h-12 items-center gap-3 border-b border-control text-body">
                <span className="w-17 shrink-0 text-fg-2 tabular-nums">{untimed(move) ? '—' : TIME.format(move.at)}</span>
                {/* On a narrow phone the corridor goes under the number, never apart. */}
                <span className="min-w-0 flex-1">
                  <span className="whitespace-nowrap">{move.kart === null ? 'Запасной карт' : `Номер ${move.kart}`}</span>{' '}
                  <span className="whitespace-nowrap text-fg-2">→ коридор {move.lane + 1}</span>
                </span>
                {kart && (
                  <span
                    role="img"
                    aria-label={`Уехал на карте: ${paceWord(known)}`}
                    className={`size-6 shrink-0 rounded-md ${known === undefined ? UNKNOWN : KNOWN}`}
                    style={{ background: fill(known) }}
                  />
                )}
              </li>
            )
          })}
        </ol>
      )}
      <button
        type="button"
        onClick={() => sheet.current?.close()}
        className="h-12 shrink-0 text-body text-fg-2 active:opacity-70"
      >
        Закрыть
      </button>
    </dialog>
  )
}
