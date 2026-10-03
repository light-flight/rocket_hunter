import { useEffect, useRef, useState } from 'react'
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
import { Attention, Check, ChevronRight, MainAction, NotSent, Spinner } from './ui.tsx'
import { plural } from './words.ts'

// The qualification of a race: the protocols the managers added and the karts they show,
// from the fastest to the slowest.

type QualificationProps = { files: QualificationFile[]; karts: Kart[]; onSignedOut: () => void }

export function Qualification({ files, karts, onSignedOut }: QualificationProps) {
  const [showFiles, setShowFiles] = useState(false)
  const [opened, setOpened] = useState<string | null>(null)
  // Files still on their way, or that need a look, stay in sight. Once all are read without
  // a note they fold into one line above the karts.
  const settled = files.every((file) => file.status === 'read' && file.warnings.length === 0)
  const openedFile = files.find((file) => file.id === opened)

  return (
    <div className="flex flex-col">
      {settled && !showFiles ? (
        <button
          type="button"
          onClick={() => setShowFiles(true)}
          className="flex h-11 items-center gap-2 text-left text-sm text-fg-2 active:opacity-70"
        >
          <span className="flex-1">
            {files.length} {plural(files.length, 'протокол', 'протокола', 'протоколов')} · {karts.length}{' '}
            {plural(karts.length, 'карт', 'карта', 'картов')}
          </span>
          <ChevronRight />
        </button>
      ) : (
        <section aria-label="Протоколы" className="flex flex-col">
          <h2 className="pt-1 pb-1 text-sm text-fg-3">Протоколы</h2>
          <ul role="list" className="flex flex-col">
            {files.map((file) => (
              <li key={file.id}>
                <FileRow file={file} onOpen={() => setOpened(file.id)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {karts.length > 0 && <KartList karts={karts} />}

      {openedFile && <FileSheet file={openedFile} onSignedOut={onSignedOut} onClose={() => setOpened(null)} />}
    </div>
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

  let icon = <Attention />
  let text = `Не прочитан: ${file.error ?? 'неизвестная ошибка'}`
  let bright = true
  if (file.status === 'local') {
    icon = <NotSent />
    text = online ? 'Отправляется…' : 'Ждёт сети · отправится сам'
    bright = false
  } else if (file.status === 'waiting' || file.status === 'reading') {
    icon = <Spinner />
    text = 'Распознаётся…'
    bright = false
  } else if (file.status === 'read') {
    icon = file.warnings.length > 0 ? <Attention /> : <Check />
    text = `Готово · ${karts} ${plural(karts, 'карт', 'карта', 'картов')}`
    if (file.warnings.length > 0) text += ' · есть замечания'
  }

  return (
    <span data-testid="file-status" className={`flex items-center gap-1.5 text-sm ${bright ? 'text-fg-2' : 'text-fg-3'}`}>
      {icon}
      <span className="min-w-0">{text}</span>
    </span>
  )
}

function KartList({ karts }: { karts: Kart[] }) {
  const fastest = karts[0].average

  return (
    <section aria-label="Карты по скорости" className="mt-3 flex flex-col">
      <div aria-hidden="true" className="flex h-6 items-center text-xs text-fg-3">
        <span className="w-7 shrink-0" />
        <span className="w-16 shrink-0">Карт</span>
        <span className="flex-1">Среднее лучшее</span>
        <span>Отставание</span>
      </div>
      <ol role="list" className="flex flex-col">
        {karts.map((kart, index) => (
          <li
            key={kart.kart}
            data-testid="kart"
            className="flex h-14 items-center border-t border-control tabular-nums"
          >
            <span className="w-7 shrink-0 text-sm text-fg-3">{index + 1}</span>
            <span className="w-16 shrink-0 text-[1.875rem]/[2.125rem] font-bold">{kart.kart}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-name font-semibold">{formatLap(kart.average)}</span>
              <span className="text-sm text-fg-3">
                {kart.laps} {plural(kart.laps, 'заезд', 'заезда', 'заездов')}
              </span>
            </span>
            <span className="text-body text-fg-3">{index > 0 && formatGap(kart.average - fastest)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

type FileSheetProps = { file: QualificationFile; onSignedOut: () => void; onClose: () => void }

// What the model read in one file, its notes, and the two things to do about a bad read:
// read it again or take the file out.
function FileSheet({ file, onSignedOut, onClose }: FileSheetProps) {
  const sheet = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const [offline, setOffline] = useState(false)
  const rows = Object.entries(file.laps).sort(([, a], [, b]) => Math.min(...a) - Math.min(...b))

  useEffect(() => {
    sheet.current?.showModal()
    // Opening focuses the first key, at the bottom of a long list: the name goes first.
    sheet.current?.scrollTo(0, 0)
  }, [])

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
    <dialog
      ref={sheet}
      onClose={onClose}
      onClick={(event) => event.target === sheet.current && sheet.current.close()}
      aria-label={file.name}
      className="mx-auto mt-auto mb-0 max-h-[85dvh] w-full max-w-md rounded-t-2xl bg-sheet text-fg ring-1 ring-line backdrop:bg-black/60"
    >
      <div className="flex flex-col gap-1 px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div aria-hidden="true" className="mb-3 h-1.25 w-9 self-center rounded-full bg-cap-edge" />
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
          <p role="alert" className="text-center text-sm text-amber-400">
            Нет связи с сервером. Прочитать снова можно, когда появится сеть.
          </p>
        )}
        <button type="button" onClick={remove} className="h-14 rounded-lg text-body text-fg-2 active:opacity-70">
          Убрать файл
        </button>
      </div>
    </dialog>
  )
}
