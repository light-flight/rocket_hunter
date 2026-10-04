import {
  type APIRequestContext,
  type BrowserContext,
  devices,
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test'

// Does what the manager does in Telegram, through the real webhook: taps the link in the app,
// which opens the bot, then presses «Войти». The sender is the manager "one" from the fixtures;
// the secret is the one config/environments/test.rb sets.
async function confirmInTelegram(page: Page, request: APIRequestContext) {
  const link = page.getByRole('link', { name: 'Войти через Telegram' })
  const href = await link.getAttribute('href')
  // Telegram itself stays out of the test.
  await page.context().route('https://t.me/**', (route) => route.fulfill({ body: '' }))
  const telegram = page.waitForEvent('popup')
  await link.click()
  // The manager comes back to the app: it is the page in front again, as on the phone.
  await (await telegram).close()
  expect(href).toMatch(/^https:\/\/t\.me\/\w+\?start=\w+$/)
  const token = new URL(href!).searchParams.get('start')
  const headers = { 'X-Telegram-Bot-Api-Secret-Token': 'test' }

  const prompt = await request.post('/telegram/webhook', {
    headers,
    data: {
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 1001, first_name: 'Иван' },
        chat: { id: 1001, type: 'private' },
        text: `/start ${token}`,
      },
    },
  })
  expect((await prompt.json()).reply_markup.inline_keyboard[0][0]).toEqual({
    text: 'Войти',
    callback_data: `confirm:${token}`,
  })

  const answer = await request.post('/telegram/webhook', {
    headers,
    data: { update_id: 2, callback_query: { id: '1', from: { id: 1001 }, data: `confirm:${token}` } },
  })
  expect((await answer.json()).text).toContain('Готово')
}

// A phone signs in only inside the installed app. The tests run in a browser tab, so they say
// what the Home Screen app of an iPhone says about itself.
async function asInstalled(context: BrowserContext) {
  await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }))
}

// What the server holds: the team's list of races, as the next phone to sign in gets it.
async function racesOnServer(page: Page): Promise<string[]> {
  const response = await page.request.get('/api/races')
  return (await response.json()).races.map((race: { name: string }) => race.name)
}

test('signs in, keeps races without a network and sends them later', async ({ page, context, request }) => {
  await asInstalled(context)
  const signInButton = page.getByRole('link', { name: 'Войти через Telegram' })
  const sessionExpired = page.getByTestId('session-expired')
  const raceName = page.getByRole('heading', { level: 1 })
  const field = page.getByLabel('Название гонки')

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Rocket Hunter' })).toBeVisible()
  await confirmInTelegram(page, request)

  // Nothing is clicked here: the app notices the confirmation by itself, within one poll.
  // The team has no races yet, so the app asks for the first one.
  const firstRace = page.getByRole('heading', { name: 'Первая гонка' })
  await expect(firstRace).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'Создать гонку' })).toBeDisabled()
  await field.fill('  Этап 1 ·  Крылатское ')
  await page.getByRole('button', { name: 'Создать гонку' }).click()

  await expect(raceName).toHaveText('Этап 1 · Крылатское')
  await expect.poll(() => racesOnServer(page)).toEqual(['Этап 1 · Крылатское'])

  // The service worker is active, so the whole app shell is in the cache.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => null))

  // Anything the page needs but the service worker did not cache fails while offline.
  const failedRequests: string[] = []
  page.on('requestfailed', (failed) => failedRequests.push(new URL(failed.url()).pathname))

  await context.setOffline(true)
  await page.reload()

  // No answer from the server says nothing about the session: the manager stays in the race.
  await expect(raceName).toHaveText('Этап 1 · Крылатское')
  await expect(signInButton).toHaveCount(0)
  await expect(sessionExpired).toHaveCount(0)
  expect(failedRequests.filter((path) => !path.startsWith('/api/'))).toEqual([])

  // A race made without a network is there at once and waits for one. A race is its name: the
  // corridors are chosen in its pits.
  await page.getByRole('button', { name: 'Все гонки' }).click()
  await page.getByRole('button', { name: 'Новая гонка' }).click()
  await field.fill('Этап 2')
  await expect(page.getByRole('radio')).toHaveCount(0)
  await field.press('Enter')
  await expect(raceName).toHaveText('Этап 2')

  // It outlives the app being closed, and the app opens in the race chosen last.
  await page.reload()
  await expect(raceName).toHaveText('Этап 2')
  await page.getByRole('button', { name: 'Все гонки' }).click()
  const rows = page.getByRole('listitem')
  await expect(rows).toHaveText([/^Этап 2.*открыта сейчас.*ждёт сети/, /^Этап 1 · Крылатское/])

  await context.setOffline(false)
  await expect(rows.first()).not.toContainText('ждёт сети')
  expect(await racesOnServer(page)).toEqual(['Этап 2', 'Этап 1 · Крылатское'])

  await rows.first().click()
  await page.getByRole('button', { name: 'Изменить' }).click()
  await expect(field).toHaveValue('Этап 2')
  await field.fill('Этап 2 · Сочи')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(raceName).toHaveText('Этап 2 · Сочи')
  await expect.poll(() => racesOnServer(page)).toEqual(['Этап 2 · Сочи', 'Этап 1 · Крылатское'])

  // A race made on another phone of the team arrives the next time the app opens.
  await page.request.put('/api/races/0b5f6c1e-2a3d-4e5f-8a9b-0c1d2e3f4a5b', {
    data: { race: { name: 'Этап 3 · с другого телефона' } },
  })
  await page.reload()
  await page.getByRole('button', { name: 'Все гонки' }).click()
  await expect(rows.first()).toContainText('Этап 3 · с другого телефона')

  await page.getByRole('button', { name: 'Менеджер: Иван Петров' }).click()
  await expect(page.getByTestId('current-user')).toHaveText('Иван Петров')
  await expect(page.getByTestId('offline-ready')).toHaveText('готово')
  await page.keyboard.press('Escape')

  // A lost session asks to sign in again, but leaves the app on screen.
  await context.clearCookies()
  await page.reload()
  await expect(sessionExpired).toBeVisible()
  await expect(raceName).toHaveText('Этап 2 · Сочи')

  // A race made meanwhile goes to the server as soon as the manager is back.
  await page.getByRole('button', { name: 'Все гонки' }).click()
  await page.getByRole('button', { name: 'Новая гонка' }).click()
  await field.fill('Этап 4')
  await field.press('Enter')
  await expect(raceName).toHaveText('Этап 4')

  await confirmInTelegram(page, request)
  await expect(sessionExpired).toHaveCount(0, { timeout: 10_000 })
  await expect.poll(() => racesOnServer(page)).toContain('Этап 4')

  await page.getByRole('button', { name: 'Все гонки' }).click()
  await page.getByRole('button', { name: 'Менеджер: Иван Петров' }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(signInButton).toBeVisible()
  await expect(rows).toHaveCount(0)

  // The gate is drawn from local storage before the server answers, so wait for the session
  // check: a session that outlived the sign-out would bring the manager back.
  const sessionCheck = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/session' && response.request().method() === 'GET',
  )
  await page.reload()
  expect((await sessionCheck).status()).toBe(401)
  await expect(signInButton).toBeVisible()
  await expect(rows).toHaveCount(0)
})

