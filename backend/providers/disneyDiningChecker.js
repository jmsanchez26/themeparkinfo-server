const fs = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");

const DEFAULT_TIMEOUT_MS = Number(process.env.DISNEY_CHECK_TIMEOUT_MS || 90_000);
const RESERVATION_API_BASE_URL = String(process.env.RESERVATION_API_BASE_URL || "").trim().replace(/\/+$/, "");
const RESERVATION_WORKER_SHARED_SECRET = String(process.env.RESERVATION_WORKER_SHARED_SECRET || "").trim();
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

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function getWorkerHeaders() {
  const headers = {
    "Content-Type": "application/json"
  };

  if (RESERVATION_WORKER_SHARED_SECRET) {
    headers["x-reservation-worker-secret"] = RESERVATION_WORKER_SHARED_SECRET;
  }

  return headers;
}

async function workerApiRequest(route, options = {}) {
  if (!RESERVATION_API_BASE_URL) {
    return null;
  }

  const response = await fetch(`${RESERVATION_API_BASE_URL}${route}`, {
    ...options,
    headers: {
      ...getWorkerHeaders(),
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Disney worker API request failed (${response.status}) ${message}`.trim());
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  return response.json();
}

async function loadVerificationState(provider) {
  const payload = await workerApiRequest(`/api/reservation-worker/disney-verification?provider=${encodeURIComponent(provider)}`);
  return payload?.data || null;
}

async function setVerificationRequired(provider, message, promptText) {
  await workerApiRequest(`/api/reservation-worker/disney-verification/${encodeURIComponent(provider)}/request`, {
    method: "POST",
    body: JSON.stringify({
      status: "required",
      message,
      promptText
    })
  });
}

async function clearVerificationState(provider) {
  await workerApiRequest(`/api/reservation-worker/disney-verification/${encodeURIComponent(provider)}/clear`, {
    method: "POST"
  });
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

async function detectVerificationPrompt(frame) {
  if (!frame) {
    return {
      required: false,
      promptText: ""
    };
  }

  const bodyText = await frame.locator("body").innerText().catch(() => "");
  const compact = bodyText.replace(/\s+/g, " ").trim();
  const required = /security code|verification code|one-time code|one time code|6-digit code|enter the code/i.test(compact);

  return {
    required,
    promptText: compact.slice(0, 500)
  };
}

async function applyVerificationCode(frame, code) {
  const digits = String(code || "").replace(/\D/g, "");
  if (!digits) return false;

  const multiInputs = frame.locator('input[maxlength="1"], input[inputmode="numeric"], input[autocomplete*="one-time-code" i]');
  const multiCount = await multiInputs.count().catch(() => 0);

  if (multiCount >= 4) {
    for (let index = 0; index < Math.min(multiCount, digits.length); index += 1) {
      await multiInputs.nth(index).fill(digits[index]).catch(() => {});
    }
  } else {
    const singleInput = await selectFirstVisible([
      frame.locator('input[autocomplete*="one-time-code" i]'),
      frame.locator('input[placeholder*="code" i]'),
      frame.locator('input[aria-label*="code" i]'),
      frame.locator('input[type="tel"]'),
      frame.locator('input[inputmode="numeric"]')
    ]);

    if (!singleInput) return false;
    await singleInput.fill(digits).catch(() => {});
  }

  const submitButton = await selectFirstVisible([
    frame.getByRole("button", { name: /continue|submit|verify|done|log in/i }),
    frame.locator("button").filter({ hasText: /continue|submit|verify|done|log in/i })
  ]);

  if (!submitButton) {
    return false;
  }

  await submitButton.click().catch(() => {});
  return true;
}

async function maybeHandleVerificationChallenge(page, provider) {
  const frame = await waitForLoginFrame(page);
  const challenge = await detectVerificationPrompt(frame);

  if (!challenge.required) {
    return {
      challengeRequired: false,
      note: ""
    };
  }

  const verificationState = await loadVerificationState(provider).catch(() => null);

  if (verificationState?.status === "submitted" && verificationState.code) {
    const submitted = await applyVerificationCode(frame, verificationState.code);

    if (submitted) {
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(3_000);

      const nextFrame = await waitForLoginFrame(page);
      const nextChallenge = await detectVerificationPrompt(nextFrame);

      if (!nextChallenge.required) {
        await clearVerificationState(provider).catch(() => {});
        return {
          challengeRequired: false,
          note: "Disney security code accepted."
        };
      }

      await setVerificationRequired(
        provider,
        "Disney still needs a fresh security code. Enter the newest code from the Disney app.",
        nextChallenge.promptText || challenge.promptText
      ).catch(() => {});

      return {
        challengeRequired: true,
        note: "Disney security code was requested again after submitting a code."
      };
    }
  }

  await setVerificationRequired(
    provider,
    "Disney sent a security code. Enter it on the Restaurant Alerts page so the worker can continue.",
    challenge.promptText
  ).catch(() => {});

  return {
    challengeRequired: true,
    note: "Disney security code required."
  };
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

  if (!input) return { found: false, selected: false };

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
    return { found: true, selected: true };
  }

  return { found: true, selected: false };
}

async function fillPartySize(page, partySize) {
  const control = await selectFirstVisible([
    page.getByRole("combobox", { name: /party|guest/i }),
    page.locator("select").filter({ has: page.locator("option") }).filter({ hasText: /guest|party/i }),
    page.locator('select[name*="party" i], select[id*="party" i], select[name*="guest" i], select[id*="guest" i]')
  ]);

  if (!control) return { found: false, selected: false };

  try {
    await control.selectOption(String(partySize));
    return { found: true, selected: true };
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
        return { found: true, selected: true };
      }
    } catch (secondaryError) {
      return { found: true, selected: false };
    }
  }

  return { found: true, selected: false };
}

async function fillPreferredDate(page, preferredDate) {
  const dateInput = await selectFirstVisible([
    page.getByLabel(/date/i),
    page.locator('input[type="date"]'),
    page.locator('input[placeholder*="Date" i]'),
    page.locator('input[aria-label*="Date" i]')
  ]);

  if (!dateInput) return { found: false, selected: false };

  await dateInput.fill(preferredDate);
  await dateInput.dispatchEvent("change").catch(() => {});
  return { found: true, selected: true };
}

async function submitSearch(page) {
  const button = await selectFirstVisible([
    page.getByRole("button", { name: /search|find times|check availability|update search/i }),
    page.locator("button").filter({ hasText: /search|find times|check availability|update search/i })
  ]);

  if (!button) return { found: false, clicked: false };

  await button.click();
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2_000);
  return { found: true, clicked: true };
}

async function collectVisibleDebugInfo(page) {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const compactText = bodyText.replace(/\s+/g, " ").trim();
  const timeMatches = [...new Set((bodyText.match(/\b\d{1,2}:\d{2}\s?(?:AM|PM)\b/gi) || []).map(time => time.replace(/\s+/g, " ").trim()))].slice(0, 10);
  const likelyNoResults =
    /no times available|no reservations available|try another date|try another time|no availability/i.test(bodyText);

  return {
    url: page.url(),
    visibleTimes: timeMatches,
    likelyNoResults,
    previewText: compactText.slice(0, 500)
  };
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

function buildPersistentProfilePath(provider) {
  const configuredBase = String(process.env.DISNEY_PLAYWRIGHT_USER_DATA_DIR || "").trim();
  if (configuredBase) {
    return configuredBase.includes("<provider>")
      ? configuredBase.replace(/<provider>/gi, provider)
      : path.join(configuredBase, provider);
  }

  return path.join(__dirname, "../data", `disney-${provider}-profile`);
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

  let context;

  try {
    const launchOptions = {
      headless: process.env.PLAYWRIGHT_HEADFUL === "true" ? false : true,
      userAgent: USER_AGENT,
      viewport: { width: 1440, height: 1100 }
    };

    if (process.env.PLAYWRIGHT_CHANNEL) {
      launchOptions.channel = process.env.PLAYWRIGHT_CHANNEL;
    }

    const userDataDir = buildPersistentProfilePath(provider);
    await ensureDir(userDataDir);
    context = await chromium.launchPersistentContext(userDataDir, launchOptions);
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
    const diagnostics = {
      provider,
      restaurantName: query.restaurantName,
      preferredDate: query.preferredDate,
      partySize: query.partySize,
      userDataDir
    };

    await page.goto(config.availabilityUrl, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT_MS
    });

    diagnostics.loginAttempted = await maybeLoginToDisney(page, { email, password });
    const verificationResult = await maybeHandleVerificationChallenge(page, provider);
    diagnostics.verificationResult = verificationResult;

    if (verificationResult.challengeRequired) {
      return {
        available: false,
        matches: [],
        source: "playwright-disney-verification-required",
        note: verificationResult.note,
        diagnostics
      };
    }

    await page.goto(config.availabilityUrl, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT_MS
    });

    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    diagnostics.restaurantInput = await fillRestaurant(page, query.restaurantName);
    diagnostics.partySizeInput = await fillPartySize(page, query.partySize);
    diagnostics.dateInput = await fillPreferredDate(page, query.preferredDate);
    diagnostics.searchAction = await submitSearch(page);

    const matches = await collectMatches(page, query);
    const debugInfo = await collectVisibleDebugInfo(page);

    const noteParts = [];
    if (!diagnostics.restaurantInput?.found) noteParts.push("restaurant control not found");
    if (!diagnostics.partySizeInput?.found) noteParts.push("party size control not found");
    if (!diagnostics.dateInput?.found) noteParts.push("date control not found");
    if (!diagnostics.searchAction?.found) noteParts.push("search button not found");
    if (!matches.length && debugInfo.likelyNoResults) noteParts.push("Disney page reported no availability");
    if (!matches.length && debugInfo.visibleTimes.length) {
      noteParts.push(`visible times seen: ${debugInfo.visibleTimes.join(", ")}`);
    }

    return {
      available: matches.length > 0,
      matches,
      source: "playwright-disney",
      note: noteParts.join(" | ") || null,
      diagnostics: {
        ...diagnostics,
        ...debugInfo
      }
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
  }
}

module.exports = {
  checkDisneyDiningAvailability
};
