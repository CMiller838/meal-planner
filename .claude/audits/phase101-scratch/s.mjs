import { chromium } from '/home/cody/~ProjectsAI/Meal_Planner/tools/browser-check/node_modules/playwright/index.mjs';
const br=await chromium.launch();const ctx=await br.newContext({viewport:{width:390,height:844}});
const page=await ctx.newPage();await page.goto('http://localhost:8798/plan.html');await page.waitForSelector('.slot-card');
await page.click('.slot-card');await page.locator('.day-done-btn').first().click();await page.waitForTimeout(1500);
await page.screenshot({path:'/home/cody/~ProjectsAI/Meal_Planner/.claude/audits/phase101-scratch/settled.png'});await br.close();
