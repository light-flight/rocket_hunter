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
  await expect(corridors).toHaveCount(2)
  await expect(page.getByTestId('pit-kart')).toHaveCount(13)

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

  // A kart dragged into a corridor joins its end, and the one at the front goes out.
  const dragInto = async (kart: string, lane: number) => {
    const from = (await page.getByRole('button', { name: `Карт ${kart}`, exact: true }).boundingBox())!
    const to = (await corridors.nth(lane).boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 })
    await page.mouse.up()
  }
  // Each drop rearranges the karts below: the next one is picked once the last has landed.
  await dragInto('1', 1)
  await expect(queue(1)).toHaveText(['?', '1'])
  await dragInto('5', 1)
  await expect(queue(1)).toHaveText(['1', '5'])
  await dragInto('9', 1)
  await expect(queue(1)).toHaveText(['5', '9'])
  await expect(page.getByRole('button', { name: 'Карт 1', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Карт 9', exact: true })).toHaveCount(0)

  // Undone back to the very first move, done again, and all of it kept through a restart.
  await page.getByRole('button', { name: 'Отменить' }).click()
  await expect(queue(1)).toHaveText(['1', '5'])
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Отменить' }).click()
  await expect(page.getByRole('button', { name: 'Отменить' })).toBeDisabled()
  await expect(queue(0)).toHaveCount(0)
  for (let i = 0; i < 7; i++) await page.getByRole('button', { name: 'Вернуть' }).click()
  await expect(queue(1)).toHaveText(['5', '9'])
  await page.reload()
  await expect(queue(0)).toHaveText(['?', '?'])
  await expect(queue(1)).toHaveText(['5', '9'])

  // The server has the pits too, for the other phones of the team.
  const pitsOnServer = async (): Promise<{ moves: { lane: number; kart: string | null }[]; count: number }> =>
    (await page.request.get(`/api/races/${raceId}/pit_log`)).json()
  await expect.poll(async () => (await pitsOnServer()).count).toBe(7)
  expect((await pitsOnServer()).moves).toHaveLength(7)

  // Without a network a move is kept here, and goes once the network is back.
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Отменить' }).click()
  await expect(queue(1)).toHaveText(['1', '5'])
  await context.setOffline(false)
  await expect.poll(async () => (await pitsOnServer()).count).toBe(6)

  // Moves made on another phone arrive here.
  const { moves } = await pitsOnServer()
  await page.request.put(`/api/races/${raceId}/pit_log`, {
    data: { pit_log: { moves: [...moves.slice(0, 6), { lane: 0, kart: '3' }], count: 7 } },
  })
  await page.reload()
  await expect(queue(0)).toHaveText(['?', '3'])
  await expect(queue(1)).toHaveText(['1', '5'])
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
