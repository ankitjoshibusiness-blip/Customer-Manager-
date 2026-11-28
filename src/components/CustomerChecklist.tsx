import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  Briefcase,
  Camera,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CloudUpload,
  Eye,
  FileText,
  Landmark,
  Plus,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import type {
  ApplicationDetails,
  ChecklistBucket,
  Customer,
  UploadedDocFile,
} from '../types/customer';
import { deleteMediaRecord, resolveMediaUrl, saveMediaBlob } from '../services/db';
import { DocumentScannerModal } from './DocumentScannerModal';

interface CustomerChecklistProps {
  customer: Customer;
  onCustomerUpdate: (updated: Customer) => Promise<void>;
  onOpenDocumentPreview: (uri: string, mimeType: string, name: string) => void;
}

const PROPERTY_DOCS = [
  'Title Deed',
  'Sale Deed',
  'Gift Deed',
  '2 Number',
  'Tax Receipt',
  'Home Plan Permission',
];

export const CustomerChecklist: React.FC<CustomerChecklistProps> = ({
  customer,
  onCustomerUpdate,
  onOpenDocumentPreview,
}) => {
  const details: ApplicationDetails = useMemo(() => {
    try {
      return JSON.parse(customer.applicationDetails || '{}');
    } catch {
      return {};
    }
  }, [customer.applicationDetails]);

  const coApplicants: Array<{ name?: string; workStatus?: string }> = useMemo(() => {
    try {
      const parsed = JSON.parse(customer.coApplicantsJson || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [customer.coApplicantsJson]);

  const people = useMemo(
    () => [
      customer.name.trim() || 'Applicant',
      ...coApplicants.map((co, i) => co.name?.trim() || `Co-Applicant ${i + 1}`),
    ],
    [customer.name, coApplicants]
  );

  const workTypes = useMemo(
    () => [
      details.workStatus || 'Not Working',
      ...coApplicants.map((co) => co.workStatus || 'Not Working'),
    ],
    [details.workStatus, coApplicants]
  );

  const [selectedPerson, setSelectedPerson] = useState(0);
  const [requiredExpanded, setRequiredExpanded] = useState(true);
  const [categoryIndex, setCategoryIndex] = useState<number>(-1);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addMode, setAddMode] = useState<'category' | 'other'>('category');
  const [newDocName, setNewDocName] = useState('');

  // Document action modal state
  const [actionOpen, setActionOpen] = useState(false);
  const [manageMode, setManageMode] = useState(false);
  const [activeDocTitle, setActiveDocTitle] = useState('');
  const [activeDocKey, setActiveDocKey] = useState('');
  const [activeBucketType, setActiveBucketType] = useState<'person' | 'property' | 'other'>('person');
  const [busyUpload, setBusyUpload] = useState(false);
  const [actionError, setActionError] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Document scanner/dialog is a nested layer and must consume Back first.
  useEffect(() => {
    const handleAndroidBack = (event: Event) => {
      if (scannerOpen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setScannerOpen(false);
      } else if (actionOpen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setActionOpen(false);
      } else if (showAddDialog) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setShowAddDialog(false);
      }
    };
    window.addEventListener('androidback', handleAndroidBack, true);
    return () => window.removeEventListener('androidback', handleAndroidBack, true);
  }, [scannerOpen, actionOpen, showAddDialog]);

  const personCategories = useMemo(
    () => [
      {
        title: 'Identity',
        subtitle: 'Personal identity proofs',
        icon: BadgeCheck,
        docs: ['Aadhaar Card', 'PAN Card'],
      },
      {
        title: 'Banking',
        subtitle: 'Bank details, cheque and ITR',
        icon: Landmark,
        docs: ['Bank Passbook', 'Bank Statement', 'Cheque', 'ITR'],
      },
      {
        title: 'Occupation',
        subtitle: 'Income and work proof',
        icon: Briefcase,
        docs: [
          (workTypes[selectedPerson] || '').toLowerCase().includes('business')
            ? 'Business Documents'
            : 'Salary Slip',
        ],
      },
    ],
    [workTypes, selectedPerson]
  );

  const checklistRoot = details.documentChecklist || {};

  const getBucket = (bucketType: 'person' | 'property' | 'other'): ChecklistBucket => {
    if (bucketType === 'other') {
      return checklistRoot.otherDocuments || checklistRoot.otherDocuments_0 || {};
    }
    if (bucketType === 'property') {
      return checklistRoot.propertyDocuments || checklistRoot.propertyDocuments_0 || {};
    }
    return checklistRoot[`person_${selectedPerson}`] || {};
  };

  const getBucketFiles = (bucket: ChecklistBucket, key: string): UploadedDocFile[] => {
    const val = bucket[`files_${key}`];
    return Array.isArray(val) ? (val as UploadedDocFile[]) : [];
  };

  const getCustomDocsForCategory = (catIdx: number): string[] => {
    const bucket = getBucket('person');
    const arr = bucket[`customCat_${catIdx}`];
    return Array.isArray(arr) ? (arr as string[]) : [];
  };

  const additionalOtherDocs: string[] = useMemo(() => {
    const bucket = checklistRoot.otherDocuments || checklistRoot.otherDocuments_0 || {};
    const arr =
      bucket.customDocuments || bucket.customCat_4 || bucket.customOther || [];
    return Array.isArray(arr) ? (arr as string[]).filter(Boolean) : [];
  }, [checklistRoot]);

  const categoryProgress = (idx: number): [number, number] => {
    const docs = personCategories[idx].docs;
    const bucket = getBucket('person');
    const custom = getCustomDocsForCategory(idx);
    const names = [...docs, ...custom];
    const count = names.filter((name) => {
      const key = docs.includes(name) ? `cat_${idx}_${name}` : `custom_${idx}_${name}`;
      const files = getBucketFiles(bucket, key);
      return Boolean(bucket[key]) || files.length > 0;
    }).length;
    return [count, names.length];
  };

  const saveBucketUpdate = async (
    bucketType: 'person' | 'property' | 'other',
    updater: (bucket: ChecklistBucket) => ChecklistBucket
  ) => {
    const bucketName =
      bucketType === 'other'
        ? 'otherDocuments'
        : bucketType === 'property'
          ? 'propertyDocuments'
          : `person_${selectedPerson}`;
    const currentBucket = { ...getBucket(bucketType) };
    const nextBucket = updater(currentBucket);
    const nextDetails: ApplicationDetails = {
      ...details,
      documentChecklist: {
        ...checklistRoot,
        [bucketName]: nextBucket,
      },
    };
    await onCustomerUpdate({
      ...customer,
      applicationDetails: JSON.stringify(nextDetails),
    });
  };

  const openActions = (title: string, key: string, bucketType: 'person' | 'property' | 'other', manage = false) => {
    setActiveDocTitle(title);
    setActiveDocKey(key);
    setActiveBucketType(bucketType);
    setManageMode(manage);
    setActionError('');
    setActionOpen(true);
  };

  const handleImportFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setBusyUpload(true);
    setActionError('');
    try {
      const added: UploadedDocFile[] = [];
      for (const file of Array.from(fileList)) {
        const uri = await saveMediaBlob(file, file.name, file.type || 'application/octet-stream');
        added.push({ uri, name: file.name, source: 'Imported' });
      }
      await saveBucketUpdate(activeBucketType, (bucket) => {
        const existing = getBucketFiles(bucket, activeDocKey);
        return {
          ...bucket,
          [activeDocKey]: true,
          [`files_${activeDocKey}`]: [...existing, ...added],
        };
      });
      setActionOpen(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to import document');
    } finally {
      e.target.value = '';
      setBusyUpload(false);
    }
  };

  const handleScannerPdfSaved = async (pdfBlob: Blob, pageCount: number) => {
    setBusyUpload(true);
    setActionError('');
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const pdfName = `${activeDocTitle} (Scanned ${pageCount}p ${stamp}).pdf`;
      const uri = await saveMediaBlob(pdfBlob, pdfName, 'application/pdf');
      await saveBucketUpdate(activeBucketType, (bucket) => {
        const existing = getBucketFiles(bucket, activeDocKey);
        return {
          ...bucket,
          [activeDocKey]: true,
          [`files_${activeDocKey}`]: [
            ...existing,
            { uri, name: pdfName, source: 'Scanner' },
          ],
        };
      });
      setScannerOpen(false);
      setActionOpen(false);
    } finally {
      setBusyUpload(false);
    }
  };

  const handleDeleteAllFilesForDoc = async (key: string, bucketType: 'person' | 'property' | 'other') => {
    const bucket = getBucket(bucketType);
    const files = getBucketFiles(bucket, key);
    for (const f of files) {
      await deleteMediaRecord(f.uri);
    }
    await saveBucketUpdate(bucketType, (b) => ({
      ...b,
      [key]: false,
      [`files_${key}`]: [],
    }));
  };

  const handleDeleteSingleFile = async (indexToRemove: number) => {
    const bucket = getBucket(activeBucketType);
    const files = getBucketFiles(bucket, activeDocKey);
    const target = files[indexToRemove];
    if (target) await deleteMediaRecord(target.uri);
    const nextFiles = files.filter((_, i) => i !== indexToRemove);
    await saveBucketUpdate(activeBucketType, (b) => ({
      ...b,
      [activeDocKey]: nextFiles.length > 0,
      [`files_${activeDocKey}`]: nextFiles,
    }));
  };

  const handleAddCustomDocument = async () => {
    const trimmed = newDocName.trim();
    if (!trimmed) {
      setShowAddDialog(false);
      return;
    }
    if (addMode === 'other') {
      await saveBucketUpdate('other', (b) => {
        const existing = Array.isArray(b.customDocuments) ? (b.customDocuments as string[]) : [];
        if (existing.some((x) => x.toLowerCase() === trimmed.toLowerCase())) return b;
        return { ...b, customDocuments: [...existing, trimmed] };
      });
    } else if (categoryIndex >= 0) {
      const key = `customCat_${categoryIndex}`;
      await saveBucketUpdate('person', (b) => {
        const existing = Array.isArray(b[key]) ? (b[key] as string[]) : [];
        if (existing.some((x) => x.toLowerCase() === trimmed.toLowerCase())) return b;
        return { ...b, [key]: [...existing, trimmed] };
      });
    }
    setNewDocName('');
    setShowAddDialog(false);
  };

  const activeBucket = getBucket(activeBucketType);
  const activeFiles = getBucketFiles(activeBucket, activeDocKey);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-[#211936]">Documents</h3>
          <p className="text-xs text-[#77718A]">Track every required document by applicant</p>
        </div>
        <span className="text-xs font-bold text-[#7042C1] tabular-nums">
          {people.length} {people.length === 1 ? 'Person' : 'People'}
        </span>
      </div>

      {/* Person Switcher */}
      <div className="flex flex-wrap gap-2">
        {people.map((personName, idx) => (
          <button
            key={`${personName}-${idx}`}
            type="button"
            onClick={() => {
              setSelectedPerson(idx);
              setCategoryIndex(-1);
            }}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-colors ${
              selectedPerson === idx
                ? 'bg-[#7042C1] text-white border-[#7042C1]'
                : 'bg-white text-[#625A78] border-[#E7E0F1] hover:bg-[#F0EAFB]'
            }`}
          >
            {idx === 0 ? <User className="w-3.5 h-3.5" /> : <Users className="w-3.5 h-3.5" />}
            <span>{idx === 0 ? 'Applicant' : `Co-Applicant ${idx}`}</span>
          </button>
        ))}
      </div>

      {/* Required Documents Header */}
      <div className="flex items-center justify-between pt-1">
        <p className="text-sm font-bold text-[#211936]">Required Documents</p>
        <button
          type="button"
          onClick={() => setRequiredExpanded((v) => !v)}
          className="p-1.5 rounded-lg bg-[#EDE5FA] text-[#7042C1] hover:bg-[#E2D6F7]"
          aria-label={requiredExpanded ? 'Collapse required documents' : 'Expand required documents'}
        >
          {requiredExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {requiredExpanded && (
        <>
          {categoryIndex < 0 ? (
            <div className="space-y-3">
              <p className="text-[11px] font-bold tracking-wider text-[#77718A]">
                {people[selectedPerson].toUpperCase()} · REQUIRED DOCUMENTS
              </p>

              <div className="grid sm:grid-cols-3 gap-3">
                {personCategories.map((cat, idx) => {
                  const [done, total] = categoryProgress(idx);
                  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
                  const Icon = cat.icon;
                  return (
                    <button
                      key={cat.title}
                      type="button"
                      onClick={() => setCategoryIndex(idx)}
                      className="text-left bg-white rounded-2xl border border-[#E7E0F1] p-4 hover:border-[#7042C1]/50 transition-colors flex flex-col gap-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="w-10 h-10 rounded-xl bg-[#F0EAFB] text-[#7042C1] flex items-center justify-center">
                          <Icon className="w-5 h-5" />
                        </div>
                        <ChevronRight className="w-4 h-4 text-[#77718A]" />
                      </div>
                      <div>
                        <p className="font-bold text-sm text-[#211936]">{cat.title}</p>
                        <p className="text-xs text-[#77718A]">{cat.subtitle}</p>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-[#77718A]">received</span>
                          <span className="font-bold font-mono-nums text-[#7042C1]">
                            {done}/{total}
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-[#ECE8F2] overflow-hidden">
                          <div
                            className="h-full bg-[#25845D] rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <p className="text-[11px] font-bold tracking-wider text-[#77718A] pt-3">
                ADDITIONAL DOCUMENTS
              </p>

              <div className="grid sm:grid-cols-2 gap-2.5">
                {PROPERTY_DOCS.map((doc) => {
                  const key = `property_${doc}`;
                  const bucket = getBucket('property');
                  const uploadedCount = getBucketFiles(bucket, key).length;
                  return (
                    <ChecklistRow
                      key={key}
                      title={doc}
                      uploadedCount={uploadedCount}
                      onAdd={() => openActions(doc, key, 'property', false)}
                      onView={() => openActions(doc, key, 'property', true)}
                      onDelete={() => handleDeleteAllFilesForDoc(key, 'property')}
                    />
                  );
                })}
                {additionalOtherDocs.map((doc) => {
                  const key = `custom_${doc}`;
                  const bucket = getBucket('other');
                  const uploadedCount = getBucketFiles(bucket, key).length;
                  return (
                    <ChecklistRow
                      key={key}
                      title={doc}
                      uploadedCount={uploadedCount}
                      onAdd={() => openActions(doc, key, 'other', false)}
                      onView={() => openActions(doc, key, 'other', true)}
                      onDelete={() => handleDeleteAllFilesForDoc(key, 'other')}
                    />
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  setAddMode('other');
                  setNewDocName('');
                  setShowAddDialog(true);
                }}
                className="w-full py-2.5 px-4 rounded-xl border border-dashed border-[#C7B7E8] text-[#7042C1] text-xs font-bold flex items-center justify-center gap-2 hover:bg-[#F0EAFB]"
              >
                <Plus className="w-4 h-4" />
                Add Other Document
              </button>
            </div>
          ) : (
            (() => {
              const cat = personCategories[categoryIndex];
              const bucket = getBucket('person');
              const customDocs = getCustomDocsForCategory(categoryIndex);
              const [done, total] = categoryProgress(categoryIndex);
              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCategoryIndex(-1)}
                        className="p-2 rounded-xl bg-white border border-[#E7E0F1] text-[#7042C1] hover:bg-[#F0EAFB]"
                        aria-label="Back to categories"
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                      <div>
                        <p className="font-bold text-[#211936] text-base">{cat.title}</p>
                        <p className="text-xs text-[#77718A]">{people[selectedPerson]}</p>
                      </div>
                    </div>
                    <span className="text-xs font-bold font-mono-nums text-[#7042C1]">
                      {done}/{total} received
                    </span>
                  </div>

                  <div className="space-y-2">
                    {cat.docs.map((doc) => {
                      const key = `cat_${categoryIndex}_${doc}`;
                      const uploadedCount = getBucketFiles(bucket, key).length;
                      return (
                        <ChecklistRow
                          key={key}
                          title={doc}
                          uploadedCount={uploadedCount}
                          onAdd={() => openActions(doc, key, 'person', false)}
                          onView={() => openActions(doc, key, 'person', true)}
                          onDelete={() => handleDeleteAllFilesForDoc(key, 'person')}
                        />
                      );
                    })}
                    {customDocs.map((doc) => {
                      const key = `custom_${categoryIndex}_${doc}`;
                      const uploadedCount = getBucketFiles(bucket, key).length;
                      return (
                        <ChecklistRow
                          key={key}
                          title={doc}
                          uploadedCount={uploadedCount}
                          onAdd={() => openActions(doc, key, 'person', false)}
                          onView={() => openActions(doc, key, 'person', true)}
                          onDelete={() => handleDeleteAllFilesForDoc(key, 'person')}
                        />
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setAddMode('category');
                      setNewDocName('');
                      setShowAddDialog(true);
                    }}
                    className="w-full py-2.5 px-4 rounded-xl border border-dashed border-[#C7B7E8] text-[#7042C1] text-xs font-bold flex items-center justify-center gap-2 hover:bg-[#F0EAFB]"
                  >
                    <Plus className="w-4 h-4" />
                    Add More Documents
                  </button>
                </div>
              );
            })()
          )}
        </>
      )}

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="application/pdf,image/*"
        onChange={handleImportFiles}
        className="hidden"
      />

      {/* Document Actions Modal */}
      {actionOpen && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="bg-white rounded-[24px] border border-[#E3D9F4] w-full max-w-lg p-6 space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-lg font-bold text-[#211936]">
                  {manageMode ? 'Manage Documents' : `Add ${activeDocTitle}`}
                </h4>
                <p className="text-xs text-[#77718A]">
                  {manageMode
                    ? `${activeFiles.length} uploaded file(s)`
                    : 'Upload PDFs/images or scan pages to PDF'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActionOpen(false)}
                className="p-1.5 rounded-lg text-[#77718A] hover:bg-[#F5F1FC]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {actionError && (
              <p className="text-xs text-[#B3261E] bg-[#FEE4E2] border border-[#FECDCA] rounded-xl px-3 py-2">
                {actionError}
              </p>
            )}

            {!manageMode && (
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={busyUpload}
                  onClick={() => fileInputRef.current?.click()}
                  className="p-4 rounded-2xl bg-[#F3ECFC] border border-[#E7E0F1] hover:border-[#7042C1] flex flex-col items-center gap-2 text-center transition-colors disabled:opacity-50"
                >
                  <CloudUpload className="w-7 h-7 text-[#7042C1]" />
                  <span className="font-bold text-sm text-[#211936]">Import</span>
                  <span className="text-[11px] text-[#77718A]">Choose PDF or Images</span>
                </button>
                <button
                  type="button"
                  disabled={busyUpload}
                  onClick={() => setScannerOpen(true)}
                  className="p-4 rounded-2xl bg-[#F3ECFC] border border-[#E7E0F1] hover:border-[#7042C1] flex flex-col items-center gap-2 text-center transition-colors disabled:opacity-50"
                >
                  <Camera className="w-7 h-7 text-[#7042C1]" />
                  <span className="font-bold text-sm text-[#211936]">Scanner</span>
                  <span className="text-[11px] text-[#77718A]">Scan pages into PDF</span>
                </button>
              </div>
            )}

            <div className="border-t border-[#E7E0F1] pt-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-[#211936]">
                  {manageMode ? 'Uploaded files' : 'Manage Documents'}
                </p>
                {manageMode ? (
                  <button
                    type="button"
                    onClick={() => setManageMode(false)}
                    className="text-xs font-semibold text-[#7042C1] hover:underline"
                  >
                    Upload more
                  </button>
                ) : (
                  <span className="text-xs font-bold font-mono-nums text-[#7042C1]">
                    {activeFiles.length} FILES
                  </span>
                )}
              </div>

              {activeFiles.length === 0 ? (
                <p className="text-xs text-[#77718A] py-2">No documents uploaded yet.</p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {activeFiles.map((file, idx) => (
                    <div
                      key={`${file.uri}-${idx}`}
                      className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-[#FAF8FD] border border-[#E7E0F1]"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileText className="w-5 h-5 text-[#7042C1] shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[#211936] truncate">{file.name}</p>
                          <p className="text-[10px] text-[#77718A]">{file.source}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={async () => {
                            const resolved = await resolveMediaUrl(file.uri);
                            if (resolved) {
                              onOpenDocumentPreview(resolved.url, resolved.mimeType, file.name);
                            }
                          }}
                          className="p-1.5 rounded-lg text-[#7042C1] hover:bg-[#F0EAFB]"
                          title="View"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSingleFile(idx)}
                          className="p-1.5 rounded-lg text-[#B3261E] hover:bg-[#FEE4E2]"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Document Name Dialog */}
      {showAddDialog && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#E3D9F4] w-full max-w-sm p-5 space-y-4">
            <h4 className="text-base font-bold text-[#211936]">Add document</h4>
            <input
              type="text"
              autoFocus
              value={newDocName}
              onChange={(e) => setNewDocName(e.target.value)}
              placeholder="Document name"
              className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddDialog(false)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-[#625A78]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddCustomDocument}
                className="px-4 py-2 rounded-xl bg-[#7042C1] text-white text-xs font-semibold"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Interactive Document Scanner Modal */}
      {scannerOpen && (
        <DocumentScannerModal
          docTitle={activeDocTitle}
          onClose={() => setScannerOpen(false)}
          onSavePdf={handleScannerPdfSaved}
        />
      )}
    </div>
  );
};

interface ChecklistRowProps {
  title: string;
  uploadedCount: number;
  onView: () => void;
  onDelete: () => void;
  onAdd: () => void;
}

const ChecklistRow: React.FC<ChecklistRowProps> = ({
  title,
  uploadedCount,
  onView,
  onDelete,
  onAdd,
}) => (
  <div className="bg-white rounded-xl border border-[#E7E0F1] px-3 py-2.5 flex items-center justify-between gap-3">
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="w-8 h-8 rounded-lg bg-[#F0EAFB] text-[#7042C1] flex items-center justify-center shrink-0">
        <FileText className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[#211936] truncate">{title}</p>
        <p
          className={`text-[11px] ${
            uploadedCount > 0 ? 'text-[#25845D] font-medium' : 'text-[#77718A]'
          }`}
        >
          {uploadedCount > 0 ? `${uploadedCount} file(s) uploaded` : 'Awaiting document'}
        </p>
      </div>
    </div>
    <div className="flex items-center gap-1 shrink-0">
      {uploadedCount > 0 ? (
        <>
          <button
            type="button"
            onClick={onView}
            className="p-1.5 rounded-lg text-[#7042C1] hover:bg-[#F0EAFB]"
            title="View uploaded document"
          >
            <Eye className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-1.5 rounded-lg text-[#B3261E] hover:bg-[#FEE4E2]"
            title="Delete uploaded document"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          className="w-8 h-8 rounded-full bg-[#7042C1] text-white flex items-center justify-center hover:bg-[#5E35A8]"
          title="Add document"
        >
          <Plus className="w-4 h-4" />
        </button>
      )}
    </div>
  </div>
);
