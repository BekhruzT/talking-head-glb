// Integration check over every downloaded head; drives eval/rig-probe.js. Run
// with the app on :3000 and the eval server on :4100, from Playwright MCP
// browser_run_code with this file. The sweep takes minutes and an MCP call
// times out in one, so this starts it in the background and returns; results
// land in eval/rig-results.json after each head, with `done` set at the end.
async (page) => {
  if (page.__rigCheckRunning) return "sweep already running; watch eval/rig-results.json";
  page.__rigCheckRunning = true;
  const heads = ["", "medical-female-01", "medical-male-01", "business-female-02", "business-male-03", "ict-facekit"];
  const results = { done: false };
  const save = () => fetch("http://localhost:4100/upload?name=rig-results.json", { method: "POST", body: JSON.stringify(results, null, 2) });
  const open = async (query) => {
    await page.goto(`http://localhost:3000/?probe${query}`);
    await page.addScriptTag({ url: `http://localhost:4100/rig-probe.js?${Date.now()}` });
    await page.waitForFunction(() => window.__avatar, null, { timeout: 30000 });
    await page.evaluate(() => stubMic());
  };
  (async () => {
    for (const model of heads) {
      const tag = model || "ava";
      const query = model ? `&model=${model}` : "";
      const out = (results[tag] = {});
      try {
        await open(query);
        out.rig = await page.evaluate(() => ({ channels: Object.keys(__avatar.indices).length, headBone: __avatar.headBone?.name ?? null, missing: ["jawOpen", "eyeBlinkLeft", "mouthSmileLeft", "eyeLookUpLeft", "aa_02", "p_b_m_21", "HeadUp", "TrunLeft"].filter((n) => !(n in __avatar.indices)) }));
        await page.waitForTimeout(1500);
        await page.evaluate((t) => shot(`rig-${t}-frame.png`), tag);
        out.idle = await page.evaluate(() => probeIdle(12000));
        // A real click, so the page has the user activation audio.play() needs.
        await page.locator("button:has(svg[data-testid^='MicOff'])").click();
        out.speech = await page.evaluate(() => probeSpeech("etf01"));
        await page.waitForTimeout(1500);
        out.visemes = await page.evaluate(() => probeSpeech("etf01", { visemesOnly: true }));
        await open(`${query}&noExpressions=1&noHeadMovement=1`);
        out.idleMotionOff = await page.evaluate((t) => probeIdle(8000, `${t}-motion-off`), tag);
      } catch (err) {
        out.error = String(err);
      }
      await save();
    }
    results.done = true;
    await save();
    page.__rigCheckRunning = false;
  })();
  return { started: heads.map((h) => h || "ava") };
}
