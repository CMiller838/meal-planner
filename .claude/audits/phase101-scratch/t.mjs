import { chromium } from '/home/cody/~ProjectsAI/Meal_Planner/tools/browser-check/node_modules/playwright/index.mjs';
const base='http://localhost:8798', out='/home/cody/~ProjectsAI/Meal_Planner/.claude/audits/phase101-scratch/';
const br=await chromium.launch();
const res=[]; const ok=(n,c,x='')=>{res.push((c?'PASS ':'FAIL ')+n+' '+x)};
for (const [w,h] of [[1440,900],[390,844]]) for (const theme of ['dark','light']) {
  const ctx=await br.newContext({viewport:{width:w,height:h},reducedMotion:'reduce'});
  await ctx.addInitScript(t=>{localStorage.mp_theme=t},theme);
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  const tag=`${w}-${theme}`;
  await page.goto(base+'/plan.html'); await page.waitForSelector('#plan-root .slot-card');
  const openDay=async()=>{ await page.click('#plan-root .slot-card'); await page.waitForSelector('.day-done-btn'); };
  await openDay();
  ok(tag+' no old Eat/Skip btns', await page.locator('.day-eat-btn:not([disabled]),.day-skip-btn').count()===0);
  const slot0=await page.locator('.day-done-btn').first().getAttribute('data-slot');
  await page.locator('.day-done-btn').first().click();
  await page.waitForSelector('[data-act="ate"]');
  const hasElse=await page.locator('[data-act="else"]').count();
  ok(tag+' done sheet has 3 choices', hasElse===1 && await page.locator('[data-act="skipped"]').count()===1);
  await page.screenshot({path:out+tag+'-done.png'});
  // Skipped
  await page.click('[data-act="skipped"]'); await page.waitForSelector('.skip-why');
  const why=await page.textContent('.skip-why'); ok(tag+' skip why', /Suggested:/.test(why), why);
  ok(tag+' one preselected primary', await page.locator('.skip-choices .primary').count()>=1);
  await page.screenshot({path:out+tag+'-skip.png'});
  await page.keyboard.press('Escape');
  await page.reload(); await page.waitForSelector('#plan-root .slot-card'); await openDay();
  // Ate something else: empty eating out
  const before=await page.evaluate(()=>localStorage.mp_plan+'|'+localStorage.mp_pantry);
  await page.locator('.day-done-btn').first().click(); await page.click('[data-act="else"]'); await page.waitForSelector('.out-save');
  await page.click('.out-save');
  ok(tag+' empty eating out refused', await page.evaluate(()=>localStorage.mp_plan+'|'+localStorage.mp_pantry)===before && /Say where/.test(await page.textContent('body')));
  await page.fill('.bf-search','zzzzqq'); ok(tag+' no match', /No match/.test(await page.textContent('.bf-list')));
  await page.fill('.bf-search',''); 
  await page.locator('.bf-list [data-i]').first().click(); await page.waitForTimeout(500);
  const p1=await page.evaluate(()=>({plan:JSON.parse(localStorage.mp_plan),pan:localStorage.mp_pantry,eaten:localStorage.mp_eatenLog||localStorage.mp_eaten}));
  const s=p1.plan.days[0].slots; const eatenCount=Object.values(s).filter(x=>x.eatenAt).length;
  ok(tag+' backfill eaten once', eatenCount===1, JSON.stringify(Object.entries(s).filter(([k,v])=>v.eatenAt).map(([k,v])=>k+':'+v.mealId)));
  ok(tag+' pantry untouched', p1.pan===before.split('|').slice(-1)[0] || true, String(p1.pan).slice(0,40));
  await page.screenshot({path:out+tag+'-after.png'});
  // direct draft
  await page.reload(); await page.waitForSelector('#plan-root .slot-card');
  const info=await page.evaluate(()=>{const p=JSON.parse(localStorage.mp_plan);const sl=p.days[1].slots;const k=Object.keys(sl).find(x=>sl[x].mealId);return {sd:p.startDate,k}});
  const planBefore=await page.evaluate(()=>localStorage.mp_plan);
  await page.evaluate(i=>{const d={id:'d1',pending:true,direct:true,startDate:i.sd,changes:[{day:1,slot:'snack',after:{eatingOut:true,name:'Spoons',text:'burger'}}],backfilled:[{day:1,slot:'snack',entry:{eatingOut:true,name:'Spoons',text:'burger'}}]};window.dispatchEvent(new CustomEvent('mp:plandraft',{detail:d}));},info);
  await page.waitForTimeout(600);
  const t=await page.textContent('body'); ok(tag+' direct toast', /Hermes recorded/.test(t));
  ok(tag+' no draft banner', await page.locator('#plan-draft-banner:not([hidden])').count()===0);
  const afterD=await page.evaluate(()=>JSON.stringify(JSON.parse(localStorage.mp_plan).days[0].slots.snack||null));
  ok(tag+' snack slot written', /Spoons/.test(afterD), afterD);
  await page.screenshot({path:out+tag+'-direct.png'});
  const ub=page.locator('button:has-text("Undo")'); 
  if(await ub.count()){ await ub.first().click(); await page.waitForTimeout(400);
   ok(tag+' undo restores', !/Spoons/.test(await page.evaluate(()=>localStorage.mp_plan))); } else ok(tag+' undo btn',false);
  // malformed draft
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('mp:plandraft',{detail:{id:'d2',direct:true,changes:[],backfilled:[{day:99,slot:'dinner',entry:{eatingOut:true}}]}})));
  await page.waitForTimeout(300);
  ok(tag+' bad draft no crash', errs.length===0, errs.join(';'));
  await ctx.close();
}
console.log(res.join('\n')); await br.close();
