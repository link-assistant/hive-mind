import { useEffect, useMemo, useState } from 'react';

import { DOCKER_URL, NPM_URL, REPO_URL, RELEASE_API, RELEASES_URL, detectOperatingSystem, installMethods, operatingSystems, primaryMethodFor, releaseVersion } from './downloads.js';
import { copy, detectLocale, locales, text } from './i18n.js';
import { readThemeMode, resolveTheme, systemTheme, themeModes, writeThemeMode } from './theme.js';

const DOCS_URL = `${REPO_URL}#readme`;

const THEME_GLYPHS = { system: '🖥', light: '☀', dark: '☾' };

function useCopyToClipboard() {
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    if (!copiedId) {
      return undefined;
    }

    const timer = setTimeout(() => setCopiedId(null), 1600);

    return () => clearTimeout(timer);
  }, [copiedId]);

  const copyValue = (id, value) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(value).then(
        () => setCopiedId(id),
        () => setCopiedId(null)
      );
    }
  };

  return { copiedId, copyValue };
}

function CommandBlock({ id, commands, locale, copiedId, onCopy }) {
  const joined = commands.join('\n');

  return (
    <div className="command-block">
      <pre>
        <code>
          {commands.map(command => (
            <span className="command-line" key={command}>
              <span className="prompt" aria-hidden="true">
                $
              </span>
              {command}
            </span>
          ))}
        </code>
      </pre>
      <button type="button" className="copy-button" onClick={() => onCopy(id, joined)}>
        {text(locale, copiedId === id ? 'copied' : 'copy')}
      </button>
    </div>
  );
}

function TerminalPreview({ locale }) {
  return (
    <div className="window-frame" aria-hidden="true">
      <div className="window-titlebar">
        <span className="traffic-lights">
          <span />
          <span />
          <span />
        </span>
        <span className="window-title">{text(locale, 'terminalTitle')}</span>
        <span className="window-spacer" />
      </div>
      <pre className="terminal-body">
        <code>
          <span className="t-line">
            <span className="t-prompt">$</span> hive --issue 1838
          </span>
          <span className="t-line t-dim">→ Reading issue and comments…</span>
          <span className="t-line t-dim">→ Planning the solution draft…</span>
          <span className="t-line t-ok">✓ Branch created</span>
          <span className="t-line t-ok">✓ Tests added and passing</span>
          <span className="t-line t-accent">↗ Pull request opened</span>
          <span className="t-line t-cursor">
            <span className="t-prompt">$</span>
            <span className="cursor" />
          </span>
        </code>
      </pre>
    </div>
  );
}

