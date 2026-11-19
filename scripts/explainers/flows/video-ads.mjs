// Video Ads walkthrough: brand -> copy (Ask AI, styles, daily set) -> clip (by
// team, angles, by moment, library, any link) -> preview (Meta, safe zone,
// sizes) -> export (sizes, sound, MP4).
export default {
  title: 'Video Ads',
  tagline: 'Make newsletter sign-up ads from game clips, in every Meta size.',
  titleVoice: "This is Video Ads in FrameUp. It turns game clips into newsletter sign-up ads, in every size.",
  endVoice: 'Give it a try at frameup.essentiallysports.com.',
  endLine: 'Open Video Ads from the FrameUp sidebar, under AI Studio.',
  page: '/video-ads.html',
  ready: "Boolean(document.querySelector('#va-styles [role=radio]'))",
  local: {},
  posterAt: 40,
  async prepare(page) {
    await page.evaluate(`(() => { const p = document.getElementById('va-panel-scroll'); p && (p.style.scrollBehavior = 'smooth'); return 1; })()`);
  },
  async run(rec, page) {
    const panel = (top) => page.evaluate(`(() => { const p = document.getElementById('va-panel-scroll'); p.scrollTo({ top: ${top}, behavior: 'smooth' }); return 1; })()`);
    await rec.pause(600);
    await rec.chapter('Write the ad');
    await rec.say('First, pick the newsletter this ad is for.');
    await rec.click('#va-brands [data-brand="es-dugout"]', { after: 700 });
    await rec.click('#va-brands [data-brand="essentially-cfb"]', { after: 500 });

    await rec.say('Write the words yourself, or let AI suggest a few.');
    await rec.reveal('#va-ask-ai');
    await rec.click('#va-ask-ai', { after: 600 });
    await rec.click('#va-ai [data-ai="write"]');
    await rec.waitFor(`document.querySelectorAll('#va-variants button, #va-variants [data-variant]').length > 0`, 15000);
    await rec.pause(700);
    await rec.click('#va-variants button, #va-variants [data-variant]', { after: 900 });
    await rec.click('#va-ai-close', { after: 400 });

    await rec.say('Then pick a style. Highlight puts the key words in a box.');
    await rec.reveal('#va-styles [data-style="condensed"]');
    await rec.click('#va-styles [data-style="condensed"]', { after: 700 });
    await rec.click('#va-styles [data-style="highlight"]', { after: 600 });
    await rec.hover('#va-styles [data-style="today3"]');
    await rec.hover('#va-styles [data-style="versus"]');

    await rec.say("Short on time? Make my daily set writes today's three ads in one go.");
    await panel(0);
    await rec.pause(700);
    await rec.hover('#va-set-make');
    await rec.pause(800);

    await rec.chapter('Pick a clip');
    await rec.say('Next, the clip. Pick one team, or a few.');
    await rec.click('#va-next', { after: 900 });
    for (const t of ['Ohio State Buckeyes', 'Michigan Wolverines', 'Georgia Bulldogs']) await rec.click(`#va-team-list [data-team="${t}"]`, { after: 250 });

    await rec.say('Find clips shows the most-watched recent plays, only from team and league accounts.');
    await rec.click('#va-team-find');
    await rec.waitFor(`document.querySelectorAll('#va-found [data-mo-use]').length > 0`, 15000);
    await rec.pause(400);
    await rec.reveal('#va-found [data-mo-angles]');
    await rec.hover('#va-found [data-mo-use]', { dx: 1.5, dy: -3 });
    await rec.click('#va-found [data-mo-angles]', { after: 1200 });

    await rec.say("By moment shows what's trending right now, with every camera angle.");
    await rec.click('#va-tab-moment');
    await rec.waitFor(`document.querySelectorAll('#va-trends [data-mo-use]').length > 0`, 15000);
    await rec.pause(1200);

    await rec.say("The library keeps every clip you've found.");
    await rec.click('#va-tab-library');
    await rec.pause(1600);

    await rec.say('Or paste any video link. For YouTube, it shows you how to save the file and drop it in.');
    await rec.click('#va-tab-link', { after: 400 });
    await rec.click('#va-xurl', { dx: 0.3 });
    await rec.type('https://www.youtube.com/watch?v=Bq3hR7m2xKs', { cps: 40 });
    await rec.click('#va-xget', { after: 1500 });

    await rec.say('Found the one? Use clip drops it straight into your ad.');
    await rec.click('#va-tab-team', { after: 700 });
    await rec.click('#va-found [data-mo-use]:not([disabled])');
    await rec.waitFor(`document.getElementById('va-busy').hidden && document.getElementById('va-video').videoWidth > 0`, 20000);
    await rec.pause(900);

    await rec.chapter('Preview');
    await rec.say("Meta preview shows how it'll look in the feed.");
    await rec.click('#va-meta-toggle', { after: 1300 });
    await rec.say('And the safe zone keeps your words clear of the buttons.');
    await rec.click('#va-safe-toggle', { after: 1600 });
    await rec.click('#va-safe-toggle', { after: 300 });
    await rec.click('#va-meta-toggle', { after: 300 });

    await rec.say('Switch sizes any time: 9:16, 4:5, or 1:1.');
    await rec.click('#va-sizes [data-size="4x5"]', { after: 1000 });
    await rec.click('#va-sizes [data-size="1x1"]', { after: 1000 });
    await rec.click('#va-sizes [data-size="9x16"]', { after: 600 });

    await rec.chapter('Export');
    await rec.say('On to Export. Pick the sizes you need.');
    await rec.click('.va-step[data-step="export"]', { after: 800 });
    await rec.click('#va-exsizes [data-ex="4x5"]', { after: 500 });

    await rec.say("Sound's muted by default. Add music from the library, or upload your own.");
    await rec.click('#va-sound-mode [data-sound="library"]', { after: 1200 });
    await rec.hover('#va-sound-mode [data-sound="upload"]');
    await rec.pause(500);
    await rec.click('#va-sound-mode [data-sound="muted"]', { after: 400 });

    await rec.say('Hit Export, and your MP4s are ready for Ads Manager.');
    await rec.click('#va-export');
    await rec.say('Each size records in real time, so give it a few seconds.');
    await rec.waitFor(`!document.getElementById('va-files').hidden`, 90000);
    await rec.pause(400);
    await rec.say('Done. The ad names for Meta are ready to copy.');
    await rec.reveal('#va-files');
    await rec.hover('#va-files');
    await rec.pause(800);
  },
};
