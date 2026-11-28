import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Calculator,
  ChevronRight,
  FolderArchive,
  MapPin,
  Plus,
  Search,
  User,
  Users,
} from 'lucide-react';
import type { Customer, CustomerStatus } from './types/customer';
import {
  deleteCustomer,
  getAllCustomers,
  resolveMediaUrl,
  seedDemoCustomerIfNeeded,
  upsertCustomer,
} from './services/db';
import { exportAllDataAsZip, triggerBlobDownload } from './services/backup';
import { appendSecurityLog, loadSecurityPrefs } from './services/security';
import { SecurityGate, SecuritySettingsScreen } from './components/SecurityGate';
import { EmiCalculator } from './components/EmiCalculator';
import { BackupSettings } from './components/BackupSettings';
import { CustomerFormModal } from './components/CustomerFormModal';
import { CustomerProfileView } from './components/CustomerProfileView';

type ActiveView = 'dashboard' | 'emi' | 'backup' | 'security';

export function App() {
  const [securityPassed, setSecurityPassed] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeView, setActiveView] = useState<ActiveView>('dashboard');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [avatarUrls, setAvatarUrls] = useState<Record<number, string>>({});
  const [exportingZip, setExportingZip] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  const lastActivityRef = useRef<number>(Date.now());

  // Route the physical Android Back button through the app's screen stack.
  useEffect(() => {
    const handleAndroidBack = (event: Event) => {
      if (showExitConfirm) {
        event.preventDefault();
        setShowExitConfirm(false);
      } else if (showForm) {
        event.preventDefault();
        setShowForm(false);
        setEditingCustomer(null);
      } else if (selectedId !== null) {
        // Safety fallback: never let Android close the app while a customer is open.
        event.preventDefault();
        event.stopImmediatePropagation();
        setSelectedId(null);
      } else if (activeView !== 'dashboard') {
        event.preventDefault();
        setActiveView('dashboard');
      } else {
        // On the dashboard, ask before allowing Android to close the app.
        event.preventDefault();
        setShowExitConfirm(true);
      }
    };
    window.addEventListener('androidback', handleAndroidBack);
    return () => window.removeEventListener('androidback', handleAndroidBack);
  }, [activeView, selectedId, showForm, showExitConfirm]);

  const loadCustomers = useCallback(async () => {
    await seedDemoCustomerIfNeeded();
    const list = await getAllCustomers();
    setCustomers(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  // Resolve customer avatars for list
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      customers
        .filter((c) => Boolean(c.photoUri))
        .map(async (c) => {
          const res = await resolveMediaUrl(c.photoUri);
          return res ? ([c.id, res.url] as const) : null;
        })
    ).then((entries) => {
      if (cancelled) return;
      const map: Record<number, string> = {};
      entries.forEach((e) => {
        if (e) map[e[0]] = e[1];
      });
      setAvatarUrls(map);
    });
    return () => {
      cancelled = true;
    };
  }, [customers]);

  // Background lock and inactivity auto-lock matching MainActivity.kt
  useEffect(() => {
    if (!securityPassed) return;

    const markActivity = () => {
      lastActivityRef.current = Date.now();
    };
    window.addEventListener('pointerdown', markActivity);
    window.addEventListener('keydown', markActivity);

    const onVisibility = () => {
      const prefs = loadSecurityPrefs();
      if (!prefs.configured) return;
      if (document.visibilityState === 'hidden') {
        lastActivityRef.current = Date.now();
      } else if (document.visibilityState === 'visible') {
        const elapsed = Date.now() - lastActivityRef.current;
        if (
          prefs.backgroundLock ||
          (prefs.autoLockMinutes > 0 && elapsed >= prefs.autoLockMinutes * 60_000)
        ) {
          setSecurityPassed(false);
          appendSecurityLog('App locked after background');
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const interval = window.setInterval(() => {
      const prefs = loadSecurityPrefs();
      if (
        prefs.configured &&
        prefs.autoLockMinutes > 0 &&
        Date.now() - lastActivityRef.current >= prefs.autoLockMinutes * 60_000
      ) {
        setSecurityPassed(false);
        appendSecurityLog('App auto-locked after inactivity');
      }
    }, 15_000);

    return () => {
      window.removeEventListener('pointerdown', markActivity);
      window.removeEventListener('keydown', markActivity);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(interval);
    };
  }, [securityPassed]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedId) ?? null,
    [customers, selectedId]
  );

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || c.mobile.toLowerCase().includes(q)
    );
  }, [customers, search]);

  const pendingCount = customers.filter((c) => c.status.toLowerCase() === 'pending').length;
  const approvedCount = customers.filter((c) => c.status.toLowerCase() === 'approved').length;
  const rejectedCount = customers.filter(
    (c) => c.status.toLowerCase() === 'reject' || c.status.toLowerCase() === 'rejected'
  ).length;
  const totalStatus = Math.max(1, pendingCount + approvedCount + rejectedCount);

  const handleSaveCustomer = async (draft: Omit<Customer, 'id'> & { id?: number }) => {
    const saved = await upsertCustomer(draft);
    await loadCustomers();
    if (selectedId !== null) setSelectedId(saved.id);
    setShowForm(false);
    setEditingCustomer(null);
  };

  const handleUpdateCustomer = async (updated: Customer) => {
    await upsertCustomer(updated);
    setCustomers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  const handleStatusChange = async (customer: Customer, status: CustomerStatus) => {
    const updated = { ...customer, status };
    await handleUpdateCustomer(updated);
  };

  const handleDeleteCustomer = async (id: number) => {
    await deleteCustomer(id);
    setSelectedId(null);
    await loadCustomers();
  };

  const handleExportAllZip = async () => {
    if (exportingZip) return;
    setExportingZip(true);
    try {
      const result = await exportAllDataAsZip();
      triggerBlobDownload(result.blob, result.fileName);
    } finally {
      setExportingZip(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F1FC] text-[#211936]">
      {/* Top Navigation Bar (Clean 3-zone contract) */}
      <header className="sticky top-0 z-30 bg-white border-b border-[#E3D9F4]">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => {
              setSelectedId(null);
              setActiveView('dashboard');
            }}
            className="text-lg font-bold tracking-tight text-[#211936] whitespace-nowrap shrink-0"
          >
            Customer Manager
          </button>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#625A78]">
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setActiveView('dashboard');
              }}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-[#211936] ${
                activeView === 'dashboard' ? 'text-[#7042C1] font-semibold' : ''
              }`}
            >
              Customers
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setActiveView('emi');
              }}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-[#211936] ${
                activeView === 'emi' ? 'text-[#7042C1] font-semibold' : ''
              }`}
            >
              EMI Calculator
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setActiveView('backup');
              }}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-[#211936] ${
                activeView === 'backup' ? 'text-[#7042C1] font-semibold' : ''
              }`}
            >
              Backup & Restore
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setActiveView('security');
              }}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-[#211936] ${
                activeView === 'security' ? 'text-[#7042C1] font-semibold' : ''
              }`}
            >
              Security
            </button>
          </nav>

          <button
            type="button"
            onClick={() => {
              setEditingCustomer(null);
              setShowForm(true);
            }}
            className="px-4 py-2 rounded-xl bg-[#7042C1] hover:bg-[#5E35A8] text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Customer
          </button>
        </div>

        {/* Mobile navigation row */}
        <div className="md:hidden flex items-center gap-4 px-6 pb-2.5 text-xs font-semibold text-[#625A78] overflow-x-auto">
          <button
            type="button"
            onClick={() => {
              setSelectedId(null);
              setActiveView('dashboard');
            }}
            className={`whitespace-nowrap ${activeView === 'dashboard' ? 'text-[#7042C1]' : ''}`}
          >
            Customers
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedId(null);
              setActiveView('emi');
            }}
            className={`whitespace-nowrap ${activeView === 'emi' ? 'text-[#7042C1]' : ''}`}
          >
            EMI Calculator
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedId(null);
              setActiveView('backup');
            }}
            className={`whitespace-nowrap ${activeView === 'backup' ? 'text-[#7042C1]' : ''}`}
          >
            Backup
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedId(null);
              setActiveView('security');
            }}
            className={`whitespace-nowrap ${activeView === 'security' ? 'text-[#7042C1]' : ''}`}
          >
            Security
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-6">
        {activeView === 'security' ? (
          <SecuritySettingsScreen
            onBack={() => setActiveView('dashboard')}
            onLockNow={() => setSecurityPassed(false)}
          />
        ) : activeView === 'backup' ? (
          <BackupSettings
            onBack={() => setActiveView('dashboard')}
            onRestored={loadCustomers}
          />
        ) : activeView === 'emi' ? (
          <EmiCalculator onBack={() => setActiveView('dashboard')} />
        ) : selectedCustomer ? (
          <CustomerProfileView
            customer={selectedCustomer}
            onBack={() => setSelectedId(null)}
            onEdit={() => {
              setEditingCustomer(selectedCustomer);
              setShowForm(true);
            }}
            onDelete={() => handleDeleteCustomer(selectedCustomer.id)}
            onCustomerUpdate={handleUpdateCustomer}
          />
        ) : (
          <div className="space-y-6">
            {/* Overview + EMI Calculator Row */}
            <div className="grid lg:grid-cols-12 gap-5 items-stretch">
              <div className="lg:col-span-8 bg-white rounded-[22px] border border-[#E3D9F4] p-6 flex flex-col justify-between gap-4">
                <div>
                  <p className="text-[11px] font-bold tracking-wider text-[#77718A]">
                    CUSTOMER OVERVIEW
                  </p>
                  <div className="flex items-baseline gap-3 mt-1">
                    <span className="text-4xl font-bold font-mono-nums text-[#211936]">
                      {customers.length}
                    </span>
                    <span className="text-sm text-[#625A78]">
                      Total customers saved on this device
                    </span>
                  </div>
                </div>

                {/* Segmented Bar */}
                <div className="flex w-full h-2.5 gap-1.5 rounded-full overflow-hidden">
                  {pendingCount + approvedCount + rejectedCount === 0 ? (
                    <div className="w-full bg-[#E5E7EB] rounded-full" />
                  ) : (
                    <>
                      {pendingCount > 0 && (
                        <div
                          className="bg-[#E5A52E] rounded-full"
                          style={{ width: `${(pendingCount / totalStatus) * 100}%` }}
                        />
                      )}
                      {approvedCount > 0 && (
                        <div
                          className="bg-[#25A879] rounded-full"
                          style={{ width: `${(approvedCount / totalStatus) * 100}%` }}
                        />
                      )}
                      {rejectedCount > 0 && (
                        <div
                          className="bg-[#D94B59] rounded-full"
                          style={{ width: `${(rejectedCount / totalStatus) * 100}%` }}
                        />
                      )}
                    </>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-4 pt-1">
                  <div>
                    <p className="text-xs font-medium text-[#9A6A12]">Pending</p>
                    <p className="text-xl font-bold font-mono-nums text-[#211936]">
                      {pendingCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-[#16845F]">Approved</p>
                    <p className="text-xl font-bold font-mono-nums text-[#211936]">
                      {approvedCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-[#C43F4C]">Rejected</p>
                    <p className="text-xl font-bold font-mono-nums text-[#211936]">
                      {rejectedCount}
                    </p>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveView('emi')}
                className="lg:col-span-4 bg-white/90 hover:bg-white rounded-[22px] border border-[#E3D9F4] p-6 text-left flex flex-col justify-between gap-4 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="w-11 h-11 rounded-2xl bg-[#EDE5FA] text-[#8B5CF6] flex items-center justify-center">
                    <Calculator className="w-6 h-6" />
                  </div>
                  <ChevronRight className="w-5 h-5 text-[#77718A]" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#211936]">EMI Calculator</h3>
                  <p className="text-xs text-[#77718A] mt-1">
                    Calculate monthly EMI, interest & total payment in English or Gujarati
                  </p>
                </div>
              </button>
            </div>

            {/* Search & Customers List */}
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-[#211936]">Customers</h2>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:w-72">
                    <Search className="w-4 h-4 text-[#77718A] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search name or mobile number"
                      className="w-full pl-10 pr-4 py-2 rounded-2xl bg-white border border-[#E3D9F4] text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={exportingZip}
                    onClick={handleExportAllZip}
                    title="Download all customer data, documents, photos & folders as ZIP"
                    className="px-3 py-2 rounded-2xl bg-white hover:bg-[#F0EAFB] border border-[#E3D9F4] text-[#7042C1] text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50 transition-colors"
                  >
                    <FolderArchive className="w-4 h-4" />
                    {exportingZip ? 'Zipping…' : 'Export ZIP'}
                  </button>
                </div>
              </div>

              {loading ? (
                <div className="space-y-2.5">
                  {[1, 2, 3].map((n) => (
                    <div
                      key={n}
                      className="h-20 rounded-2xl bg-white/70 border border-[#E3D9F4] animate-pulse"
                    />
                  ))}
                </div>
              ) : filteredCustomers.length === 0 ? (
                <div className="bg-white rounded-[22px] border border-[#E3D9F4] py-14 px-6 text-center space-y-2">
                  <Users className="w-11 h-11 text-[#C4B9DB] mx-auto" />
                  <p className="text-sm font-semibold text-[#625A78]">
                    {search ? 'No matching customers' : 'No customers yet'}
                  </p>
                  <p className="text-xs text-[#77718A]">
                    Click Add Customer to create your first applicant profile.
                  </p>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-2">
                  {filteredCustomers.map((c) => {
                    let city = '';
                    let customerId = '';
                    let loanId = '';
                    try {
                      const parsed = JSON.parse(c.applicationDetails || '{}');
                      city = parsed.villageCity || '';
                      customerId = typeof parsed.customerId === 'string' ? parsed.customerId.trim() : '';
                      loanId = typeof parsed.loanId === 'string' ? parsed.loanId.trim() : '';
                    } catch {
                      city = '';
                    }
                    const avatar = avatarUrls[c.id];
                    const statusStyle =
                      c.status === 'Approved'
                        ? 'text-[#16845F] bg-[#ECFDF5] border-[#A7F3D0]'
                        : c.status === 'Reject'
                          ? 'text-[#C43F4C] bg-[#FEF2F2] border-[#FECACA]'
                          : 'text-[#9A6A12] bg-[#FFFBEB] border-[#FDE68A]';

                    return (
                      <div
                        key={c.id}
                        onClick={() => setSelectedId(c.id)}
                        className="bg-white rounded-xl border border-[#E3D9F4] hover:border-[#7042C1]/50 px-3 py-2 flex items-center gap-2.5 cursor-pointer transition-colors"
                      >
                        <div className="w-9 h-9 rounded-lg bg-[#E9ECF2] text-[#7042C1] overflow-hidden flex items-center justify-center shrink-0">
                          {avatar ? (
                            <img src={avatar} alt={c.name} className="w-full h-full object-cover" />
                          ) : (
                            <User className="w-4 h-4" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0 leading-tight">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold text-[13px] text-[#211936] truncate">
                              {c.name}
                            </p>
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1 shrink-0"
                            >
                              <select
                                value={c.status}
                                onChange={(e) =>
                                  handleStatusChange(c, e.target.value as CustomerStatus)
                                }
                                aria-label={`Status for ${c.name}`}
                                className={`px-1.5 py-0.5 rounded-md border text-[11px] font-semibold focus:outline-none cursor-pointer ${statusStyle}`}
                              >
                                <option value="Pending">Pending</option>
                                <option value="Approved">Approved</option>
                                <option value="Reject">Reject</option>
                              </select>
                              <ChevronRight className="w-3.5 h-3.5 text-[#77718A]" />
                            </div>
                          </div>

                          {c.status === 'Approved' && (
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0 text-[10.5px] font-medium text-[#16845F] mt-0.5">
                              <span>
                                Customer ID:{' '}
                                <span className="font-mono-nums font-semibold">
                                  {customerId || '—'}
                                </span>
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>
                                Loan ID:{' '}
                                <span className="font-mono-nums font-semibold">
                                  {loanId || '—'}
                                </span>
                              </span>
                            </div>
                          )}

                          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0 text-[11px] text-[#77718A] mt-0.5 truncate">
                            <span className="font-semibold text-[#8B5CF6]">
                              {c.loanType || 'Loan type not set'}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono-nums">{c.mobile}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono-nums">
                              {c.loanAmount || 'Amount not set'}
                            </span>
                            {city && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="inline-flex items-center gap-0.5 truncate">
                                  <MapPin className="w-2.5 h-2.5 shrink-0" />
                                  {city}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Add / Edit Customer Form Modal */}
      {showForm && (
        <CustomerFormModal
          initial={editingCustomer}
          onDismiss={() => {
            setShowForm(false);
            setEditingCustomer(null);
          }}
          onSave={handleSaveCustomer}
        />
      )}

      {showExitConfirm && (
        <div className="fixed inset-0 z-[100] bg-black/55 flex items-center justify-center p-5" role="dialog" aria-modal="true" aria-labelledby="exit-confirm-title">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <h2 id="exit-confirm-title" className="text-base font-bold text-[#211936]">Exit Customer Manager?</h2>
            <p className="mt-2 text-sm text-[#625A78]">Are you sure you want to close the app?</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowExitConfirm(false)} className="px-4 py-2 rounded-xl border border-[#E3D9F4] text-sm font-semibold text-[#625A78]">Cancel</button>
              <button type="button" onClick={() => {
                const nativeApp = (window as Window & { AndroidApp?: { exitApp?: () => void } }).AndroidApp;
                if (nativeApp?.exitApp) nativeApp.exitApp();
                else setShowExitConfirm(false);
              }} className="px-4 py-2 rounded-xl bg-[#7042C1] text-sm font-semibold text-white">Exit</button>
            </div>
          </div>
        </div>
      )}

      {/* Security Gate Overlay (keeps workspace state mounted beneath lock screen) */}
      {!securityPassed && <SecurityGate onUnlocked={() => setSecurityPassed(true)} />}
    </div>
  );
}

export default App;
