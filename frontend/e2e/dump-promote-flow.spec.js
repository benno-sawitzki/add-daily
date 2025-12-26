/**
 * E2E test for dump creation and promotion flow
 * 
 * To run:
 *   npx playwright test e2e/dump-promote-flow.spec.js
 */
import { test, expect } from '@playwright/test';

// Test user credentials - deterministic
const TEST_USER_EMAIL = 'test-promote-e2e@example.com';
const TEST_USER_PASSWORD = 'test-password-123';
const TEST_USER_NAME = 'Test Promote E2E User';
// Get API base URL from environment or default
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8010';
const API_BASE = BACKEND_URL.endsWith('/api') ? BACKEND_URL : `${BACKEND_URL}/api`;

test.describe('Dump Promote Flow', () => {
  let authToken = null;

  test.beforeAll(async ({ request }) => {
    // Step 1: Try to sign up test user
    const signupResponse = await request.post(`${API_BASE}/auth/signup`, {
      data: {
        email: TEST_USER_EMAIL,
        password: TEST_USER_PASSWORD,
        name: TEST_USER_NAME
      }
    });

    if (signupResponse.status() === 400) {
      // User exists, try to login instead
      const loginResponse = await request.post(`${API_BASE}/auth/login`, {
        data: {
          email: TEST_USER_EMAIL,
          password: TEST_USER_PASSWORD
        }
      });

      if (loginResponse.status() !== 200) {
        throw new Error(`Failed to login test user: ${loginResponse.status()} - ${await loginResponse.text()}`);
      }

      const loginData = await loginResponse.json();
      authToken = loginData.token;
    } else if (signupResponse.status() === 200 || signupResponse.status() === 201) {
      const signupData = await signupResponse.json();
      authToken = signupData.token;
    } else {
      throw new Error(`Failed to create test user: ${signupResponse.status()} - ${await signupResponse.text()}`);
    }

    if (!authToken) {
      throw new Error('Failed to obtain auth token');
    }
  });

  test('should create dump, extract items, promote to inbox, and verify task', async ({ page, context }) => {
    // Set auth token in localStorage before navigating
    await context.addCookies([]); // Clear cookies first
    await page.goto('/');
    
    // Set auth token in localStorage
    await page.evaluate((token) => {
      localStorage.setItem('auth_token', token);
    }, authToken);

    // 1. Go to /app/dumps
    await page.goto('/app/dumps');
    await page.waitForLoadState('networkidle');
    
    // 2. Open braindump overlay - look for mic button in header
    const micButton = page.locator('[data-testid="voice-button"]').first();
    
    if (!(await micButton.isVisible({ timeout: 5000 }).catch(() => false))) {
      // Try alternative selector
      const altButton = page.locator('button:has-text("Braindump")').first();
      if (!(await altButton.isVisible({ timeout: 2000 }).catch(() => false))) {
        throw new Error('Could not find voice/braindump button');
      }
      await altButton.click();
    } else {
      await micButton.click();
    }
    
    // Wait for voice overlay to appear
    await page.waitForSelector('[data-testid="voice-overlay"]', { timeout: 10000 });
    
    // 3. Switch to Type (text input mode)
    const textModeButton = page.locator('[data-testid="text-mode-btn"]');
    if (await textModeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await textModeButton.click();
      await page.waitForTimeout(300);
    }
    
    // 4. Enter text: "go home, do task 1, buy groceries"
    const textarea = page.locator('textarea').first();
    await textarea.fill('go home, do task 1, buy groceries');
    
    // 5. Save Dump
    const saveButton = page.locator('button:has-text("Save Dump"), [data-testid="submit-voice"]').first();
    await expect(saveButton).toBeEnabled({ timeout: 5000 });
    await saveButton.click();
    
    // 6. Expect redirect to /app/process
    await page.waitForURL('**/app/process', { timeout: 10000 });
    expect(page.url()).toContain('/app/process');
    
    // Wait for items to load
    await page.waitForLoadState('networkidle');
    
    // Wait for processing page to be visible
    await page.waitForSelector('[data-testid="processing-page"]', { timeout: 10000 });
    
    // 7. Promote first item to Inbox
    // Find the first item card (they should be in a list)
    // Look for cards containing item text
    const firstItemText = page.locator('text=/go home|do task 1|buy groceries/i').first();
    await expect(firstItemText).toBeVisible({ timeout: 5000 });
    
    // Find the parent card element
    const firstItemCard = firstItemText.locator('..').locator('..').locator('..'); // Go up to card
    // Or find card by looking for the structure - items are in cards with buttons
    const itemCards = page.locator('.card, [class*="Card"]').filter({ hasText: /go home|do task 1|buy groceries/i });
    
    // Find "Inbox" button in the first item card
    const inboxButton = itemCards.first().getByRole('button', { name: /^inbox$/i }).first();
    await expect(inboxButton).toBeVisible({ timeout: 5000 });
    await inboxButton.click();
    
    // Wait for promotion to complete (check for success toast or item removal)
    await page.waitForTimeout(1000);
    
    // Verify item was removed from the list (promoted items disappear)
    // Or check for success toast
    const successToast = page.locator('[data-sonner-toast]').filter({ hasText: /promoted/i });
    // Don't fail if toast is not visible, just continue
    
    // 8. Go to /app/inbox and confirm task exists
    await page.goto('/app/inbox');
    await page.waitForLoadState('networkidle');
    
    // Look for the task we just promoted - at least one of the extracted items should appear
    const taskText = page.getByText(/go home/i).or(
      page.getByText(/do task 1/i)
    ).or(
      page.getByText(/buy groceries/i)
    );
    
    // At least one of the extracted items should appear as a task
    await expect(taskText.first()).toBeVisible({ timeout: 5000 });
  });
});

