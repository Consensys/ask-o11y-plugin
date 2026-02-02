import { test, expect } from '@playwright/test';

test('cursor should stay in position when typing in middle of text', async ({ page }) => {
  // Navigate to Grafana
  await page.goto('http://localhost:3000');
  
  // Login
  await page.fill('input[name="user"]', 'admin');
  await page.fill('input[name="password"]', 'admin');
  await page.click('button[type="submit"]');
  
  // Wait a bit for dashboard
  await page.waitForTimeout(2000);
  
  // Navigate to Ask O11y plugin
  await page.goto('http://localhost:3000/a/consensys-asko11y-app');
  
  // Wait for chat input
  const textarea = page.locator('textarea[aria-label="Chat input"]');
  await textarea.waitFor({ timeout: 15000 });
  
  // Type initial text
  await textarea.fill('Hello World');
  
  // Move cursor to position 6 (after "Hello ")
  await textarea.click();
  await textarea.press('Home');
  for (let i = 0; i < 6; i++) {
    await textarea.press('ArrowRight');
  }
  
  // Get cursor position before typing
  const positionBefore = await textarea.evaluate((el: HTMLTextAreaElement) => el.selectionStart);
  console.log('Cursor position before:', positionBefore);
  
  // Type in the middle
  await textarea.press('B');
  await textarea.press('e');
  await textarea.press('a');
  await textarea.press('u');
  await textarea.press('t');
  await textarea.press('i');
  await textarea.press('f');
  await textarea.press('u');
  await textarea.press('l');
  await textarea.press(' ');
  
  // Check results
  const textAfter = await textarea.inputValue();
  const positionAfter = await textarea.evaluate((el: HTMLTextAreaElement) => el.selectionStart);
  
  console.log('Text after:', textAfter);
  console.log('Cursor position after:', positionAfter);
  console.log('Expected position: 16');
  
  expect(textAfter).toBe('Hello Beautiful World');
  expect(positionAfter).toBe(16);
  
  console.log('✅ SUCCESS: Cursor stayed in correct position!');
});
