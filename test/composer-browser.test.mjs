import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from './helpers/chromium.mjs'

const source = await readFile(new URL('../hermes-dynamic-chat/plugin.js', import.meta.url), 'utf8')
const fixture = `<!doctype html><html><head><style>
html { font-size:14px; --composer-width:100%; --foreground:#222; --card:#eee; }
body { margin:0; }
[data-chat-surface] { position:relative; width:1200px; height:300px; }
[data-slot='aui_thread-content'] { box-sizing:border-box; width:100%; max-width:var(--composer-width); padding-inline:1.5rem; margin:auto; }
[data-slot='composer-dock'] { box-sizing:border-box; position:absolute; bottom:0; left:50%; transform:translateX(-50%); width:calc(min(var(--composer-width),calc(100% - 2rem)) + 10px); max-width:100%; }
[data-slot='composer-root'] { box-sizing:border-box; width:100%; padding-inline:5px; }
[data-slot='composer-surface'] { height:64px; background:var(--card); color:var(--foreground); border-radius:12px; }
[data-slot='composer-dock'][data-popped-out] { width:var(--composer-popout-width,24rem); max-width:calc(100vw - 1.5rem); }
[data-hud-shell] { --composer-width:320px; }
textarea { box-sizing:border-box; width:100%; }
</style></head><body>
<main data-chat-surface id='chat'><section data-slot='aui_thread-content'><p>Native transcript</p></section><div data-slot='composer-dock'><div data-slot='composer-root'><div data-slot='composer-surface'><textarea aria-label='Message'>Draft stays here</textarea><button>Send</button></div></div></div></main>
<div data-chat-surface id='second' style='width:400px'><div data-slot='composer-dock'><div data-slot='composer-root'></div></div></div>
<div data-chat-surface id='floating'><div data-slot='composer-dock' data-popped-out style='--composer-popout-width:24rem'><div data-slot='composer-root'></div></div></div>
<div data-hud-shell><div data-chat-surface id='hud'><div data-slot='composer-dock'><div data-slot='composer-root'></div></div></div></div>
<aside id='sidebar'>Native sidebar</aside><div id='unrelated' style='width:var(--composer-width)'>Unrelated panel</div>
</body></html>`

async function setup(browser, initial) {
  await browser.call('Page.setDocumentContent', { frameId: (await browser.call('Page.getFrameTree')).frameTree.frame.id, html: fixture })
  await browser.evaluate(`(async () => {
    window.values = new Map(${JSON.stringify(initial ? [['composer-width', initial]] : [])});
    window.notices=[]; window.entries=[]; window.cleanups=[]; window.writes=[];
    window.ctx={storage:{get:(key,fallback)=>values.has(key)?values.get(key):fallback,set:(key,value)=>{writes.push([key,value]);values.set(key,value)}},register:e=>entries.push(e),onDispose:fn=>cleanups.push(fn)};
    Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:key=>values.has('composer-width')?JSON.stringify(values.get('composer-width')):null}});
    window.originalInput=document.querySelector('textarea'); window.sent=0;
    document.querySelector('button').addEventListener('click',()=>sent++);
    const sdk=URL.createObjectURL(new Blob(['export const PALETTE_AREA="palette",host={notify:n=>window.notices.push(n)}'],{type:'text/javascript'}));
    const url=URL.createObjectURL(new Blob([${JSON.stringify(source)}.replace("from '@hermes/plugin-sdk'", "from '"+sdk+"'")],{type:'text/javascript'}));
    try { window.plugin=(await import(url)).default; } finally { URL.revokeObjectURL(url);URL.revokeObjectURL(sdk); }
    window.enable=()=>plugin.register(ctx);window.disable=()=>{cleanups.splice(0).reverse().forEach(fn=>fn());entries.length=0;};
    window.measure=()=>{
      const width=id=>document.querySelector('#'+id+' [data-slot="composer-dock"]').getBoundingClientRect().width;
      const surface=getComputedStyle(document.querySelector('[data-slot="composer-surface"]'));
      return {dock:width('chat'),second:width('second'),popout:width('floating'),hud:width('hud'),thread:document.querySelector('[data-slot="aui_thread-content"]').getBoundingClientRect().width,mode:document.documentElement.getAttribute('data-dynamic-chat-width'),background:surface.backgroundColor,radius:surface.borderRadius,sameInput:document.querySelector('textarea')===originalInput,draft:originalInput.value,owned:document.querySelectorAll('[data-dynamic-chat-owned]').length};
    };
  })()`)
}

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.05, `${actual} != ${expected}`)

