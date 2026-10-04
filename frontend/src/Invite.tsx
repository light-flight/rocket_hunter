import { useState } from 'react'
import { api } from './api.ts'

const INVITATION =
  'Приглашение в Rocket Hunter. Откройте ссылку в Telegram и нажмите «Запустить» — бот пришлёт ' +
  'инструкцию. Ссылка одноразовая, действует 3 дня.'

type InviteProps = { onSessionExpired: () => void }

const BUTTON = 'h-14 rounded-lg bg-control text-body font-semibold ring-1 ring-line ring-inset active:opacity-70 disabled:opacity-50'

// Two taps, because sharing and copying only work straight from a tap, not after a request.
export function Invite({ onSessionExpired }: InviteProps) {
  const [text, setText] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [failed, setFailed] = useState(false)
  const [canShare, setCanShare] = useState(() => 'share' in navigator)
  const [copied, setCopied] = useState(false)

  async function create() {
    setCreating(true)
    setFailed(false)
    const response = await api('POST', '/invitations')
    const body: { url?: unknown } | null =
      response?.status === 201 ? await response.json().catch(() => null) : null
    setCreating(false)

    if (typeof body?.url === 'string') setText(`${INVITATION}\n${body.url}`)
    else if (response?.status === 401) onSessionExpired()
    else setFailed(true)
  }

  function share(text: string) {
    navigator.share({ text }).catch((error: unknown) => {
      // Closing the share sheet is not a failure. Anything else leaves copying as the way out.
      if ((error as { name?: unknown }).name !== 'AbortError') setCanShare(false)
    })
  }

  function copy(text: string) {
    // navigator.clipboard is missing outside a secure context (plain http on a LAN address).
    navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => {},
    )
  }

  if (text === null) {
    return (
      <div className="flex flex-col gap-2">
        {failed && (
          <p role="alert" className="text-center text-sm text-warn">Не удалось создать приглашение. Попробуйте ещё раз.</p>
        )}
        <button type="button" onClick={create} disabled={creating} className={BUTTON}>
          Пригласить менеджера
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-lg bg-field p-3 text-sm break-words whitespace-pre-line text-fg-2 ring-1 ring-line ring-inset">
        {text}
      </p>
      <button type="button" onClick={() => (canShare ? share(text) : copy(text))} className={BUTTON}>
        {canShare ? 'Поделиться приглашением' : copied ? 'Скопировано' : 'Скопировать приглашение'}
      </button>
    </div>
  )
}
