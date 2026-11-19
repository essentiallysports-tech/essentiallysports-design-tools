// Generate walkthrough: brief -> look, tone, count (with cost) -> Generate ->
// four designs -> focus view: Director note + Apply, Assistant edit, undo,
// 4:5 -> 9:16, PNG -> free mode note.
export default {
  title: 'Generate',
  tagline: 'Turn a sports story into on-brand, ready-to-post designs in seconds.',
  titleVoice: "This is Generate in FrameUp. It turns a sports story into on-brand designs, in seconds.",
  endVoice: 'Give it a try at frameup.essentiallysports.com.',
  endLine: 'Open Generate from the FrameUp sidebar, under AI Studio.',
  page: '/generate.html',
  ready: "Boolean(window.FrameUpGenerate && window.FrameUpCreative && document.querySelector('#gen-look')) && document.getElementById('gen-live')?.getAttribute('aria-busy') !== 'true'",
  local: { 'frameup.generate.look.v1': 'templates', 'frameup.generate.count.v1': null },
  serverOpts: { genDelay: 5200 },
  posterAt: null,
  async run(rec, page) {
    await rec.pause(700);
    await rec.chapter('Write the brief');
    await rec.say('Start with a brief: who, what happened, and a number or a quote.');
    await rec.click('#gen-brief', { dx: 0.3, dy: 0.4 });
    await rec.type('Josh Allen goes over 1,000 rushing yards as the Bills beat the Chiefs 30-21.');
    await rec.pause(400);

    await rec.say('No story yet? Click a trending one and it fills the brief for you.');
    await rec.hover(await rec.byText('#gen-live, .gen-live, main', '^NFL\\s*Josh Allen leads', 'button'), { dx: 0.4 });
    await rec.pause(900);

    await rec.say('Pick a look. Creative gives you art-directed designs.');
    await rec.click('[data-look="creative"]');

    await rec.say('Choose a tone, like Hype.');
    await rec.click('#gen-tone [data-value="hype"]');

    await rec.say("Then pick how many designs you want. You'll see the cost before you start.");
    await rec.click('[data-count="6"]', { after: 500 });
    await rec.click('[data-count="4"]', { after: 300 });
    await rec.hover('#gen-count-cost', { dx: 0.45 });
    await rec.pause(500);

    await rec.chapter('Generate');
    await rec.say('Hit Generate. FrameUp reads the story, finds photos, and lays out each design.');
    await rec.click('#gen-submit');
    await rec.waitFor(`document.querySelectorAll('#gen-grid .gen-cc:not(.is-skeleton)').length >= 4 && !window.FrameUpGenerate.isBusy()`, 60000);
    await rec.pause(500);

    await rec.say('Four designs, each with its own layout. Every one passes the ES brand check.');
    await page.evaluate(`window.scrollTo({ top: document.getElementById('gen-summary').getBoundingClientRect().top + scrollY - 24, behavior: 'smooth' })`);
    await rec.pause(900);
    await rec.hover('#gen-grid .gen-cc:nth-child(2) .gen-cc__media', { dx: 0.5, dy: 0.5 });
    await rec.hover('#gen-grid .gen-cc:nth-child(3) .gen-cc__media', { dx: 0.5, dy: 0.5 });
    await rec.pause(400);

    await rec.chapter('Edit and export');
    await rec.say('Click a design to open it.');
    await rec.click('#gen-grid .gen-cc:nth-child(1) .gen-cc__media', { after: 900 });

    // gen4: small fixes are made while designing; the Director tab lists them
    // and offers creative ideas (only when the run has one to try).
    await rec.say('The Director tab shows the score, what it fixed while designing, and ideas to try.');
    await rec.click('#gfx-tab-director', { after: 900 });
    const has = sel => page.evaluate(`Boolean([...document.querySelectorAll('${sel}')].find(x => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0; }))`);
    if (await has('.gfx .gfx-fixed')) await rec.hover('.gfx .gfx-fixed', { dx: 0.3, dy: 0.5 });
    await rec.pause(700);
    if (await has('.gfx [data-fx="apply"]')) {
      await rec.hover('.gfx [data-fx="apply"]', { dx: -1.6, dy: -1 });
      await rec.pause(500);
      await rec.say('Like an idea? One click tries it.');
      await rec.click('.gfx [data-fx="apply"]', { after: 1200 });
    } else {
      if (await has('.gfx .gfx-better')) await rec.hover('.gfx .gfx-better', { dx: 0.3, dy: 0.5 });
      await rec.pause(600);
    }

    await rec.say('Or ask the Assistant in plain words.');
    await rec.click('#gfx-tab-assistant', { after: 500 });
    await rec.click('.gfx textarea', { dx: 0.3 });
    await rec.type('make the number bigger');
    await rec.pause(300);
    await rec.click(await rec.byText('.gfx', '^Send$', 'button'), { after: 1400 });

    await rec.say('Not sure? Undo takes it back.');
    await rec.click('.gfx [data-fx="undo"]', { after: 900 });

    await rec.say('Need it for Stories? Switch the size from 4:5 to 9:16.');
    await rec.click('.gfx [data-size="story"]', { after: 1300 });

    await rec.say('When it looks right, download a PNG, ready to post.');
    await rec.click('.gfx [data-fx="png"]', { after: 1200 });

    await rec.say("Over your weekly AI budget? Generate still works, using ES templates.");
    await rec.click('.gfx [data-fx="close"]', { after: 500 });
    await page.evaluate(`window.scrollTo({ top: 0, behavior: 'smooth' })`);
    await rec.pause(700);
    await rec.hover('[data-look="templates"]');
    await rec.pause(500);
    await rec.hover(await rec.byText('.site-shell, body', '^AI usage', 'div,a,section,aside'), { dx: 0.5, dy: 0.5 });
    await rec.pause(400);
  },
};
