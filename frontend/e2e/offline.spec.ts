import { expect, test } from '@playwright/test'

test('opens and keeps local records without a network', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Rocket Hunter' })).toBeVisible()
  await expect(page.getByTestId('server-status')).toHaveText('есть')
  // The service worker is active, so the whole app shell is in the cache.
  await expect(page.getByTestId('offline-ready')).toHaveText('готово')

  await context.setOffline(true)
  await page.reload()

  await expect(page.getByRole('heading', { name: 'Rocket Hunter' })).toBeVisible()
  await expect(page.getByTestId('server-status')).toHaveText('нет')

  await page.getByRole('button', { name: 'Записать' }).click()
  await page.getByRole('button', { name: 'Записать' }).click()
  await expect(page.getByTestId('storage-count')).toHaveText('2')

  await page.reload()
  await expect(page.getByTestId('storage-count')).toHaveText('2')

  await context.setOffline(false)
  await page.getByRole('button', { name: 'Проверить связь' }).click()
  await expect(page.getByTestId('server-status')).toHaveText('есть')
})
