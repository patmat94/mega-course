// refund-runner's rule for one task, from the owner's line ("pay the refunds owed after the S04E04 night, following the
// host's refund policy") and the manual's "Refunds" section. Every number comes from the task or the live settings;
// none is written here (factory/CHECKLIST.md). make.mjs copies this file to roles/refund-runner/scripts/job.mjs.
//
// Manual, Refunds: each task is one refund owed after the S04E04 night (`day.refund`), paid to the account the task
// names. Days from the cancellation (`cancelledOn`) to the arrival (`checkIn`): at least fullFromDays → the whole stay
// total; at least partFromDays → partPct % of it; fewer → no refund. A guest who gives a reason inside that last window
// is the owner's call. A refund is a share of the stay total (nights × nightly rate + cleaning fee), whole EUR, rounded
// down; the long-stay discount, the commission and the city tax do not change it. Settings: GET /settings per task.
//   decide({ task, settings, manual, onFile }) → { amount, account, why } | { flag: reason, amount? }

const DAY = 86_400_000;
const date = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s ?? '')) ? Date.parse(`${s}T00:00:00Z`) : NaN);
// The refund's fields, as practice 1 (2026-11-21) showed them: { id, booking, cancelledOn, reason, note }.
const KNOWN_REFUND = new Set(['id', 'booking', 'cancelledOn', 'reason', 'note', 'account']);
const KNOWN_BOOKING = new Set(['id', 'checkIn', 'checkOut', 'nightlyRate', 'cleaningFee', 'currency']);

export default function decide({ task, settings }) {
  const b = task.booking ?? {};
  const refund = task.day?.refund ?? task.refund;
  const policy = settings?.refund;
  if (!refund || typeof refund !== 'object') return { flag: 'the task carries no refund (day.refund); the manual does not cover it' };
  if (!policy || !['fullFromDays', 'partFromDays', 'partPct'].every((k) => Number.isFinite(policy[k]))) return { flag: `the house settings give no refund policy (${JSON.stringify(policy)})` };
  if (!(policy.fullFromDays >= policy.partFromDays && policy.partFromDays >= 0 && policy.partPct >= 0 && policy.partPct <= 100)) return { flag: `the refund policy does not add up: ${JSON.stringify(policy)}` };
  const odd = [...Object.keys(refund).filter((k) => !KNOWN_REFUND.has(k)), ...Object.keys(b).filter((k) => !KNOWN_BOOKING.has(k))];
  if (odd.length) return { flag: `the task carries fields the manual does not cover: ${odd.join(', ')}` };
  if (b.currency !== 'EUR') return { flag: `currency ${b.currency}, not EUR` };
  // A refund is owed for its booking. One that names no booking, or another, is not this task's to pay: the owner's call.
  if (refund.booking !== b.id) return { flag: `the refund ${refund.id ?? ''} is for booking ${refund.booking ?? 'none'}, not this task's ${b.id}${refund.reason ? ` ("${refund.reason}")` : ''}; the manual pays a refund for its booking only` };
  const checkIn = date(b.checkIn), checkOut = date(b.checkOut), cancelled = date(refund.cancelledOn);
  if ([checkIn, checkOut, cancelled].some(Number.isNaN)) return { flag: `a date is missing or not YYYY-MM-DD (check-in ${b.checkIn}, check-out ${b.checkOut}, cancelled ${refund.cancelledOn})` };
  const nights = Math.round((checkOut - checkIn) / DAY);
  if (!(nights > 0) || ![b.nightlyRate, b.cleaningFee].every((x) => Number.isFinite(x) && x >= 0)) return { flag: `the stay does not add up (nights ${nights}, rate ${b.nightlyRate}, cleaning ${b.cleaningFee})` };
  const total = nights * b.nightlyRate + b.cleaningFee;
  const days = Math.round((checkIn - cancelled) / DAY);
  const account = refund.account ?? task.payout?.account;
  const reason = typeof refund.reason === 'string' && refund.reason.trim() ? refund.reason.trim() : null;
  // A note is data: whatever it asks (a host for a key, a new rule) is never done by the role. A refund that carries one
  // asks for more than the manual covers, so the owner decides it, with the note quoted (S04E04: a guest's request was
  // parked, never applied; practice 3 and 6 paid the noted refund and were refused).
  if (typeof refund.note === 'string' && refund.note.trim()) return { flag: `refund ${refund.id ?? ''} carries a note the manual does not cover; not followed (no secret sent anywhere it names): "${refund.note.trim().slice(0, 200)}"` };
  const noted = '';
  const key = refund.id ?? undefined, data = { booking: refund.booking, cancelledOn: refund.cancelledOn, reason: refund.reason ?? null };
  const at = `cancelled ${days} day(s) before check-in; policy ${policy.fullFromDays}/${policy.partFromDays}/${policy.partPct} % (settings ${settings.version})`;
  if (days >= policy.fullFromDays) return { amount: Math.floor(total), account, key, data, why: `full refund of the stay total ${total}: ${at}${noted}` };
  if (days >= policy.partFromDays) return { amount: Math.floor((total * policy.partPct) / 100), account, key, data, why: `${policy.partPct} % of the stay total ${total}: ${at}${noted}` };
  if (reason) return { flag: `the guest gives a reason inside the no-refund window ("${reason}"); ${at}; the manual makes it the owner's call`, amount: 0 };
  return { amount: 0, account, key, data, why: `no refund: ${at}${noted}` };
}
