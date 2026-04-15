const fs = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");

const DEFAULT_TIMEOUT_MS = Number(process.env.DISNEY_CHECK_TIMEOUT_MS || 90_000);
const USER_AGENT =
  process.env.PLAYWRIGHT_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

const PROVIDER_CONFIG = {
  wdw: {
    label: "Walt Disney World",
    availabilityUrl: "https://disneyworld.disney.go.com/dine-res/availability/"
  },
  disneyland: {
    label: "Disneyland Resort",
    availabilityUrl: "https://disneyland.disney.go.com/dine-res/availability/"
  }
};

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\w\s':-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function timeToMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function parseDisplayedTimeToMinutes(value) {
  const match = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);

  if (!match) return null;

  let hours = Number(match[1]) % 12;
  const minutes = Number(match[2]);
  if (/pm/i.test(match[3])) hours += 12;

  return hours * 60 + minutes;
}

function isWithinWindow(displayedTime, startTime, endTime) {
  const candidate = parseDisplayedTimeToMinutes(displayedTime);
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);

  if (candidate == null || start == null || end == null) {
    return true;
  }

  return candidate >= start && candidate <= end;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

async function waitForLoginFrame(page) {
  for (let index = 0; index < 40; index += 1) {
    const frame = page
      .frames()
      .find(candidate => /registerdisney\.go\.com|oneid/i.test(candidate.url() || "") || candidate.name() === "oneid-iframe");

    if (frame) {
      return frame;
    }

    await page.waitForTimeout(500);
  }

  return null;
}

async function maybeLoginToDisney(page, credentials) {
  const loginFrame = await waitForLoginFrame(page);
  if (!loginFrame) return false;

  const emailInput = loginFrame.locator("#InputIdentityFlowValue");
  await emailInput.waitFor({ state: "visible", timeout: 20_000 });
  await emailInput.fill(credentials.email);
  await loginFrame.locator("#BtnSubmit").click();

  const passwordInput = loginFrame.locator("#InputPassword");
  await passwordInput.waitFor({ state: "visible", timeout: 20_000 });
  await passwordInput.fill(credentials.password);
  await loginFrame.locator("#BtnSubmit").click();

  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(3_000);

  return true;
}

async function selectFirstVisible(locatorList) {
  for (const locator of locatorList) {
    try {
      if (await locator.count()) {
        const first = locator.first();
        if (await first.isVisible()) {
          return first;
        }
      }
    } catch (error) {
      // Try the next locator.
    }
  }

  return null;
}

async function fillRestaurant(page, restaurantName) {
  const input = await selectFirstVisible([
    page.getByRole("combobox", { name: /restaurant/i }),
    page.getByRole("textbox", { name: /restaurant/i }),
    page.locator('input[placeholder*="Restaurant" i]'),
    page.locator('input[aria-label*="Restaurant" i]')
  ]);

  if (!input) return false;

  await input.click();
  await input.fill(restaurantName);
  await page.waitForTimeout(1_500);

  const option = await selectFirstVisible([
    page.getByRole("option", { name: new RegExp(restaurantName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }),
    page.locator("[role='option']").filter({ hasText: restaurantName }),
    page.locator("button").filter({ hasText: restaurantName }),
    page.locator("li").filter({ hasText: restaurantName })
  ]);

  if (option) {
    await option.click().catch(() => {});
    return true;
  }

  return true;
}

async function fillPartySize(page, partySize) {
  const control = await selectFirstVisible([
    page.getByRole("combobox", { name: /party|guest/i }),
    page.locator("select").filter({ has: page.locator("option") }).filter({ hasText: /guest|party/i }),
    page.locator('select[name*="party" i], select[id*="party" i], select[name*="guest" i], select[id*="guest" i]')
  ]);

  if (!control) return false;

  try {
    await control.selectOption(String(partySize));
    return true;
  } catch (error) {
    try {
      await control.click();
      const option = await selectFirstVisible([
        page.getByRole("option", { name: new RegExp(`^${partySize}\\b`) }),
        page.locator("[role='option']").filter({ hasText: new RegExp(`^${partySize}\\b`) }),
        page.locator("li").filter({ hasText: new RegExp(`^${partySize}\\b`) })
      ]);

      if (option) {
        await option.click();
        return true;
      }
    } catch (secondaryError) {
      return false;
    }
  }

  return false;
}

async function fillPreferredDate(page, preferredDate) {
  const dateInput = await selectFirstVisible([
    page.getByLabel(/date/i),
    page.locator('input[type="date"]'),
    page.locator('input[placeholder*="Date" i]'),
    page.locator('input[aria-label*="Date" i]')
  ]);

  if (!dateInput) return false;

  await dateInput.fill(preferredDate);
  await dateInput.dispatchEvent("change").catch(() => {});
  return true;
}

async function submitSearch(page) {
  const button = await selectFirstVisible([
    page.getByRole("button", { name: /search|find times|check availability|update search/i }),
    page.locator("button").filter({ hasText: /search|find times|check availability|update search/i })
  ]);

  if (!button) return false;

  await button.click();
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2_000);
  return true;
}

