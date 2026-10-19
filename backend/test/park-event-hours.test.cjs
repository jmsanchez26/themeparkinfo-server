const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

for (const base of ['public', 'themeparkinfo-mobile/www']) {
  for (const park of ['usfl', 'usHollywood']) {
    test(`${base} ${park}: event hours include HHN/early access and invalidate the old cache`, async () => {
      const dom = new JSDOM('<div class="park-hours-container"><div class="hours-title"></div><div class="hours-details"><span class="open-hours"></span></div></div>', {
        url: 'http://localhost:3000/', runScripts: 'outside-only'
      });
      const w = dom.window;
      try {
        const RealDate = w.Date;
        w.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-10-18T16:00:00Z'])); } static now() { return RealDate.parse('2026-10-18T16:00:00Z'); } };
        w.timeZone = park === 'usfl' ? 'America/New_York' : 'America/Los_Angeles';
        w.PARK_IDS = { [park]: 'park-1', islandofAdventure: 'park-2' };
        w.localStorage.setItem('parkHoursCache', JSON.stringify({ 'park-1_2026-10-18': { open: '9:00 AM', close: '5:00 PM' } }));
        const offset = park === 'usfl' ? '-04:00' : '-07:00';
        let calls = 0;
        w.fetch = async () => {
          calls++;
          return { ok: true, json: async () => ({ schedule: [
            { date: '2026-10-18', type: 'OPERATING', openingTime: `2026-10-18T09:00:00${offset}`, closingTime: `2026-10-18T18:00:00${offset}` },
            { date: '2026-10-18', type: 'TICKETED_EVENT', description: 'Halloween Horror Nights', openingTime: `2026-10-18T19:00:00${offset}`, closingTime: `2026-10-19T02:00:00${offset}` },
            { date: '2026-10-18', type: 'INFO', description: 'Halloween Horror Nights Early Access', openingTime: `2026-10-18T17:00:00${offset}`, closingTime: `2026-10-18T19:00:00${offset}` },
            { date: '2026-10-19', type: 'TICKETED_EVENT', description: 'Halloween Horror Nights Premium Scream Night', openingTime: `2026-10-19T19:00:00${offset}`, closingTime: `2026-10-20T02:00:00${offset}` }
          ] }) };
        };
        w.eval(fs.readFileSync(path.resolve(__dirname, '../../', base, 'assets/js/parkHours.js'), 'utf8'));
        await w.getParkHours(park);
        const events = w.document.querySelectorAll('.park-event-hours-line');
        const zone = park === 'usfl' ? 'EDT' : 'PDT';
        assert.equal(events.length, 2);
        assert.equal(events[0].querySelector(".park-event-title").textContent, "Halloween Horror Nights");
        assert.equal(events[0].querySelector(".park-event-time").textContent, `7:00 PM ${zone} – 2:00 AM ${zone}`);
        assert.match(events[1].querySelector(".park-event-title").textContent, /Early Access/);
        assert.match(events[1].querySelector(".park-event-time").textContent, /5:00 PM/);
        await w.getParkHours(park); assert.equal(calls, 1);
        await w.getParkHours('islandofAdventure');
        assert.equal(w.document.querySelectorAll('.park-event-hours-line').length, 0);
      } finally { w.close(); }
    });
  }
}
