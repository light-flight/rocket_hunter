import { type APIRequestContext, type BrowserContext, expect, type Page, test } from '@playwright/test'

// Does what the manager does in Telegram, through the real webhook: opens the bot with the
// link from the app, then presses «Войти». The sender is the manager "one" from the fixtures;
// the secret is the one config/environments/test.rb sets.
async function confirmInTelegram(page: Page, request: APIRequestContext) {
  const href = await page.getByRole('link', { name: 'Открыть Telegram' }).getAttribute('href')
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

test('signs in, then opens and stays usable without a network', async ({ page, context, request }) => {
  await asInstalled(context)
  const signInButton = page.getByRole('button', { name: 'Войти через Telegram' })
  const currentUser = page.getByTestId('current-user')
  const sessionExpired = page.getByTestId('session-expired')

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Rocket Hunter' })).toBeVisible()
  await signInButton.click()
  await confirmInTelegram(page, request)

  // Nothing is clicked here: the app notices the confirmation by itself, within one poll.
  await expect(currentUser).toHaveText('Иван Петров', { timeout: 10_000 })
  await expect(page.getByTestId('server-status')).toHaveText('есть')
  // The service worker is active, so the whole app shell is in the cache.
  await expect(page.getByTestId('offline-ready')).toHaveText('готово')

  // Anything the page needs but the service worker did not cache fails while offline.
  const failedRequests: string[] = []
  page.on('requestfailed', (failed) => failedRequests.push(new URL(failed.url()).pathname))

  await context.setOffline(true)
  await page.reload()

  // No answer from the server says nothing about the session: the manager stays signed in.
  await expect(currentUser).toBeVisible()
  await expect(page.getByTestId('server-status')).toHaveText('нет')
  await expect(signInButton).toHaveCount(0)
  await expect(sessionExpired).toHaveCount(0)
  expect(failedRequests.filter((path) => !path.startsWith('/api/'))).toEqual([])

  await context.setOffline(false)
  await page.getByRole('button', { name: 'Проверить связь' }).click()
  await expect(page.getByTestId('server-status')).toHaveText('есть')

  // A lost session asks to sign in again, but leaves the app on screen.
  await context.clearCookies()
  await page.reload()
  await expect(sessionExpired).toBeVisible()
  await expect(currentUser).toBeVisible()

  await sessionExpired.getByRole('button', { name: 'Войти через Telegram' }).click()
  await confirmInTelegram(page, request)
  await expect(sessionExpired).toHaveCount(0, { timeout: 10_000 })
  await expect(currentUser).toBeVisible()

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(signInButton).toBeVisible()
  await expect(currentUser).toHaveCount(0)

  // The gate is drawn from local storage before the server answers, so wait for the session
  // check: a session that outlived the sign-out would bring the manager back.
  const sessionCheck = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/session' && response.request().method() === 'GET',
  )
  await page.reload()
  expect((await sessionCheck).status()).toBe(401)
  await expect(signInButton).toBeVisible()
  await expect(currentUser).toHaveCount(0)
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
  const signInButton = { name: 'Войти через Telegram' }

  test('Android offers to install, by a key or by steps, and no sign-in', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Установите приложение' })).toBeVisible()
    await expect(page.getByRole('button', signInButton)).toHaveCount(0)
  })

  test('inside Telegram on Android the way out is a link that opens Chrome', async ({ page, context }) => {
    await context.addInitScript(() => Object.assign(window, { TelegramWebview: {} }))
    await page.goto('/')

    await expect(page.getByRole('link', { name: 'Открыть в Chrome' })).toHaveAttribute(
      'href',
      'intent://localhost:3100/#Intent;scheme=https;package=com.android.chrome;end',
    )
    await expect(page.getByRole('button', signInButton)).toHaveCount(0)
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
      await expect(page.getByRole('button', signInButton)).toHaveCount(0)
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
})
