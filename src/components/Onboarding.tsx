/**
 * First-run "how it works" — shown once (a localStorage flag) so a new user
 * understands the in → parse → review → out flow without a walkthrough.
 */

const STEPS: { title: string; text: string }[] = [
  {
    title: 'Bills arrive',
    text: 'From Outlook, SharePoint or Drive, bills are triaged automatically into the CMMS Bills module.',
  },
  {
    title: 'Parse',
    text: 'Pull them into the Bills Inbox — the AI extractor reads vendor, account, dates and amounts.',
  },
  {
    title: 'Review',
    text: 'Only low-confidence bills wait in the Review Queue for a quick human check; the rest go straight through.',
  },
  {
    title: 'Push out',
    text: 'Confirmed bills flow into Facilio — and, once a destination is configured, Xero / QuickBooks / NetSuite.',
  },
];

export function Onboarding({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="bi-onb" role="dialog" aria-modal="true" aria-label="How Bill Intelligence works">
      <div className="bi-onb__panel">
        <div className="bi-onb__head">
          <span className="bi-onb__mark">F</span>
          <div>
            <h2 className="bi-onb__title">Welcome to Bill Intelligence</h2>
            <p className="bi-onb__sub">Turn bills from anywhere into structured records. Here's the flow:</p>
          </div>
        </div>

        <ol className="bi-onb__steps">
          {STEPS.map((s, i) => (
            <li className="bi-onb__step" key={s.title}>
              <span className="bi-onb__num" aria-hidden="true">
                {i + 1}
              </span>
              <div className="bi-onb__step-body">
                <span className="bi-onb__step-title">{s.title}</span>
                <span className="bi-onb__step-text">{s.text}</span>
              </div>
            </li>
          ))}
        </ol>

        <div className="bi-onb__foot">
          <button type="button" className="btn btn--accent" onClick={onDismiss} autoFocus>
            Get started
          </button>
        </div>
      </div>
    </div>
  );
}