test('keeps qualification protocols without a network and ranks the karts once they are read', async ({
  page,
  context,
  request,
  browser,
}) => {
  // What another phone does reaches the pits here with their poll, every 10 seconds.
  test.slow()
  await asInstalled(context)
  await page.goto('/')
  await confirmInTelegram(page, request)

  // The races of the previous test are there: this one makes its own.
  await page.getByRole('button', { name: 'Новая гонка' }).click({ timeout: 10_000 })
  await page.getByLabel('Название гонки').fill('Этап 5 · Тольятти')
  await page.getByRole('button', { name: 'Создать гонку' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Этап 5 · Тольятти')
  await expect.poll(() => racesOnServer(page)).toContain('Этап 5 · Тольятти')
  await expect(page.getByRole('button', { name: 'Добавить квалификацию' })).toBeVisible()

  const picker = page.locator('input[type=file]')
  const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ${name}\n`) })
  const files = page.getByRole('region', { name: 'Протоколы' }).getByRole('listitem')
  const karts = page.getByTestId('kart')

  // Picked without a network: kept on the phone, through a restart, until there is one.
  await context.setOffline(true)
  await picker.setInputFiles([pdf('Квала 9.pdf')])
  await expect(files).toHaveText([/Квала 9\.pdf.*Ждёт сети/])
  await page.reload()
  await expect(files).toHaveText([/Квала 9\.pdf.*Ждёт сети/])

  await context.setOffline(false)
  await expect(files).toHaveCount(0, { timeout: 15_000 })
  await expect(page.getByRole('button', { name: /1 протокол · 13 картов/ })).toBeVisible()
  await expect(karts).toHaveCount(13)
  await expect(karts.first()).toHaveText(/^1\s*1\s*40\.899\s*1 заезд/)
  await expect(karts.nth(1)).toHaveText(/^2\s*11\s*41\.167\s*1 заезд\s*\+0\.268$/)

  // The same protocol again is not read twice, and its laps count once. A file with a note
  // keeps the list of files in sight.
  await picker.setInputFiles([pdf('Квала 9.pdf')])
  await expect(files).toHaveCount(2, { timeout: 15_000 })
  await expect(files.nth(1)).toContainText('есть замечания', { timeout: 15_000 })
  await expect(karts.first()).toContainText('1 заезд')

  await files.nth(1).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toContainText('Тот же файл, что «Квала 9.pdf»')
  await expect(sheet.getByRole('row')).toHaveCount(13)
  page.once('dialog', (dialog) => dialog.accept())
  await sheet.getByRole('button', { name: 'Убрать файл' }).click()
  await expect(page.getByRole('button', { name: /1 протокол · 13 картов/ })).toBeVisible()

  // Another phone of the team sees the same files.
  const raceId = await page.evaluate(() => localStorage.getItem('rocket-hunter.race'))
  await expect
    .poll(async () => (await (await page.request.get(`/api/races/${raceId}/qualification_files`)).json()).files.length)
    .toBe(1)

  // The pits. The first time they are opened they ask how many corridors the pit lane has, one
  // unless told otherwise, and show nothing else until told.
  await page.getByRole('tab', { name: 'Пит-стопы' }).click()
  const lanes = page.getByRole('radiogroup', { name: 'Сколько коридоров в пите?' })
  const corridors = page.getByTestId('corridor')
  const queue = (lane: number) => corridors.nth(lane).getByTestId('corridor-kart')
  // The karts in a corridor, front first: 'q7' is the kart team 7 qualified on, 's2' the third spare.
  const inCorridor = (lane: number) =>
    queue(lane).evaluateAll((karts) => karts.map((kart) => kart.getAttribute('data-kart')))
  const grid = page.getByTestId('pit-kart')
  const team = (number: string) => page.getByRole('button', { name: `Номер ${number}`, exact: true })
  const undo = page.getByRole('button', { name: 'Отменить' })
  const redo = page.getByRole('button', { name: 'Вернуть' })
  const more = page.getByRole('button', { name: 'Ещё' })
  const done = page.getByRole('button', { name: 'Готово' })
  await expect(lanes.getByRole('radio', { name: '1 коридор' })).toBeChecked()
  await expect(corridors).toHaveCount(0)
  await expect(grid).toHaveCount(0)
  for (const key of [undo, redo, more, page.getByRole('button', { name: 'Журнал' })]) await expect(key).toHaveCount(0)

  // The finger slides along the pictures of the pit lane, and the choice follows it.
  const one = (await lanes.getByRole('radio', { name: '1 коридор' }).boundingBox())!
  const two = (await lanes.getByRole('radio', { name: '2 коридора' }).boundingBox())!
  await page.mouse.move(one.x + one.width / 2, one.y + one.height / 2)
  await page.mouse.down()
  await page.mouse.move(two.x + two.width / 2, two.y + two.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(lanes.getByRole('radio', { name: '2 коридора' })).toBeChecked()
  await done.click()

  // Then the corridors, and below them every team of the qualification.
  await expect(lanes).toHaveCount(0)
  await expect(corridors).toHaveCount(2)
  await expect(grid).toHaveCount(13)

  // Before any stop each team is on the kart it qualified on: 1 the fastest, 20 the slowest.
  await expect(team('1')).toHaveAttribute('data-pace', '0')
  await expect(team('20')).toHaveAttribute('data-pace', '1')
  const kart5 = (await team('5').getAttribute('data-pace'))!
  const kart9 = (await team('9').getAttribute('data-pace'))!
  for (const pace of [kart5, kart9]) expect(pace).toMatch(/^0\.\d+$/)

  // Before the start the corridors get their spare karts by a long press.
  const longPress = async (lane: number) => {
    const box = (await corridors.nth(lane).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(700)
    await page.mouse.up()
    await page.getByRole('menuitem', { name: 'Добавить неизвестную тачку' }).click()
  }
  for (const lane of [0, 0, 1, 1]) await longPress(lane)
  await expect.poll(() => inCorridor(0)).toEqual(['s0', 's1'])
  await expect.poll(() => inCorridor(1)).toEqual(['s2', 's3'])

  // A kart in a corridor has no number on it: the number went out on the kart at the front. One
  // nobody knows the pace of has no colour and a dashed edge, and no «?» drawn on it.
  const unknown = async (tile: Locator) => {
    await expect(tile).toHaveAttribute('data-pace', 'unknown')
    await expect(tile).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(tile).toHaveCSS('outline-style', 'dashed')
    expect(await tile.evaluate((element) => getComputedStyle(element, '::after').content)).toBe('none')
  }
  await expect(queue(0)).toHaveText(['', ''])
  await unknown(queue(0).first())

  // A team dragged into a corridor leaves its kart at the end and goes out on the one at the front.
  const dragInto = async (number: string, lane: number) => {
    const from = (await team(number).boundingBox())!
    const to = (await corridors.nth(lane).boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 })
    await page.mouse.up()
  }
  // The next team is dragged once the last one has landed.
  await dragInto('1', 1)
  await expect.poll(() => inCorridor(1)).toEqual(['s3', 'q1'])
  await dragInto('5', 1)
  await expect.poll(() => inCorridor(1)).toEqual(['q1', 'q5'])
  await dragInto('9', 1)
  await expect.poll(() => inCorridor(1)).toEqual(['q5', 'q9'])
  // The karts 5 and 9 came on stay in the corridor with their pace, and with no number. 9 went out
  // on the kart of 1, the fastest, and 1 and 5 on spares nobody knows the pace of. Every team is
  // still in the grid.
  await expect(queue(1)).toHaveText(['', ''])
  await expect(queue(1).nth(0)).toHaveAttribute('data-pace', kart5)
  await expect(queue(1).nth(1)).toHaveAttribute('data-pace', kart9)
  await expect(grid).toHaveCount(13)
  await expect(page.getByRole('button', { name: 'Другой номер' })).toBeVisible()
  await expect(team('9')).toHaveAttribute('data-pace', '0')
  await unknown(team('1'))
  await expect(team('1')).toHaveText('1')
  await expect(team('5')).toHaveAttribute('data-pace', 'unknown')

  // A team that comes in again leaves the spare it was on at the end, and goes out on the next one.
  await dragInto('1', 0)
  await expect.poll(() => inCorridor(0)).toEqual(['s1', 's2'])
  await expect(queue(0).nth(0)).toHaveAttribute('data-pace', 'unknown')
  await expect(queue(0).nth(1)).toHaveAttribute('data-pace', 'unknown')
  await expect(team('1')).toHaveAttribute('data-pace', 'unknown')

  // A number that is not in the grid is typed in, with the corridor it came into. It is read the
  // way the protocols are, so " 07" is 7. Anything that is not a number records nothing.
  const other = page.getByRole('dialog', { name: 'Другой номер' })
  const number = other.getByLabel('Номер')
  await page.getByRole('button', { name: 'Другой номер' }).click()
  await expect(number).toBeFocused()
  await number.fill('1234')
  await other.getByRole('button', { name: 'Коридор 1' }).click()
  await expect(other.getByRole('alert')).toHaveText('Номер — до трёх цифр, можно с буквой: 7, 12A')
  await expect.poll(() => inCorridor(0)).toEqual(['s1', 's2'])
  await expect(grid).toHaveCount(13)
  await number.fill(' 07')
  await other.getByRole('button', { name: 'Коридор 1' }).click()
  await expect(other).toBeHidden()
  await expect(grid).toHaveCount(14)
  await expect(team('7')).toHaveAttribute('data-pace', 'unknown')
  await expect.poll(() => inCorridor(0)).toEqual(['s2', 'q7'])
  await expect(queue(0).nth(1)).toHaveAttribute('data-pace', 'unknown')

  // Undone back to the very first move, done again, and all of it kept through a restart.
  await undo.click()
  await expect.poll(() => inCorridor(0)).toEqual(['s1', 's2'])
  for (let i = 0; i < 8; i++) await undo.click()
  await expect(undo).toBeDisabled()
  await expect(queue(0)).toHaveCount(0)
  await expect(team('9')).toHaveAttribute('data-pace', kart9)
  for (let i = 0; i < 9; i++) await redo.click()
  await expect.poll(() => inCorridor(0)).toEqual(['s2', 'q7'])
  await expect.poll(() => inCorridor(1)).toEqual(['q5', 'q9'])
  await page.reload()
  await expect.poll(() => inCorridor(0)).toEqual(['s2', 'q7'])
  await expect.poll(() => inCorridor(1)).toEqual(['q5', 'q9'])

  // The server has the pits too, for the other phones of the team: every move entered on any phone,
  // with its id and time, the ids of the moves undone, and the corridors. The undo above undid 9
  // moves, and the redo entered them again as new ones.
  type Move = { id: string; lane: number; kart: string | null; at: number }
  type PitLog = { moves: Move[]; undone: string[]; total: { moves: number; undone: number }; lanes: number | null }
  const pitsOnServer = async (): Promise<PitLog> => (await page.request.get(`/api/races/${raceId}/pit_log`)).json()
  // What stands there, the way the phones work it out: the moves not undone, by the time they were
  // entered.
  const standingOnServer = async () => {
    const { moves, undone } = await pitsOnServer()
    return moves
      .filter((move) => !undone.includes(move.id))
      .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))
      .map(({ lane, kart }) => [lane, kart])
  }
  const sendPits = (moves: Move[]) => page.request.put(`/api/races/${raceId}/pit_log`, { data: { pit_log: { moves } } })
  await expect.poll(async () => (await pitsOnServer()).total).toEqual({ moves: 18, undone: 9 })
  expect(await standingOnServer()).toHaveLength(9)
  expect((await pitsOnServer()).lanes).toBe(2)

  // The journal: which team came into which corridor, the last first, and when it was entered, to
  // the second. The redo entered the moves again at the times they had.
  const journal = page.getByRole('dialog', { name: 'Журнал' })
  const entered = (stop: string) => new RegExp(`^\\d\\d:\\d\\d:\\d\\d\\s*${stop}$`)
  await page.getByRole('button', { name: 'Журнал' }).click()
  await expect(journal.getByRole('listitem')).toHaveText([
    entered('Номер 7 → коридор 1'),
    entered('Номер 1 → коридор 1'),
    entered('Номер 9 → коридор 2'),
    entered('Номер 5 → коридор 2'),
    entered('Номер 1 → коридор 2'),
    entered('Запасной карт → коридор 2'),
    entered('Запасной карт → коридор 2'),
    entered('Запасной карт → коридор 1'),
    entered('Запасной карт → коридор 1'),
  ])
  // The time 7 was typed in, by the clock of the phone that entered it.
  const seven = (await pitsOnServer()).moves.find((move) => move.kart === '7')!.at
  const time = await page.evaluate(
    (at) => new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    seven,
  )
  await expect(journal.getByRole('listitem').first()).toHaveText(new RegExp(`^${time}`))
  await journal.getByRole('button', { name: 'Закрыть' }).click()
  await expect(journal).toBeHidden()

  // Without a network an undo is kept here, and goes once the network is back.
  await context.setOffline(true)
  await undo.click()
  await expect.poll(() => inCorridor(0)).toEqual(['s1', 's2'])
  await context.setOffline(false)
  await expect.poll(async () => (await standingOnServer()).length).toBe(8)

  // Moves made on another phone arrive here. That phone sends the moves it entered, each with its
  // own id; the same send again, as after an answer that was lost, changes nothing.
  const three = { id: 'e2e-three', lane: 0, kart: '3', at: Date.now() }
  expect((await sendPits([three])).status()).toBe(204)
  const total = (await pitsOnServer()).total
  expect((await sendPits([three])).status()).toBe(204)
  expect((await pitsOnServer()).total).toEqual(total)
  await page.reload()
  await expect.poll(() => inCorridor(0)).toEqual(['s2', 'q3'])
  await expect.poll(() => inCorridor(1)).toEqual(['q5', 'q9'])

  // Two phones enter at once: this one without a network, another one a moment later. Neither move
  // is lost once the network is back, and they stand in the order they were entered.
  await context.setOffline(true)
  await dragInto('11', 1)
  await expect.poll(() => inCorridor(1)).toEqual(['q9', 'q11'])
  expect((await sendPits([{ id: 'e2e-thirteen', lane: 1, kart: '13', at: Date.now() + 1000 }])).status()).toBe(204)
  await context.setOffline(false)
  // 11 went out on the kart 5 had left, and 13 after it on the one 9 had left.
  await expect.poll(() => inCorridor(1)).toEqual(['q11', 'q13'])
  await expect.poll(async () => (await standingOnServer()).slice(-2)).toEqual([
    [1, '11'],
    [1, '13'],
  ])
  await expect(team('11')).toHaveAttribute('data-pace', kart5)
  await expect(team('13')).toHaveAttribute('data-pace', kart9)

  // The server takes a move, but its answer is lost on the way back: 15 went into corridor 1 by
  // mistake. With no network then, the manager undoes it and drags 15 into corridor 2, and another
  // phone enters 17 meanwhile. Once the network is back the move goes again, the undo with it, and
  // 15 came in once, where it really did.
  let lose = true
  await page.route(`**/api/races/${raceId}/pit_log`, async (route) => {
    if (route.request().method() !== 'PUT' || !lose) return route.fallback()
    lose = false
    await route.fetch()
    await route.abort()
  })
  const taken = (await pitsOnServer()).total.moves
  await dragInto('15', 0)
  await expect.poll(() => inCorridor(0)).toEqual(['q3', 'q15'])
  await expect.poll(async () => (await pitsOnServer()).total.moves).toBe(taken + 1)
  await context.setOffline(true)
  await undo.click()
  await expect.poll(() => inCorridor(0)).toEqual(['s2', 'q3'])
  await dragInto('15', 1)
  await expect.poll(() => inCorridor(1)).toEqual(['q13', 'q15'])
  expect((await sendPits([{ id: 'e2e-seventeen', lane: 0, kart: '17', at: Date.now() + 1000 }])).status()).toBe(204)
  await context.setOffline(false)
  await expect.poll(() => inCorridor(0)).toEqual(['q3', 'q17'])
  await expect.poll(() => inCorridor(1)).toEqual(['q13', 'q15'])
  await expect.poll(async () => (await standingOnServer()).slice(-2)).toEqual([
    [1, '15'],
    [0, '17'],
  ])
  expect((await standingOnServer()).filter(([, kart]) => kart === '15')).toEqual([[1, '15']])
  expect((await pitsOnServer()).total.moves).toBe(taken + 3)

  // A protocol read later in the race brings its teams into the pits, on the karts they qualified
  // on: «Квала 10» has 33 too. Added on another phone, it comes into the pits here once it is read,
  // with nothing done on this phone and no restart. 7, typed in by hand, went with the undo without
  // a network.
  await expect(grid).toHaveCount(13)
  await expect(team('7')).toHaveCount(0)
  const added = await page.request.put(`/api/races/${raceId}/qualification_files/6d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6`, {
    multipart: { file: pdf('Квала 10.pdf'), name: 'Квала 10.pdf', added_at: new Date().toISOString() },
  })
  expect(added.status()).toBe(201)
  await expect(team('33')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('tab', { name: 'Пит-стопы' })).toHaveAttribute('aria-selected', 'true')
  await expect(team('33')).toHaveAttribute('data-pace', /^0\.\d+$/)
  await expect(grid).toHaveCount(14)
  // 13 is on the kart 9 qualified on, at its pace with both protocols read.
  const kart9Now = (await team('13').getAttribute('data-pace'))!

  // Starting the pits over is asked first: a «no» leaves them as they are, and the focus where it was.
  await more.click()
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('menuitem', { name: 'Начать сначала' }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(more).toBeFocused()
  await expect.poll(() => inCorridor(0)).toEqual(['q3', 'q17'])

  // A «yes» undoes every stop, on every phone, and the pits ask for their corridors again.
  let asked = ''
  await more.click()
  page.once('dialog', (dialog) => {
    asked = dialog.message()
    void dialog.accept()
  })
  await page.getByRole('menuitem', { name: 'Начать сначала' }).click()
  await expect(lanes).toBeVisible()
  expect(asked).toBe('Начать пит-стопы сначала? Смены сотрутся на всех телефонах, коридоры выберете заново.')
  await expect(corridors).toHaveCount(0)
  await expect(grid).toHaveCount(0)
  await expect
    .poll(async () => {
      const log = await pitsOnServer()
      return { lanes: log.lanes, undone: log.moves.every((move) => log.undone.includes(move.id)) }
    })
    .toEqual({ lanes: null, undone: true })
  expect(await standingOnServer()).toEqual([])

  // Chosen again, the corridors are empty, and every team is back on the kart it qualified on.
  await lanes.getByRole('radio', { name: '3 коридора' }).click()
  await done.click()
  await expect(corridors).toHaveCount(3)
  await expect(page.getByTestId('corridor-kart')).toHaveCount(0)
  await expect(grid).toHaveCount(14)
  await expect(team('1')).toHaveAttribute('data-pace', '0')
  await expect(team('9')).toHaveAttribute('data-pace', kart9Now)
  await expect(undo).toBeDisabled()
  await expect.poll(async () => (await pitsOnServer()).lanes).toBe(3)

  // Once anything stands the corridors stay: one chosen later on another phone, which had not read
  // the pits, changes nothing, there or here.
  const sendLanes = (lanes: number | null, at: number, undone: string[] = []) =>
    page.request.put(`/api/races/${raceId}/pit_log`, { data: { pit_log: { undone, lanes, lanes_at: at } } })
  await longPress(2)
  await longPress(0)
  await expect.poll(() => inCorridor(2)).toEqual(['s0'])
  await expect.poll(() => inCorridor(0)).toEqual(['s1'])
  await expect.poll(async () => (await standingOnServer()).length).toBe(2)
  expect((await sendLanes(1, Date.now() + 1000)).status()).toBe(204)
  expect((await pitsOnServer()).lanes).toBe(3)

  // The same on a second phone that has never read these pits, with no network for them: it asks for
  // the corridors, and its choice gives way to the ones the race is on once the network is back.
  const phone = await browser.newContext({ ...devices['Pixel 7'], baseURL: test.info().project.use.baseURL })
  await asInstalled(phone)
  const second = await phone.newPage()
  const pitLog = (url: URL) => url.pathname.endsWith('/pit_log')
  await second.route(pitLog, (route) => route.abort())
  await second.goto('/')
  await confirmInTelegram(second, request)
  await second.getByRole('button', { name: /^Этап 5 · Тольятти/ }).click({ timeout: 10_000 })
  await second.getByRole('tab', { name: 'Пит-стопы' }).click()
  await second.getByRole('button', { name: 'Готово' }).click()
  await expect(second.getByTestId('corridor')).toHaveCount(1)
  await second.unroute(pitLog)
  await expect(second.getByTestId('corridor')).toHaveCount(3, { timeout: 15_000 })
  await expect(second.getByTestId('corridor-kart')).toHaveCount(2)
  await phone.close()
  expect((await pitsOnServer()).lanes).toBe(3)
  await expect(corridors).toHaveCount(3)

  // Started over on another phone, and the corridors chosen there: they come here, and what was
  // undone here before cannot be entered again.
  await undo.click()
  await expect(redo).toBeEnabled()
  await expect.poll(async () => (await standingOnServer()).length).toBe(1)
  const ids = (await pitsOnServer()).moves.map((move) => move.id)
  expect((await sendLanes(null, Date.now() + 1000, ids)).status()).toBe(204)
  expect((await sendLanes(2, Date.now() + 2000)).status()).toBe(204)
  await expect(corridors).toHaveCount(2, { timeout: 15_000 })
  await expect(page.getByTestId('corridor-kart')).toHaveCount(0)
  await expect(undo).toBeDisabled()
  await expect(redo).toBeDisabled()

  // Started over there once more: the pits here ask for their corridors again.
  expect((await sendLanes(null, Date.now() + 3000)).status()).toBe(204)
  await expect(lanes).toBeVisible({ timeout: 15_000 })
  await done.click()
  await expect(corridors).toHaveCount(1)
  await expect.poll(async () => (await pitsOnServer()).lanes).toBe(1)
})

// Protocols come out late: the pits are entered from the start of the race, by number.
test('enters the pits before any protocol, by the numbers typed in', async ({ page, context, request }) => {
  await asInstalled(context)
  await page.goto('/')
  await confirmInTelegram(page, request)

  await page.getByRole('button', { name: 'Новая гонка' }).click({ timeout: 10_000 })
  await page.getByLabel('Название гонки').fill('Этап 6 · Рязань')
  await page.getByRole('button', { name: 'Создать гонку' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Этап 6 · Рязань')
  await expect.poll(() => racesOnServer(page)).toContain('Этап 6 · Рязань')

  const pitsTab = page.getByRole('tab', { name: 'Пит-стопы' })
  const team = page.getByRole('button', { name: 'Номер 12A', exact: true })
  await page.getByRole('button', { name: 'Пит-стопы без квалификации' }).click()
  await expect(pitsTab).toHaveAttribute('aria-selected', 'true')

  // The first time, the pits ask how many corridors the pit lane has: one unless told otherwise.
  const lanes = page.getByRole('radiogroup', { name: 'Сколько коридоров в пите?' })
  await expect(lanes.getByRole('radio', { name: '1 коридор' })).toBeChecked()
  await expect(page.getByText('Скорость картов появится после квалификации')).toHaveCount(0)
  await page.getByRole('button', { name: 'Готово' }).click()
  await expect(lanes).toHaveCount(0)
  await expect(page.getByTestId('corridor')).toHaveCount(1)
  await expect(page.getByText('Скорость картов появится после квалификации')).toBeVisible()
  await expect(page.getByTestId('pit-kart')).toHaveCount(0)

  // A team typed in is in the grid from then on, on a kart nobody knows the pace of. 12а typed
  // with a Russian letter is 12A. It came into an empty corridor, so it went out on its own kart.
  await page.getByRole('button', { name: 'Другой номер' }).click()
  const other = page.getByRole('dialog', { name: 'Другой номер' })
  await other.getByLabel('Номер').fill('12а')
  await other.getByRole('button', { name: 'Коридор 1' }).click()
  await expect(other).toBeHidden()
  await expect(team).toHaveAttribute('data-pace', 'unknown')
  await expect(page.getByTestId('corridor-kart')).toHaveCount(0)

  // The other tab leads back to the protocols.
  await page.getByRole('tab', { name: 'Квалификация' }).click()
  await expect(page.getByRole('button', { name: 'Добавить квалификацию' })).toBeVisible()

  // The server has the move and the corridors, and the race opens in its pits from now on.
  const raceId = await page.evaluate(() => localStorage.getItem('rocket-hunter.race'))
  await expect
    .poll(async () => {
      const log = await (await page.request.get(`/api/races/${raceId}/pit_log`)).json()
      return { moves: log.moves, lanes: log.lanes }
    })
    .toEqual({ moves: [{ id: expect.any(String), lane: 0, kart: '12A', at: expect.any(Number) }], lanes: 1 })
  await page.reload()
  await expect(pitsTab).toHaveAttribute('aria-selected', 'true')
  await expect(team).toBeVisible()
})

// The number is the driver's. A driver may come into the same corridor again and again, right one
// after another: each time the number goes from the kart they came on onto the one at the front.
test('a driver changes karts in the same corridor as often as they come in', async ({ page, context, request }) => {
  await asInstalled(context)
  await page.goto('/')
  await confirmInTelegram(page, request)

  await page.getByRole('button', { name: 'Новая гонка' }).click({ timeout: 10_000 })
  await page.getByLabel('Название гонки').fill('Этап 7 · Тула')
  await page.getByRole('button', { name: 'Создать гонку' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Этап 7 · Тула')
  await page.getByRole('button', { name: 'Пит-стопы без квалификации' }).click()
  await page.getByRole('button', { name: 'Готово' }).click()

  const corridor = page.getByTestId('corridor')
  const inCorridor = () =>
    corridor
      .getByTestId('corridor-kart')
      .evaluateAll((karts) => karts.map((kart) => kart.getAttribute('data-kart')))
  for (let spare = 0; spare < 2; spare++) {
    const box = (await corridor.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(700)
    await page.mouse.up()
    await page.getByRole('menuitem', { name: 'Добавить неизвестную тачку' }).click()
  }
  await expect.poll(inCorridor).toEqual(['s0', 's1'])

  // 12 comes in on the kart it qualified on and goes out on s0.
  await page.getByRole('button', { name: 'Другой номер' }).click()
  const other = page.getByRole('dialog', { name: 'Другой номер' })
  await other.getByLabel('Номер').fill('12')
  await other.getByRole('button', { name: 'Коридор 1' }).click()
  await expect.poll(inCorridor).toEqual(['s1', 'q12'])

  // Then again and again, seconds apart: first in, first out, every time.
  const team = page.getByRole('button', { name: 'Номер 12', exact: true })
  const dragIn = async () => {
    const from = (await team.boundingBox())!
    const to = (await corridor.boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 })
    await page.mouse.up()
  }
  for (const after of [
    ['q12', 's0'],
    ['s0', 's1'],
    ['s1', 'q12'],
    ['q12', 's0'],
  ]) {
    await dragIn()
    await expect.poll(inCorridor).toEqual(after)
  }

  // Every one of the five stops is in the journal, and on the server.
  await page.getByRole('button', { name: 'Журнал' }).click()
  await expect(page.getByRole('dialog', { name: 'Журнал' }).getByRole('listitem')).toHaveText(
    [...Array(5).fill(/Номер 12 → коридор 1/), /Запасной карт/, /Запасной карт/],
  )
  const raceId = await page.evaluate(() => localStorage.getItem('rocket-hunter.race'))
  await expect
    .poll(async () => {
      const log = await (await page.request.get(`/api/races/${raceId}/pit_log`)).json()
      return log.moves.filter((move: { kart: string | null }) => move.kart === '12').length
    })
    .toBe(5)

  // «Отменить» takes back the last stop only: the number is back on the kart it came in on.
  await page.getByRole('dialog', { name: 'Журнал' }).getByRole('button', { name: 'Закрыть' }).click()
  await page.getByRole('button', { name: 'Отменить' }).click()
  await expect.poll(inCorridor).toEqual(['s1', 'q12'])
})

test('a database that cannot be opened leaves a way out, not a blank screen', async ({ page, context }) => {
  await asInstalled(context)
  await context.addInitScript(() => {
    localStorage.setItem('rocket-hunter.user', JSON.stringify({ name: 'Иван Петров' }))
    IDBFactory.prototype.open = () => {
      throw new DOMException('Internal error opening backing store', 'UnknownError')
    }
  })
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Не удалось прочитать данные на телефоне' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Перезапустить' })).toBeVisible()
})

test('server paths are answered by Rails, not by the cached app shell', async ({ page }) => {
  await page.goto('/')
  // The service worker is active, so the whole app shell is in the cache.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => null))
  // Reload so the page is controlled by the service worker.
  await page.reload()

  const response = await page.goto('/up')

  expect(response?.fromServiceWorker()).toBe(false)
  await expect(page.locator('#root')).toHaveCount(0)
})

test.describe('in a browser on a phone, before the app is installed', () => {
  const signIn = 'Войти через Telegram'

  test('Android offers to install, by a key or by steps, and no sign-in', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Установите приложение' })).toBeVisible()
    await expect(page.getByText(signIn)).toHaveCount(0)
  })

  test('inside Telegram on Android the way out is a link that opens Chrome', async ({ page, context }) => {
    await context.addInitScript(() => Object.assign(window, { TelegramWebview: {} }))
    await page.goto('/')

    await expect(page.getByRole('link', { name: 'Открыть в Chrome' })).toHaveAttribute(
      'href',
      'intent://localhost:3100/#Intent;scheme=https;package=com.android.chrome;end',
    )
    await expect(page.getByText(signIn)).toHaveCount(0)
  })

  test.describe('Safari 26 on iPhone', () => {
    test.use({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
    })

    test('shows the steps of its own menus', async ({ page }) => {
      await page.goto('/')

      await expect(page.getByRole('listitem')).toHaveText([
        /Ещё.*Поделиться/,
        /Добавить на экран «Домой»/,
        /Добавить.*переключатель/,
        /Rocket\sHunter.*на экране «Домой»/,
      ])
      await expect(page.getByText(signIn)).toHaveCount(0)
    })

    test('inside Telegram the way out is a link that opens Safari', async ({ page, context }) => {
      await context.addInitScript(() => Object.assign(window, { TelegramWebviewProxy: {} }))
      await page.goto('/')

      await expect(page.getByRole('link', { name: 'Открыть в Safari' })).toHaveAttribute(
        'href',
        'x-safari-https://localhost:3100/',
      )
    })
  })

  test.describe('Chrome on iPhone', () => {
    test.use({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1',
    })

    test('shows the steps at once, without sending to Safari', async ({ page }) => {
      await page.goto('/')

      await expect(page.getByRole('listitem')).toHaveText([
        /Поделиться.*в меню браузера/,
        /На экран «Домой»/,
        /Добавить/,
        /Rocket\sHunter.*на экране «Домой»/,
      ])
      await expect(page.getByRole('link', { name: 'Открыть в Safari' })).toHaveCount(0)
    })
  })
})
