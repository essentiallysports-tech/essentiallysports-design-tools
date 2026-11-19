// Generate walkthrough: brief -> look, tone, count (with cost) -> Generate ->
// four designs -> focus view: Director note + Apply, Assistant edit, undo,
// 4:5 -> 9:16, PNG -> free mode note.
export default {
  title: 'Generate',
  tagline: 'Turn a sports story into on-brand, ready-to-post designs in seconds.',
  titleVoice: 'FrameUp Generate. Turn a sports story into on-brand designs in seconds.',
  endVoice: 'Try it at frameup.essentiallysports.com.',
  endLine: 'Open Generate from the FrameUp sidebar, under AI Studio.',
  page: '/generate.html',
  ready: "Boolean(window.FrameUpGenerate && window.FrameUpCreative && document.querySelector('#gen-look')) && document.getElementById('gen-live')?.getAttribute('aria-busy') !== 'true'",
  local: { 'frameup.generate.look.v1': 'templates', 'frameup.generate.count.v1': null },
  serverOpts: { genDelay: 5200 },
  posterAt: null,
  async run(rec, page) {
    await rec.pause(700);
    await rec.say('Start with a brief: who, what happened, and a number or a quote.');
    await rec.click('#gen-brief', { dx: 0.3, dy: 0.4 });
    await rec.type('Josh Allen goes over 1,000 rushing yards as the Bills beat the Chiefs 30-21.');
    await rec.pause(400);

    await rec.say('No story yet? Click a trending one and it fills the brief for you.');
    await rec.hover(await rec.byText('#gen-live, .gen-live, main', '^NFL\\s*Josh Allen leads', 'button'), { dx: 0.4 });
    await rec.pause(900);

    await rec.say('Pick the look. Creative gives you art-directed designs.');
    await rec.click('[data-look="creative"]');

    await rec.say('Choose a tone, like Hype.');
    await rec.click('#gen-tone [data-value="hype"]');

    await rec.say('Then pick how many designs you want. The cost shows before you start.');
    await rec.click('[data-count="6"]', { after: 500 });
    await rec.click('[data-count="4"]', { after: 300 });
    await rec.hover('#gen-count-cost', { dx: 0.45 });
    await rec.pause(500);

    await rec.say('Press Generate. FrameUp reads the story, finds photos, and lays out each design.');
    await rec.click('#gen-submit');
    await rec.waitFor(`document.querySelectorAll('#gen-grid .gen-cc:not(.is-skeleton)').length >= 4 && !window.FrameUpGenerate.isBusy()`, 60000);
    await rec.pause(500);

    await rec.say('Four designs, each with its own layout. Every one passes the ES brand check.');
    await page.evaluate(`window.scrollTo({ top: document.getElementById('gen-summary').getBoundingClientRect().top + scrollY - 24, behavior: 'smooth' })`);
    await rec.pause(900);
    await rec.hover('#gen-grid .gen-cc:nth-child(2) .gen-cc__media', { dx: 0.5, dy: 0.5 });
    await rec.hover('#gen-grid .gen-cc:nth-child(3) .gen-cc__media', { dx: 0.5, dy: 0.5 });
    await rec.pause(400);

    await rec.say('Click a design to open it.');
    await rec.click('#gen-grid .gen-cc:nth-child(1) .gen-cc__media', { after: 900 });

    await rec.say('The Director tab says what works, and what could be better.');
    await rec.click('#gfx-tab-director', { after: 900 });
    await rec.hover('.gfx [data-fx="apply"]', { dx: -1.6, dy: -1 });
    await rec.pause(600);

    await rec.say('Click Apply, and the fix is made for you.');
    await rec.click('.gfx [data-fx="apply"]', { after: 1200 });

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

    await rec.say('Over your weekly AI budget? Generate still works, using ES templates.');
    await rec.click('.gfx [data-fx="close"]', { after: 500 });
    await page.evaluate(`window.scrollTo({ top: 0, behavior: 'smooth' })`);
    await rec.pause(700);
    await rec.hover('[data-look="templates"]');
    await rec.pause(500);
    await rec.hover(await rec.byText('.site-shell, body', '^AI usage', 'div,a,section,aside'), { dx: 0.5, dy: 0.5 });
    await rec.pause(400);
  },
};
