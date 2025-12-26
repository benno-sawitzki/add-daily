import { test, expect } from '@playwright/test';

// Test user credentials - deterministic
const TEST_USER_EMAIL = 'test-e2e@example.com';
const TEST_USER_PASSWORD = 'test-password-123';
const TEST_USER_NAME = 'Test E2E User';
// Get API base URL from environment or default
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8010';
const API_BASE = BACKEND_URL.endsWith('/api') ? BACKEND_URL : `${BACKEND_URL}/api`;

test.describe('Save Dump E2E', () => {
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

  test('should create a dump and show it in the list', async ({ page, context }) => {
    // Set auth token in localStorage before navigating
    await context.addCookies([]); // Clear cookies first
    await page.goto('/');
    
    // Set auth token in localStorage
    await page.evaluate((token) => {
      localStorage.setItem('auth_token', token);
    }, authToken);

    // Navigate to dumps page
    await page.goto('/app/dumps');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Open braindump modal - look for mic button in header
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
    
    // Switch to text input mode
    const textModeButton = page.locator('[data-testid="text-mode-btn"]');
    if (await textModeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await textModeButton.click();
    }
    
    // Fill in the textarea
    const textarea = page.locator('textarea').first();
    await textarea.fill('test dump e2e');
    
    // Click "Save Dump" button
    const saveButton = page.locator('button:has-text("Save Dump"), [data-testid="submit-voice"]').first();
    await expect(saveButton).toBeEnabled({ timeout: 5000 });
    await saveButton.click();
    
    // Wait for success (either toast or navigation)
    // Check for success - no error toast
    const errorToast = page.locator('[data-sonner-toast][data-type="error"]');
    await expect(errorToast).not.toBeVisible({ timeout: 10000 });
    
    // Wait for navigation to dump detail page or check for dump in list
    await page.waitForURL(/\/app\/dumps/, { timeout: 15000 });
    
    // Verify we're on a dumps page (either list or detail)
    const currentUrl = page.url();
    expect(currentUrl).toMatch(/\/app\/dumps/);
    
    // If we're on the list page, verify the dump appears
    if (currentUrl === 'http://localhost:3000/app/dumps' || currentUrl.endsWith('/app/dumps')) {
      // Look for the dump text in the list
      await expect(page.locator('text=test dump e2e')).toBeVisible({ timeout: 10000 });
    } else {
      // We're on a detail page, verify the dump content is shown
      await expect(page.locator('text=test dump e2e')).toBeVisible({ timeout: 10000 });
    }
  });
});
