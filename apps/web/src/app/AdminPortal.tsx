import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Activity, AlertTriangle, Boxes, CheckCircle2, Clock3, LayoutDashboard,
  Globe, LogOut, Mail, Plus, RefreshCw, Save, Search, Server, ShieldCheck, Trash2
} from 'lucide-react';

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'factormail.admin.token';

type Overview = {
  mailboxCount: number;
  messageCount: number;
  mailboxesWithMessages: number;
  mailboxCapacity: number;
  domain: string;
  mailboxTtlMinutes: number;
  inboundConfigured: boolean;
  storage: string;
  api: string;
  timestamp: string;
};
type Mailbox = {
  id: string;
  address: string;
  createdAt: string;
  expiresAt: string;
  messageCount: number;
};
type Domain = {
  id: string;
  domain: string;
  isActive: boolean;
  verificationStatus: 'pending' | 'verified' | 'failed';
  inboundStatus: 'pending' | 'ready' | 'failed';
  providerReference: string | null;
  createdAt: string;
  updatedAt: string;
  administrativeNotes: string | null;
  inboundTestedAt: string | null;
};
type DomainDraft = {
  verificationStatus: 'pending' | 'verified' | 'failed';
  inboundStatus: 'pending' | 'ready' | 'failed';
  isActive: boolean;
  providerReference: string;
  administrativeNotes: string;
};
type Status = {
  api: string;
  storage: string;
  domain: string;
  mailboxTtlMinutes: number;
  inboundConfigured: boolean;
  adminSessionExpiresAt: string;
  timestamp: string;
};
type Page = 'overview' | 'mailboxes' | 'domains' | 'services';

