import { test, expect, type Page } from "@playwright/test";

async function upload(
  page: Page,
  width = 800,
  height = 1200,
  mode: "mapped" | "count_only" = "mapped",
) {
  await page.goto("/");
  await page.getByRole("button", { name: /New line/ }).click();
  // A generated image with visible hold-like dots makes tests self-contained.
  const bytes = await page.evaluate(
    ({ width, height }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#b8b2a0";
      ctx.fillRect(0, 0, width, height);
      for (let i = 0; i < 15; i++) {
        ctx.fillStyle = i % 2 ? "#915574" : "#b3c269";
        ctx.beginPath();
        ctx.ellipse(
          width * (0.2 + (i % 3) * 0.28),
          height * (0.12 + Math.floor(i / 3) * 0.17),
          27,
          15,
          0.4,
          0,
          7,
        );
        ctx.fill();
      }
      return canvas.toDataURL("image/jpeg").split(",")[1];
    },
    { width, height },
  );
  await page.getByLabel("Choose a photo", { exact: true }).setInputFiles({
    name: "route.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(bytes, "base64"),
  });
  await page
    .getByRole("button", {
      name: mode === "mapped" ? /Map holds/ : /Reps only/,
    })
    .click();
  await expect(page.getByTestId("photo-map").locator("img")).toBeVisible();
  await page
    .getByTestId("photo-map")
    .locator("img")
    .evaluate((img: HTMLImageElement) => img.decode());
}
async function add(page: Page, x: number, y: number) {
  const map = page.getByTestId("photo-map");
  await map.scrollIntoViewIfNeeded();
  const box = (await map.boundingBox())!;
  await map
    .locator("img")
    .click({ position: { x: box.width * x, y: box.height * y } });
}
async function assertPosition(page: Page, index: number, x: number, y: number) {
  const map = (await page.getByTestId("photo-map").boundingBox())!;
  const marker = (await page.getByTestId(`hold-${index}`).boundingBox())!;
  expect(
    Math.abs((marker.x + marker.width / 2 - map.x) / map.width - x),
  ).toBeLessThan(0.005);
  expect(
    Math.abs((marker.y + marker.height / 2 - map.y) / map.height - y),
  ).toBeLessThan(0.005);
}

