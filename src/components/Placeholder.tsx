import { icons, type IconName } from '../lib/icons';

function mask(icon: string) {
  return { maskImage: `url("${icon}")`, WebkitMaskImage: `url("${icon}")` };
}

/**
 * A section that exists in the navigation (to match the design) but has no
 * backing data or screen yet. Honest by default: it says what it will be rather
 * than faking content.
 */
export function Placeholder({
  icon,
  title,
  blurb,
}: {
  icon: IconName;
  title: string;
  blurb: string;
}) {
  return (
    <div className="fds-widget">
      <div className="fds-widget__body">
        <div className="empty" style={{ padding: 'var(--spacing-sectionLarge)' }}>
          <span
            className="bi-nav__icon"
            style={{
              ...mask(icons[icon]),
              width: 28,
              height: 28,
              backgroundColor: 'var(--colors-iconNeutralLight)',
              margin: '0 auto var(--spacing-containerXLarge)',
            }}
            aria-hidden="true"
          />
          <div className="fds-widget__title" style={{ marginBottom: 6 }}>
            {title}
          </div>
          <div className="empty__text">{blurb}</div>
        </div>
      </div>
    </div>
  );
}
