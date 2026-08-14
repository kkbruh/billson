import { useState } from 'react';
import { IntegrationsScreen } from './IntegrationsScreen';
import { Placeholder } from './Placeholder';

type SettingsTab = 'integrations' | 'templates' | 'preferences';

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'integrations', label: 'Sources & Integrations' },
  { key: 'templates', label: 'Templates' },
  { key: 'preferences', label: 'Preferences' },
];

/** Settings hub — houses the integration connectors, extraction templates and
 *  org preferences under one roof (each was its own nav item before). */
export function SettingsScreen() {
  const [tab, setTab] = useState<SettingsTab>('integrations');

  return (
    <div className="bi-settings">
      <nav className="segmented" role="tablist" aria-label="Settings sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`segmented__item${tab === t.key ? ' segmented__item--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="bi-settings__panel">
        {tab === 'integrations' && <IntegrationsScreen />}
        {tab === 'templates' && (
          <Placeholder
            icon="templates"
            title="Templates"
            blurb="Per-vendor extraction templates that lock field positions for known bill layouts. Not built yet — every bill is read by the AI extractor today."
          />
        )}
        {tab === 'preferences' && (
          <Placeholder
            icon="settings"
            title="Preferences"
            blurb="Extraction defaults (OCR mode, single-model vs consensus), the review-gate threshold, and roles will live here."
          />
        )}
      </div>
    </div>
  );
}
