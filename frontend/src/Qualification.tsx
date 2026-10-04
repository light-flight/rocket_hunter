import { useEffect, useRef, useState } from 'react'
import { dismiss, type Progress, progress } from './progress.ts'
import {
  deleteFile,
  formatGap,
  formatLap,
  type Kart,
  type QualificationFile,
  rereadFile,
  syncFiles,
} from './qualification.ts'
import { useOnline } from './status.ts'
import { Sheet, type SheetHandle } from './Sheet.tsx'
import { Check, ChevronRight, Cross, MainAction, NotSent, Protocol, Spinner } from './ui.tsx'
import { plural } from './words.ts'

// The qualification of a race: its karts from the fastest to the slowest, in a table. Above them,
// the protocols they come from, one key away, and while protocols are on their way, one bar for
// all of them: how far they have gone to the server, and how far the model has read them.

type QualificationProps = { raceId: string; files: QualificationFile[]; karts: Kart[]; onSignedOut: () => void }

export function Qualification({ raceId, files, karts, onSignedOut }: QualificationProps) {
  const [list, setList] = useState(false)
  const [opened, setOpened] = useState<string | null>(null)
  const openedFile = files.find((file) => file.id === opened)
  const going = files.some((file) => ['local', 'waiting', 'reading'].includes(file.status))

  return (
    <div className="flex flex-col">
      <ProtocolsKey files={files} karts={karts.length} onOpen={() => setList(true)} />
      <ProgressBar raceId={raceId} files={files} />

      {karts.length > 0 ? (
        <KartTable karts={karts} />
      ) : (
        <p className="mt-8 text-center text-sm text-fg-3">
          {going ? 'Карты встанут здесь от быстрого к медленному' : 'Картов в протоколах нет'}
        </p>
      )}

      {list && <Protocols files={files} onOpen={setOpened} onClose={() => setList(false)} />}
      {openedFile && <FileSheet file={openedFile} onSignedOut={onSignedOut} onClose={() => setOpened(null)} />}
    </div>
  )
}

type ProtocolsKeyProps = { files: QualificationFile[]; karts: number; onOpen: () => void }

// How many protocols there are and what came of them, on the key that shows them. A protocol that
// was not read is told here: its row is a tap away only. The model's notes are not: they are in the
// protocol, for whoever opens it.
function ProtocolsKey({ files, karts, onOpen }: ProtocolsKeyProps) {
  const failed = files.filter((file) => file.status === 'failed').length

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className="flex min-h-12 items-center gap-2.5 border-b border-control py-2 text-left active:opacity-70"
    >
      <span className="flex text-fg-3">
        <Protocol />
      </span>
      <span className="min-w-0 flex-1 text-body">
        {files.length} {plural(files.length, 'протокол', 'протокола', 'протоколов')}
        {karts > 0 && ` · ${karts} ${plural(karts, 'карт', 'карта', 'картов')}`}
        {failed > 0 && (
          <span className="text-fg-2"> · {failed} {plural(failed, 'не прочитан', 'не прочитаны', 'не прочитаны')}</span>
        )}
      </span>
      <ChevronRight />
    </button>
  )
}

// How often the bar moves on while it is up, and how long it stays full once everything is read:
// as long as it takes to fold away (--animate-bar-out).
const TICK_MS = 250
const DONE_MS = 1500

