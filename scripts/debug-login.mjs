import puppeteer from "puppeteer-core";

const EMAIL = "demo.vertex@peham.ai";
const PASSWORD = "VertexDemo123!";

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
page.on("console", (m) => console.log("  [console]", m.text().slice(0, 200)));
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));

await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));

const dump = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll("input")].map((i) => ({
    type: i.type,
    placeholder: i.placeholder,
    value: i.value,
  }));
  const btns = [...document.querySelectorAll("button")].map((b) => b.textContent.trim().slice(0, 30));
  const bodyText = document.body.innerText.slice(0, 400);
  return { inputs, btns, bodyText };
});
console.log("INPUTS:", JSON.stringify(dump.inputs, null, 1));
console.log("BUTTONS:", dump.btns);
console.log("BODY:", dump.bodyText);

// Try filling + submit
try {
  await page.type('input[type="email"]', EMAIL, { delay: 20 });
  await page.type('input[type="password"]', PASSWORD, { delay: 20 });
  await page.click(".auth-submit");
  console.log("clicked .auth-submit");
} catch (e) {
  console.log("fill/click error:", String(e).slice(0, 300));
}

await new Promise((r) => setTimeout(r, 6000));
const after = await page.evaluate(() => ({
  hasComposer: !!document.querySelector(".input-row input"),
  bodyText: document.body.innerText.slice(0, 500),
  url: location.href,
}));
console.log("AFTER:", JSON.stringify(after, null, 1));

await browser.close();