async function collectMatches(page, query) {
  const restaurantNeedle = normalizeText(query.restaurantName);
  const matchingCards = page.locator("article, section, li, div").filter({
    hasText: query.restaurantName
  });

  const count = Math.min(await matchingCards.count().catch(() => 0), 12);
  const matches = [];

  for (let index = 0; index < count; index += 1) {
    const card = matchingCards.nth(index);
    const text = normalizeText(await card.innerText().catch(() => ""));
    if (!text || !text.includes(restaurantNeedle)) continue;

    const rawText = await card.innerText().catch(() => "");
    const timeMatches = rawText.match(/\b\d{1,2}:\d{2}\s?(?:AM|PM)\b/gi) || [];

    for (const time of timeMatches) {
      if (!isWithinWindow(time, query.startTime, query.endTime)) continue;

      matches.push({
        restaurant: query.restaurantName,
        date: query.preferredDate,
        time: time.replace(/\s+/g, " ").trim()
      });
    }
  }

  if (matches.length) {
    return matches;
  }

  const visibleTimes = page.getByText(/\b\d{1,2}:\d{2}\s?(AM|PM)\b/i);
  const visibleCount = Math.min(await visibleTimes.count().catch(() => 0), 30);

  for (let index = 0; index < visibleCount; index += 1) {
    const time = (await visibleTimes.nth(index).innerText().catch(() => "")).trim();
    if (!time || !isWithinWindow(time, query.startTime, query.endTime)) continue;

    matches.push({
      restaurant: query.restaurantName,
      date: query.preferredDate,
      time
    });
  }

  return matches;
}

async function buildBrowserContext(browser, provider) {
  const storageStatePath =
    process.env.DISNEY_PLAYWRIGHT_STORAGE_STATE ||
    path.join(__dirname, "../data", `disney-${provider}-storage-state.json`);

  const contextOptions = {
    userAgent: USER_AGENT,
    viewport: { width: 1440, height: 1100 },
    storageState: (await fileExists(storageStatePath)) ? storageStatePath : undefined
  };

  const context = await browser.newContext(contextOptions);
  return { context, storageStatePath };
}

async function checkDisneyDiningAvailability(query) {
  const provider = String(query.provider || "").toLowerCase();
  const config = PROVIDER_CONFIG[provider];

  if (!config) {
    return {
      available: false,
      matches: [],
      source: "unsupported-provider",
      note: `No Disney dining configuration exists for provider "${provider}".`
    };
  }

  const email = String(process.env.DISNEY_LOGIN_EMAIL || "").trim();
  const password = String(process.env.DISNEY_LOGIN_PASSWORD || "").trim();

  if (!email || !password) {
    return {
      available: false,
      matches: [],
      source: "missing-credentials",
      note: "Set DISNEY_LOGIN_EMAIL and DISNEY_LOGIN_PASSWORD for the reservation worker."
    };
  }

  let browser;
  let context;

  try {
    browser = await chromium.launch({
      headless: process.env.PLAYWRIGHT_HEADFUL === "true" ? false : true,
      channel: process.env.PLAYWRIGHT_CHANNEL || "chromium"
    });

    const builtContext = await buildBrowserContext(browser, provider);
    context = builtContext.context;
    const storageStatePath = builtContext.storageStatePath;
    const page = await context.newPage();
    page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);

    await page.goto(config.availabilityUrl, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT_MS
    });

    await maybeLoginToDisney(page, { email, password });
    await page.goto(config.availabilityUrl, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT_MS
    });

    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    await fillRestaurant(page, query.restaurantName);
    await fillPartySize(page, query.partySize);
    await fillPreferredDate(page, query.preferredDate);
    await submitSearch(page);

    const matches = await collectMatches(page, query);
    await context.storageState({ path: storageStatePath }).catch(() => {});

    return {
      available: matches.length > 0,
      matches,
      source: "playwright-disney"
    };
  } catch (error) {
    return {
      available: false,
      matches: [],
      source: "playwright-disney-error",
      error: error.message
    };
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

module.exports = {
  checkDisneyDiningAvailability
};