test("15 holds survive save, reload, and phone/desktop/landscape resizing", async ({
  page,
}) => {
  await upload(page);
  const points = Array.from({ length: 15 }, (_, i) => ({
    x: 0.2 + (i % 3) * 0.28,
    y: 0.12 + Math.floor(i / 3) * 0.17,
  }));
  for (const point of points) await add(page, point.x, point.y);
  await expect(page.getByRole("button", { name: /^Hold / })).toHaveCount(15);
  await page.getByLabel("Color").fill("Purple");
  await page.getByLabel("Grade", { exact: true }).fill("V4");
  await page.getByRole("button", { name: /Finish hold/ }).click();
  await page.getByRole("button", { name: /Done · Save line/ }).click();
  await expect(page.getByRole("heading", { name: "Purple V4" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /Purple V4/ }).click();
  for (const size of [
    { width: 390, height: 844 },
    { width: 1440, height: 1000 },
    { width: 844, height: 390 },
    { width: 320, height: 700 },
  ]) {
    await page.setViewportSize(size);
    for (const [i, point] of points.entries())
      await assertPosition(page, i + 1, point.x, point.y);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await expect(
    page.getByRole("button", { name: "Hold 15, TOP", exact: true }),
  ).toBeVisible();
});

test("zooms the route photo without resizing the page frame", async ({
  page,
}) => {
  await upload(page);
  const frameBefore = (await page.getByTestId("photo-map").boundingBox())!;
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.getByRole("button", { name: "Reset zoom" })).toHaveText(
    "125%",
  );
  await expect(page.getByTestId("photo-map-canvas")).toHaveAttribute(
    "style",
    /scale\(1\.25\)/,
  );
  const frameAfter = (await page.getByTestId("photo-map").boundingBox())!;
  expect(frameAfter.width).toBeCloseTo(frameBefore.width, 1);
  expect(frameAfter.height).toBeCloseTo(frameBefore.height, 1);
  await page.getByRole("button", { name: "Reset zoom" }).click();
  await expect(page.getByRole("button", { name: "Reset zoom" })).toHaveText(
    "100%",
  );
});

test("drag, keyboard nudge, delete, undo, and TOP semantics", async ({
  page,
}) => {
  await upload(page, 1200, 800);
  await add(page, 0.2, 0.3);
  await add(page, 0.5, 0.5);
  await add(page, 0.8, 0.7);
  await page.getByRole("button", { name: /Finish hold/ }).click();
  await expect(
    page.getByRole("button", { name: "Hold 3, TOP", exact: true }),
  ).toBeVisible();
  const marker = page.getByTestId("hold-1");
  await marker.scrollIntoViewIfNeeded();
  let box = (await page.getByTestId("photo-map").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.4, {
    steps: 5,
  });
  await page.mouse.up();
  await assertPosition(page, 1, 0.35, 0.4);
  await marker.focus();
  await page.keyboard.press("ArrowRight");
  await assertPosition(page, 1, 0.355, 0.4);
  await page.getByTestId("hold-2").click();
  await page.getByRole("button", { name: "Delete selected" }).click();
  await expect(
    page.getByRole("button", { name: "Hold 2, TOP", exact: true }),
  ).toBeVisible();
  await add(page, 0.5, 0.8);
  await expect(page.getByRole("button", { name: /Finish hold/ })).toHaveClass(
    /selected-result/,
  );
  await page.getByRole("button", { name: "Undo last hold" }).click();
  await expect(page.getByRole("button", { name: /^Hold / })).toHaveCount(2);
  await page.getByTestId("hold-1").scrollIntoViewIfNeeded();
  box = (await page.getByTestId("photo-map").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.355, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x - 15, box.y + box.height * 0.2, { steps: 5 });
  await page.mouse.up();
  await assertPosition(page, 1, 0, 0.2);
});

test("requires color, grade, and hold; failed persistence retains editable draft", async ({
  page,
}) => {
  await upload(page);
  const save = page.getByRole("button", { name: /Done · Save line/ });
  await expect(save).toBeDisabled();
  await page.getByLabel("Color").fill("Orange");
  await page.getByLabel("Grade", { exact: true }).fill("V3");
  await expect(save).toBeDisabled();
  await add(page, 0.5, 0.5);
  await expect(save).toBeEnabled();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      IDBObjectStore.prototype.put = original;
      throw new Error("Test: storage full");
    };
  });
  await save.click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "storage full",
  );
  await expect(page.getByLabel("Color")).toHaveValue("Orange");
  await expect(page.getByTestId("hold-1")).toBeVisible();
  await save.click();
  await expect(page.getByRole("heading", { name: "Orange V3" })).toBeVisible();
});

test("invalid image reports an actionable error", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /New line/ }).click();
  await page.getByLabel("Choose a photo", { exact: true }).setInputFiles({
    name: "broken.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "could not be opened",
  );
});

test("can replace a selected photo and save notes on the line", async ({
  page,
}) => {
  await upload(page);
  await add(page, 0.45, 0.6);
  await page.getByLabel("Choose a different photo").setInputFiles({
    name: "replacement.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(
      await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 500;
        canvas.height = 500;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#547c85";
        context.fillRect(0, 0, 500, 500);
        return canvas.toDataURL("image/jpeg").split(",")[1];
      }),
      "base64",
    ),
  });
  await expect(
    page.getByRole("button", { name: "Remove selected photo" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove selected photo" }).click();
  await expect(
    page.getByLabel("Choose a photo", { exact: true }),
  ).toBeAttached();
  await page.getByLabel("Choose a photo", { exact: true }).setInputFiles({
    name: "replacement.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(
      await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 500;
        canvas.height = 500;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#547c85";
        context.fillRect(0, 0, 500, 500);
        return canvas.toDataURL("image/jpeg").split(",")[1];
      }),
      "base64",
    ),
  });
  await expect(page.getByRole("button", { name: /Map holds/ })).toBeVisible();
  await page.getByRole("button", { name: /Map holds/ }).click();
  await expect(page.getByRole("button", { name: /^Hold / })).toHaveCount(0);
  await add(page, 0.5, 0.4);
  await page.getByLabel("Color").fill("Teal");
  await page.getByLabel("Grade", { exact: true }).fill("V3");
  await page
    .getByLabel("Line notes optional")
    .fill("Right wrist hurts at the start. Use the high left foot.");
  await page.getByRole("button", { name: /Done · Save line/ }).click();
  await expect(
    page.getByText("Right wrist hurts at the start. Use the high left foot."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit notes" }).click();
  await page
    .getByLabel("Edit line notes")
    .fill("Updated beta: keep the left foot high and rest first.");
  await page.getByRole("button", { name: "Save notes" }).click();
  await expect(
    page.getByText("Updated beta: keep the left foot high and rest first."),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /Teal V3/ }).click();
  await expect(
    page.getByText("Updated beta: keep the left foot high and rest first."),
  ).toBeVisible();
});