// One bar for every protocol on its way: the first quarter is the way to the server, the rest the
// model reading. Light runs along the part going now; without a network nothing moves.
function ProgressBar({ raceId, files }: { raceId: string; files: QualificationFile[] }) {
  const online = useOnline()
  const [shown, setShown] = useState<Progress | null>(() => progress(raceId, files))
  const up = shown !== null
  const done = shown?.done ?? false

  useEffect(() => {
    const update = () => setShown(progress(raceId, files))
    update()
    if (!up) return
    const timer = window.setInterval(update, TICK_MS)
    return () => window.clearInterval(timer)
  }, [raceId, files, up])

  useEffect(() => {
    if (!done) return
    const timer = window.setTimeout(() => {
      dismiss(raceId)
      setShown(null)
    }, DONE_MS)
    return () => window.clearTimeout(timer)
  }, [raceId, done])

  if (!shown) return null

  const sending = shown.local > 0 && online
  const reading = shown.reading > 0
  const percent = shown.done ? 100 : Math.min(99, Math.floor(shown.whole * 100))
  const of = (count: number) => (shown.files > 1 ? ` ${count} из ${shown.files}` : '')
  const text = shown.done
    ? 'Готово'
    : shown.local === 0
      ? `Распознаётся${shown.files > 1 ? ` · готово${of(shown.files - shown.reading)}` : ''}`
      : online
        ? `Загружается${of(shown.files - shown.local + 1)}`
        : 'Ждёт сети · загрузится сам'

  return (
    // Opens and folds away by its height, so the karts below move along rather than jump.
    <div className={`grid grid-rows-[1fr] ${done ? 'animate-bar-out' : 'animate-bar-in'} motion-reduce:animate-none`}>
      <div className="min-h-0 overflow-hidden">
        <div className="flex flex-col gap-2 pt-3 pb-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex items-center gap-1.5 self-center text-sm text-fg-2">
              {shown.done && <Check />}
              {text}
            </span>
            <span className="text-name font-semibold tabular-nums">{percent}%</span>
          </div>
          <div
            role="progressbar"
            aria-label="Протоколы"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={`${percent}%, ${text}`}
            className="grid grid-cols-[1fr_3fr] gap-1"
          >
            <Leg part={shown.sent} going={sending} />
            <Leg part={shown.read} going={reading} />
          </div>
          <div aria-hidden="true" className="grid grid-cols-[1fr_3fr] gap-1 text-xs">
            <LegName done={shown.sent === 1} going={sending}>
              Загрузка
            </LegName>
            <LegName done={shown.read === 1} going={reading}>
              Распознавание
            </LegName>
          </div>
        </div>
      </div>
    </div>
  )
}

function Leg({ part, going }: { part: number; going: boolean }) {
  return (
    <div className="relative h-2 overflow-hidden rounded-full bg-line">
      <div
        className="h-full rounded-full bg-fg-2 transition-[width] duration-300 ease-linear motion-reduce:transition-none"
        style={{ width: `${part * 100}%` }}
      />
      {going && (
        <div className="absolute inset-y-0 left-0 w-2/5 animate-sheen bg-linear-to-r from-transparent via-white/45 to-transparent motion-reduce:hidden" />
      )}
    </div>
  )
}

function LegName({ done, going, children }: { done: boolean; going: boolean; children: string }) {
  return (
    <span className={`flex items-center gap-1 ${going ? 'text-fg-2' : 'text-fg-3'}`}>
      {done && <Check />}
      {children}
    </span>
  )
}

