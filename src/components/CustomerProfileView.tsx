import React, { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  ClipboardList,
  Download,
  Edit3,
  FileSpreadsheet,
  Film,
  Grid,
  Image as ImageIcon,
  List,
  Plus,
  Share2,
  SlidersHorizontal,
  StickyNote,
  Trash2,
  User,
  Video,
} from 'lucide-react';
import type {
  ApplicationDetails,
  CoApplicantData,
  Customer,
  CustomerStatus,
} from '../types/customer';
import {
  deleteMediaRecord,
  getMediaRecord,
  resolveMediaUrl,
  saveMediaBlob,
} from '../services/db';
import { exportCustomerProfilePdf } from '../services/pdfExport';
import { triggerBlobDownload } from '../services/backup';
import { CustomerChecklist } from './CustomerChecklist';
import { GpsCameraModal } from './GpsCameraModal';
import { ProfilePhotoCropModal } from './ProfilePhotoCropModal';
import {
  DocumentViewerModal,
  PhotoViewerModal,
  VideoViewerModal,
} from './MediaViewers';

interface CustomerProfileViewProps {
  customer: Customer;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  onCustomerUpdate: (updated: Customer) => Promise<void>;
}

const PROFILE_TABS = [
  { id: 0, label: 'Application', icon: User },
  { id: 1, label: 'Photos', icon: ImageIcon },
  { id: 2, label: 'Videos', icon: Video },
  { id: 3, label: 'Documents', icon: ClipboardList },
  { id: 4, label: 'Notes', icon: StickyNote },
];

const VISIBLE_TABS_KEY = 'customer_manager_visible_tabs';

