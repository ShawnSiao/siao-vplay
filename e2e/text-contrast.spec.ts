import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// SC 1.4.3: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
// Solid colors and simple opaque monotonic linear gradients. Images, group opacity and pseudo-element backgrounds need visual review.
for (const route of ["library.html", "runtime.html", "player.html?summary=result&drawer", "dialog.html"]) {
  test(`solid-background text contrast: ${route}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 960, height: 640 });
    await page.goto(`/e2e/${route}`);
    await page.locator("#root").locator(":scope > *").first().waitFor();
    if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, `contrast-${route.split(".")[0]}.png`) });
    const audit = await page.evaluate(() => {
      type Color = [number, number, number, number];
      const parse = (value: string): Color | null => {
        const match = value.match(/^rgba?\(([^)]+)\)$/);
        if (!match) return null;
        const parts = match[1].split(/[,\s/]+/).map(Number);
        return [parts[0], parts[1], parts[2], parts[3] ?? 1];
      };
      const over = (front: Color, back: Color): Color => {
        const alpha = front[3] + back[3] * (1 - front[3]);
        return [0, 1, 2].map((i) => (front[i] * front[3] + back[i] * back[3] * (1 - front[3])) / alpha).concat(alpha) as Color;
      };
      const luminance = (color: Color) => color.slice(0, 3).map((value) => value / 255)
        .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const measured: { text: string; selector: string; ratio: number; required: number }[] = [];
      const unverified: { text: string; reason: string; color: string; backgrounds: string[] }[] = [];
      for (const element of document.querySelectorAll("p,span,small,label,strong,em,button,a,h1,h2,h3,summary,li,dt,dd")) {
        const text = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join("").trim();
        if (!/[\p{L}\p{N}]/u.test(text) || !element.getClientRects().length || element.closest(":disabled,[aria-disabled='true'],[hidden],[inert],[aria-hidden='true']")) continue;
        const style = getComputedStyle(element);
        if (style.visibility !== "visible") continue;
        let background: Color = [0, 0, 0, 0];
        let reason = "";
        for (let parent: Element | null = element; parent; parent = parent.parentElement) {
          const current = getComputedStyle(parent);
          if (["::before", "::after"].some((pseudo) => {
            const overlay = getComputedStyle(parent!, pseudo);
            return !["none", "normal"].includes(overlay.content) &&
              (overlay.backgroundImage !== "none" || (parse(overlay.backgroundColor)?.[3] ?? 0) > 0);
          })) { reason = "pseudo-element background"; break; }
          if (Number(current.opacity) !== 1) { reason = "group opacity"; break; }
          if (background[3] < 1) {
            if (current.backgroundImage !== "none") {
              const colors = [...current.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map((match) => parse(match[0])!);
              const foreground = parse(style.color);
              const simple = current.backgroundImage.startsWith("linear-gradient(") &&
                current.backgroundImage.split("gradient").length === 2 && colors.length === 2 && colors.every((color) => color[3] === 1);
              if (!simple || !foreground || foreground[3] !== 1) { reason = "background image"; break; }
              const candidates = colors.map((color) => over(background, color));
              const monotonic = [1, -1].some((direction) => [0, 1, 2].every((i) => direction * (candidates[0][i] - candidates[1][i]) >= 0));
              const light = luminance(foreground);
              const limits = candidates.map(luminance).sort((a, b) => a - b);
              if (!monotonic || (light > limits[0] && light < limits[1])) { reason = "non-monotonic gradient contrast"; break; }
              const ratio = (color: Color) => (Math.max(light, luminance(color)) + 0.05) / (Math.min(light, luminance(color)) + 0.05);
              background = candidates.sort((a, b) => ratio(a) - ratio(b))[0];
              continue;
            }
            const color = parse(current.backgroundColor);
            if (!color) { reason = "unsupported background color"; break; }
            if (color[3] > 0) background = over(background, color);
          }
        }
        const foreground = parse(style.color);
        if (reason || !foreground || background[3] < 1) {
          const backgrounds: string[] = [];
          for (let node: Element | null = element; node; node = node.parentElement) {
            const computed = getComputedStyle(node);
            backgrounds.push(`${node.tagName}.${node.className}: ${computed.backgroundColor}; ${computed.backgroundImage}`);
          }
          unverified.push({ text, reason: reason || "unknown color", color: style.color, backgrounds }); continue;
        }
        const values = [luminance(over(foreground, background)), luminance(background)].sort((a, b) => b - a);
        const size = parseFloat(style.fontSize);
        measured.push({ text, selector: `${element.parentElement?.className} > ${element.tagName}.${element.className}`, ratio: (values[0] + 0.05) / (values[1] + 0.05),
          required: size >= 24 || (size >= 18.6667 && Number(style.fontWeight) >= 700) ? 3 : 4.5 });
      }
      return { measured, unverified };
    });
    if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await writeFile(join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, `contrast-${route.split(".")[0]}.json`), JSON.stringify(audit, null, 2));
    await testInfo.attach("computed-text-contrast", { body: JSON.stringify(audit, null, 2), contentType: "application/json" });
    expect(audit.measured.length).toBeGreaterThan(10);
    expect(audit.measured.filter((item) => item.ratio < item.required)).toEqual([]);
  });
}
