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
  await page.getByRole('button', { name: 'Переименовать' }).click()
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

  await confirmInTelegram(page, request)
  await expect(sessionExpired).toHaveCount(0, { timeout: 10_000 })
  await expect(raceName).toHaveText('Этап 2 · Сочи')

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
