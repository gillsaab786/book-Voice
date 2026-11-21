/** A service's daily allowance is used up; work with it should wait until `resumeAt`. */
export class DailyLimitError extends Error {
  constructor(public service: string, public resumeAt: number, message?: string) {
    super(message || `${service}: daily free limit reached`);
  }
}

/** Next midnight US Pacific time (when Google's daily quotas reset), as a timestamp. */
export function nextPacificMidnight(now = Date.now()): number {
  // Pacific is UTC-8 (PST) or UTC-7 (PDT). Find which by formatting.
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  const h = Number(parts.hour) % 24;
  const m = Number(parts.minute);
  const msToMidnight = ((23 - h) * 60 + (60 - m)) * 60e3;
  return now + msToMidnight + 60e3;
}

export function timeLabel(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