test('shipping ESM preserves native UI while cycling widths, resizing panes and switching themes', async () => {
  const browser = await chromium()
  try {
    await setup(browser)
    const original = await browser.evaluate('measure()')
    await browser.evaluate('enable()')
    for (const [mode, width] of [['compact', 736], ['wide', 883.2], ['wider', 1030.4], ['hermes', 1200]]) {
      const metrics = await browser.evaluate('measure()')
      assert.equal(metrics.mode, mode)
      near(metrics.dock, mode === 'hermes' ? original.dock : Math.min(width + 10, 1178))
      near(metrics.thread, width)
      near(metrics.second, mode === 'hermes' ? original.second : 378)
      near(metrics.popout, original.popout)
      near(metrics.hud, original.hud)
      assert.equal(metrics.background, original.background)
      assert.equal(metrics.radius, original.radius)
      assert.equal(metrics.sameInput, true)
      assert.equal(metrics.draft, 'Draft stays here')
      assert.equal(metrics.owned, 1)
      await browser.evaluate('entries[0].data.run()')
    }
    await browser.evaluate(`document.documentElement.setAttribute('data-hermes-theme','another-theme');document.documentElement.style.setProperty('--card','#abcdef');document.documentElement.style.fontSize='16px';document.querySelector('#chat').style.width='320px'`)
    const narrow = await browser.evaluate('measure()')
    near(narrow.dock, 298)
    near(narrow.thread, 320)
    assert.equal(narrow.background, 'rgb(171, 205, 239)')
    await browser.evaluate('document.querySelector("button").click();disable()')
    const disabled = await browser.evaluate('measure()')
    assert.equal(disabled.mode, null)
    assert.equal(disabled.owned, 0)
    assert.equal(disabled.sameInput, true)
    assert.equal(await browser.evaluate('sent'), 1)
    await browser.evaluate('enable()')
    assert.equal((await browser.evaluate('measure()')).mode, 'compact')
    await browser.evaluate('disable()')
  } finally { await browser.close() }
})

test('storage events update only the standalone setting and disabling restores original geometry', async () => {
  const browser = await chromium()
  try {
    await setup(browser, 'wider')
    const baseline = await browser.evaluate('measure()')
    await browser.evaluate('enable()')
    near((await browser.evaluate('measure()')).dock, 1040.4)
    await browser.evaluate(`values.set('composer-width','wide');dispatchEvent(new StorageEvent('storage',{key:'hermes.plugin.codex-chat-look.composer-width'}))`)
    assert.equal((await browser.evaluate('measure()')).mode, 'wider')
    await browser.evaluate(`dispatchEvent(new StorageEvent('storage',{key:'hermes.plugin.hermes-dynamic-chat.composer-width'}))`)
    near((await browser.evaluate('measure()')).dock, 893.2)
    await browser.evaluate('disable()')
    near((await browser.evaluate('measure()')).dock, baseline.dock)
    await browser.evaluate(`values.set('composer-width','compact');dispatchEvent(new StorageEvent('storage',{key:null}))`)
    assert.equal((await browser.evaluate('measure()')).mode, null)
  } finally { await browser.close() }
})

test('failed persistence keeps rendered width and native draft unchanged', async () => {
  const browser = await chromium()
  try {
    await setup(browser)
    await browser.evaluate('enable();ctx.storage.set=()=>{}')
    assert.equal(await browser.evaluate('entries[0].data.run()'), false)
    const metrics = await browser.evaluate('measure()')
    near(metrics.dock, 746)
    assert.equal(metrics.mode, 'compact')
    assert.equal(metrics.draft, 'Draft stays here')
    assert.equal(await browser.evaluate('notices.length'), 1)
    await browser.evaluate('disable()')
  } finally { await browser.close() }
})

test('SDK-masked read failures block writes and preserve the last usable geometry', async () => {
  const browser = await chromium()
  try {
    await setup(browser, 'wider')
    await browser.evaluate(`enable();window.rawStorage=window.localStorage;Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:()=>{throw new Error('read unavailable')}}});ctx.storage.get=(key,fallback)=>fallback;dispatchEvent(new StorageEvent('storage',{key:'hermes.plugin.hermes-dynamic-chat.composer-width'}))`)
    assert.equal((await browser.evaluate('measure()')).mode, 'wider')
    assert.equal(await browser.evaluate('entries[0].data.run()'), false)
    assert.equal(await browser.evaluate('writes.length'), 0)
    assert.equal(await browser.evaluate('values.get("composer-width")'), 'wider')
    await browser.evaluate(`Object.defineProperty(window,'localStorage',{configurable:true,value:rawStorage});ctx.storage.get=(key,fallback)=>values.has(key)?values.get(key):fallback`)
    assert.equal(await browser.evaluate('entries[0].data.run()'), true)
    assert.equal((await browser.evaluate('measure()')).mode, 'hermes')
    await browser.evaluate('disable()')
  } finally { await browser.close() }
})

test('malformed persisted JSON blocks writes rather than erasing the saved preference', async () => {
  const browser = await chromium()
  try {
    await setup(browser, 'wider')
    await browser.evaluate(`Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:()=>'{broken'}});enable()`)
    assert.equal((await browser.evaluate('measure()')).mode, 'compact')
    assert.equal(await browser.evaluate('entries[0].data.run()'), false)
    assert.equal(await browser.evaluate('writes.length'), 0)
    assert.equal(await browser.evaluate('values.get("composer-width")'), 'wider')
    await browser.evaluate('disable()')
  } finally { await browser.close() }
})

