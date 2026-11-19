// Reels Studio walkthrough: story (trend or data formats) -> style -> Make my
// reel -> review (beats, checks, voice and music) -> export; then a quick look
// at Game Swing (game, key plays, win probability) and Replay (clip -> three
// frames -> carousel).
const READY = "Boolean(window.ReelMakerPage && document.querySelector('#rm-pane-topic'))";
export default {
  title: 'Reels Studio',
  tagline: 'Turn a trend, a game or one clip into an on-brand reel, ready to post.',
  titleVoice: 'FrameUp Reels Studio. Turn a trend, a game, or one clip into an on-brand reel.',
  endVoice: 'Try it at frameup.essentiallysports.com.',
  endLine: 'Open Reels Studio from the FrameUp sidebar, under AI Studio.',
  page: '/reel-maker.html',
  ready: READY,
  local: {},
  posterAt: 30,
  async run(rec, page) {
    // Back to the Story step with the format tiles showing.
    const toStart = async () => {
      if (await page.evaluate(`Boolean(document.querySelector('#rm-steps [data-step="topic"], .rm-steps [data-step="topic"]'))`)) {
        await rec.click('[data-step="topic"]', { after: 800 });
      }
      const tiles = await page.evaluate(`(() => { const e = document.querySelector('#rm-fmt-entry [data-gformat="gameswing"]'); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0; })()`);
      if (!tiles) throw new Error('could not get back to the format tiles');
    };
    await rec.pause(600);
    await rec.say('Start with the story. Pick one of today’s trending stories.');
    await rec.click('#rm-trends [data-trend="t1"]', { after: 900 });

    await rec.say('Or start from data. All formats shows every kind of reel.');
    await rec.click('#rm-fmt-entry [data-gall]', { after: 1800 });
    await rec.click('#rm-fmt-entry [data-gall]', { after: 600 });

    await rec.say('Pick a style, or leave it on Auto.');
    await rec.reveal('#rm-pane-topic [data-style="classic"]');
    await rec.click('#rm-pane-topic [data-style="classic"]', { after: 700 });

    await rec.say('Then press Make my reel.');
    await rec.click('#rm-write');
    await rec.waitFor(`!document.querySelector('#rm-pane-edit').hidden`, 40000);
    await rec.pause(1200);

    await rec.say('Review it beat by beat. Change any words, photo or clip.');
    await rec.click('#rm-play', { after: 300 });
    await rec.hover('#rm-pane-edit input[data-field="text"]', { dx: 0.6 });
    await rec.pause(1500);

    await rec.say('The status line runs the quality checks before you post.');
    await rec.click('#rm-statusline', { after: 1800 });
    await rec.click('#rm-statusline', { after: 400 });

    await rec.say('Voice, captions and music are here too.');
    await rec.click('#rm-voice > summary', { after: 1500 });
    await rec.click('#rm-voice > summary', { after: 300 });
    await rec.click('#rm-music > summary', { after: 1300 });
    await rec.click('#rm-music > summary', { after: 300 });

    await rec.say('Next, Export. Choose an organic post or a paid ad, then Export MP4.');
    await rec.click('#rm-next', { after: 900 });
    await rec.hover('#rm-target [data-target="paid"]');
    await rec.pause(400);
    await rec.click('#rm-export');
    await rec.say('It renders right in your browser, in real time.');
    await rec.waitFor(`!document.querySelector('#rm-files').hidden || /fail|cancel/i.test(document.querySelector('#rm-export-status')?.textContent || '')`, 120000);
    await rec.pause(600);
    await rec.hover('#rm-files');
    await rec.pause(600);

    await rec.say('Game Swing turns a finished game into a reel.');
    await toStart();
    await rec.click('#rm-fmt-entry [data-gformat="gameswing"]');
    await rec.waitFor(`document.querySelector('#rm-games [data-game="401873063"]')`, 15000);
    await rec.pause(500);
    await rec.click('#rm-games [data-game="401873063"]');
    await rec.waitFor(`!document.querySelector('#rm-pane-topic').hidden && document.querySelector('#rm-data-story [data-keyplay]')`, 15000);
    await rec.pause(600);

    await rec.say('The key plays are picked for you, with ESPN win probability.');
    await rec.hover('#rm-data-story [data-keyplay]', { dx: 6, dy: 0.5 });
    await rec.pause(900);
    await rec.click('#rm-write');
    await rec.waitFor(`!document.querySelector('#rm-pane-edit').hidden && !document.querySelector('#rm-data-review').hidden`, 40000);
    await rec.pause(900);
    await rec.click('#rm-play', { after: 2600 });

    await rec.say('Replay takes one clip and finds the setup, the play and the reaction.');
    await toStart();
    await rec.click('#rm-fmt-entry [data-gformat="replay"]');
    await rec.waitFor(`document.querySelector('#rm-c-xform')`, 10000);
    await rec.click('#rm-c-link', { dx: 0.3 });
    await rec.type('https://x.com/NFL/status/1855000000000000001', { cps: 45 });
    await rec.click(await rec.byText('#rm-c-xform', '^Find the clip$', 'button'));
    await rec.waitFor(`document.querySelector('#rm-c-pick [data-cuse]')`, 20000);
    await rec.pause(500);
    await rec.click('#rm-c-pick [data-cuse]');
    await rec.waitFor(`!document.querySelector('#rm-pane-topic').hidden && !document.querySelector('#rm-data-story').hidden`, 10000);
    await rec.pause(400);
    await rec.click('#rm-write');
    await rec.waitFor(`!document.querySelector('#rm-pane-edit').hidden && document.querySelector('#rm-data-review [data-frame]')`, 60000);
    await rec.pause(800);

    await rec.say('Three frames, and it makes a carousel too.');
    await rec.hover('#rm-data-review [data-frame="play"]');
    await rec.pause(700);
    await rec.click('#rm-view [data-view="carousel"]', { after: 1100 });
    await rec.click('#rm-slide-next', { after: 900 });
    await rec.click('#rm-slide-next', { after: 900 });
  },
};