test("limits reusable photos to the selected gym", async ({ page }) => {
  await upload(page);
  await add(page, 0.5, 0.5);
  await page.getByLabel("Color").fill("Indigo");
  await page.getByLabel("Grade", { exact: true }).fill("V2");
  await page.getByLabel("Gym optional").fill("North Gym");
  await page.getByRole("button", { name: /Done · Save line/ }).click();
  await page.getByRole("button", { name: /All lines/ }).click();
  await page.getByRole("button", { name: /New line/ }).click();

  await page.getByLabel("Gym for photo reuse").fill("South Gym");
  await expect(
    page
      .locator(".saved-photo-strip")
      .getByRole("button", { name: /Indigo V2/ }),
  ).toHaveCount(0);
  await page.getByLabel("Gym for photo reuse").fill("North Gym");
  await expect(
    page
      .locator(".saved-photo-strip")
      .getByRole("button", { name: /Indigo V2/ }),
  ).toBeVisible();
});

test("replaces a saved line photo and persists its new hold map", async ({
  page,
}) => {
  await upload(page, 600, 900);
  await add(page, 0.4, 0.6);
  await page.getByLabel("Color").fill("Copper");
  await page.getByLabel("Grade", { exact: true }).fill("V3");
  await page.getByLabel("Gym optional").fill("Edit Gym");
  await page.getByRole("button", { name: /Done · Save line/ }).click();
  await page.getByRole("button", { name: "Edit line & holds" }).click();

  const replacement = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 600;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#9a6f47";
    context.fillRect(0, 0, 1200, 600);
    return canvas.toDataURL("image/jpeg").split(",")[1];
  });
  await page.getByLabel("Choose a different photo").setInputFiles({
    name: "wide-wall.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(replacement, "base64"),
  });
  await page.getByRole("button", { name: /Map holds/ }).click();
  await add(page, 0.7, 0.4);
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.reload();
  await page.getByRole("button", { name: /Copper V3/ }).click();
  await expect(page.getByTestId("hold-1")).toBeVisible();
  const ratio = await page
    .getByTestId("photo-map")
    .locator("img")
    .evaluate(
      (image: HTMLImageElement) => image.naturalWidth / image.naturalHeight,
    );
  expect(ratio).toBeGreaterThan(1.5);
});

test("exports and imports lines, photos, sessions, attempts, and notes", async ({
  page,
}) => {
  await upload(page);
  await add(page, 0.5, 0.5);
  await page.getByLabel("Color").fill("Silver");
  await page.getByLabel("Grade", { exact: true }).fill("V2");
  await page.getByLabel("Line notes optional").fill("Backup test beta.");
  await page.getByRole("button", { name: /Done · Save line/ }).click();
  await page.getByRole("button", { name: /All lines/ }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  expect(backupPath).toBeTruthy();

  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase("bouldero-v1");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
  );
  await page.reload();
  await expect(page.getByRole("button", { name: /Silver V2/ })).toHaveCount(0);
  await page.getByLabel("Import backup").setInputFiles(backupPath!);
  await expect(
    page.getByText(/Imported 1 lines, 0 sessions, and 0 attempts/),
  ).toBeVisible();
  await page.getByRole("button", { name: /Silver V2/ }).click();
  await expect(page.getByText("Backup test beta.")).toBeVisible();
  await expect(page.getByTestId("photo-map").locator("img")).toBeVisible();
});

