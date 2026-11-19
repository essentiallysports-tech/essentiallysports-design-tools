// Trends walkthrough (generate.html?view=trends): the Post now board and its
// signals -> AI angles (why fans care, headline ideas) -> sport and newsletter
// filters -> the post kit -> Design post hands the story to Generate as a
// ready brief, and Generate starts designing.
const first = '#trends-body .trends-picks .trend-row[data-id]:first-of-type';
export default {
  title: 'Trends',
  tagline: 'See what sports fans care about right now, and turn it into a post in one click.',
  titleVoice: "This is Trends in FrameUp. It shows what sports fans care about, right now.",
  endVoice: 'Give it a try at frameup.essentiallysports.com.',
  endLine: 'Open Trends from the FrameUp sidebar, under AI Studio.',
  page: '/generate.html?view=trends',
  ready: "Boolean(document.querySelector('#trends-body .trend-row[data-id]'))",
  local: { 'frameup.generate.look.v1': 'creative' },
  posterAt: 14,
  async run(rec, page) {
    await rec.pause(700);
    await rec.say("Trends pulls from Google Trends and Google News, and it refreshes every few minutes.");
    await rec.hover('#trends-live', { dx: 0.5, pad: 40 });
    await rec.pause(900);

    await rec.say("Post now puts the best stories first. They're ranked by freshness, momentum and ES fit.");
    await rec.hover('#tg-picks', { dx: 0.3, pad: 32 });
    await rec.pause(700);
    await rec.hover(`${first} .trend-title`, { dx: 0.15 });
    await rec.pause(400);

    await rec.say('Hot means lots of searches, or lots of outlets, on that story right now.');
    await rec.hover(`${first} .td-signal`, { pad: 60 });
    await rec.pause(1300);

    await rec.chapter('Why it matters');
    await rec.say("Want to know why a story matters? Click AI angles.");
    await rec.click('#trends-ai', { after: 300 });
    await rec.waitFor(`document.querySelector('${first} .trend-why')`, 15000);
    await rec.pause(300);
    await rec.say('Each story gets a line on why fans care, plus three headline ideas.');
    await rec.hover(`${first} .trend-why`, { dx: 0.1, pad: 28 });
    await rec.pause(900);
    await rec.hover(`${first} .trend-ideas__list`, { dx: 0.2, pad: 28 });
    await rec.pause(1200);

    await rec.chapter('Filter the board');
    await rec.say('Filter by sport with one click.');
    await rec.click('#trends-filters [data-sport="nfl"]', { after: 1100 });
    await rec.click('#trends-filters [data-sport="golf"]', { after: 1100 });
    await rec.say('Or pick a newsletter, and the board shows what fits it.');
    await rec.click('#trends-filters [data-sport="all"]', { after: 500 });
    await rec.click('#trends-brand', { after: 300 });
    await page.evaluate(`(() => { const s = document.getElementById('trends-brand'); const o = [...s.options].find(o => /CFB/i.test(o.text)) || s.options[1]; s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
    await rec.pause(1600);
    await page.evaluate(`(() => { const s = document.getElementById('trends-brand'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
    await rec.pause(700);

    await rec.chapter('Make the post');
    await rec.say("Open the post kit for headlines, a template, a photo search and a reel hook.");
    await rec.click(`${first} [data-kit]`, { after: 600 });
    await rec.waitFor(`document.querySelector('${first} .td-kit:not([hidden]) .td-kit__grid')`, 10000);
    await rec.reveal(`${first} .td-kit`, 'center');
    await rec.hover(`${first} .td-kit__sec--heads`, { dx: 0.3, pad: 20 });
    await rec.pause(1000);
    await rec.hover(`${first} .td-kit__sec:nth-child(4)`, { dx: 0.3, pad: 20 });
    await rec.pause(800);

    await rec.say("Like one? Design post hands it to Generate as a ready brief.");
    await page.evaluate(`window.scrollTo({ top: 0, behavior: 'smooth' })`);
    await rec.pause(800);
    await rec.click(`${first} a[data-design]`, { after: 300 });
    await rec.waitFor(`document.documentElement.dataset.aisView === 'generate' && document.getElementById('gen-brief').value.length > 20`, 10000);
    await rec.pause(600);
    await rec.say("The brief's written for you, and Generate starts designing right away.");
    await rec.look('#gen-brief', { pad: 40 });
    await rec.pause(2400);
  },
};
