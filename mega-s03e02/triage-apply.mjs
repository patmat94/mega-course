// Writes the triage decisions (made with .agents/skills/triage) into doc/issues/.
// Keeps each file's key, title and raw request text; sets status, labels, sources, links and body.
//   node mega-s03e02/triage-apply.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'sched-prod', 'sched-prod', 'doc', 'issues');

const ar = (intent, acc, bounds, allowed) =>
  `## Intent\n${intent}\n\n## Acceptance\n${acc.map((a) => `- ${a}`).join('\n')}\n\n## Boundaries\n${bounds.map((b) => `- ${b}`).join('\n')}\n\nAllowed by ${allowed}.`;
const nh = (q, opts, rec, why) =>
  `## Question\n${q}\n\n## Options\n${opts.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n\n## Recommendation\n${rec}\n\n## Why\n${why}`;

const D = {
  // ---------- requests from the channels ----------
  'IN-1900': { mark: 'agent-ready', body: ar(
    'Staff can search the bookings list by booking reference as well as by name.',
    ['Given a booking with reference R, when staff search the bookings list for R, then that booking is listed.',
     'Given a search by a person\'s name, when staff search, then results are the same as today.',
     'Given a reference that matches no booking, when staff search, then the list is empty and no other booking is shown.',
     'A test covers search by reference and by name.'],
    ['Must not change or remove the existing name search.', 'Must not change stored bookings.'],
    'AUT-1 (new columns, filters or fields that add to what is there and take nothing away)') },
  'IN-2830': { mark: 'agent-ready', body: ar(
    'Every icon button on the booking page gets an accessible name that says what it does, so a screen reader reads more than "button".',
    ['Given a screen reader on the booking page, when it reaches an icon button, then it reads a name with a verb and its object (DES-5), e.g. "Next week".',
     'Given the booking page, when it renders, then no button has an empty accessible name (automated a11y test).',
     'Given the change, when the page renders, then nothing visible changes and no button\'s action changes.'],
    ['Must not change layout, icons or colours.', 'Labels follow DES-5 (verb and its object).'],
    'AUT-1 (copy changes in the product\'s own interface; bug fixes inside the specs, with a test)') },
  'IN-2943': { status: 'closed', reason: 'duplicate', dup: 'IN-7118', body:
    'Same decision as IN-7118: the CSV export date format. This client (ilse · studio · auckland) relies on mm/dd as it comes today; IN-7118 asks for dd/mm. Both are weighed in IN-7118 (AUT-2: a change to something a client has told us they rely on).' },
  'IN-2952': { status: 'closed', reason: 'obsolete', sources: ['IN-2952', 'IN-3244'], body:
    'Withdrawn by the client in IN-3244: "Scratch my request to move the weekly summary to Mondays. The team voted to keep Friday." The weekly summary stays on Friday; no work. IN-3244 is answered here.' },
  'IN-3197': { mark: 'agent-ready', body: ar(
    'The booking form gets an optional free-text note field (e.g. "first visit", "bring a mat"), stored with the booking and shown to staff with it.',
    ['Given the booking form, when a person types a note and books, then the booking stores the note and staff see it on the booking.',
     'Given the booking form, when a person leaves the note empty, then the booking goes through and is not blocked or changed.',
     'Given an export, when it runs, then every column it had is still there (PRD-3); the note is an added column.',
     'A test covers booking with and without a note.'],
    ['Must not make the field required.', 'Must not remove or rename any existing field or export column.'],
    'AUT-1 (new columns, filters or fields that add to what is there and take nothing away)') },
  'IN-3568': { mark: 'agent-ready', blockedBy: ['SCHED-4468'], body: ar(
    'Add a compact week view, built on the 4 px spacing scale (DES-3), that fits a whole day on one screen. The current week view stays as it is.',
    ['Given a 1080 px tall screen, when staff open the compact week view, then 07:00–21:00 of every day fits without scrolling.',
     'Given the compact view, when it renders, then every spacing value comes from the spacing tokens (DES-3) and every font size from the type scale (DES-1).',
     'Given a user who does not choose compact, when they open the week view, then it looks as it does today.'],
    ['Must not change the default week view.', 'Must not add spacing values outside the 4 px scale.', 'Waits for SCHED-4468 (spacing on the scale); "URGENT / before Friday" does not skip that.'],
    'AUT-1 (a denser layout built on the spacing scale (DES-3))') },
  'IN-3975': { mark: 'needs-human', body: nh(
    'Should the calendar feed send all-day bookings as all-day events, when a client relies on them coming as midnight to midnight?',
    ['Keep midnight to midnight for every feed; answer IN-3975 no.',
     'Send real all-day events in every feed, as IN-3975 asks.',
     'Add a per-account (or per-feed) setting for all-day bookings, midnight to midnight by default, all-day events by choice.'],
    'Option 3',
    'A client told us the screens outside their rooms read the feed and expect midnight to midnight (IN-9868), so changing it for everyone is AUT-2 (a change to something a client has told us they rely on). A setting keeps that client as is and lets others opt in; the rule lives in one place (PRD-4). Either way each booking keeps its stable id (ADR-0002).') },
  'IN-9868': { status: 'closed', reason: 'duplicate', dup: 'IN-3975', body:
    'Same decision as IN-3975: how the calendar feed sends all-day bookings. This client relies on midnight to midnight; IN-3975 asks for all-day events. Both are weighed in IN-3975 (AUT-2: a change to something a client has told us they rely on).' },
  'IN-2313': { status: 'closed', reason: 'duplicate', dup: 'IN-3197', body:
    'Same ask as IN-3197: an optional free-text note on the booking form. The work is there.' },
  'IN-4945': { mark: 'agent-ready', body: ar(
    'The client\'s logo in the booking confirmation email keeps its aspect ratio instead of being stretched. (The second problem in this ticket, the blank "Add to calendar" link, is TRI-1.)',
    ['Given a logo of any aspect ratio, when the confirmation email renders, then the logo keeps its ratio within the header box.',
     'Given a logo, when the email renders in common clients (Gmail, Outlook, Apple Mail), then it is not stretched or cropped.',
     'A test or snapshot covers a wide and a tall logo.'],
    ['Must not change the email\'s copy, links or other images.', 'Must not change the logo files clients uploaded.'],
    'AUT-1 (bug fixes and small features inside the specs, with a test that shows the change)') },
  'TRI-1': { new: { title: 'confirmation email: "Add to calendar" link opens a blank page', from: 'from:support' }, sources: ['IN-4945'], mark: 'agent-ready', body: ar(
    'The "Add to calendar" link in the booking confirmation email opens a calendar entry for the booking (an .ics file or the calendar\'s add page), not a blank page. Split from IN-4945, which held two problems.',
    ['Given a confirmation email, when the person opens "Add to calendar", then they get the booking with its start, end and time zone (ADR-0001).',
     'Given the link, when opened twice, then it adds the same event with the same stable id, not a second different one (ADR-0002).',
     'Given the link, when opened, then it does not show a blank page or ask for a login.',
     'A test covers the link.'],
    ['Must not change the logo fix in IN-4945.', 'Must not read events back from external calendars (ADR-0002).'],
    'AUT-1 (bug fixes and small features inside the specs, with a test that shows the change)') },
  'IN-5262': { status: 'closed', reason: 'contradicts-spec', body:
    'Contradicts PRD-2 and ADR-0001: every time is stored in UTC and shown in the viewer\'s zone; times saved in local zones broke every daylight-saving change. Reports can convert at the edge; SCHED-4446 adds the UTC offset to the export.' },
  'IN-5862': { mark: 'agent-ready', body: ar(
    'Fix the typo "Calender" → "Calendar" on the settings page.',
    ['Given the settings page, when it renders, then it says "Calendar" wherever it said "Calender".',
     'Given the change, when any other page renders, then its copy is not changed.'],
    ['Must not change setting names, keys or stored values; copy only.'],
    'AUT-1 (copy changes in the product\'s own interface)') },
  'IN-6895': { mark: 'agent-ready', body: ar(
    'The confirmation page shows the booking time together with its time zone, so people abroad know which zone it is in (PRD-2, ADR-0001).',
    ['Given a booking, when the confirmation page renders, then the time is shown with its zone (e.g. "10:00 Europe/Warsaw, UTC+1").',
     'Given a viewer in another zone, when the page renders, then the time is in the viewer\'s zone and says so (PRD-2).',
     'Given the change, when the page renders, then the stored time is not changed and no time is shown without a zone.',
     'A test covers two zones.'],
    ['Must not change stored times (PRD-2).'],
    'AUT-1 (bug fixes and small features inside the specs, with a test that shows the change)') },
  'IN-7914': { status: 'closed', reason: 'duplicate', dup: 'SCHED-4471', body:
    'Filed before last week\'s date fix: dates typed day first in EU locales were read month first. That is SCHED-4471 (dates parse mm/dd in eu locales), done.' },
  'IN-4016': { status: 'closed', reason: 'duplicate', dup: 'SCHED-4434', body:
    'An old-queue ticket for what SCHED-4434 (booking page: the list of times scrolls on small phones) already shipped; done.' },
  'IN-6485': { status: 'closed', reason: 'duplicate', dup: 'SCHED-4498', body:
    'Same bug as SCHED-4498 (confirmation email: the cancel link opens the login page). The work is there.' },
  'IN-9066': { mark: 'agent-ready', body: ar(
    'Add a "Copy link" button next to each slot on the slots page; it copies that slot\'s public booking link.',
    ['Given the slots page, when staff press "Copy link" next to a slot, then that slot\'s booking link is on the clipboard and a short inline note confirms it.',
     'Given a copy that fails, when the browser blocks the clipboard, then an inline message shows the link to copy by hand, not a modal dialog (DES-4).',
     'Given the button, when it renders, then its label is a verb and its object, "Copy link" (DES-5), and nothing else on the page changes.',
     'A test covers the copy.'],
    ['Must not change slot links or how slots are booked.', 'No modal dialogs (DES-4).'],
    'AUT-1 (bug fixes and small features inside the specs, with a test that shows the change)') },
  'IN-8948': { mark: 'agent-ready', body: ar(
    'Hovering over a booking in the week view shows who booked it, next to its time.',
    ['Given a booking by Anna Kowalska, when staff hover over it in the week view, then the hover shows the time and "Anna Kowalska".',
     'Given a booking, when hovered, then the time still shows as today, in the viewer\'s zone (PRD-2).',
     'Given the public booking page, when a person hovers a slot, then no other person\'s name is shown.',
     'A test covers the hover.'],
    ['Staff week view only; must not show names on the public booking page.'],
    'AUT-1 (new columns, filters or fields that add to what is there and take nothing away)') },
  'IN-6745': { status: 'closed', reason: 'duplicate', dup: 'SCHED-4486', body:
    'Same ask as SCHED-4486 (audit log: keep 90 days). The decision is weighed there.' },
  'IN-7118': { mark: 'needs-human', body: nh(
    'How should dates appear in the CSV export: stay mm/dd, switch to dd/mm for EU accounts, or something else?',
    ['Keep mm/dd for every account; answer the EU accounts no.',
     'Switch EU accounts to dd/mm, as IN-7118 asks.',
     'Add an export date-format setting per account (mm/dd by default, dd/mm or ISO 8601 by choice), so nothing changes for anyone who does not opt in.'],
    'Option 3',
    'A client told us their payroll import relies on mm/dd as it comes today (IN-2943), so switching it is AUT-2 (a change to something a client has told us they rely on). The client in IN-2943 is in Auckland, a day-first locale, so switching by locale would break them too. A per-account setting keeps the rule in one place (PRD-4).') },
  'IN-8671': { mark: 'agent-ready', body: ar(
    'The CSV export quotes fields (RFC 4180), so a client name with a comma no longer shifts the columns.',
    ['Given a client name "Smith, Anna", when the export runs, then the row has the same number of columns as the header and the name is one field.',
     'Given a value with a double quote or a line break, when the export runs, then it is quoted and escaped.',
     'Given rows with no special characters, when the export runs, then they read the same as today: no column added, removed or reordered, dates unchanged (PRD-3, IN-7118).',
     'A test covers commas, quotes and line breaks.'],
    ['Must not change the date format (open question in IN-7118).', 'Must not add, drop or reorder columns (PRD-3).'],
    'AUT-1 (bug fixes and small features inside the specs, with a test that shows the change)') },

  // ---------- backlog ----------
  'SCHED-4412': { mark: 'agent-ready', body: ar(
    'Replace every raw hex, rgb or named colour in components with the matching `--color-*` token (DES-2). Nothing visible changes.',
    ['Given the components, when a lint scans them, then no raw hex, rgb or named colour is left.',
     'Given every page, when compared with screenshots taken before, then nothing visible changes.',
     'Given a colour with no matching token, when found, then it is not invented: the issue lists it for design instead.'],
    ['Must not add new colour values to the palette.', 'Must not change how anything looks.'],
    'AUT-1 (bringing code in line with a rule in specs/ when nothing visible changes)') },
  'SCHED-4418': { mark: 'agent-ready', body: ar(
    'The week view starts on the first day of the week of the account\'s locale instead of always on Sunday.',
    ['Given an account with locale en-US, when staff open the week view, then it starts on Sunday.',
     'Given an account with locale de-DE or en-GB, when staff open the week view, then it starts on Monday.',
     'Given a booking, when the first day changes, then its time and day do not change (PRD-2).',
     'A test covers at least two locales.'],
    ['Must not change stored times or the time zone handling (PRD-2).', 'Must not add a new setting; the locale already holds the rule (PRD-4).'],
    'AUT-1 (bug fixes and small features inside the specs, with a test that shows the change)') },
  'SCHED-4431': { mark: 'agent-ready', body: ar(
    'The booking page shows how many seats are left in a group slot.',
    ['Given a slot with 10 seats and 7 bookings, when a person opens the booking page, then it shows 3 seats left.',
     'Given a slot with one seat, when the page renders, then no seat count is shown.',
     'Given a full slot, when the page renders, then it shows no seats left and it cannot be booked; no overbooking.',
     'A test covers these cases.'],
    ['Must not change how bookings are made or counted (PRD-1).'],
    'AUT-1 (new columns, filters or fields that add to what is there and take nothing away)') },
  'SCHED-4446': { mark: 'agent-ready', body: ar(
    'Add a UTC offset column next to the start and end times in the CSV export, so every tool knows the zone (ADR-0001).',
    ['Given a booking, when the export runs, then a new offset column (e.g. +13:00) sits next to start and end.',
     'Given the existing start and end columns, when the export runs, then they are not changed: same format and order of values (PRD-3, IN-2943).',
     'Given an account in a daylight-saving zone, when a booking falls on each side of the change, then each row carries its own offset.',
     'A test covers two zones and a daylight-saving change.'],
    ['Must not change or remove the existing start and end columns.', 'Must not change the date format (IN-7118 is open).'],
    'AUT-1 (new columns, filters or fields that add to what is there and take nothing away)') },
  'SCHED-4452': { mark: 'agent-ready', body: ar(
    'Each booking reaches a connected Outlook calendar once: pushes reuse the booking\'s stable id, so a re-sync updates the event instead of adding a second one (ADR-0002).',
    ['Given a booking already synced to Outlook, when sync runs again, then the calendar has one event for it.',
     'Given a changed booking, when sync runs, then the existing event is updated, not duplicated.',
     'Given the fix, when sync runs, then sched-prod still never reads events back from Outlook (ADR-0002).',
     'A test covers a repeated sync.'],
    ['Must not add two-way sync (ADR-0002).', 'Must not delete events in clients\' calendars.'],
    'AUT-1 (bug fixes and small features inside the specs, with a test that shows the change)') },
  'SCHED-4463': { mark: 'agent-ready', body: ar(
    'Replace every font size set in a component with the matching step of the type scale in the tokens (DES-1). Nothing visible changes.',
    ['Given the components, when a lint scans them, then no font size outside the type scale is left.',
     'Given every page, when compared with screenshots taken before, then nothing visible changes.',
     'Given a size with no matching step, when found, then it is listed for design, not given a new step.'],
    ['Must not add steps to the type scale.', 'Must not change how anything looks.'],
    'AUT-1 (bringing code in line with a rule in specs/ when nothing visible changes)') },
  'SCHED-4465': { mark: 'agent-ready', body: ar(
    'When the API rate-limits a caller, the 429 reply carries a Retry-After header with the seconds until the limit resets.',
    ['Given a caller over the limit, when the API replies 429, then the reply has Retry-After with a whole number of seconds > 0.',
     'Given a caller under the limit, when it calls, then the reply does not carry a Retry-After header and is otherwise as today.',
     'Given the 429 reply, when it is sent, then its status and body are unchanged.',
     'A test covers both cases.'],
    ['Must not change the rate limits themselves.', 'Must not change any other reply field.'],
    'AUT-1 (new columns, filters or fields that add to what is there and take nothing away)') },
  'SCHED-4468': { mark: 'agent-ready', body: ar(
    'Replace every margin and padding set in a component with the matching step of the 4 px spacing scale in the tokens (DES-3). Nothing visible changes.',
    ['Given the components, when a lint scans them, then no margin or padding outside the spacing scale is left.',
     'Given every page, when compared with screenshots taken before, then nothing visible changes.',
     'Given a value with no matching step, when found, then it is listed for design, not given a new step.'],
    ['Must not add steps to the spacing scale.', 'Must not change how anything looks.'],
    'AUT-1 (bringing code in line with a rule in specs/ when nothing visible changes)') },
  'SCHED-4486': { mark: 'needs-human', sources: [], body: nh(
    'Should audit log entries be deleted after 90 days, as finance asks (SCHED-4486, IN-6745)?',
    ['Keep every audit log entry, as today.',
     'Delete entries older than 90 days, for every account.',
     'Keep 90 days in the product and move older entries to an archive; delete nothing until whoever owns retention signs off.'],
    'Option 3',
    'Deleting entries is deleting data that is already stored, so it needs a person (AUT-2). The audit log may be what clients or an audit rely on, and a deletion cannot be undone; an archive meets finance\'s "ninety days would be enough for us" (IN-6745) without losing data.') },
  'SCHED-4494': { mark: 'agent-ready', body: ar(
    'A booking that crosses midnight shows on both days it covers in the week view.',
    ['Given a booking 23:00–01:00 in the viewer\'s zone, when the week view renders, then it shows on day one until 24:00 and on day two from 00:00.',
     'Given that booking, when it shows on two days, then it is still one booking in one slot (PRD-1), not two.',
     'Given a viewer in another zone, when the view renders, then the days follow the viewer\'s zone (PRD-2).',
     'A test covers a booking across midnight and one that does not.'],
    ['Must not split the booking or change stored times (PRD-1, PRD-2).'],
    'AUT-1 (bug fixes and small features inside the specs, with a test that shows the change)') },
  'SCHED-4498': { mark: 'agent-ready', body: ar(
    'The cancel link in the booking confirmation email opens the booking without a login, the same way the cancel link in the reminder email does.',
    ['Given a confirmation email, when the person who booked opens its cancel link, then the booking opens with a cancel button and no login.',
     'Given a cancel link for one booking, when it is opened, then it shows only that booking and nothing else of the account.',
     'Given the reminder email\'s cancel link, when it is opened, then it works as today.',
     'A test covers both emails.'],
    ['Must not change the reminder email or its link.', 'Must not let the link show or change other bookings.'],
    'AUT-1 (bug fixes and small features inside the specs, with a test that shows the change)') },
};

