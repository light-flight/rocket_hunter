import { type APIRequestContext, type BrowserContext, expect, type Page, test } from '@playwright/test'

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

async function lanesOnServer(page: Page, name: string): Promise<number | undefined> {
  const response = await page.request.get('/api/races')
  return (await response.json()).races.find((race: { name: string }) => race.name === name)?.lanes
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

  // A race made without a network is there at once and waits for one.
  await page.getByRole('button', { name: 'Все гонки' }).click()
  await page.getByRole('button', { name: 'Новая гонка' }).click()
  await field.fill('Этап 2')
  await expect(page.getByRole('radio', { name: '1 коридор' })).toBeChecked()
  await page.getByRole('radio', { name: '2 коридора' }).click()
  await expect(page.getByRole('radio', { name: '2 коридора' })).toBeChecked()
  await field.press('Enter')
  await expect(raceName).toHaveText('Этап 2')
  await expect(page.getByTestId('race-lanes')).toHaveText('2 коридора')

  // It outlives the app being closed, and the app opens in the race chosen last.
  await page.reload()
  await expect(raceName).toHaveText('Этап 2')
  await page.getByRole('button', { name: 'Все гонки' }).click()
  const rows = page.getByRole('listitem')
  await expect(rows).toHaveText([/^Этап 2.*открыта сейчас.*ждёт сети/, /^Этап 1 · Крылатское/])

  await context.setOffline(false)
  await expect(rows.first()).not.toContainText('ждёт сети')
  expect(await racesOnServer(page)).toEqual(['Этап 2', 'Этап 1 · Крылатское'])
  expect(await lanesOnServer(page, 'Этап 2')).toBe(2)

  await rows.first().click()
  await page.getByRole('button', { name: 'Изменить' }).click()
  await expect(field).toHaveValue('Этап 2')
  await expect(page.getByRole('radio', { name: '2 коридора' })).toBeChecked()
  await field.fill('Этап 2 · Сочи')
  await page.getByRole('radio', { name: '1 коридор' }).click()
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(raceName).toHaveText('Этап 2 · Сочи')
  await expect(page.getByTestId('race-lanes')).toHaveText('1 коридор')
  await expect.poll(() => racesOnServer(page)).toEqual(['Этап 2 · Сочи', 'Этап 1 · Крылатское'])
  expect(await lanesOnServer(page, 'Этап 2 · Сочи')).toBe(1)

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
}) => {
  await asInstalled(context)
  await page.goto('/')
  await confirmInTelegram(page, request)

  // The races of the previous test are there: this one makes its own.
  await page.getByRole('button', { name: 'Новая гонка' }).click({ timeout: 10_000 })
  await page.getByLabel('Название гонки').fill('Этап 5 · Тольятти')
  await page.getByRole('radio', { name: '2 коридора' }).click()
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

  // The pits. Before the start the corridors get their unknown karts by a long press.
  await page.getByRole('tab', { name: 'Пит-стопы' }).click()
  const corridors = page.getByTestId('corridor')
  const queue = (lane: number) => corridors.nth(lane).getByTestId('corridor-kart')
  const grid = page.getByTestId('pit-kart')
  const team = (number: string) => page.getByRole('button', { name: `Номер ${number}`, exact: true })
  await expect(corridors).toHaveCount(2)
  await expect(grid).toHaveCount(13)

  // Before any stop each team is on the kart it qualified on: 1 the fastest, 20 the slowest.
  await expect(team('1')).toHaveAttribute('data-pace', '0')
  await expect(team('20')).toHaveAttribute('data-pace', '1')
  const kart5 = (await team('5').getAttribute('data-pace'))!
  const kart9 = (await team('9').getAttribute('data-pace'))!
  for (const pace of [kart5, kart9]) expect(pace).toMatch(/^0\.\d+$/)

  const longPress = async (lane: number) => {
    const box = (await corridors.nth(lane).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(700)
    await page.mouse.up()
    await page.getByRole('menuitem', { name: 'Добавить неизвестную тачку' }).click()
  }
  for (const lane of [0, 0, 1, 1]) await longPress(lane)
  await expect(queue(0)).toHaveText(['?', '?'])
  await expect(queue(1)).toHaveText(['?', '?'])

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
  await expect(queue(1)).toHaveText(['?', '1'])
  await dragInto('5', 1)
  await expect(queue(1)).toHaveText(['1', '5'])
  await dragInto('9', 1)
  await expect(queue(1)).toHaveText(['5', '9'])
  // The karts 5 and 9 came on stay in the corridor with their pace. 9 went out on the kart of 1,
  // the fastest, and 1 and 5 on spares nobody knows the pace of. Every team is still in the grid.
  await expect(queue(1).nth(0)).toHaveAttribute('data-pace', kart5)
  await expect(queue(1).nth(1)).toHaveAttribute('data-pace', kart9)
  await expect(grid).toHaveCount(13)
  await expect(page.getByRole('button', { name: 'Другой номер' })).toBeVisible()
  await expect(team('9')).toHaveAttribute('data-pace', '0')
  await expect(team('1')).toHaveAttribute('data-pace', 'unknown')
  await expect(team('5')).toHaveAttribute('data-pace', 'unknown')

  // A team that comes in again leaves the spare it was on at the end, and goes out on the next one.
  await dragInto('1', 0)
  await expect(queue(0)).toHaveText(['?', '1'])
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
  await expect(queue(0)).toHaveText(['?', '1'])
  await expect(grid).toHaveCount(13)
  await number.fill(' 07')
  await other.getByRole('button', { name: 'Коридор 1' }).click()
  await expect(other).toBeHidden()
  await expect(grid).toHaveCount(14)
  await expect(team('7')).toHaveAttribute('data-pace', 'unknown')
  await expect(queue(0)).toHaveText(['1', '7'])
  await expect(queue(0).nth(1)).toHaveAttribute('data-pace', 'unknown')

  // Undone back to the very first move, done again, and all of it kept through a restart.
  await page.getByRole('button', { name: 'Отменить' }).click()
  await expect(queue(0)).toHaveText(['?', '1'])
  for (let i = 0; i < 8; i++) await page.getByRole('button', { name: 'Отменить' }).click()
  await expect(page.getByRole('button', { name: 'Отменить' })).toBeDisabled()
  await expect(queue(0)).toHaveCount(0)
  await expect(team('9')).toHaveAttribute('data-pace', kart9)
  for (let i = 0; i < 9; i++) await page.getByRole('button', { name: 'Вернуть' }).click()
  await expect(queue(0)).toHaveText(['1', '7'])
  await expect(queue(1)).toHaveText(['5', '9'])
  await page.reload()
  await expect(queue(0)).toHaveText(['1', '7'])
  await expect(queue(1)).toHaveText(['5', '9'])

  // The server has the pits too, for the other phones of the team: every move entered on any phone,
  // with its id and time, and the ids of the moves undone. The undo above undid 9 moves, and the
  // redo entered them again as new ones.
  type Move = { id: string; lane: number; kart: string | null; at: number }
  type PitLog = { moves: Move[]; undone: string[]; total: { moves: number; undone: number } }
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

  // Without a network an undo is kept here, and goes once the network is back.
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Отменить' }).click()
  await expect(queue(0)).toHaveText(['?', '1'])
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
  await expect(queue(0)).toHaveText(['1', '3'])
  await expect(queue(1)).toHaveText(['5', '9'])

  // Two phones enter at once: this one without a network, another one a moment later. Neither move
  // is lost once the network is back, and they stand in the order they were entered.
  await context.setOffline(true)
  await dragInto('11', 1)
  await expect(queue(1)).toHaveText(['9', '11'])
  expect((await sendPits([{ id: 'e2e-thirteen', lane: 1, kart: '13', at: Date.now() + 1000 }])).status()).toBe(204)
  await context.setOffline(false)
  // 11 went out on the kart 5 had left, and 13 after it on the one 9 had left.
  await expect(queue(1)).toHaveText(['11', '13'])
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
  await expect(queue(0)).toHaveText(['3', '15'])
  await expect.poll(async () => (await pitsOnServer()).total.moves).toBe(taken + 1)
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Отменить' }).click()
  await expect(queue(0)).toHaveText(['1', '3'])
  await dragInto('15', 1)
  await expect(queue(1)).toHaveText(['13', '15'])
  expect((await sendPits([{ id: 'e2e-seventeen', lane: 0, kart: '17', at: Date.now() + 1000 }])).status()).toBe(204)
  await context.setOffline(false)
  await expect(queue(0)).toHaveText(['3', '17'])
  await expect(queue(1)).toHaveText(['13', '15'])
  await expect.poll(async () => (await standingOnServer()).slice(-2)).toEqual([
    [1, '15'],
    [0, '17'],
  ])
  expect((await standingOnServer()).filter(([, kart]) => kart === '15')).toEqual([[1, '15']])
  expect((await pitsOnServer()).total.moves).toBe(taken + 3)
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

  // The server has the move, and the race opens in its pits from now on.
  const raceId = await page.evaluate(() => localStorage.getItem('rocket-hunter.race'))
  await expect
    .poll(async () => (await (await page.request.get(`/api/races/${raceId}/pit_log`)).json()).moves)
    .toEqual([{ id: expect.any(String), lane: 0, kart: '12A', at: expect.any(Number) }])
  await page.reload()
  await expect(pitsTab).toHaveAttribute('aria-selected', 'true')
  await expect(team).toBeVisible()
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
