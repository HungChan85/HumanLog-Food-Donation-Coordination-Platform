import { test, expect, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import path from "node:path";

async function register(page: Page, role: "Donor" | "Requester", email: string, name: string) {
  await page.goto("/");
  await page
    .getByRole("button", {
      name: role === "Donor" ? "Donate Food" : "Request Food Assistance",
      exact: true,
    })
    .click();
  await page.getByLabel("Name or organization").fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("E2e-only-password-123");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
}

async function chooseCoordinates(page: Page) {
  await page.getByText("Enter coordinates manually", { exact: true }).click();
  await page.getByLabel("Latitude", { exact: true }).fill("10.7707525");
  await page.getByLabel("Longitude", { exact: true }).fill("106.6976235");
  await page.getByRole("button", { name: "Use coordinates", exact: true }).click();
}

async function assertRestricted(page: Page, role: "Donor" | "Requester") {
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.getByRole("button")).toHaveCount(2);
  for (const name of ["Overview", "Donations", "Food Requests", "Warehouses & Routes"])
    await expect(nav.getByRole("button", { name, exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Demo view selector")).toHaveCount(0);
  await page.evaluate(() => {
    window.location.hash = "overview";
  });
  await expect(page).toHaveURL(new RegExp(role === "Donor" ? "#my-donations$" : "#my-requests$"));
  const denied = await page.request.get("/api/coordinator/donations");
  expect(denied.status()).toBe(403);
  const crossRole = await page.request.get(
    role === "Donor" ? "/api/requester/requests" : "/api/donor/donations",
  );
  expect(crossRole.status()).toBe(403);
}

test("donor and requester submit, reload their own history, and stay within their roles", async ({
  browser,
}) => {
  const suffix = Date.now();
  const donorContext = await browser.newContext(),
    requesterContext = await browser.newContext(),
    otherContext = await browser.newContext();
  const donor = await donorContext.newPage(),
    requester = await requesterContext.newPage(),
    other = await otherContext.newPage();
  await register(donor, "Donor", `donor-${suffix}@example.test`, `E2E Bakery ${suffix}`);
  await assertRestricted(donor, "Donor");
  await donor
    .getByRole("navigation")
    .getByRole("button", { name: "Donate Food", exact: true })
    .click();
  await donor.getByLabel("Quantity", { exact: true }).fill("8");
  await donor.getByLabel("Total weight (kg)").fill("12");
  await donor.getByRole("button", { name: "Continue", exact: true }).click();
  await donor.getByLabel("Location address").fill("E2E pickup, District 1");
  await chooseCoordinates(donor);
  await donor.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(donor.getByText("Foodbank Quận 1", { exact: true })).toBeVisible();
  await donor.getByRole("button", { name: "Submit Donation", exact: true }).click();
  await expect(
    donor.getByRole("heading", { name: "Your donation has been submitted" }),
  ).toBeVisible();
  const donationId = await donor.locator(".confirmation-meta strong").first().innerText();
  expect(donationId).toMatch(/^DN-[0-9a-f-]{36}$/);
  await donor.getByRole("button", { name: "View History", exact: true }).click();
  await donor.reload();
  await expect(donor.getByText(donationId, { exact: true })).toBeVisible();
  await donor.screenshot({
    path: "test-results/donor-history.png",
    fullPage: true,
  });

  await register(other, "Donor", `other-${suffix}@example.test`, "E2E Other donor");
  await expect(other.getByText(donationId, { exact: true })).toHaveCount(0);
  expect((await other.request.get(`/api/donor/donations/${donationId}`)).status()).toBe(404);

  await register(
    requester,
    "Requester",
    `requester-${suffix}@example.test`,
    `E2E Community ${suffix}`,
  );
  await assertRestricted(requester, "Requester");
  await requester
    .getByRole("navigation")
    .getByRole("button", { name: "Request Food", exact: true })
    .click();
  await requester.getByLabel("Location address").fill("E2E delivery, District 1");
  await chooseCoordinates(requester);
  await requester
    .locator("fieldset label")
    .filter({ hasText: "Dry Food" })
    .locator("input")
    .fill("15");
  await requester.getByRole("button", { name: "Review Request", exact: true }).click();
  await requester.getByRole("button", { name: "Submit Food Request", exact: true }).click();
  await expect(
    requester.getByRole("heading", {
      name: "Your food assistance request has been submitted",
    }),
  ).toBeVisible();
  const requestId = await requester.locator(".confirmation-meta strong").first().innerText();
  await requester.getByRole("button", { name: "View History", exact: true }).click();
  await requester.reload();
  await expect(requester.getByText(requestId, { exact: true })).toBeVisible();
  await requester.setViewportSize({ width: 390, height: 844 });
  await expect(requester.locator(".sidebar")).not.toBeInViewport();
  await requester.screenshot({
    path: "test-results/requester-mobile.png",
    fullPage: true,
  });
  expect(
    await requester.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);

  // Optional coordinator credentials are created through the operator CLI.
  if (process.env.E2E_COORD_EMAIL && process.env.E2E_COORD_PASSWORD) {
    const coordinatorContext = await browser.newContext();
    const coordinator = await coordinatorContext.newPage();
    await coordinator.goto("/");
    await coordinator.getByRole("button", { name: "Sign in", exact: true }).click();
    await coordinator.getByLabel("Email", { exact: true }).fill(process.env.E2E_COORD_EMAIL);
    await coordinator.getByLabel("Password", { exact: true }).fill(process.env.E2E_COORD_PASSWORD);
    await coordinator.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(coordinator.getByRole("navigation").getByRole("button")).toHaveCount(4);
    for (const [nav, identity, name] of [
      ["Donations", donationId, `E2E Bakery ${suffix}`],
      ["Food Requests", requestId, `E2E Community ${suffix}`],
    ]) {
      await coordinator
        .getByRole("navigation")
        .getByRole("button", { name: nav, exact: true })
        .click();
      await coordinator.getByRole("button", { name: identity, exact: true }).click();
      const drawer = coordinator.getByRole("dialog", { name: "Edit record" });
      await drawer
        .getByLabel(nav === "Donations" ? "Donor name" : "Requester name")
        .fill(name + " updated");
      await drawer.getByLabel("Status", { exact: true }).selectOption("Processed");
      await drawer.getByRole("button", { name: "Save Changes", exact: true }).click();
      await expect(drawer).toHaveCount(0);
      await expect(
        coordinator.getByRole("cell", {
          name: name + " updated",
          exact: false,
        }),
      ).toBeVisible();
    }
    await donor.reload();
    await expect(
      donor
        .locator(".history-card")
        .filter({ hasText: donationId })
        .getByText("Processed", { exact: true }),
    ).toBeVisible();
    await requester.reload();
    await expect(
      requester
        .locator(".history-card")
        .filter({ hasText: requestId })
        .getByText("Processed", { exact: true }),
    ).toBeVisible();
    await coordinator.screenshot({
      path: "test-results/coordinator-requests.png",
      fullPage: true,
    });
    for (const [resource, identity] of [
      ["donations", donationId],
      ["requests", requestId],
    ]) {
      expect(
        (
          await coordinator.request.delete(`/api/coordinator/${resource}/${identity}`, {
            headers: { Origin: "http://localhost:8080" },
          })
        ).status(),
      ).toBe(200);
    }
    await coordinatorContext.close();
  }
  await donor.getByRole("button", { name: "Sign out", exact: true }).click();
  await donor.reload();
  await expect(donor.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await donorContext.close();
  await requesterContext.close();
  await otherContext.close();
});

function legacyFixture(action: "create" | "cleanup", suffix: string) {
  const root = path.resolve(process.cwd(), "..");
  const python = path.join(
    root,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  const result = spawnSync(python, ["-m", "tests.browser_legacy_fixture", action, suffix], {
    cwd: path.join(root, "backend"),
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || "Legacy browser fixture failed.");
  return JSON.parse(result.stdout) as { donationId: string; requestId: string };
}

test("coordinator assigns imported records to the correct accounts and confirms historical quantity units", async ({
  browser,
}) => {
  test.skip(
    !process.env.E2E_COORD_EMAIL || !process.env.E2E_COORD_PASSWORD,
    "Requires an operator-created test coordinator.",
  );
  const suffix = String(Date.now());
  const fixture = legacyFixture("create", suffix);
  const donorContext = await browser.newContext(),
    requesterContext = await browser.newContext(),
    coordinatorContext = await browser.newContext();
  try {
    const donor = await donorContext.newPage(),
      requester = await requesterContext.newPage(),
      coordinator = await coordinatorContext.newPage();
    await register(
      donor,
      "Donor",
      `legacy-donor-${suffix}@example.test`,
      `E2E Legacy owner ${suffix}`,
    );
    await register(
      requester,
      "Requester",
      `legacy-requester-${suffix}@example.test`,
      `E2E Legacy requester ${suffix}`,
    );
    const donorUser = (await (await donor.request.get("/api/auth/me")).json()).user;
    const requesterUser = (await (await requester.request.get("/api/auth/me")).json()).user;
    expect((await donor.request.get(`/api/donor/donations/${fixture.donationId}`)).status()).toBe(
      404,
    );
    expect(
      (await requester.request.get(`/api/requester/requests/${fixture.requestId}`)).status(),
    ).toBe(404);
    await coordinator.goto("/");
    await coordinator.getByRole("button", { name: "Sign in", exact: true }).click();
    await coordinator.getByLabel("Email", { exact: true }).fill(process.env.E2E_COORD_EMAIL!);
    await coordinator.getByLabel("Password", { exact: true }).fill(process.env.E2E_COORD_PASSWORD!);
    await coordinator.getByRole("button", { name: "Sign in", exact: true }).click();
    const jobs = [
      {
        nav: "Donations",
        id: fixture.donationId,
        user: donorUser,
        otherUser: requesterUser,
        page: donor,
        api: "/api/donor/donations",
      },
      {
        nav: "Food Requests",
        id: fixture.requestId,
        user: requesterUser,
        otherUser: donorUser,
        page: requester,
        api: "/api/requester/requests",
      },
    ];
    for (const job of jobs) {
      await coordinator
        .getByRole("navigation")
        .getByRole("button", { name: job.nav, exact: true })
        .click();
      await coordinator.getByRole("button", { name: job.id, exact: true }).click();
      const drawer = coordinator.getByRole("dialog", { name: "Edit record" });
      await expect(drawer.getByText(/Assign this record to the correct/)).toBeVisible();
      const owner = drawer.getByLabel("Record owner", { exact: true });
      await expect(owner).toBeEnabled();
      await owner.selectOption(job.user.id);
      await expect(owner.locator(`option[value="${job.otherUser.id}"]`)).toHaveCount(0);
      await drawer.getByRole("button", { name: "Save Changes", exact: true }).click();
      await expect(drawer).toHaveCount(0);
      await job.page.reload();
      await expect(job.page.getByText(job.id, { exact: true })).toBeVisible();
      const assigned = await (await job.page.request.get(`${job.api}/${job.id}`)).json();
      expect(assigned.ownerId).toBe(job.user.id);
      expect(assigned.legacy.needsUnitReview).toBe(true);
      expect(assigned.quantity || assigned.quantities).toContain("unit not recorded");

      await coordinator.getByRole("button", { name: job.id, exact: true }).click();
      const edit = coordinator.getByRole("dialog", { name: "Edit record" });
      await edit.getByRole("checkbox", { name: /I have checked that the quantities/ }).check();
      if (job.nav === "Donations") await edit.getByLabel("Quantity", { exact: true }).fill("11");
      else
        await edit
          .locator("fieldset label")
          .filter({ hasText: "Dry Food" })
          .locator("input")
          .fill("6");
      await edit.getByLabel("Status", { exact: true }).selectOption("Processed");
      await edit.getByRole("button", { name: "Save Changes", exact: true }).click();
      await expect(edit).toHaveCount(0);
      await job.page.reload();
      await expect(
        job.page
          .locator(".history-card")
          .filter({ hasText: job.id })
          .getByText("Processed", { exact: true }),
      ).toBeVisible();
      const verified = await (await job.page.request.get(`${job.api}/${job.id}`)).json();
      expect(verified.legacy.needsUnitReview).toBe(false);
      expect(verified.quantity || verified.quantities).not.toContain("unit not recorded");
    }
  } finally {
    await donorContext.close();
    await requesterContext.close();
    await coordinatorContext.close();
    legacyFixture("cleanup", suffix);
  }
});
