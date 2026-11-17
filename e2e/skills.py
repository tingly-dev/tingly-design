"""End-to-end checks for choosing the skills a chat reads (.design/chat-skills.md), with a stand-in `claude`
(e2e/fake-claude) that records how it is called. The server lists the skills in the project, the product and the
machine; a project's own skill is found and named in the request's system prompt with its path; the choice is kept
in the project folder and is what a request without one reads; an explicit empty list means none; the request bar's
picker searches, groups and saves at once; a run's card and the conversation record say what it read; every kind's
bar has the picker.
Run with `pnpm dev` started with e2e/fake-claude first on PATH: python3 e2e/skills.py (or pnpm e2e skills)"""
import os, json, time, asyncio, subprocess, urllib.request
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, 'e2e', 'out') + '/'
CHROME = os.environ.get('DC_CHROME')
LOG = os.environ.get('FAKE_CLAUDE_LOG', '/tmp/fake-claude.log')

CANVAS = 'tingly-box-console-canvas'
DOCS = 'tingly-design-guide-doc'
SKILL = 'brand-voice'
SKILL_MD = f'''---
name: Brand voice
description: Write in this product's voice: short sentences, no exclamation marks.
---

# Brand voice

Say what happened, plainly.
'''

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

def api(path, body=None, method=None):
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), method=method, headers={'content-type': 'application/json'})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def calls(): return [json.loads(l) for l in open(LOG)] if os.path.exists(LOG) else []

def appended(entry):
    """The --append-system-prompt value of a recorded call."""
    args = entry.get('args') or []
    return args[args.index('--append-system-prompt') + 1] if '--append-system-prompt' in args else ''

def run(prompt, **extra):
    """Hand a request over through the server and wait for the stand-in to finish it; return its recorded calls."""
    before = len(calls())
    api(f'/api/projects/{CANVAS}/delegate', {'prompt': prompt, **extra})
    t = time.time()
    while time.time() - t < 20:
        new = calls()[before:]
        if new and new[-1]['ev'] == 'end' and new[-1]['code'] == 0: break
        time.sleep(0.2)
    time.sleep(0.3)
    return [c for c in calls()[before:] if c['ev'] == 'start']

async def wait_for(fn, timeout=15):
    t = time.time()
    while time.time() - t < timeout:
        v = fn()
        if v: return v
        await asyncio.sleep(0.2)
    return fn()

def restore():
    """The samples are edited in place; put them back and drop the local state this suite made (a project skill,
    the stored choice). The change log and the transcript are the machine's own and are left as they were."""
    for p in (CANVAS, DOCS):
        try: api(f'/api/projects/{p}/conversation', method='DELETE')
        except Exception: pass
        try: api(f'/api/projects/{p}/skills', {'skills': []}, method='PUT')
        except Exception: pass
        subprocess.run(['git', 'checkout', '--', f'projects/{p}'], cwd=REPO)
        subprocess.run(['git', 'clean', '-fdq', '--', f'projects/{p}'], cwd=REPO)

def stored(p):
    try: return json.load(open(os.path.join(REPO, 'projects', p, '.claude-skills.json')))
    except FileNotFoundError: return None