export const CustomerProfileView: React.FC<CustomerProfileViewProps> = ({
  customer,
  onBack,
  onEdit,
  onDelete,
  onCustomerUpdate,
}) => {
  const [visibleTabs, setVisibleTabs] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem(VISIBLE_TABS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as number[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    return [0, 1, 2, 3, 4];
  });

  const [profileTab, setProfileTab] = useState(0);
  const [navExpanded, setNavExpanded] = useState(true);
  const [showNavSettings, setShowNavSettings] = useState(false);

  // Application profile person tab
  const [selectedPersonIdx, setSelectedPersonIdx] = useState(0);

  // Media state
  const [gridMode, setGridMode] = useState(true);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);
  const [selectedVideos, setSelectedVideos] = useState<string[]>([]);
  const [showDeleteMediaConfirm, setShowDeleteMediaConfirm] = useState(false);
  const [showDeleteCustomerConfirm, setShowDeleteCustomerConfirm] = useState(false);

  // Camera & photo crop modals
  const [showPhotoCrop, setShowPhotoCrop] = useState(false);
  const [showGpsCamera, setShowGpsCamera] = useState(false);
  const [gpsCameraVideoMode, setGpsCameraVideoMode] = useState(false);

  // Viewers
  const [photoViewerState, setPhotoViewerState] = useState<{
    urls: string[];
    index: number;
  } | null>(null);
  const [videoViewerUrl, setVideoViewerUrl] = useState<string | null>(null);
  const [docViewerState, setDocViewerState] = useState<{
    url: string;
    mimeType: string;
    name: string;
  } | null>(null);

  // Notes state
  const [noteDraft, setNoteDraft] = useState(customer.notes);
  const [noteSavedToast, setNoteSavedToast] = useState('');

  // Resolved URLs map for idb:// media
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, { url: string; name: string }>>({});
  const attachInputRef = useRef<HTMLInputElement | null>(null);

  // Capture the device Back event before the app-level fallback handler.
  useEffect(() => {
    const handleAndroidBack = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (docViewerState) setDocViewerState(null);
      else if (videoViewerUrl) setVideoViewerUrl(null);
      else if (photoViewerState) setPhotoViewerState(null);
      else if (showGpsCamera) setShowGpsCamera(false);
      else if (showPhotoCrop) setShowPhotoCrop(false);
      else if (showNavSettings) setShowNavSettings(false);
      else if (showDeleteMediaConfirm) setShowDeleteMediaConfirm(false);
      else if (showDeleteCustomerConfirm) setShowDeleteCustomerConfirm(false);
      else if (selectionMode) {
        setSelectionMode(false);
        setSelectedPhotos([]);
        setSelectedVideos([]);
      } else if (selectedPersonIdx > 0) setSelectedPersonIdx(0);
      else if (profileTab !== 0) setProfileTab(0);
      else onBack();
    };
    window.addEventListener('androidback', handleAndroidBack, true);
    return () => window.removeEventListener('androidback', handleAndroidBack, true);
  }, [docViewerState, videoViewerUrl, photoViewerState, showGpsCamera, showPhotoCrop, showNavSettings, showDeleteMediaConfirm, showDeleteCustomerConfirm, selectionMode, selectedPersonIdx, profileTab, onBack]);

  useEffect(() => {
    setNoteDraft(customer.notes);
    setSelectedPersonIdx(0);
  }, [customer.id, customer.notes]);

  useEffect(() => {
    setSelectionMode(false);
    setSelectedPhotos([]);
    setSelectedVideos([]);
  }, [customer.id, profileTab]);

  const photoList = useMemo(
    () => customer.photos.split('|').filter(Boolean),
    [customer.photos]
  );
  const videoList = useMemo(
    () => customer.videos.split('|').filter(Boolean),
    [customer.videos]
  );

  // Resolve all media URLs for avatar, photos, and videos
  useEffect(() => {
    const uris = [customer.photoUri, ...photoList, ...videoList].filter(Boolean);
    let cancelled = false;
    Promise.all(
      uris.map(async (uri) => {
        const res = await resolveMediaUrl(uri);
        return res ? ([uri, { url: res.url, name: res.name }] as const) : null;
      })
    ).then((entries) => {
      if (cancelled) return;
      const map: Record<string, { url: string; name: string }> = {};
      entries.forEach((e) => {
        if (e) map[e[0]] = e[1];
      });
      setResolvedUrls(map);
    });
    return () => {
      cancelled = true;
    };
  }, [customer.photoUri, photoList, videoList]);

  const details: ApplicationDetails = useMemo(() => {
    try {
      return JSON.parse(customer.applicationDetails || '{}');
    } catch {
      return {};
    }
  }, [customer.applicationDetails]);

  const coApplicants: CoApplicantData[] = useMemo(() => {
    try {
      const arr = JSON.parse(customer.coApplicantsJson || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }, [customer.coApplicantsJson]);

  const mediaSubTab = profileTab === 2 ? 1 : 0; // 0 = Photos, 1 = Videos
  const activeMediaFiles = mediaSubTab === 0 ? photoList : videoList;
  const activeSelectedMedia = mediaSubTab === 0 ? selectedPhotos : selectedVideos;

  const toggleMediaSelection = (uri: string) => {
    if (mediaSubTab === 0) {
      setSelectedPhotos((prev) =>
        prev.includes(uri) ? prev.filter((x) => x !== uri) : [...prev, uri]
      );
    } else {
      setSelectedVideos((prev) =>
        prev.includes(uri) ? prev.filter((x) => x !== uri) : [...prev, uri]
      );
    }
  };

  const handleAttachMedia = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const incoming: string[] = [];
    for (const file of Array.from(files)) {
      const uri = await saveMediaBlob(file, file.name, file.type);
      incoming.push(uri);
    }
    if (mediaSubTab === 0) {
      const next = Array.from(new Set([...photoList, ...incoming])).join('|');
      await onCustomerUpdate({ ...customer, photos: next });
    } else {
      const next = Array.from(new Set([...videoList, ...incoming])).join('|');
      await onCustomerUpdate({ ...customer, videos: next });
    }
    e.target.value = '';
  };

  const handleDownloadSelectedMedia = async () => {
    if (activeSelectedMedia.length === 0) return;
    if (activeSelectedMedia.length === 1) {
      const rec = await getMediaRecord(activeSelectedMedia[0]);
      if (rec) triggerBlobDownload(rec.blob, rec.name);
      return;
    }
    const zip = new JSZip();
    for (let i = 0; i < activeSelectedMedia.length; i++) {
      const rec = await getMediaRecord(activeSelectedMedia[i]);
      if (rec) {
        zip.file(`${i + 1}_${rec.name}`, rec.blob);
      }
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    triggerBlobDownload(zipBlob, `CustomerMedia_${Date.now()}.zip`);
  };

  const handleShareSelectedMedia = async () => {
    if (activeSelectedMedia.length === 0) return;
    const files: File[] = [];
    for (const uri of activeSelectedMedia) {
      const rec = await getMediaRecord(uri);
      if (rec) {
        files.push(new File([rec.blob], rec.name, { type: rec.mimeType }));
      }
    }
    if (files.length > 0 && navigator.canShare && navigator.canShare({ files })) {
      try {
        await navigator.share({
          files,
          title: `${customer.name} Media`,
        });
        return;
      } catch {
        // fallback to download
      }
    }
    await handleDownloadSelectedMedia();
  };

  const handleDeleteSelectedPhotos = async () => {
    const toDelete = new Set(selectedPhotos);
    for (const uri of toDelete) {
      await deleteMediaRecord(uri);
    }
    const remaining = photoList.filter((u) => !toDelete.has(u)).join('|');
    await onCustomerUpdate({ ...customer, photos: remaining });
    setSelectedPhotos([]);
    setSelectionMode(false);
    setShowDeleteMediaConfirm(false);
  };

  const handleSaveNotes = async () => {
    await onCustomerUpdate({ ...customer, notes: noteDraft.trim() });
    setNoteSavedToast('Notes saved');
    window.setTimeout(() => setNoteSavedToast(''), 2500);
  };

  const handleShareNotes = async () => {
    const fileName = `${customer.name || 'Customer'}-notes.txt`;
    const blob = new Blob([noteDraft], { type: 'text/plain;charset=utf-8' });
    if (navigator.share) {
      try {
        await navigator.share({ title: fileName, text: noteDraft });
        return;
      } catch {
        // fallback to download
      }
    }
    triggerBlobDownload(blob, fileName);
  };

  const avatarUrl = customer.photoUri ? resolvedUrls[customer.photoUri]?.url : undefined;

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-xl bg-white border border-[#E3D9F4] text-[#7042C1] hover:bg-[#F0EAFB]"
            aria-label="Back to customers"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl font-bold text-[#211936]">Customer Profile</h2>
            <p className="text-xs text-[#77718A]">Customer details & records</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => exportCustomerProfilePdf(customer)}
            className="px-3.5 py-2 rounded-xl bg-white border border-[#E3D9F4] text-[#7042C1] text-xs font-semibold hover:bg-[#F0EAFB] flex items-center gap-1.5 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Export PDF
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="px-3.5 py-2 rounded-xl bg-[#7042C1] text-white text-xs font-semibold hover:bg-[#5E35A8] flex items-center gap-1.5 whitespace-nowrap"
          >
            <Edit3 className="w-4 h-4" />
            Edit
          </button>
          <button
            type="button"
            onClick={() => setShowDeleteCustomerConfirm(true)}
            className="p-2 rounded-xl bg-white border border-[#FECACA] text-[#B3261E] hover:bg-[#FEF2F2]"
            title="Delete customer"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Profile Header Summary Card */}
      <div className="bg-white rounded-[22px] border border-[#E3D9F4] p-5 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => setShowPhotoCrop(true)}
          className="w-[72px] h-[72px] rounded-[18px] bg-[#E8EFFD] text-[#7042C1] overflow-hidden flex items-center justify-center shrink-0 hover:ring-2 hover:ring-[#7042C1] transition-all"
          title="Update profile photo"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt={customer.name} className="w-full h-full object-cover" />
          ) : (
            <Camera className="w-7 h-7" />
          )}
        </button>

        <div className="flex-1 min-w-[200px] space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xl font-bold text-[#211936] truncate">{customer.name}</h3>
            <select
              value={customer.status}
              onChange={(e) =>
                onCustomerUpdate({
                  ...customer,
                  status: e.target.value as CustomerStatus,
                })
              }
              aria-label={`File status for ${customer.name}`}
              className={`px-2.5 py-1 rounded-lg border text-xs font-semibold focus:outline-none cursor-pointer ${
                customer.status === 'Approved'
                  ? 'text-[#16845F] bg-[#ECFDF5] border-[#A7F3D0]'
                  : customer.status === 'Reject'
                    ? 'text-[#C43F4C] bg-[#FEF2F2] border-[#FECACA]'
                    : 'text-[#9A6A12] bg-[#FFFBEB] border-[#FDE68A]'
              }`}
            >
              <option value="Pending">Pending</option>
              <option value="Approved">Approved</option>
              <option value="Reject">Reject</option>
            </select>
          </div>
          {customer.status === 'Approved' && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs font-medium text-[#16845F]">
              <span>
                Customer ID:{' '}
                <span className="font-mono-nums font-semibold">
                  {details.customerId?.trim() || '—'}
                </span>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Loan ID:{' '}
                <span className="font-mono-nums font-semibold">
                  {details.loanId?.trim() || '—'}
                </span>
              </span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#77718A]">
            <span>Loan: {customer.loanType || '—'}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-nums">Amount: {customer.loanAmount || '—'}</span>
            <span aria-hidden="true">·</span>
            <span>Village: {details.villageCity || '—'}</span>
          </div>
        </div>
      </div>

      {/* Workspace Split: Customizable Left Navigation Rail + Content */}
      <div className="flex flex-col md:flex-row gap-4 items-start">
        <aside
          className={`bg-white/85 rounded-2xl border border-[#E3D9F4] p-2 shrink-0 flex md:flex-col gap-1 overflow-x-auto w-full ${
            navExpanded ? 'md:w-44' : 'md:w-16'
          } transition-all`}
        >
          <div className="flex md:flex-col gap-1 w-full">
            <div className="flex items-center justify-between px-2 py-1.5">
              {navExpanded && (
                <span className="hidden md:inline text-[10px] font-bold tracking-wider text-[#77718A]">
                  MENU
                </span>
              )}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowNavSettings(true)}
                  className="p-1.5 rounded-lg text-[#7042C1] hover:bg-[#F0EAFB]"
                  title="Customize navigation"
                >
                  <SlidersHorizontal className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setNavExpanded((v) => !v)}
                  className="hidden md:inline-flex p-1.5 rounded-lg text-[#77718A] hover:bg-[#F0EAFB]"
                  title="Toggle menu labels"
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>

            {PROFILE_TABS.filter((t) => visibleTabs.includes(t.id)).map((tab) => {
              const Icon = tab.icon;
              const active = profileTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setProfileTab(tab.id)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-[#7042C1] text-white'
                      : 'text-[#625A78] hover:bg-[#F0EAFB] hover:text-[#211936]'
                  } ${!navExpanded ? 'md:justify-center md:px-0' : ''}`}
                  title={tab.label}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className={navExpanded ? 'inline' : 'md:hidden'}>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Main Content Viewport */}
        <div className="flex-1 w-full min-w-0">
          {profileTab === 0 && (
            <div className="space-y-4">
              <div className="bg-white rounded-[22px] border border-[#E3D9F4] p-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] font-bold text-[#8B5CF6] tracking-wider">
                    APPLICATION PROFILE
                  </p>
                  <h4 className="text-lg font-bold text-[#211936]">Applicant & family details</h4>
                </div>
                <span className="text-xs font-bold font-mono-nums text-[#8B5CF6]">
                  {coApplicants.length + 1} Members
                </span>
              </div>

              {/* Person Selector Tabs */}
              <div className="flex items-center gap-2 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setSelectedPersonIdx(0)}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                    selectedPersonIdx === 0
                      ? 'bg-[#7042C1] text-white'
                      : 'bg-white border border-[#E3D9F4] text-[#625A78]'
                  }`}
                >
                  Applicant
                </button>
                {coApplicants.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedPersonIdx(idx + 1)}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                      selectedPersonIdx === idx + 1
                        ? 'bg-[#7042C1] text-white'
                        : 'bg-white border border-[#E3D9F4] text-[#625A78]'
                    }`}
                  >
                    Co-applicant {idx + 1}
                  </button>
                ))}
              </div>

              <div className="bg-[#EFEAF9] rounded-[22px] border border-[#E3D9F4] p-6 space-y-4">
                {selectedPersonIdx === 0 ? (
                  <>
                    <div>
                      <h5 className="text-xl font-bold text-[#211936]">{customer.name}</h5>
                      <p className="text-xs font-semibold text-[#8B5CF6]">Primary Applicant</p>
                    </div>
                    <div className="border-t border-[#DCD2F0] pt-3 divide-y divide-[#E3D9F4]">
                      <ProfileRow label="Relationship" value={details.relationship} />
                      <ProfileRow label="Mobile Number" value={customer.mobile} mono />
                      <ProfileRow label="Address" value={customer.address} />
                      <ProfileRow label="Work Status" value={details.workStatus} />
                      {details.workStatus && details.workStatus !== 'Not Working' && (
                        <>
                          <ProfileRow label="Business" value={details.business} />
                          <ProfileRow label="Salary" value={details.salary} mono />
                          <ProfileRow label="Salary Mode" value={details.salaryMode} />
                        </>
                      )}
                      <ProfileRow label="Email" value={details.email} />
                    </div>
                    <div className="border-t border-[#DCD2F0] pt-3">
                      <p className="text-sm font-bold text-[#211936] mb-1">Bank Account Details</p>
                      <div className="divide-y divide-[#E3D9F4]">
                        <ProfileRow label="Account Holder Name" value={details.accountHolderName} />
                        <ProfileRow label="Account Number" value={details.bankAccountNumber} mono />
                        <ProfileRow label="Bank Name" value={details.bankName} />
                        <ProfileRow label="IFSC Code" value={details.ifsc} mono />
                        <ProfileRow label="Branch Name" value={details.bankBranch} />
                        <ProfileRow label="Cheque Available" value={details.checkAvailable} />
                      </div>
                    </div>
                    <div className="border-t border-[#DCD2F0] pt-3">
                      <p className="text-sm font-bold text-[#211936] mb-1">Household & Loan</p>
                      <div className="divide-y divide-[#E3D9F4]">
                        <ProfileRow label="Total Members at Home" value={details.totalMembers} mono />
                        <ProfileRow label="Loan Type" value={customer.loanType} />
                        <ProfileRow label="Loan Amount" value={customer.loanAmount} mono />
                        {customer.status === 'Approved' && (
                          <>
                            <ProfileRow label="Customer ID" value={details.customerId} mono />
                            <ProfileRow label="Loan ID" value={details.loanId} mono />
                          </>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  (() => {
                    const p = coApplicants[selectedPersonIdx - 1];
                    if (!p) return null;
                    return (
                      <>
                        <div>
                          <h5 className="text-xl font-bold text-[#211936]">
                            {p.name || `Co-applicant ${selectedPersonIdx}`}
                          </h5>
                          <p className="text-xs font-semibold text-[#8B5CF6]">Co-applicant details</p>
                        </div>
                        <div className="border-t border-[#DCD2F0] pt-3 divide-y divide-[#E3D9F4]">
                          <ProfileRow label="Relationship" value={p.relationship} />
                          <ProfileRow label="Mobile Number" value={p.mobile} mono />
                          <ProfileRow label="Address" value={p.address} />
                          <ProfileRow label="Work Status" value={p.workStatus} />
                          {p.workStatus && p.workStatus !== 'Not Working' && (
                            <>
                              <ProfileRow label="Business" value={p.business} />
                              <ProfileRow label="Salary" value={p.salary} mono />
                              <ProfileRow label="Salary Mode" value={p.salaryMode} />
                            </>
                          )}
                          <ProfileRow label="Email" value={p.email} />
                        </div>
                        <div className="border-t border-[#DCD2F0] pt-3">
                          <p className="text-sm font-bold text-[#211936] mb-1">Bank Account Details</p>
                          <div className="divide-y divide-[#E3D9F4]">
                            <ProfileRow label="Account Holder Name" value={p.accountHolderName} />
                            <ProfileRow label="Account Number" value={p.bankAccountNumber} mono />
                            <ProfileRow label="Bank Name" value={p.bankName} />
                            <ProfileRow label="IFSC Code" value={p.ifsc} mono />
                            <ProfileRow label="Branch Name" value={p.bankBranch} />
                            <ProfileRow label="Cheque Available" value={p.checkAvailable} />
                          </div>
                        </div>
                      </>
                    );
                  })()
                )}
              </div>
            </div>
          )}

          {(profileTab === 1 || profileTab === 2) && (
            <div className="bg-[#EFEAF9] rounded-[22px] border border-[#E3D9F4] p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="font-bold text-[#211936] text-base">Customer Media</h4>
                  <p className="text-xs text-[#77718A]">
                    {mediaSubTab === 0 ? 'Photos' : 'Videos'} · {activeMediaFiles.length} item(s)
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {activeMediaFiles.length > 0 && !selectionMode && (
                    <button
                      type="button"
                      onClick={() => setSelectionMode(true)}
                      className="px-3 py-1.5 rounded-xl bg-white border border-[#E3D9F4] text-xs font-semibold text-[#7042C1]"
                    >
                      Select
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setGridMode((v) => !v)}
                    className="p-2 rounded-xl bg-white border border-[#E3D9F4] text-[#7042C1]"
                    title="Toggle grid or list view"
                  >
                    {gridMode ? <List className="w-4 h-4" /> : <Grid className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className={`grid gap-2.5 ${mediaSubTab === 0 ? 'grid-cols-2' : 'grid-cols-2'}`}>
                <button
                  type="button"
                  onClick={() => attachInputRef.current?.click()}
                  className="py-2.5 px-3.5 rounded-xl bg-white border border-[#E3D9F4] text-[#7042C1] text-xs font-bold flex items-center justify-center gap-2 hover:bg-[#FAF8FD]"
                >
                  <Plus className="w-4 h-4" />
                  Attach {mediaSubTab === 0 ? 'Photos' : 'Videos'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setGpsCameraVideoMode(mediaSubTab === 1);
                    setShowGpsCamera(true);
                  }}
                  className="py-2.5 px-3.5 rounded-xl bg-[#7042C1] text-white text-xs font-bold flex items-center justify-center gap-2 hover:bg-[#5E35A8]"
                >
                  <Camera className="w-4 h-4" />
                  GPS Camera
                </button>
              </div>

              <input
                ref={attachInputRef}
                type="file"
                multiple
                accept={mediaSubTab === 0 ? 'image/*' : 'video/*'}
                onChange={handleAttachMedia}
                className="hidden"
              />

              {(selectionMode || activeSelectedMedia.length > 0) && (
                <div className="bg-white rounded-xl border border-[#E3D9F4] p-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[#211936]">
                    {activeSelectedMedia.length}{' '}
                    {mediaSubTab === 0 ? 'photo(s)' : 'video(s)'} selected
                  </span>
                  <div className="flex items-center gap-2">
                    {activeSelectedMedia.length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={handleDownloadSelectedMedia}
                          className="px-3 py-1.5 rounded-lg border border-[#E3D9F4] text-xs font-semibold text-[#7042C1] flex items-center gap-1"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download
                        </button>
                        <button
                          type="button"
                          onClick={handleShareSelectedMedia}
                          className="px-3 py-1.5 rounded-lg bg-[#7042C1] text-white text-xs font-semibold flex items-center gap-1"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                          Share
                        </button>
                        {mediaSubTab === 0 && (
                          <button
                            type="button"
                            onClick={() => setShowDeleteMediaConfirm(true)}
                            className="p-1.5 rounded-lg text-[#B3261E] hover:bg-[#FEE4E2]"
                            title="Delete selected photos"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectionMode(false);
                        setSelectedPhotos([]);
                        setSelectedVideos([]);
                      }}
                      className="px-2.5 py-1.5 text-xs font-semibold text-[#77718A]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {activeMediaFiles.length === 0 ? (
                <div className="py-12 text-center text-sm text-[#77718A]">
                  No {mediaSubTab === 0 ? 'photos' : 'videos'} added yet
                </div>
              ) : gridMode ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {activeMediaFiles.map((uri, idx) => {
                    const resolved = resolvedUrls[uri];
                    const isSelected = activeSelectedMedia.includes(uri);
                    return (
                      <div
                        key={uri}
                        onClick={() => {
                          if (selectionMode || activeSelectedMedia.length > 0) {
                            toggleMediaSelection(uri);
                          } else if (mediaSubTab === 0) {
                            const urls = activeMediaFiles
                              .map((u) => resolvedUrls[u]?.url)
                              .filter(Boolean) as string[];
                            setPhotoViewerState({ urls, index: idx });
                          } else if (resolved?.url) {
                            setVideoViewerUrl(resolved.url);
                          }
                        }}
                        className="bg-white rounded-xl border border-[#E3D9F4] p-2 cursor-pointer hover:border-[#7042C1] transition-colors relative group"
                      >
                        <div className="h-32 rounded-lg overflow-hidden bg-[#F0EAFB] relative flex items-center justify-center">
                          {mediaSubTab === 0 && resolved?.url ? (
                            <img
                              src={resolved.url}
                              alt={resolved.name}
                              className="w-full h-full object-cover"
                            />
                          ) : mediaSubTab === 1 && resolved?.url ? (
                            <>
                              <video
                                src={resolved.url}
                                className="w-full h-full object-cover"
                                muted
                              />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                                <Film className="w-8 h-8 text-white" />
                              </div>
                            </>
                          ) : (
                            <ImageIcon className="w-8 h-8 text-[#7042C1]" />
                          )}
                          {isSelected && (
                            <div className="absolute inset-0 bg-black/45 flex items-center justify-center">
                              <CheckCircle2 className="w-8 h-8 text-[#31D68B]" />
                            </div>
                          )}
                        </div>
                        <p className="mt-1.5 text-[11px] font-medium text-[#211936] truncate">
                          {resolved?.name || 'Media file'}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-[#E3D9F4] divide-y divide-[#E3D9F4]">
                  {activeMediaFiles.map((uri, idx) => {
                    const resolved = resolvedUrls[uri];
                    const isSelected = activeSelectedMedia.includes(uri);
                    return (
                      <div
                        key={uri}
                        onClick={() => {
                          if (selectionMode || activeSelectedMedia.length > 0) {
                            toggleMediaSelection(uri);
                          } else if (mediaSubTab === 0) {
                            const urls = activeMediaFiles
                              .map((u) => resolvedUrls[u]?.url)
                              .filter(Boolean) as string[];
                            setPhotoViewerState({ urls, index: idx });
                          } else if (resolved?.url) {
                            setVideoViewerUrl(resolved.url);
                          }
                        }}
                        className="p-3 flex items-center gap-3 cursor-pointer hover:bg-[#FAF8FD]"
                      >
                        <div className="w-14 h-14 rounded-lg overflow-hidden bg-[#F0EAFB] shrink-0 flex items-center justify-center">
                          {mediaSubTab === 0 && resolved?.url ? (
                            <img
                              src={resolved.url}
                              alt={resolved.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Film className="w-6 h-6 text-[#7042C1]" />
                          )}
                        </div>
                        <p className="flex-1 text-xs font-semibold text-[#211936] truncate">
                          {resolved?.name || 'Media file'}
                        </p>
                        {isSelected && <Check className="w-4 h-4 text-[#7042C1]" />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {profileTab === 3 && (
            <CustomerChecklist
              customer={customer}
              onCustomerUpdate={onCustomerUpdate}
              onOpenDocumentPreview={(url, mimeType, name) =>
                setDocViewerState({ url, mimeType, name })
              }
            />
          )}

          {profileTab === 4 && (
            <div className="bg-white rounded-[22px] border border-[#E3D9F4] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-base font-bold text-[#211936]">All customer notes</h4>
                {noteSavedToast && (
                  <span className="text-xs font-semibold text-[#16845F]">{noteSavedToast}</span>
                )}
              </div>
              <textarea
                rows={10}
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Write all notes for this customer here..."
                className="w-full p-3.5 rounded-xl border border-[#D4D8E1] bg-[#FAF8FD] text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
              />
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={handleSaveNotes}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-[#7042C1] hover:bg-[#5E35A8] text-white text-sm font-semibold"
                >
                  Save notes
                </button>
                <button
                  type="button"
                  onClick={handleShareNotes}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-white border border-[#E3D9F4] text-[#7042C1] hover:bg-[#F0EAFB] text-sm font-semibold flex items-center justify-center gap-2"
                >
                  <Share2 className="w-4 h-4" />
                  Share Notes (.txt)
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Customize Navigation Modal */}
      {showNavSettings && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#E3D9F4] max-w-sm w-full p-5 space-y-4">
            <h4 className="text-base font-bold text-[#211936]">Customize navigation</h4>
            <p className="text-xs text-[#77718A]">
              Choose which sections appear in the left menu.
            </p>
            <div className="space-y-2">
              {PROFILE_TABS.map((tab) => {
                const checked = visibleTabs.includes(tab.id);
                return (
                  <label key={tab.id} className="flex items-center gap-2.5 text-sm text-[#211936] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? Array.from(new Set([...visibleTabs, tab.id])).sort((a, b) => a - b)
                          : visibleTabs.filter((x) => x !== tab.id);
                        if (next.length === 0) return;
                        setVisibleTabs(next);
                        localStorage.setItem(VISIBLE_TABS_KEY, JSON.stringify(next));
                        if (!next.includes(profileTab)) setProfileTab(next[0]);
                      }}
                      className="w-4 h-4 accent-[#7042C1]"
                    />
                    {tab.label}
                  </label>
                );
              })}
            </div>
            <div className="flex justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  const all = [0, 1, 2, 3, 4];
                  setVisibleTabs(all);
                  localStorage.setItem(VISIBLE_TABS_KEY, JSON.stringify(all));
                }}
                className="text-xs font-semibold text-[#7042C1]"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setShowNavSettings(false)}
                className="px-4 py-1.5 rounded-xl bg-[#7042C1] text-white text-xs font-semibold"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Selected Photos Confirmation */}
      {showDeleteMediaConfirm && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#E3D9F4] max-w-sm w-full p-5 space-y-4">
            <h4 className="text-base font-bold text-[#211936]">Delete selected photos?</h4>
            <p className="text-sm text-[#625A78]">
              Permanently delete {selectedPhotos.length} selected photo(s) from this customer?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteMediaConfirm(false)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-[#625A78]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteSelectedPhotos}
                className="px-4 py-2 rounded-xl bg-[#B3261E] text-white text-xs font-semibold"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Customer Confirmation */}
      {showDeleteCustomerConfirm && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#E3D9F4] max-w-sm w-full p-5 space-y-4">
            <h4 className="text-base font-bold text-[#211936]">Delete customer?</h4>
            <p className="text-sm text-[#625A78]">
              This will permanently remove {customer.name} and all saved media records.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteCustomerConfirm(false)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-[#625A78]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  setShowDeleteCustomerConfirm(false);
                  await onDelete();
                }}
                className="px-4 py-2 rounded-xl bg-[#B3261E] text-white text-xs font-semibold"
              >
                Delete customer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Profile Photo Crop Modal */}
      {showPhotoCrop && (
        <ProfilePhotoCropModal
          onClose={() => setShowPhotoCrop(false)}
          onSaveCropped={async (blob) => {
            const uri = await saveMediaBlob(blob, `profile_${Date.now()}.jpg`, 'image/jpeg');
            await onCustomerUpdate({ ...customer, photoUri: uri });
          }}
        />
      )}

      {/* GPS Camera Modal */}
      {showGpsCamera && (
        <GpsCameraModal
          customerName={customer.name}
          initialVideoMode={gpsCameraVideoMode}
          onClose={() => setShowGpsCamera(false)}
          onPhotoCaptured={async (blob, fileName) => {
            const uri = await saveMediaBlob(blob, fileName, 'image/jpeg');
            const next = Array.from(new Set([...photoList, uri])).join('|');
            await onCustomerUpdate({ ...customer, photos: next });
          }}
          onVideoCaptured={async (blob, fileName) => {
            const uri = await saveMediaBlob(blob, fileName, blob.type || 'video/webm');
            const next = Array.from(new Set([...videoList, uri])).join('|');
            await onCustomerUpdate({ ...customer, videos: next });
          }}
        />
      )}

      {/* Photo / Video / Document Viewers */}
      {photoViewerState && (
        <PhotoViewerModal
          urls={photoViewerState.urls}
          currentIndex={photoViewerState.index}
          onChangeIndex={(index) => setPhotoViewerState({ ...photoViewerState, index })}
          onClose={() => setPhotoViewerState(null)}
        />
      )}

      {videoViewerUrl && (
        <VideoViewerModal url={videoViewerUrl} onClose={() => setVideoViewerUrl(null)} />
      )}

      {docViewerState && (
        <DocumentViewerModal
          url={docViewerState.url}
          mimeType={docViewerState.mimeType}
          name={docViewerState.name}
          onClose={() => setDocViewerState(null)}
        />
      )}
    </div>
  );
};

const ProfileRow: React.FC<{ label: string; value?: string; mono?: boolean }> = ({
  label,
  value,
  mono,
}) => (
  <div className="py-2 flex items-start gap-4 text-xs sm:text-sm">
    <span className="w-40 sm:w-48 shrink-0 text-[#77718A]">{label}</span>
    <span
      className={`flex-1 font-medium text-[#211936] break-words ${
        mono ? 'font-mono-nums' : ''
      }`}
    >
      {value?.trim() ? value : '—'}
    </span>
  </div>
);