async function api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data as T;
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export default function AdminPortal() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [page, setPage] = useState<Page>('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [search, setSearch] = useState('');
  const [domains, setDomains] = useState<Domain[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [newDomainNotes, setNewDomainNotes] = useState('');
  const [selectedDomainId, setSelectedDomainId] = useState('');
  const [domainDraft, setDomainDraft] = useState<DomainDraft>({
    verificationStatus: 'pending',
    inboundStatus: 'pending',
    isActive: false,
    providerReference: '',
    administrativeNotes: ''
  });

  const logout = useCallback(async () => {
    const current = token;
    sessionStorage.removeItem(TOKEN_KEY);
    setToken('');
    setOverview(null);
    setStatus(null);
    setMailboxes([]);
    if (current) {
      try {
        await api('/api/admin/logout', current, { method: 'POST' });
      } catch {
        // The local session is cleared even if the server is unreachable.
      }
    }
  }, [token]);

  const loadData = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      const [nextOverview, nextStatus] = await Promise.all([
        api<Overview>('/api/admin/overview', token),
        api<Status>('/api/admin/status', token)
      ]);
      setOverview(nextOverview);
      setStatus(nextStatus);
      if (page === 'mailboxes') {
        const result = await api<{ mailboxes: Mailbox[] }>('/api/admin/mailboxes', token);
        setMailboxes(result.mailboxes);
      }
      if (page === 'domains') {
        const result = await api<{ domains: Domain[] }>('/api/admin/domains', token);
        setDomains(result.domains);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unable to load administrator data.';
      if (message.includes('Administrator sign-in required')) {
        await logout();
        setError('Your administrator session expired. Sign in again.');
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }, [token, page, logout]);

  useEffect(() => {
    if (token) void loadData();
  }, [token, loadData]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${API}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Administrator sign-in failed.');
      sessionStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setPassword('');
      setNotice('Administrator session established.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }

  async function openPage(next: Page) {
    setPage(next);
    setError('');
    setNotice('');
    if (next === 'mailboxes' && token) {
      try {
        const result = await api<{ mailboxes: Mailbox[] }>('/api/admin/mailboxes', token);
        setMailboxes(result.mailboxes);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unable to load mailboxes.');
      }
    }
  }

  async function removeMailbox(mailbox: Mailbox) {
    if (!window.confirm(`Permanently remove ${mailbox.address}? This cannot be undone.`)) return;
    setError('');
    setNotice('');
    try {
      await api(`/api/admin/mailboxes/${mailbox.id}`, token, { method: 'DELETE' });
      setMailboxes(items => items.filter(item => item.id !== mailbox.id));
      setNotice(`Mailbox ${mailbox.address} was removed.`);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to remove mailbox.');
    }
  }

  async function addDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);

    try {
      const result = await api<{ domain: Domain }>('/api/admin/domains', token, {
        method: 'POST',
        body: JSON.stringify({
          domain: newDomain.trim().toLowerCase(),
          administrativeNotes: newDomainNotes
        })
      });

      setDomains(items => [result.domain, ...items]);
      setNewDomain('');
      setNewDomainNotes('');
      setSelectedDomainId(result.domain.id);
      setDomainDraft({
        verificationStatus: result.domain.verificationStatus,
        inboundStatus: result.domain.inboundStatus,
        isActive: result.domain.isActive,
        providerReference: result.domain.providerReference || '',
        administrativeNotes: result.domain.administrativeNotes || ''
      });
      setNotice(`Domain ${result.domain.domain} was registered in pending status.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to register domain.');
    } finally {
      setBusy(false);
    }
  }

  function selectDomain(domain: Domain) {
    setSelectedDomainId(domain.id);
    setDomainDraft({
      verificationStatus: domain.verificationStatus,
      inboundStatus: domain.inboundStatus,
      isActive: domain.isActive,
      providerReference: domain.providerReference || '',
      administrativeNotes: domain.administrativeNotes || ''
    });
    setError('');
    setNotice('');
  }

  async function saveDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selected = domains.find(item => item.id === selectedDomainId);
    if (!selected) {
      setError('Select a domain before saving changes.');
      return;
    }

    if (
      domainDraft.isActive &&
      (domainDraft.verificationStatus !== 'verified' || domainDraft.inboundStatus !== 'ready')
    ) {
      setError('A domain must be verified and inbound-ready before activation.');
      return;
    }

    setError('');
    setNotice('');
    setBusy(true);

    try {
      const result = await api<{ domain: Domain }>(
        `/api/admin/domains/${selected.id}`,
        token,
        {
          method: 'PATCH',
          body: JSON.stringify(domainDraft)
        }
      );

      setDomains(items => items.map(item =>
        item.id === result.domain.id ? result.domain : item
      ));
      setNotice(`Domain ${result.domain.domain} was updated.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update domain.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteDomain(domain: Domain) {
    if (!window.confirm(
      `Permanently delete ${domain.domain}? Domains with dependent addresses cannot be deleted.`
    )) return;

    setError('');
    setNotice('');
    setBusy(true);

    try {
      await api(
        `/api/admin/domains/${domain.id}`,
        token,
        { method: 'DELETE' }
      );

      setDomains(items => items.filter(item => item.id !== domain.id));
      if (selectedDomainId === domain.id) setSelectedDomainId('');
      setNotice(`Domain ${domain.domain} was deleted.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to delete domain.');
    } finally {
      setBusy(false);
    }
  }

  const filteredMailboxes = useMemo(() => {
    const query = search.trim().toLowerCase();
    return mailboxes.filter(item =>
      !query || item.address.toLowerCase().includes(query) || item.id.includes(query)
    );
  }, [mailboxes, search]);

  if (!token) {
    return (
      <main className="admin-login-wrap">
        <section className="admin-login-card">
          <img src="/factormail-logo.svg" alt="FactorMailService" />
          <div className="admin-kicker">Protected administration</div>
          <h1 className="admin-title">Admin portal</h1>
          <p className="admin-subtitle">Sign in to manage FactorMailService operations and inspect live service health.</p>
          {error && <div className="admin-message error" role="alert">{error}</div>}
          <form onSubmit={login}>
            <label className="admin-form-label" htmlFor="admin-username">Administrator username</label>
            <input className="admin-form-input" id="admin-username" autoComplete="username"
              value={username} onChange={e => setUsername(e.target.value)} required />
            <label className="admin-form-label" htmlFor="admin-password">Password</label>
            <input className="admin-form-input" id="admin-password" type="password"
              autoComplete="current-password" value={password}
              onChange={e => setPassword(e.target.value)} required />
            <button className="admin-button admin-button-primary" type="submit" disabled={busy}>
              <ShieldCheck size={16} /> {busy ? 'Verifying…' : 'Sign in securely'}
            </button>
          </form>
          <p className="admin-footer">Administrator access is verified by the server. Public inbox access remains separate.</p>
        </section>
      </main>
    );
  }

  const nav: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'mailboxes', label: 'Mailbox management', icon: Mail },
    { id: 'domains', label: 'Domain registry', icon: Globe },
    { id: 'services', label: 'API & services', icon: Server }
  ];

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <header className="admin-topbar">
          <div className="admin-brand">
            <img src="/factormail-logo.svg" alt="FactorMailService" />
          </div>
          <button className="admin-button" onClick={() => void logout()}>
            <LogOut size={15} /> Sign out
          </button>
        </header>

        <div className="admin-kicker">Operations & developer console</div>
        <h1 className="admin-title">
          {page === 'overview' ? 'Service overview' : page === 'mailboxes' ? 'Mailbox management' : page === 'domains' ? 'Domain registry' : 'API & services'}
        </h1>
        <p className="admin-subtitle">Monitor live service configuration and manage temporary inboxes.</p>

        {error && <div className="admin-message error" role="alert">{error}</div>}
        {notice && <div className="admin-message" role="status">{notice}</div>}

        <div className="admin-layout" style={{ marginTop: 24 }}>
          <aside className="admin-sidebar" aria-label="Admin navigation">
            <div className="admin-side-label">WORKSPACE</div>
            {nav.map(item => {
              const Icon = item.icon;
              return (
                <button key={item.id} className={`admin-side-link ${page === item.id ? 'active' : ''}`}
                  onClick={() => void openPage(item.id)}>
                  <Icon size={16} /> {item.label}
                </button>
              );
            })}
            <div className="admin-side-label">SYSTEM</div>
            <div className="admin-side-link" style={{ cursor: 'default' }}>
              <Activity size={16} /> Live diagnostics
            </div>
          </aside>

          <section className="admin-main">
            {page === 'overview' && (
              <>
                <div className="admin-stats">
                  <div className="admin-stat">
                    <div className="admin-stat-label">Active mailboxes</div>
                    <div className="admin-stat-value">{overview?.mailboxCount ?? '—'}</div>
                    <div className="admin-stat-foot">Live stored mailbox count</div>
                  </div>
                  <div className="admin-stat">
                    <div className="admin-stat-label">Stored messages</div>
                    <div className="admin-stat-value">{overview?.messageCount ?? '—'}</div>
                    <div className="admin-stat-foot">Messages in current mailbox store</div>
                  </div>
                  <div className="admin-stat">
                    <div className="admin-stat-label">Capacity used</div>
                    <div className="admin-stat-value">
                      {overview ? `${((overview.mailboxCount / overview.mailboxCapacity) * 100).toFixed(1)}%` : '—'}
                    </div>
                    <div className="admin-stat-foot">{overview ? `${overview.mailboxCount} of ${overview.mailboxCapacity}` : 'Loading capacity'}</div>
                  </div>
                  <div className="admin-stat">
                    <div className="admin-stat-label">API status</div>
                    <div className="admin-stat-value" style={{ fontSize: 22 }}>
                      {overview?.api === 'healthy' ? 'Operational' : 'Checking'}
                    </div>
                    <div className="admin-stat-foot">Live response from administrator API</div>
                  </div>
                </div>

                <div className="admin-panel">
                  <div className="admin-panel-heading">
                    <div><h2>Service health</h2><p>Current backend configuration, not simulated telemetry.</p></div>
                    <button className="admin-button" onClick={() => void loadData()} disabled={busy}>
                      <RefreshCw size={14} /> Refresh
                    </button>
                  </div>
                  <div className="admin-status-list">
                    <div className="admin-status-item"><span><Server size={15} style={{ verticalAlign: 'middle', marginRight: 8 }} />API service</span><span className="admin-pill ok"><CheckCircle2 size={12} /> Healthy</span></div>
                    <div className="admin-status-item"><span><Boxes size={15} style={{ verticalAlign: 'middle', marginRight: 8 }} />Mailbox storage</span><span className="admin-pill ok">{overview?.storage || 'Checking'}</span></div>
                    <div className="admin-status-item"><span><Mail size={15} style={{ verticalAlign: 'middle', marginRight: 8 }} />Inbound email</span><span className={`admin-pill ${overview?.inboundConfigured ? 'ok' : 'warn'}`}>{overview?.inboundConfigured ? 'Configured' : 'Not configured'}</span></div>
                    <div className="admin-status-item"><span><Clock3 size={15} style={{ verticalAlign: 'middle', marginRight: 8 }} />Mailbox lifetime</span><strong>{overview ? `${overview.mailboxTtlMinutes} minutes` : '—'}</strong></div>
                  </div>
                </div>
                <div className="admin-panel">
                  <div className="admin-panel-heading"><div><h2>Production readiness</h2><p>Configuration items that affect real-world operation.</p></div></div>
                  <div className="admin-status-list">
                    <div className="admin-status-item"><span>Mailbox domain</span><strong>{overview?.domain || 'Loading…'}</strong></div>
                    <div className="admin-status-item"><span>Inbound delivery</span><span className={`admin-pill ${overview?.inboundConfigured ? 'ok' : 'warn'}`}>{overview?.inboundConfigured ? 'Secret configured' : 'Setup required'}</span></div>
                    <div className="admin-status-item"><span>Storage backend</span><strong>Local JSON file</strong></div>
                    <div className="admin-status-item"><span>Latest health check</span><strong>{overview ? dateLabel(overview.timestamp) : '—'}</strong></div>
                  </div>
                  {!overview?.inboundConfigured && <div className="admin-message" style={{ marginTop: 16, marginBottom: 0 }}><AlertTriangle size={15} style={{ verticalAlign: 'middle', marginRight: 7 }} />Real inbound email is not configured. Configure a real domain and provider webhook before relying on message delivery.</div>}
                </div>
              </>
            )}

            {page === 'mailboxes' && (
              <div className="admin-panel">
                <div className="admin-panel-heading">
                  <div><h2>Stored mailboxes</h2><p>Inspect mailbox addresses, creation time, expiry, and message count.</p></div>
                  <button className="admin-button" onClick={() => void openPage('mailboxes')}><RefreshCw size={14} /> Refresh</button>
                </div>
                <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                  <Search size={17} style={{ marginTop: 10, color: '#8290a5', flexShrink: 0 }} />
                  <input className="admin-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search address or mailbox ID…" />
                </div>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead><tr><th>Address</th><th>Messages</th><th>Created</th><th>Expires</th><th>Action</th></tr></thead>
                    <tbody>
                      {filteredMailboxes.map(mailbox => (
                        <tr key={mailbox.id}>
                          <td><div className="admin-address">{mailbox.address}</div><small>{mailbox.id}</small></td>
                          <td>{mailbox.messageCount}</td><td>{dateLabel(mailbox.createdAt)}</td><td>{dateLabel(mailbox.expiresAt)}</td>
                          <td><button className="admin-button admin-button-danger" onClick={() => void removeMailbox(mailbox)}><Trash2 size={13} /> Delete</button></td>
                        </tr>
                      ))}
                      {!filteredMailboxes.length && <tr><td colSpan={5}>{busy ? 'Loading mailboxes…' : 'No matching mailboxes found.'}</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {page === 'domains' && (
              <>
                <div className="admin-panel">
                  <div className="admin-panel-heading">
                    <div>
                      <h2>Register a domain</h2>
                      <p>New domains start inactive and require verification and inbound readiness.</p>
                    </div>
                    <Globe size={20} />
                  </div>

                  <form onSubmit={addDomain}>
                    <label className="admin-form-label" htmlFor="new-domain">Domain name</label>
                    <input
                      id="new-domain"
                      className="admin-form-input"
                      type="text"
                      autoComplete="off"
                      placeholder="mail.example.com"
                      value={newDomain}
                      onChange={event => setNewDomain(event.target.value)}
                      maxLength={253}
                      required
                    />
                    <label className="admin-form-label" htmlFor="new-domain-notes">Administrative notes (optional)</label>
                    <textarea
                      id="new-domain-notes"
                      className="admin-form-input"
                      rows={3}
                      maxLength={2000}
                      placeholder="Provider, ownership checks, or setup notes"
                      value={newDomainNotes}
                      onChange={event => setNewDomainNotes(event.target.value)}
                    />
                    <div style={{ marginTop: 14 }}>
                      <button className="admin-button admin-button-primary" type="submit" disabled={busy}>
                        <Plus size={14} /> Register domain
                      </button>
                    </div>
                  </form>
                </div>

                <div className="admin-panel">
                  <div className="admin-panel-heading">
                    <div>
                      <h2>Registered domains</h2>
                      <p>{domains.length} registered · Public availability requires active, verified, inbound-ready status.</p>
                    </div>
                    <button className="admin-button" onClick={() => void loadData()} disabled={busy}>
                      <RefreshCw size={14} /> Refresh
                    </button>
                  </div>

                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Domain</th>
                          <th>Verification</th>
                          <th>Inbound</th>
                          <th>Activation</th>
                          <th>Created</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {domains.map(domain => (
                          <tr key={domain.id}>
                            <td>
                              <div className="admin-address">{domain.domain}</div>
                              <small>{domain.id}</small>
                            </td>
                            <td>
                              <span className={`admin-pill ${domain.verificationStatus === 'verified' ? 'ok' : 'warn'}`}>
                                {domain.verificationStatus}
                              </span>
                            </td>
                            <td>
                              <span className={`admin-pill ${domain.inboundStatus === 'ready' ? 'ok' : 'warn'}`}>
                                {domain.inboundStatus}
                              </span>
                            </td>
                            <td>
                              <span className={`admin-pill ${domain.isActive ? 'ok' : 'warn'}`}>
                                {domain.isActive ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td>{dateLabel(domain.createdAt)}</td>
                            <td>
                              <button className="admin-button" onClick={() => selectDomain(domain)}>
                                Manage
                              </button>
                            </td>
                          </tr>
                        ))}
                        {!domains.length && (
                          <tr>
                            <td colSpan={6}>{busy ? 'Loading domains…' : 'No domains registered yet.'}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {selectedDomainId && domains.some(item => item.id === selectedDomainId) && (
                  <div className="admin-panel">
                    <div className="admin-panel-heading">
                      <div>
                        <h2>Manage domain</h2>
                        <p>{domains.find(item => item.id === selectedDomainId)?.domain}</p>
                      </div>
                      <ShieldCheck size={20} />
                    </div>

                    <form onSubmit={saveDomain}>
                      <label className="admin-form-label" htmlFor="domain-verification">Verification status</label>
                      <select
                        id="domain-verification"
                        className="admin-form-input"
                        value={domainDraft.verificationStatus}
                        onChange={event => setDomainDraft(draft => ({
                          ...draft,
                          verificationStatus: event.target.value as DomainDraft['verificationStatus']
                        }))}
                      >
                        <option value="pending">Pending</option>
                        <option value="verified">Verified</option>
                        <option value="failed">Failed</option>
                      </select>

                      <label className="admin-form-label" htmlFor="domain-inbound">Inbound email status</label>
                      <select
                        id="domain-inbound"
                        className="admin-form-input"
                        value={domainDraft.inboundStatus}
                        onChange={event => setDomainDraft(draft => ({
                          ...draft,
                          inboundStatus: event.target.value as DomainDraft['inboundStatus']
                        }))}
                      >
                        <option value="pending">Pending</option>
                        <option value="ready">Ready</option>
                        <option value="failed">Failed</option>
                      </select>

                      <label className="admin-form-label" htmlFor="domain-provider">Provider reference (optional)</label>
                      <input
                        id="domain-provider"
                        className="admin-form-input"
                        value={domainDraft.providerReference}
                        maxLength={500}
                        onChange={event => setDomainDraft(draft => ({
                          ...draft, providerReference: event.target.value
                        }))}
                        placeholder="Email provider domain ID or reference"
                      />

                      <label className="admin-form-label" htmlFor="domain-admin-notes">Administrative notes</label>
                      <textarea
                        id="domain-admin-notes"
                        className="admin-form-input"
                        rows={4}
                        maxLength={2000}
                        value={domainDraft.administrativeNotes}
                        onChange={event => setDomainDraft(draft => ({
                          ...draft, administrativeNotes: event.target.value
                        }))}
                        placeholder="Ownership, DNS checks, provider setup, and operational notes"
                      />

                      <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18, fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={domainDraft.isActive}
                          onChange={event => setDomainDraft(draft => ({
                            ...draft, isActive: event.target.checked
                          }))}
                        />
                        Activate this domain for public mailbox creation
                      </label>
                      <p className="admin-footer">
                        Activation is rejected unless verification is verified and inbound email is ready.
                        Mark inbound ready only after testing the real provider configuration.
                      </p>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
                        <button className="admin-button admin-button-primary" type="submit" disabled={busy}>
                          <Save size={14} /> Save changes
                        </button>
                        <button className="admin-button" type="button" onClick={() => setSelectedDomainId('')}>
                          Cancel
                        </button>
                        <button
                          className="admin-button admin-button-danger"
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            const selected = domains.find(item => item.id === selectedDomainId);
                            if (selected) void deleteDomain(selected);
                          }}
                        >
                          <Trash2 size={14} /> Delete domain
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </>
            )}

            {page === 'services' && (
              <div className="admin-panel">
                <div className="admin-panel-heading"><div><h2>API & service diagnostics</h2><p>Configuration values reported by the running API.</p></div><button className="admin-button" onClick={() => void loadData()} disabled={busy}><RefreshCw size={14} /> Refresh</button></div>
                <div className="admin-status-list">
                  <div className="admin-status-item"><span>API health</span><span className="admin-pill ok">{status?.api || 'Checking'}</span></div>
                  <div className="admin-status-item"><span>Storage type</span><strong>{status?.storage || '—'}</strong></div>
                  <div className="admin-status-item"><span>Mailbox domain</span><strong>{status?.domain || '—'}</strong></div>
                  <div className="admin-status-item"><span>Mailbox TTL</span><strong>{status ? `${status.mailboxTtlMinutes} minutes` : '—'}</strong></div>
                  <div className="admin-status-item"><span>Inbound webhook</span><span className={`admin-pill ${status?.inboundConfigured ? 'ok' : 'warn'}`}>{status?.inboundConfigured ? 'Configured' : 'Disabled'}</span></div>
                  <div className="admin-status-item"><span>Admin session expires</span><strong>{status ? dateLabel(status.adminSessionExpiresAt) : '—'}</strong></div>
                  <div className="admin-status-item"><span>Last status check</span><strong>{status ? dateLabel(status.timestamp) : '—'}</strong></div>
                </div>
                <p className="admin-footer">Domain, TTL, and webhook settings are read from server configuration. This screen does not silently change production environment variables.</p>
              </div>
            )}
            <div className="admin-footer">FactorMailService · Administrative access · Data refreshes on demand.</div>
          </section>
        </div>
      </div>
    </main>
  );
}