// One line a kart: its place, its number, its best laps averaged, how many there were, and how far
// it is behind the fastest.
function KartTable({ karts }: { karts: Kart[] }) {
  const fastest = karts[0].average

  return (
    <table aria-label="Карты по скорости" className="mt-2 w-full text-left tabular-nums">
      <thead className="text-xs text-fg-3">
        <tr className="h-8">
          <th scope="col" className="w-7 font-normal">
            <span className="sr-only">Место</span>
          </th>
          <th scope="col" className="w-15 font-normal">
            Карт
          </th>
          <th scope="col" className="font-normal">
            Среднее лучшее
          </th>
          <th scope="col" className="w-14 text-right font-normal">
            Кругов
          </th>
          <th scope="col" className="w-21 text-right font-normal">
            Отставание
          </th>
        </tr>
      </thead>
      <tbody>
        {karts.map((kart, index) => (
          <tr key={kart.kart} data-testid="kart" className="h-10 border-t border-control">
            <td className="text-sm text-fg-3">{index + 1}</td>
            <th scope="row" className="text-[1.375rem]/7 font-bold">
              {kart.kart}
            </th>
            <td className="text-name font-semibold">{formatLap(kart.average)}</td>
            <td className="text-right text-body text-fg-2">{kart.laps}</td>
            <td className="text-right text-body text-fg-3">{index > 0 && formatGap(kart.average - fastest)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

type ProtocolsProps = { files: QualificationFile[]; onOpen: (id: string) => void; onClose: () => void }

// Every protocol of the race, oldest first, and where each is on its way to being read. A tap on
// one shows what the model read in it, in a sheet over this one.
function Protocols({ files, onOpen, onClose }: ProtocolsProps) {
  return (
    <Sheet label="Протоколы" onClose={onClose}>
      <ul role="list">
        {files.map((file) => (
          <li key={file.id}>
            <FileRow file={file} onOpen={() => onOpen(file.id)} />
          </li>
        ))}
      </ul>
    </Sheet>
  )
}

function FileRow({ file, onOpen }: { file: QualificationFile; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-18 w-full items-center gap-3 border-b border-control py-3 text-left active:opacity-70"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-name font-semibold">{file.name}</span>
        <FileStatus file={file} />
      </span>
      <ChevronRight />
    </button>
  )
}

// One quiet line under the name of a file: where it is on its way to being read.
function FileStatus({ file }: { file: QualificationFile }) {
  const online = useOnline()
  const karts = Object.keys(file.laps).length

  let icon = <Cross />
  let text = `Не прочитан: ${file.error ?? 'неизвестная ошибка'}`
  let bright = true
  if (file.status === 'local') {
    icon = <NotSent />
    text = online ? 'Загружается…' : 'Ждёт сети · загрузится сам'
    bright = false
  } else if (file.status === 'waiting' || file.status === 'reading') {
    icon = <Spinner />
    text = 'Распознаётся…'
    bright = false
  } else if (file.status === 'read') {
    icon = <Check />
    text = `Готово · ${karts} ${plural(karts, 'карт', 'карта', 'картов')}`
  }

  return (
    <span data-testid="file-status" className={`flex items-center gap-1.5 text-sm ${bright ? 'text-fg-2' : 'text-fg-3'}`}>
      {icon}
      <span className="min-w-0">{text}</span>
    </span>
  )
}

type FileSheetProps = { file: QualificationFile; onSignedOut: () => void; onClose: () => void }

// What the model read in one file, its notes, and the two things to do about a bad read:
// read it again or take the file out.
function FileSheet({ file, onSignedOut, onClose }: FileSheetProps) {
  const sheet = useRef<SheetHandle>(null)
  const [busy, setBusy] = useState(false)
  const [offline, setOffline] = useState(false)
  const rows = Object.entries(file.laps).sort(([, a], [, b]) => Math.min(...a) - Math.min(...b))

  async function reread() {
    setBusy(true)
    setOffline(false)
    const done = await rereadFile(file, onSignedOut)
    setBusy(false)
    if (done) sheet.current?.close()
    else setOffline(true)
  }

  async function remove() {
    if (!window.confirm(`Убрать «${file.name}»? Его времена больше не будут учитываться.`)) return
    await deleteFile(file)
    sheet.current?.close()
    void syncFiles(onSignedOut)
  }

  return (
    <Sheet ref={sheet} label={file.name} onClose={onClose}>
      <div className="flex flex-col gap-1">
        <div className="flex flex-col gap-1 pb-3">
          <p className="text-[1.375rem]/7 font-bold break-words">{file.name}</p>
          <FileStatus file={file} />
        </div>

        {file.warnings.length > 0 && (
          <ul role="list" aria-label="Замечания" className="flex flex-col gap-1.5 pb-3 text-sm text-fg-2">
            {file.warnings.map((warning) => (
              <li key={warning} className="flex gap-2">
                <span aria-hidden="true" className="text-fg-3">
                  ·
                </span>
                {warning}
              </li>
            ))}
          </ul>
        )}

        {rows.length > 0 && (
          <table className="mb-3 w-full text-left tabular-nums">
            <caption className="pb-1 text-left text-sm text-fg-3">Что прочитано</caption>
            <tbody>
              {rows.map(([kart, laps]) => (
                <tr key={kart} className="border-t border-control">
                  <th scope="row" className="w-16 py-1.5 text-name font-bold">
                    {kart}
                  </th>
                  <td className="py-1.5 text-body">{laps.map(formatLap).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {file.sent === 1 && (file.status === 'read' || file.status === 'failed') && (
          <MainAction secondary onClick={reread} disabled={busy}>
            Прочитать снова
          </MainAction>
        )}
        {offline && (
          <p role="alert" className="text-center text-sm text-warn">
            Нет связи с сервером. Прочитать снова можно, когда появится сеть.
          </p>
        )}
        <button type="button" onClick={remove} className="h-14 rounded-lg text-body text-fg-2 active:opacity-70">
          Убрать файл
        </button>
      </div>
    </Sheet>
  )
}