test('full-width mode matches the unmodified dock in narrow panes at different root sizes', async () => {
  const browser = await chromium()
  try {
    await setup(browser, 'hermes')
    for (const fontSize of ['14px', '16px']) {
      await browser.evaluate(`document.documentElement.style.fontSize=${JSON.stringify(fontSize)};document.querySelector('#chat').style.width='320px'`)
      const native = await browser.evaluate('measure()')
      await browser.evaluate('enable()')
      near((await browser.evaluate('measure()')).dock, native.dock)
      await browser.evaluate('disable()')
    }
  } finally { await browser.close() }
})

test('failed writes followed by unavailable reads cannot falsely verify the compact preset', async () => {
  const browser = await chromium()
  try {
    await setup(browser, 'hermes')
    await browser.evaluate(`enable();ctx.storage.set=()=>{Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:()=>{throw new Error('read unavailable')}}});ctx.storage.get=(key,fallback)=>fallback}`)
    assert.equal(await browser.evaluate('entries[0].data.run()'), false)
    assert.equal((await browser.evaluate('measure()')).mode, 'hermes')
    assert.equal(await browser.evaluate('values.get("composer-width")'), 'hermes')
    await browser.evaluate('disable()')
  } finally { await browser.close() }
})

test('early disable and failed registration never leave styles or deferred activation', async () => {
  const browser = await chromium()
  try {
    await setup(browser)
    const result = await browser.evaluate(`(() => {
      const head=document.head;head.remove();enable();disable();document.documentElement.prepend(head);
      document.dispatchEvent(new Event('DOMContentLoaded'));
      const early=measure();
      const register=ctx.register;ctx.register=()=>{throw new Error('registration failed')};
      let failed=false;try { enable() } catch { failed=true }
      ctx.register=register;disable();
      return {early,failed,after:measure()};
    })()`)
    assert.equal(result.early.mode, null)
    assert.equal(result.early.owned, 0)
    assert.equal(result.failed, true)
    assert.equal(result.after.mode, null)
    assert.equal(result.after.owned, 0)
  } finally { await browser.close() }
})

test('duplicate registration cannot dispose the first plugin instance', async () => {
  const browser = await chromium()
  try {
    await setup(browser)
    await browser.evaluate(`window.registry=new Map();window.originalCleanups=[];ctx.onDispose=fn=>originalCleanups.push(fn);ctx.register=e=>{registry.set(e.id,e);return ()=>registry.delete(e.id)};enable()`)
    assert.equal(await browser.evaluate(`(() => {
      let failed=false;const secondCleanups=[];const secondRegistrations=[];
      try { plugin.register({...ctx,register:e=>{const remove=ctx.register(e);secondRegistrations.push(remove);return remove},onDispose:fn=>secondCleanups.push(fn)}) }
      catch { failed=true;secondRegistrations.reverse().forEach(fn=>fn()) }
      secondCleanups.reverse().forEach(fn=>fn());
      return failed;
    })()`), true)
    const metrics = await browser.evaluate('measure()')
    assert.equal(metrics.mode, 'compact')
    assert.equal(metrics.owned, 1)
    assert.equal(await browser.evaluate('registry.size'), 1)
    await browser.evaluate('originalCleanups.reverse().forEach(fn=>fn());disable()')
  } finally { await browser.close() }
})

for (const order of ['before', 'after']) {
  test('actual Codex stylesheet coexistence: ' + order, { skip: !process.env.CODEX_CHAT_COMPAT_CSS }, async () => {
    const css = await readFile(process.env.CODEX_CHAT_COMPAT_CSS, 'utf8')
    const browser = await chromium()
    try {
      await setup(browser, 'wider')
      await browser.evaluate(`document.documentElement.setAttribute('data-codex-chat-look','true');document.documentElement.setAttribute('data-codex-composer-width','codex-wide');window.legacyStyle=document.createElement('style');legacyStyle.textContent=${JSON.stringify(css)};`)
      if (order === 'before') await browser.evaluate('document.head.appendChild(legacyStyle)')
      await browser.evaluate('enable()')
      if (order === 'after') await browser.evaluate('document.head.appendChild(legacyStyle)')
      const metrics = await browser.evaluate('measure()')
      near(metrics.dock, 1040.4)
      near(metrics.thread, 1030.4)
      assert.equal(metrics.sameInput, true)
      await browser.evaluate('entries[0].data.run()')
      near((await browser.evaluate('measure()')).dock, 1182)
      await browser.evaluate('disable()')
      const after = await browser.evaluate('measure()')
      near(after.dock, 893.2)
      assert.equal(after.mode, null)
      assert.equal(after.owned, 0)
      assert.equal(await browser.evaluate('document.documentElement.getAttribute("data-codex-composer-width")'), 'codex-wide')
    } finally { await browser.close() }
  })
}