test("starts a gym session and persists an attempt with notes", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await upload(page);
  await add(page, 0.4, 0.6);
  await add(page, 0.55, 0.35);
  await page.getByLabel("Color").fill("Green");
  await page.getByLabel("Grade", { exact: true }).fill("V2");
  await page.getByLabel("Gym optional").fill("Test Gym");
  await page.getByRole("button", { name: /Done · Save line/ }).click();
  await page.getByRole("button", { name: /All lines/ }).click();

  await page.getByRole("button", { name: /Start a session/ }).click();
  await page.getByLabel("Gym", { exact: true }).fill("Test Gym");
  await page.getByRole("button", { name: /Start session/ }).click();
  await expect(page.getByText("SESSION IN PROGRESS")).toBeVisible();
  await expect(page.getByLabel("Session elapsed time")).toContainText(
    /00:00:0/,
  );
  await page
    .locator(".project-grid")
    .getByRole("button", { name: /Green V2/ })
    .click();
  await page.locator(".attempt-hold-picker").getByTestId("hold-1").click();
  await page.getByRole("button", { name: /Add attempt/ }).click();
  await expect(page.getByText("#1 · Attempted")).toBeVisible();
  await expect(
    page.locator(".attempt-history").getByText("Controlled hold 1"),
  ).toBeVisible();
  await page.getByRole("button", { name: /All lines/ }).click();
  await expect(
    page.getByRole("heading", { name: "Attempted lines" }),
  ).toBeVisible();
  await expect(
    page.locator(".session-attempted-lines").getByRole("button", {
      name: /Green V2 1 attempt/,
    }),
  ).toBeVisible();
  await page
    .locator(".session-attempted-lines")
    .getByRole("button", { name: /Green V2/ })
    .click();
  await page.getByRole("button", { name: "Sent" }).click();
  await page
    .getByLabel("Notes optional")
    .fill("Kept my hips close on the last move.");
  await page.getByRole("button", { name: /Add attempt/ }).click();

  await expect(page.getByText("#2 · Sent")).toBeVisible();
  await expect(page.locator(".pill")).toHaveText("Completed");
  await expect(
    page.locator(".attempt-history").getByText("Controlled hold 2"),
  ).toBeVisible();
  await expect(
    page.getByText("Kept my hips close on the last move."),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /Completed 1/ }).click();
  await page
    .locator(".project-grid")
    .getByRole("button", { name: /Green V2/ })
    .click();
  await expect(page.getByText("#2 · Sent")).toBeVisible();
  await page
    .locator(".attempt-history article")
    .filter({ hasText: "#2 · Sent" })
    .getByRole("button", { name: "Edit attempt" })
    .click();
  await page.getByLabel("Edit attempt result").selectOption("attempt");
  await page.getByRole("button", { name: "Save attempt" }).click();
  await expect(page.getByText("#2 · Attempted")).toBeVisible();
  await expect(page.locator(".pill")).toHaveText("Ongoing");
  await page
    .locator(".attempt-history article")
    .filter({ hasText: "#2 · Attempted" })
    .getByRole("button", { name: "Edit attempt" })
    .click();
  await page.getByLabel("Edit attempt result").selectOption("sent");
  await page.getByRole("button", { name: "Save attempt" }).click();
  await expect(page.locator(".pill")).toHaveText("Completed");
});