export default function App() {
  const [locale, setLocale] = useState(() => detectLocale());
  const [themeMode, setThemeMode] = useState(() => readThemeMode());
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(readThemeMode()));
  const [selectedOs, setSelectedOs] = useState(() => {
    const detected = detectOperatingSystem();

    return detected === 'unknown' ? 'macos' : detected;
  });
  const [release, setRelease] = useState(null);
  const [releaseStatus, setReleaseStatus] = useState('loading');
  const { copiedId, copyValue } = useCopyToClipboard();

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themeMode = themeMode;
  }, [locale, resolvedTheme, themeMode]);

  useEffect(() => {
    setResolvedTheme(resolveTheme(themeMode));

    if (themeMode !== 'system' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolvedTheme(systemTheme());

    media.addEventListener('change', onChange);

    return () => media.removeEventListener('change', onChange);
  }, [themeMode]);

  useEffect(() => {
    const controller = new AbortController();

    fetch(RELEASE_API, { signal: controller.signal })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Release request failed: ${response.status}`);
        }

        return response.json();
      })
      .then(data => {
        setRelease(data);
        setReleaseStatus('ready');
      })
      .catch(error => {
        if (error.name !== 'AbortError') {
          setReleaseStatus('fallback');
        }
      });

    return () => controller.abort();
  }, []);

  const version = useMemo(() => releaseVersion(release), [release]);
  const primaryMethod = primaryMethodFor(selectedOs);
  const statusKey = releaseStatus === 'ready' ? 'statusReady' : releaseStatus === 'loading' ? 'statusLoading' : 'statusFallback';

  const changeTheme = mode => {
    setThemeMode(mode);
    writeThemeMode(mode);
  };

  return (
    <main className="page-shell">
      <header className="top-bar">
        <div className="locale-switch" aria-label="Language">
          {locales.map(value => (
            <button key={value} type="button" className={locale === value ? 'active' : ''} onClick={() => setLocale(value)}>
              {value.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="theme-switch" aria-label="Theme">
          {themeModes.map(mode => (
            <button key={mode} type="button" className={themeMode === mode ? 'active' : ''} onClick={() => changeTheme(mode)} title={mode}>
              <span aria-hidden="true">{THEME_GLYPHS[mode]}</span>
            </button>
          ))}
        </div>
      </header>

      <section className="hero" aria-labelledby="site-title">
        <div className="hero-copy">
          <p className="eyebrow">{text(locale, 'eyebrow')}</p>
          <h1 id="site-title">{text(locale, 'title')}</h1>
          <p className="summary">{text(locale, 'summary')}</p>
          <div className="status-row" role="status">
            <span>{text(locale, statusKey)}</span>
            {releaseStatus === 'ready' && version ? (
              <a className="version-pill" href={RELEASES_URL}>
                v{version}
              </a>
            ) : releaseStatus === 'fallback' ? (
              <a className="version-pill" href={RELEASES_URL}>
                GitHub
              </a>
            ) : null}
          </div>

          <div className="download-panel">
            <div className="os-tabs" aria-label={text(locale, 'chooseOs')}>
              {operatingSystems.map(os => (
                <button key={os} type="button" className={selectedOs === os ? 'active' : ''} onClick={() => setSelectedOs(os)}>
                  {text(locale, `os${os.charAt(0).toUpperCase()}${os.slice(1)}`)}
                </button>
              ))}
            </div>
            {primaryMethod ? (
              <div className="primary-install">
                <p className="primary-install-label">
                  {text(locale, 'primaryAction')} <strong>{text(locale, `os${selectedOs.charAt(0).toUpperCase()}${selectedOs.slice(1)}`)}</strong>
                </p>
                <CommandBlock id={`primary-${primaryMethod.id}`} commands={primaryMethod.commands} locale={locale} copiedId={copiedId} onCopy={copyValue} />
                <p className="primary-install-note">{text(locale, primaryMethod.noteKey)}</p>
              </div>
            ) : null}
          </div>

          <nav className="support-links" aria-label="Primary links">
            <a href={NPM_URL}>{text(locale, 'linkNpm')}</a>
            <a href={DOCKER_URL}>{text(locale, 'linkDocker')}</a>
            <a href={REPO_URL}>{text(locale, 'linkRepo')}</a>
          </nav>
        </div>

        <div className="hero-media">
          <TerminalPreview locale={locale} />
        </div>
      </section>

      <section className="install" aria-labelledby="install-title">
        <div>
          <p className="eyebrow">{text(locale, 'methodsTitle')}</p>
          <h2 id="install-title">{text(locale, 'release')}</h2>
        </div>
        <div className="install-grid">
          {operatingSystems.map(os => (
            <article className="install-card" key={os}>
              <h3>{text(locale, `os${os.charAt(0).toUpperCase()}${os.slice(1)}`)}</h3>
              <p className="install-card-note">{text(locale, `notes${os.charAt(0).toUpperCase()}${os.slice(1)}`)}</p>
              {installMethods[os].map(method => (
                <div className="method" key={method.id}>
                  <p className="method-label">{text(locale, method.labelKey)}</p>
                  <CommandBlock id={method.id} commands={method.commands} locale={locale} copiedId={copiedId} onCopy={copyValue} />
                  <p className="method-note">{text(locale, method.noteKey)}</p>
                </div>
              ))}
            </article>
          ))}
        </div>
      </section>

      <section className="prereqs" aria-labelledby="prereqs-title">
        <div>
          <p className="eyebrow">{text(locale, 'prereqTitle')}</p>
          <h2 id="prereqs-title">{text(locale, 'verifyTitle')}</h2>
        </div>
        <ul className="prereq-list">
          <li>{text(locale, 'prereqNode')}</li>
          <li>{text(locale, 'prereqDocker')}</li>
        </ul>
        <p className="verify-intro">{text(locale, 'verifyIntro')}</p>
        <CommandBlock id="verify" commands={['hive --version', 'solve --version']} locale={locale} copiedId={copiedId} onCopy={copyValue} />
      </section>

      <footer className="page-footer">
        <nav className="support-links" aria-label={text(locale, 'linksTitle')}>
          <a href={NPM_URL}>{text(locale, 'linkNpm')}</a>
          <a href={DOCKER_URL}>{text(locale, 'linkDocker')}</a>
          <a href={REPO_URL}>{text(locale, 'linkRepo')}</a>
          <a href={RELEASES_URL}>{text(locale, 'linkReleases')}</a>
          <a href={DOCS_URL}>{text(locale, 'linkDocs')}</a>
        </nav>
        <p className="footer-note">{text(locale, 'footer')}</p>
      </footer>
    </main>
  );
}

// Re-export so build tooling / tests can introspect available translations.
export { copy };