const list = (xs) => `[${xs.join(', ')}]`;
// issues triage creates (a request split in two): a stub the loop below fills
for (const [key, d] of Object.entries(D)) {
  if (d.new && !existsSync(join(DIR, `${key}.md`)))
    writeFileSync(join(DIR, `${key}.md`), `---\nkey: ${key}\ntitle: ${JSON.stringify(d.new.title)}\nstatus: open\nlabels: [${d.new.from}]\n---\n\nSplit by triage; see the request in sources.\n`, 'utf8');
}
let n = 0;
for (const f of readdirSync(DIR).filter((f) => f.endsWith('.md'))) {
  const key = f.slice(0, -3);
  const d = D[key];
  const text = readFileSync(join(DIR, f), 'utf8');
  const fmRaw = text.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
  const fm = Object.fromEntries(fmRaw[1].split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 2)]));
  const status = fm.status;
  if (!d) {
    if (status === 'done') continue; // shipped backlog work stays as it is
    throw new Error(`no triage decision for ${key}`);
  }
  const from = fm.labels.replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter((l) => l.startsWith('from:'));
  const st = d.status ?? 'open';
  const labels = st === 'open' ? [d.mark, ...from] : from;
  const sources = d.sources ?? (key.startsWith('IN-') ? [key] : []);
  const out = [`key: ${key}`, `title: ${fm.title}`, `status: ${st}`];
  if (d.reason) out.push(`reason: ${d.reason}`);
  out.push(`labels: ${list(labels)}`);
  if (sources.length) out.push(`sources: ${list(sources)}`);
  if (d.blockedBy) out.push(`blocked-by: ${list(d.blockedBy)}`);
  if (d.dup) out.push(`duplicate-of: ${d.dup}`);
  // keep the original request / backlog text under the triage body
  const MARK = '\n\n## Request as filed\n';
  const orig = fmRaw[2].includes(MARK) ? fmRaw[2].split(MARK)[1] : fmRaw[2];
  writeFileSync(join(DIR, f), `---\n${out.join('\n')}\n---\n\n${d.body}${MARK}${orig.trim()}\n`, 'utf8');
  n++;
}
console.log(`triaged ${n} issue(s)`);