test("backfills a past session and adds attempts at the historical time", async ({
  page,
}) => {
  await upload(page);
  await add(page, 0.4, 0.6);
  await page.getByLabel("Color").fill("Blue");
  await page.getByLabel("Grade", { exact: true }).fill("V3");
  await page.getByLabel("Gym optional").fill("Archive Gym");
  await page.getByRole("button", { name: /Done · Save line/ }).click();
  await page.getByRole("button", { name: /All lines/ }).click();

  await page.getByRole("button", { name: /Start a session/ }).click();
  await page.getByRole("button", { name: "Add past session" }).click();
  await page.getByLabel("Gym", { exact: true }).fill("Archive Gym");
  await page.getByLabel("Started").fill("2026-08-15T18:00");
  await page.getByLabel("Ended").fill("2026-08-15T20:30");
  await page.getByRole("button", { name: /Create past session/ }).click();

  await expect(page.getByText("ADDING A PAST SESSION")).toBeVisible();
  await expect(page.getByLabel("Session elapsed time")).toContainText("2h 30m");
  await page.getByRole("button", { name: /Blue V3/ }).click();
  await page.locator(".attempt-hold-picker").getByTestId("hold-1").click();
  await page.getByRole("button", { name: /Add attempt/ }).click();
  await page.getByRole("button", { name: /All lines/ }).click();
  await page.getByRole("button", { name: "Finish adding history" }).click();

  await expect(page.getByText(/Aug 15, 2026/)).toBeVisible();
  await expect(page.locator(".session-summary")).toContainText("1 attempts");
  await page.getByRole("button", { name: "Edit details" }).click();
  await page.getByLabel("Edit session gym").fill("Revised Archive Gym");
  await page.getByLabel("Edit session start").fill("2026-08-15T17:45");
  await page.getByLabel("Edit session end").fill("2026-08-15T19:00");
  await page.getByRole("button", { name: "Save session details" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "include every attempt",
  );
  await page.getByLabel("Edit session end").fill("2026-08-15T20:45");
  await page.getByRole("button", { name: "Save session details" }).click();
  await expect(
    page.getByRole("heading", { name: "Revised Archive Gym" }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Blue V3/ }).click();
  await page.getByRole("button", { name: "Edit attempt" }).click();
  await page.getByLabel("Edit attempt result").selectOption("sent");
  await page.getByLabel("Edit attempt time").fill("2026-08-16T19:15");
  await page.getByRole("button", { name: "Save attempt" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "inside its session",
  );
  await page.getByLabel("Edit attempt time").fill("2026-08-15T19:15");
  await page
    .getByLabel("Edit attempt notes")
    .fill("Corrected after reviewing the past session.");
  await page.getByRole("button", { name: "Save attempt" }).click();
  await expect(page.getByText("#1 · Sent")).toBeVisible();
  await expect(
    page.getByText("Corrected after reviewing the past session."),
  ).toBeVisible();
  await page.getByRole("button", { name: "History" }).click();
  await page.getByRole("button", { name: "Edit session" }).click();
  await expect(page.getByText("ADDING A PAST SESSION")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Attempted lines" }),
  ).toBeVisible();
  await expect(page.getByLabel("Current session summary")).toContainText("1");
  await page.getByRole("button", { name: "Finish adding history" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete session" }).click();
  await expect(
    page.getByRole("heading", { name: "Revised Archive Gym" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Home/ }).click();
  await expect(page.getByRole("button", { name: /Blue V3/ })).toBeVisible();
});

test("records failed starts, partial starts, controlled holds, and attempt batches", async ({
  page,
}) => {
  await upload(page);
  await add(page, 0.35, 0.7);
  await add(page, 0.5, 0.5);
  await add(page, 0.65, 0.3);
  await page.getByLabel("Color").fill("Mint");
  await page.getByLabel("Grade", { exact: true }).fill("V4");
  await page.getByLabel("Gym optional").fill("Semantics Gym");
  await page.getByRole("button", { name: /Done · Save line/ }).click();
  await page.getByRole("button", { name: /All lines/ }).click();
  await page.getByRole("button", { name: /Start a session/ }).click();
  await page.getByLabel("Gym", { exact: true }).fill("Semantics Gym");
  await page.getByRole("button", { name: /Start session/ }).click();
  await page.getByRole("button", { name: /Mint V4/ }).click();

  await expect(page.locator(".attempt-hold-picker > strong")).toHaveText(
    "Couldn’t establish start",
  );
  await page.getByRole("button", { name: /^Add attempt/ }).click();
  await expect(
    page.locator(".attempt-history").getByText("Couldn’t establish start"),
  ).toBeVisible();

  await page.getByRole("button", { name: "From a hold" }).click();
  await page
    .getByLabel("Partial starting hold")
    .selectOption({ label: "Hold 2" });
  await page.locator(".attempt-hold-picker").getByTestId("hold-1").click();
  await page.getByRole("button", { name: /^Add attempt/ }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "cannot come before",
  );

  await page.locator(".attempt-hold-picker").getByTestId("hold-3").click();
  await page.getByLabel("Attempts to add").fill("3");
  await page.getByRole("button", { name: "Add 3 attempts" }).click();
  await expect(page.getByText("Total attempts").locator("..")).toContainText(
    "4",
  );
  await expect(
    page.locator(".attempt-history").getByText("Started from hold 2"),
  ).toHaveCount(3);
  await expect(
    page.locator(".attempt-history").getByText("Controlled hold 3"),
  ).toHaveCount(3);
});

test("reuses one photo for a reps-only warm-up line", async ({ page }) => {
  await upload(page);
  await add(page, 0.5, 0.5);
  await page.getByLabel("Color").fill("Red");
  await page.getByLabel("Grade", { exact: true }).fill("V1");
  await page.getByLabel("Gym optional").fill("Test Gym");
  await page.getByRole("button", { name: /Done · Save line/ }).click();

  await page
    .getByRole("button", { name: /Create another line from this photo/ })
    .click();
  await page.getByRole("button", { name: /Reps only/ }).click();
  await expect(
    page.getByText("Reps-only line — no markers needed."),
  ).toBeVisible();
  await page.getByLabel("Color").fill("Yellow");
  await page.getByLabel("Grade", { exact: true }).fill("V0");
  await page.getByRole("button", { name: /Warm-up/ }).click();
  await page.getByRole("button", { name: /Done · Save line/ }).click();
  await expect(page.getByText("Repetitions")).toBeVisible();

  const stored = await page.evaluate(async () => {
    const request = indexedDB.open("bouldero-v1", 2);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<Array<Record<string, unknown>>>(
      (resolve, reject) => {
        const get = db
          .transaction("projects", "readonly")
          .objectStore("projects")
          .getAll();
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
      },
    );
    db.close();
    return rows.map((row) => ({
      name: row.name,
      hasPhoto: row.photo instanceof Blob,
      source: row.source_project_id,
      mode: row.route_mode,
    }));
  });
  expect(stored.find((row) => row.name === "Red V1")?.hasPhoto).toBe(true);
  expect(stored.find((row) => row.name === "Yellow V0")).toMatchObject({
    hasPhoto: false,
    mode: "count_only",
  });
  expect(stored.find((row) => row.name === "Yellow V0")?.source).toBeTruthy();

  await page.getByRole("button", { name: /All lines/ }).click();
  await expect(page.getByText("Shared wall · 2 lines")).toHaveCount(2);
  await expect(page.locator(".arrow-icon").first()).toBeVisible();
  await page.evaluate(async () => {
    const request = indexedDB.open("bouldero-v1", 2);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("projects", "readwrite");
      const store = transaction.objectStore("projects");
      const get = store.getAll();
      get.onsuccess = () => {
        const warmUp = get.result.find(
          (row: { name: string }) => row.name === "Yellow V0",
        );
        store.put({
          ...warmUp,
          status: "sent",
          sent_at: new Date().toISOString(),
        });
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });
  await page.reload();
  await page.getByRole("button", { name: /Yellow V0/ }).click();
  await expect(page.locator(".pill")).toHaveText("Ongoing");
  expect(
    await page.evaluate(async () => {
      const request = indexedDB.open("bouldero-v1", 2);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const rows = await new Promise<Array<{ name: string; status: string }>>(
        (resolve, reject) => {
          const get = db
            .transaction("projects", "readonly")
            .objectStore("projects")
            .getAll();
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => reject(get.error);
        },
      );
      db.close();
      return rows.find((row) => row.name === "Yellow V0")?.status;
    }),
  ).toBe("active");
  await page.getByRole("button", { name: /All lines/ }).click();
  await page.getByRole("button", { name: /Start a session/ }).click();
  await page.getByLabel("Gym", { exact: true }).fill("Test Gym");
  await page.getByRole("button", { name: /Start session/ }).click();
  await page.getByRole("button", { name: /Yellow V0/ }).click();
  await page.getByRole("button", { name: /Add attempt/ }).click();
  await page.getByRole("button", { name: /Add attempt/ }).click();
  await expect(page.getByText("Total attempts").locator("..")).toContainText(
    "2",
  );
});

test("filters, lists, completes, archives, and restores lines", async ({
  page,
}) => {
  await upload(page);
  await add(page, 0.45, 0.55);
  await page.getByLabel("Color").fill("Blue");
  await page.getByLabel("Grade", { exact: true }).fill("V5");
  await page.getByLabel("Gym optional").fill("Library Gym");
  await page.getByRole("button", { name: /Done · Save line/ }).click();

  await page.getByRole("button", { name: "Mark completed" }).click();
  await expect(page.locator(".pill")).toHaveText("Completed");
  await page.getByRole("button", { name: /All lines/ }).click();
  await expect(page.getByRole("button", { name: /Blue V5/ })).toHaveCount(0);
  await page.getByRole("button", { name: /Completed 1/ }).click();
  await expect(page.getByRole("button", { name: /Blue V5/ })).toBeVisible();

  await page.getByRole("button", { name: "List view" }).click();
  await expect(page.locator(".project-grid")).toHaveClass(/list-view/);
  await page.getByLabel("Filter by gym").selectOption("Library Gym");
  await page.getByLabel("Search lines").fill("missing");
  await expect(
    page.getByRole("heading", { name: "No lines match." }),
  ).toBeVisible();
  await page.getByLabel("Search lines").fill("blue");
  await page.getByRole("button", { name: /Blue V5/ }).click();

  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.locator(".pill")).toHaveText("Archived");
  await page.getByRole("button", { name: "Move to ongoing" }).click();
  await expect(page.locator(".pill")).toHaveText("Ongoing");
});

test("shows live session counts, switches lines directly, and offers a next step after send", async ({
  page,
}) => {
  await upload(page);
  await add(page, 0.5, 0.5);
  await page.getByLabel("Color").fill("Olive");
  await page.getByLabel("Grade", { exact: true }).fill("V2");
  await page.getByLabel("Gym optional").fill("Flow Gym");
  await page.getByRole("button", { name: /Done · Save line/ }).click();
  await page
    .getByRole("button", { name: /Create another line from this photo/ })
    .click();
  await page.getByRole("button", { name: /Reps only/ }).click();
  await page.getByLabel("Color").fill("Gold");
  await page.getByLabel("Grade", { exact: true }).fill("V1");
  await page.getByRole("button", { name: /Done · Save line/ }).click();
  await page
    .getByRole("button", { name: /Create another line from this photo/ })
    .click();
  await page.getByRole("button", { name: /Reps only/ }).click();
  await page.getByLabel("Color").fill("Away");
  await page.getByLabel("Grade", { exact: true }).fill("V0");
  await page.getByLabel("Gym optional").fill("Other Gym");
  await page.getByRole("button", { name: /Done · Save line/ }).click();
  await page.getByRole("button", { name: /All lines/ }).click();

  await page.getByRole("button", { name: /Start a session/ }).click();
  await page.getByLabel("Gym", { exact: true }).fill("Flow Gym");
  await page.getByRole("button", { name: /Start session/ }).click();
  const summary = page.getByLabel("Current session summary");
  await expect(summary.getByText("Attempts").locator("..")).toContainText("0");
  await expect(summary.getByText("New lines").locator("..")).toContainText("0");
  await expect(summary.getByText("Carried in").locator("..")).toContainText(
    "2",
  );

  await page.getByRole("button", { name: /Away V0/ }).click();
  await expect(
    page.getByRole("heading", { name: "This session is at Flow Gym." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Send project/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Edit line & holds" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /All lines/ }).click();

  await page.getByRole("button", { name: /Olive V2/ }).click();
  await page
    .locator(".line-switcher")
    .getByRole("button", { name: /Gold V1/ })
    .click();
  await expect(page.getByRole("heading", { name: "Gold V1" })).toBeVisible();
  await page.getByRole("button", { name: /^Add attempt/ }).click();
  await page.getByRole("button", { name: /All lines/ }).click();
  await expect(summary.getByText("Attempts").locator("..")).toContainText("1");
  const goldCard = page
    .locator(".project-grid .project-card")
    .filter({ hasText: "Gold V1" });
  await expect(goldCard.locator(".card-attempts")).toContainText("1 total");
  await expect(goldCard.locator(".card-attempts")).toContainText("1 today");
  await expect(goldCard.locator(".card-attempts")).toContainText("Just now");
  await expect(
    page.locator(".project-grid .project-card").first(),
  ).toContainText("Gold V1");

  await page.getByRole("button", { name: /New line/ }).click();
  await page
    .locator(".saved-photo-strip")
    .getByRole("button", { name: /Olive V2/ })
    .click();
  await page.getByRole("button", { name: /Reps only/ }).click();
  await page.getByLabel("Color").fill("Coral");
  await page.getByLabel("Grade", { exact: true }).fill("V0");
  await page.getByRole("button", { name: /Done · Save line/ }).click();
  await page.getByRole("button", { name: /All lines/ }).click();
  await expect(summary.getByText("New lines").locator("..")).toContainText("1");

  await page
    .locator(".project-grid")
    .getByRole("button", { name: /Gold V1/ })
    .click();
  await page.getByRole("button", { name: /Send project/ }).click();
  await expect(page.getByText("Completed this session")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Next ongoing line/ }),
  ).toBeVisible();
});

test("shows session history, timeline notes, and line progress", async ({
  page,
}) => {
  await upload(page);
  await add(page, 0.4, 0.6);
  await page.getByLabel("Color").fill("Black");
  await page.getByLabel("Grade", { exact: true }).fill("V6");
  await page.getByLabel("Gym optional").fill("History Gym");
  await page.getByRole("button", { name: /Top out/ }).click();
  await page.getByRole("button", { name: /Done · Save line/ }).click();
  await page.getByRole("button", { name: /All lines/ }).click();
  await page.getByRole("button", { name: /Start a session/ }).click();
  await page.getByLabel("Gym", { exact: true }).fill("History Gym");
  await page.getByRole("button", { name: /Start session/ }).click();
  await page.getByRole("button", { name: /Black V6/ }).click();
  await page
    .getByLabel("Notes optional")
    .fill("Matched the final hold with control.");
  await page.getByRole("button", { name: "Sent" }).click();
  await expect(page.locator(".attempt-hold-picker > strong")).toHaveText(
    "Reached TOP OUT",
  );
  await page.getByRole("button", { name: /Add attempt/ }).click();
  await page.getByRole("button", { name: /All lines/ }).click();
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: "History" }).click();

  await expect(
    page.getByRole("heading", { name: "Session timeline" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "History Gym" }),
  ).toBeVisible();
  await expect(page.locator(".session-summary")).toContainText("1 attempts");
  await expect(page.locator(".session-summary")).toContainText("1 sends");
  await expect(
    page.getByText("“Matched the final hold with control.”"),
  ).toBeVisible();
  await page.getByRole("button", { name: /Black V6/ }).click();
  await expect(page.getByRole("button", { name: /History/ })).toBeVisible();
  await expect(
    page.locator(".attempt-history").getByText("Reached TOP OUT"),
  ).toBeVisible();
  await expect(page.getByText(/History Gym ·/)).toBeVisible();
  await expect(page.getByText("Sends recorded").locator("..")).toContainText(
    "1",
  );
});

test("edits saved holds and keeps reusable warm-ups ongoing after a send", async ({
  page,
}) => {
  await upload(page);
  await add(page, 0.35, 0.65);
  await page.getByLabel("Color").fill("Rose");
  await page.getByLabel("Grade", { exact: true }).fill("V1");
  await page.getByLabel("Gym optional").fill("Repeat Gym");
  await page.getByRole("button", { name: /Warm-up/ }).click();
  await page.getByRole("button", { name: /Done · Save line/ }).click();
  await expect(page.getByLabel("Line purpose")).toContainText("Warm-up");

  await page.getByRole("button", { name: "Edit line & holds" }).click();
  await add(page, 0.65, 0.35);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Holds mapped").locator("..")).toContainText("2");

  await page.getByRole("button", { name: /All lines/ }).click();
  await page.getByRole("button", { name: /Start a session/ }).click();
  await page.getByLabel("Gym", { exact: true }).fill("Repeat Gym");
  await page.getByRole("button", { name: /Start session/ }).click();
  await page
    .locator(".project-grid")
    .getByRole("button", { name: /Rose V1/ })
    .click();
  await page.getByRole("button", { name: /Send warm-up/ }).click();
  await expect(
    page.getByText("This reusable line stays ongoing."),
  ).toBeVisible();
  await page
    .locator(".project-grid")
    .getByRole("button", { name: /Rose V1/ })
    .click();
  await expect(page.locator(".pill")).toHaveText("Ongoing");
  await page.getByRole("button", { name: /All lines/ }).click();
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.locator(".session-summary")).toContainText("0 sends");
});