async def main():
    os.makedirs(OUT, exist_ok=True)
    os.path.exists(LOG) and os.remove(LOG)
    restore()
    # a skill that lives with the project, which Claude Code would not find by itself (it runs from the repository root)
    folder = os.path.join(REPO, 'projects', CANVAS, '.claude', 'skills', SKILL)
    os.makedirs(folder, exist_ok=True)
    open(os.path.join(folder, 'SKILL.md'), 'w').write(SKILL_MD)
    try:
        # what this machine offers: the project's own skill and the product's, with their frontmatter read
        got = api(f'/api/projects/{CANVAS}/skills')
        by_id = {s['id']: s for s in got['skills']}
        check('the listing has the built-in format references', all(k in by_id and by_id[k]['scope'] == 'builtin' for k in ('dc-canvas', 'slides', 'docs')), sorted(by_id))
        check('a project skill is found with its name and description', by_id.get(SKILL, {}).get('scope') == 'project' and by_id[SKILL]['name'] == 'Brand voice' and by_id[SKILL]['description'].startswith('Write in this product'), by_id.get(SKILL))
        check('and the path is the project\'s SKILL.md', by_id.get(SKILL, {}).get('path', '').endswith(f'projects/{CANVAS}/.claude/skills/{SKILL}/SKILL.md'), by_id.get(SKILL, {}).get('path'))
        check('nothing is chosen yet', got['chosen'] == [], got['chosen'])

        # the choice: unknown names dropped, a repeat kept once, and it lands in the project folder
        kept = api(f'/api/projects/{CANVAS}/skills', {'skills': [SKILL, 'no-such-skill', SKILL]}, method='PUT')['chosen']
        check('saving keeps what exists, once', kept == [SKILL], kept)
        saved = stored(CANVAS)
        check('the choice is stored in the project folder', saved == {'skills': [SKILL]}, saved)

        # a request without a choice reads the stored one, and Claude Code is told its SKILL.md path
        s = run('make the headline shorter')
        note = appended(s[0]) if s else ''
        check('a request with no skills of its own reads the stored choice', 'Brand voice' in note and 'Read each one\'s SKILL.md' in note, note[-500:])
        check('the project skill is named with its full path', f'projects/{CANVAS}/.claude/skills/{SKILL}/SKILL.md' in note, note[-300:])
        check('the kind\'s own format reference is still the one in the system prompt', '.claude/skills/dc-canvas/SKILL.md' in (s[0]['args'][s[0]['args'].index('--append-system-prompt') + 1] if s else ''))

        # an explicit empty list is "none this time", not "use the stored one"
        s = run('nothing this time', skills=[])
        check('an explicit empty list reads no chosen skill', s and 'The person chose these skills' not in appended(s[0]), appended(s[0])[-300:] if s else s)

        # the bar: the picker, its search, the format reference that cannot be turned off
        async with async_playwright() as p:
            b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
            pg = await b.new_page(locale='zh-CN', viewport={'width': 1440, 'height': 900})
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(BASE + f'/?p={CANVAS}')
            chip = pg.locator('.prompt .skillchip')
            await chip.wait_for(timeout=15000)
            await pg.wait_for_timeout(600)
            expect(chip).to_contain_text('技能 · 1')
            check('the bar says how many skills the chat reads', '技能 · 1' in await chip.inner_text(), await chip.inner_text())

            await chip.click()
            dlg = pg.locator('.skillsdlg')
            await dlg.wait_for()
            check('the picker names the project skill and its description', await dlg.locator('.rname', has_text='Brand voice').count() == 1 and await dlg.locator('.rpath', has_text='Write in this product').count() == 1)
            row = dlg.locator('.skillrow', has_text='Brand voice')
            always = dlg.locator('.skillrow', has_text='dc-canvas')
            check('the chosen skill is ticked', await row.locator('input[type=checkbox]').is_checked())
            check('the kind\'s format reference is ticked and cannot be turned off', await always.locator('input[type=checkbox]').is_checked() and await always.locator('input[type=checkbox]').is_disabled())
            check('and says it is always read', '每次必读' in await always.inner_text(), await always.inner_text())
            await pg.screenshot(path=OUT + 'skills-picker-zh.png')

            await dlg.locator('.skills-search').fill('brand')
            await pg.wait_for_timeout(200)
            check('search keeps only the matching skill', await dlg.locator('.skillrow').count() == 1 and await dlg.locator('.rname', has_text='Brand voice').count() == 1, await dlg.locator('.skillrow').count())
            await dlg.locator('.skills-search').fill('zzzz')
            await pg.wait_for_timeout(200)
            check('a search that matches nothing says so', await dlg.locator('.refnote', has_text='没有与').count() == 1)
            await dlg.locator('.skills-search').fill('')
            await pg.wait_for_timeout(200)

            # unticking saves at once
            await dlg.locator('.skillrow', has_text='Brand voice').locator('input[type=checkbox]').click()
            check('unticking saves to the project at once', await wait_for(lambda: stored(CANVAS) == {'skills': []}, 5))
            await dlg.get_by_role('button', name='完成').click()
            await expect(dlg).to_have_count(0)
            text = (await chip.inner_text()).strip()
            check('the bar goes back to plain Skills when none is chosen', '技能' in text and '·' not in text, text)

            # ticking it again, then a request through the bar
            await chip.click()
            await pg.locator('.skillrow', has_text='Brand voice').locator('input[type=checkbox]').click()
            await wait_for(lambda: stored(CANVAS) == {'skills': [SKILL]}, 5)
            await pg.locator('.skillsdlg').get_by_role('button', name='完成').click()
            expect(chip).to_contain_text('技能 · 1')

            # English, light: the two pictures a PR shows
            if not os.environ.get('DC_E2E_NO_SHOTS'):
                en = await b.new_page(locale='en-US', viewport={'width': 1440, 'height': 900})
                await en.goto(BASE + f'/?p={CANVAS}')
                await en.locator('.prompt .skillchip').wait_for(timeout=15000)
                await en.wait_for_timeout(600)
                await en.locator('.prompt .skillchip').click()
                await en.locator('.skillsdlg').wait_for()
                await en.screenshot(path=OUT + 'skills-picker-en.png')
                await en.locator('.skillsdlg').get_by_role('button', name='Done').click()

            await pg.locator('.prompt .seg button', has_text='Claude Code').click()
            await pg.locator('.prompt textarea').fill('Tighten the opening paragraph')
            before = len(calls())
            await pg.locator('.prompt .send').click()
            await wait_for(lambda: len([c for c in calls() if c['ev'] == 'start']) > before)
            s = [c for c in calls()[before:] if c['ev'] == 'start']
            check('a request sent from the bar carries the chosen skill', bool(s) and 'Brand voice' in appended(s[0]), appended(s[0])[-300:] if s else s)

            runfeed = pg.locator('.runfeed').last
            await runfeed.wait_for(timeout=15000)
            await runfeed.locator('.run-skills').wait_for(timeout=15000)
            check('the run\'s card says what it read', 'Brand voice' in await runfeed.locator('.run-skills').inner_text(), await runfeed.locator('.run-skills').inner_text())
            await pg.wait_for_timeout(400)
            if not os.environ.get('DC_E2E_NO_SHOTS'):
                await runfeed.screenshot(path=OUT + 'skills-run-en.png')

            # the conversation record keeps it too
            turns = api(f'/api/projects/{CANVAS}/transcript')
            last = [t for t in turns if t.get('agent') == 'claude'][-1] if turns else {}
            check('the conversation record says the turn read it', last.get('skills') == [SKILL], last.get('skills'))

            # a doc's bar has the picker, and a built-in skill chosen there reaches the request
            await pg.goto(BASE + f'/?p={DOCS}')
            dchip = pg.locator('.dsask .skillchip')
            await dchip.wait_for(timeout=15000)
            await pg.wait_for_timeout(600)
            await dchip.click()
            await pg.locator('.skillsdlg').wait_for()
            check('a doc\'s bar offers the same picker', await pg.locator('.skillsdlg .skillrow', has_text='dc-canvas').count() == 1)
            await pg.locator('.skillsdlg .skillrow', has_text='dc-canvas').locator('input[type=checkbox]').click()
            check('the doc\'s choice is the doc project\'s own', await wait_for(lambda: stored(DOCS) == {'skills': ['dc-canvas']}, 5))
            await pg.locator('.skillsdlg').get_by_role('button', name='完成').click()
            expect(dchip).to_contain_text('技能 · 1')
            await pg.locator('.dsask textarea').fill('Add a note about the skills picker')
            before = len(calls())
            await pg.locator('.dsask button.send').click()
            await wait_for(lambda: len([c for c in calls() if c['ev'] == 'start']) > before)
            s = [c for c in calls()[before:] if c['ev'] == 'start']
            check('a doc request is given the chosen built-in skill by path', bool(s) and '.claude/skills/dc-canvas/SKILL.md' in appended(s[0]), appended(s[0])[-300:] if s else s)
            await pg.locator('.runfeed .run-skills').last.wait_for(timeout=15000)
            check('and its run card says so', 'dc-canvas' in await pg.locator('.runfeed .run-skills').last.inner_text())

            # every kind's bar has the picker: slides and motion use the same bar as canvas, a design system and a dashboard the same as docs
            for project, sel in (('tingly-design-intro-slides', '.prompt'), ('tingly-design-system', '.dsask'), ('tingly-box-usage-dashboard', '.dsask'), ('tingly-design-motion', '.prompt')):
                await pg.goto(BASE + f'/?p={project}')
                c = pg.locator(sel + ' .skillchip')
                ok = True
                try:
                    await c.wait_for(timeout=15000)
                except Exception:
                    ok = False
                check(f'every kind\'s bar has the picker ({project})', ok and await c.is_visible())
                if ok:
                    await c.click()
                    ok = await pg.locator('.skillsdlg').is_visible()
                    await pg.keyboard.press('Escape')
                    check(f'and it opens there ({project})', ok)
            check('no page errors', not errs, errs[:3])
            await b.close()
    finally:
        restore()

failed = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(failed)}/{len(results)} passed')
raise SystemExit(1 if failed else 0)