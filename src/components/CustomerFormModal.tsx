import React, { useEffect, useState } from 'react';
import { Loader2, Trash2, UserPlus, X } from 'lucide-react';
import type {
  AddressDraft,
  ApplicationDetails,
  CoApplicantData,
  Customer,
} from '../types/customer';

interface CustomerFormModalProps {
  initial: Customer | null;
  onDismiss: () => void;
  onSave: (customer: Omit<Customer, 'id'> & { id?: number }) => Promise<void>;
}

const RELATIONSHIPS = ['Self', 'Wife', 'Brother', 'Mother', 'Father', 'Cousin', 'Uncle', 'Friend', 'Other'];
const WORK_OPTIONS = ['Salaried', 'Business', 'Self Employed', 'Professional', 'Farmer', 'Retired', 'Not Working', 'Other', 'Working'];
const SALARY_MODES = ['In Account', 'Cash'];
const LOAN_TYPES = [
  'Personal Loan',
  'Home Loan',
  'Business Loan',
  'Vehicle Loan',
  'Car Loan',
  'Bike Loan',
  'Gold Loan',
  'Education Loan',
  'Agriculture Loan',
  'Mortgage Loan',
  'Other',
];

const emptyAddress = (): AddressDraft => ({
  houseNo: '',
  street: '',
  villageCity: '',
  taluka: '',
  district: '',
  state: '',
  pinCode: '',
});

function formatAddressDisplay(a: AddressDraft): string {
  return [a.houseNo, a.street, a.villageCity, a.taluka, a.district, a.state, a.pinCode]
    .filter((v) => v.trim().length > 0)
    .join(', ');
}

function addressFromObj(obj: Record<string, unknown>, legacy = ''): AddressDraft {
  return {
    houseNo: String(obj.addressHouseNo ?? ''),
    street: String(obj.addressStreet ?? '') || legacy,
    villageCity: String(obj.villageCity ?? ''),
    taluka: String(obj.addressTaluka ?? ''),
    district: String(obj.addressDistrict ?? ''),
    state: String(obj.addressState ?? ''),
    pinCode: String(obj.addressPinCode ?? ''),
  };
}

interface CoApplicantDraft {
  name: string;
  relationship: string;
  mobile: string;
  address: AddressDraft;
  sameAsApplicant: boolean;
  workStatus: string;
  business: string;
  salary: string;
  salaryMode: string;
  email: string;
  bankAccountNumber: string;
  bankName: string;
  accountHolderName: string;
  ifsc: string;
  branchName: string;
  checkAvailable: string;
  itrStatus: string;
}

const emptyCoApplicant = (): CoApplicantDraft => ({
  name: '',
  relationship: '',
  mobile: '',
  address: emptyAddress(),
  sameAsApplicant: false,
  workStatus: 'Not Working',
  business: '',
  salary: '',
  salaryMode: '',
  email: '',
  bankAccountNumber: '',
  bankName: '',
  accountHolderName: '',
  ifsc: '',
  branchName: '',
  checkAvailable: '',
  itrStatus: 'No',
});

interface AddressFieldsProps {
  title: string;
  value: AddressDraft;
  onChange: (next: AddressDraft) => void;
}

const AddressFields: React.FC<AddressFieldsProps> = ({ title, value, onChange }) => {
  const [pinMsg, setPinMsg] = useState('');
  const [pinLoading, setPinLoading] = useState(false);

  useEffect(() => {
    const pin = value.pinCode.trim();
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      setPinMsg('');
      setPinLoading(false);
      return;
    }
    let cancelled = false;
    setPinLoading(true);
    setPinMsg('Finding city and address details…');
    fetch(`https://api.postalpincode.in/pincode/${pin}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return;
        const result = Array.isArray(json) ? json[0] : null;
        const office = result?.Status === 'Success' ? result?.PostOffice?.[0] : null;
        if (office) {
          onChange({
            ...value,
            villageCity: office.Name || value.villageCity,
            taluka: office.Block || value.taluka,
            district: office.District || value.district,
            state: office.State || value.state,
          });
          setPinMsg('Address details filled from PIN code');
        } else {
          setPinMsg('PIN code not found. You can enter details manually.');
        }
      })
      .catch(() => {
        if (!cancelled) setPinMsg('Could not fetch address. Enter details manually.');
      })
      .finally(() => {
        if (!cancelled) setPinLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.pinCode]);

  return (
    <div className="space-y-2.5">
      <p className="text-xs font-bold text-[#7042C1]">{title}</p>
      <div className="grid sm:grid-cols-2 gap-2.5">
        <input
          type="text"
          value={value.houseNo}
          onChange={(e) => onChange({ ...value, houseNo: e.target.value })}
          placeholder="House / Flat No. • મકાન નંબર"
          className="px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
        />
        <input
          type="text"
          value={value.street}
          onChange={(e) => onChange({ ...value, street: e.target.value })}
          placeholder="Street / Area • શેરી / વિસ્તાર"
          className="px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
        />
        <input
          type="text"
          value={value.villageCity}
          onChange={(e) => onChange({ ...value, villageCity: e.target.value })}
          placeholder="Village / City • ગામ / શહેર"
          className="px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
        />
        <input
          type="text"
          value={value.taluka}
          onChange={(e) => onChange({ ...value, taluka: e.target.value })}
          placeholder="Taluka • તાલુકો"
          className="px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
        />
        <input
          type="text"
          value={value.district}
          onChange={(e) => onChange({ ...value, district: e.target.value })}
          placeholder="District • જિલ્લો"
          className="px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
        />
        <input
          type="text"
          value={value.state}
          onChange={(e) => onChange({ ...value, state: e.target.value })}
          placeholder="State • રાજ્ય"
          className="px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
        />
      </div>
      <div>
        <div className="relative">
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={value.pinCode}
            onChange={(e) =>
              onChange({ ...value, pinCode: e.target.value.replace(/\D/g, '').slice(0, 6) })
            }
            placeholder="PIN Code • પિન કોડ (6 digits)"
            className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm font-mono-nums text-[#211936] focus:outline-none focus:border-[#7042C1]"
          />
          {pinLoading && (
            <Loader2 className="w-4 h-4 animate-spin text-[#7042C1] absolute right-3 top-1/2 -translate-y-1/2" />
          )}
        </div>
        {pinMsg && <p className="text-[11px] text-[#77718A] mt-1">{pinMsg}</p>}
      </div>
    </div>
  );
};

interface BankFieldsProps {
  accountNumber: string;
  onAccountNumber: (v: string) => void;
  bankName: string;
  onBankName: (v: string) => void;
  holderName: string;
  onHolderName: (v: string) => void;
  ifsc: string;
  onIfsc: (v: string) => void;
  branchName: string;
  onBranchName: (v: string) => void;
  checkAvailable: string;
  onCheckAvailable: (v: string) => void;
}

const BankFields: React.FC<BankFieldsProps> = ({
  accountNumber,
  onAccountNumber,
  bankName,
  onBankName,
  holderName,
  onHolderName,
  ifsc,
  onIfsc,
  branchName,
  onBranchName,
  checkAvailable,
  onCheckAvailable,
}) => {
  const [ifscMsg, setIfscMsg] = useState('');
  const [ifscLoading, setIfscLoading] = useState(false);

  useEffect(() => {
    const code = ifsc.trim().toUpperCase();
    if (code.length !== 11 || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(code)) {
      setIfscMsg('');
      setIfscLoading(false);
      return;
    }
    let cancelled = false;
    setIfscLoading(true);
    setIfscMsg('Finding bank branch…');
    fetch(`https://ifsc.razorpay.com/${code}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((details) => {
        if (cancelled) return;
        if (details) {
          if (details.BRANCH) onBranchName(details.BRANCH);
          if (details.BANK) onBankName(details.BANK);
          setIfscMsg(details.BRANCH ? 'Branch details found' : 'Branch name not available');
        } else {
          setIfscMsg('Invalid IFSC code');
        }
      })
      .catch(() => {
        if (!cancelled) setIfscMsg('Could not fetch branch. Enter details manually.');
      })
      .finally(() => {
        if (!cancelled) setIfscLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ifsc]);

  return (
    <div className="space-y-2.5 pt-2 border-t border-[#E3D9F4]">
      <p className="text-xs font-bold text-[#7042C1]">BANK ACCOUNT DETAILS</p>
      <div className="grid sm:grid-cols-2 gap-2.5">
        <input
          type="text"
          inputMode="numeric"
          value={accountNumber}
          onChange={(e) => onAccountNumber(e.target.value)}
          placeholder="Bank Account Number"
          className="px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm font-mono-nums text-[#211936] focus:outline-none focus:border-[#7042C1]"
        />
        <input
          type="text"
          value={bankName}
          onChange={(e) => onBankName(e.target.value)}
          placeholder="Bank Name"
          className="px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
        />
        <input
          type="text"
          value={holderName}
          onChange={(e) => onHolderName(e.target.value)}
          placeholder="Account Holder Name"
          className="px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
        />
        <div>
          <div className="relative">
            <input
              type="text"
              maxLength={11}
              value={ifsc}
              onChange={(e) =>
                onIfsc(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))
              }
              placeholder="IFSC Number"
              className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm font-mono-nums uppercase text-[#211936] focus:outline-none focus:border-[#7042C1]"
            />
            {ifscLoading && (
              <Loader2 className="w-4 h-4 animate-spin text-[#7042C1] absolute right-3 top-1/2 -translate-y-1/2" />
            )}
          </div>
          {ifscMsg && <p className="text-[11px] text-[#77718A] mt-1">{ifscMsg}</p>}
        </div>
        <input
          type="text"
          value={branchName}
          onChange={(e) => onBranchName(e.target.value)}
          placeholder="Branch Name • શાખાનું નામ"
          className="px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
        />
        <select
          value={checkAvailable}
          onChange={(e) => onCheckAvailable(e.target.value)}
          className="px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
        >
          <option value="">Cheque Available?</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
        </select>
      </div>
    </div>
  );
};

export const CustomerFormModal: React.FC<CustomerFormModalProps> = ({
  initial,
  onDismiss,
  onSave,
}) => {
  const saved: ApplicationDetails = (() => {
    try {
      return JSON.parse(initial?.applicationDetails || '{}');
    } catch {
      return {};
    }
  })();

  const [selectedTab, setSelectedTab] = useState(0);
  const [name, setName] = useState(initial?.name ?? '');
  const [relationship, setRelationship] = useState(saved.relationship ?? '');
  const [mobile, setMobile] = useState(initial?.mobile ?? '');
  const [applicantAddress, setApplicantAddress] = useState<AddressDraft>(() =>
    addressFromObj(saved, initial?.address ?? '')
  );
  const [workStatus, setWorkStatus] = useState(saved.workStatus ?? 'Not Working');
  const [business, setBusiness] = useState(saved.business ?? '');
  const [salary, setSalary] = useState(saved.salary ?? '');
  const [salaryMode, setSalaryMode] = useState(saved.salaryMode ?? '');
  const [email, setEmail] = useState(saved.email ?? '');
  const [bankAccountNumber, setBankAccountNumber] = useState(saved.bankAccountNumber ?? '');
  const [bankName, setBankName] = useState(saved.bankName ?? '');
  const [accountHolderName, setAccountHolderName] = useState(saved.accountHolderName ?? '');
  const [ifsc, setIfsc] = useState(saved.ifsc ?? '');
  const [bankBranch, setBankBranch] = useState(saved.bankBranch ?? '');
  const [checkAvailable, setCheckAvailable] = useState(saved.checkAvailable ?? '');
  const [totalMembers, setTotalMembers] = useState(saved.totalMembers ?? '');
  const [itrStatus, setItrStatus] = useState(
    saved.itrStatus === 'Yes' || saved.itrStatus === 'Filed' ? 'Yes' : 'No'
  );
  const [loanType, setLoanType] = useState(initial?.loanType ?? '');
  const [loanAmount, setLoanAmount] = useState(initial?.loanAmount ?? '');
  const [customerId, setCustomerId] = useState(saved.customerId ?? '');
  const [loanId, setLoanId] = useState(saved.loanId ?? '');

  const [coApplicants, setCoApplicants] = useState<CoApplicantDraft[]>(() => {
    try {
      const arr = JSON.parse(initial?.coApplicantsJson || '[]');
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.map((p: Record<string, unknown>) => ({
          name: String(p.name ?? ''),
          relationship: String(p.relationship ?? ''),
          mobile: String(p.mobile ?? ''),
          address: addressFromObj(p, String(p.address ?? '')),
          sameAsApplicant: Boolean(p.sameAsApplicant),
          workStatus: String(p.workStatus ?? 'Not Working'),
          business: String(p.business ?? ''),
          salary: String(p.salary ?? ''),
          salaryMode: String(p.salaryMode ?? ''),
          email: String(p.email ?? ''),
          bankAccountNumber: String(p.bankAccountNumber ?? ''),
          bankName: String(p.bankName ?? ''),
          accountHolderName: String(p.accountHolderName ?? ''),
          ifsc: String(p.ifsc ?? ''),
          branchName: String(p.bankBranch ?? ''),
          checkAvailable: String(p.checkAvailable ?? ''),
          itrStatus: p.itrStatus === 'Yes' || p.itrStatus === 'Filed' ? 'Yes' : 'No',
        }));
      }
    } catch {
      // ignore
    }
    return [emptyCoApplicant()];
  });

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handleAndroidBack = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (selectedTab > 0) setSelectedTab((tab) => tab - 1);
      else onDismiss();
    };
    window.addEventListener('androidback', handleAndroidBack, true);
    return () => window.removeEventListener('androidback', handleAndroidBack, true);
  }, [selectedTab, onDismiss]);

  const isEmailValid = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  const handleSave = async () => {
    const filledCo = coApplicants.filter(
      (p) =>
        p.name.trim() ||
        p.mobile.trim() ||
        formatAddressDisplay(p.address) ||
        p.email.trim()
    );

    if (!name.trim()) {
      setSelectedTab(0);
      setError('Applicant name is required');
      return;
    }
    if (mobile.length !== 10) {
      setSelectedTab(0);
      setError('Applicant mobile number must be exactly 10 digits');
      return;
    }
    if (filledCo.some((p) => p.mobile.length > 0 && p.mobile.length !== 10)) {
      setError('Each co-applicant mobile number must be exactly 10 digits');
      return;
    }
    if (email.trim() && !isEmailValid(email)) {
      setSelectedTab(0);
      setError('Enter a valid applicant email address');
      return;
    }
    if (filledCo.some((p) => p.email.trim() && !isEmailValid(p.email))) {
      setError('Enter a valid co-applicant email address');
      return;
    }

    const detailsObj: ApplicationDetails = {
      ...saved,
      customerId: customerId.trim(),
      loanId: loanId.trim(),
      relationship,
      workStatus,
      business,
      salary,
      salaryMode,
      email: email.trim(),
      totalMembers,
      bankAccountNumber,
      bankName,
      accountHolderName,
      ifsc,
      bankBranch,
      checkAvailable,
      addressHouseNo: applicantAddress.houseNo,
      addressStreet: applicantAddress.street,
      villageCity: applicantAddress.villageCity,
      addressTaluka: applicantAddress.taluka,
      addressDistrict: applicantAddress.district,
      addressState: applicantAddress.state,
      addressPinCode: applicantAddress.pinCode,
      itrStatus,
    };

    const coList: CoApplicantData[] = filledCo.map((p) => ({
      name: p.name,
      relationship: p.relationship,
      mobile: p.mobile,
      address: formatAddressDisplay(p.address),
      addressHouseNo: p.address.houseNo,
      addressStreet: p.address.street,
      villageCity: p.address.villageCity,
      addressTaluka: p.address.taluka,
      addressDistrict: p.address.district,
      addressState: p.address.state,
      addressPinCode: p.address.pinCode,
      sameAsApplicant: p.sameAsApplicant,
      workStatus: p.workStatus,
      business: p.business,
      salary: p.salary,
      salaryMode: p.salaryMode,
      email: p.email.trim(),
      bankAccountNumber: p.bankAccountNumber,
      bankName: p.bankName,
      accountHolderName: p.accountHolderName,
      ifsc: p.ifsc,
      bankBranch: p.branchName,
      checkAvailable: p.checkAvailable,
      itrStatus: p.itrStatus,
    }));

    setSaving(true);
    try {
      await onSave({
        id: initial?.id,
        name: name.trim(),
        mobile,
        address: formatAddressDisplay(applicantAddress),
        loanType: loanType.trim(),
        loanAmount: loanAmount.trim(),
        photoUri: initial?.photoUri ?? '',
        photos: initial?.photos ?? '',
        documents: initial?.documents ?? '',
        videos: initial?.videos ?? '',
        notes: initial?.notes ?? '',
        createdAt: initial?.createdAt ?? Date.now(),
        applicationDetails: JSON.stringify(detailsObj),
        coApplicantsJson: JSON.stringify(coList),
        status: initial?.status ?? 'Pending',
      });
    } finally {
      setSaving(false);
    }
  };

  const updateCo = (idx: number, patch: Partial<CoApplicantDraft>) => {
    setCoApplicants((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };

  const loanOptions = loanType && !LOAN_TYPES.includes(loanType) ? [loanType, ...LOAN_TYPES] : LOAN_TYPES;

  return (
    <div data-customer-form-modal="true" className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
      <div className="bg-[#FDFDFF] rounded-[28px] border border-[#E3D9F4] w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-lg">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[#E3D9F4] flex items-start justify-between gap-4 bg-white">
          <div>
            <h2 className="text-xl font-bold text-[#102A43]">
              {initial ? 'Edit customer' : 'Add customer'}
            </h2>
            <p className="text-xs text-[#61758A]">
              Manage applicant and co-applicant profiles separately
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="p-1.5 rounded-lg text-[#77718A] hover:bg-[#F5F1FC]"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Person Tabs */}
        <div className="px-6 pt-3 pb-2 bg-white border-b border-[#E3D9F4] flex items-center gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setSelectedTab(0)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
              selectedTab === 0
                ? 'bg-[#7042C1] text-white'
                : 'bg-[#F0EAFB] text-[#625A78] hover:text-[#211936]'
            }`}
          >
            Applicant
          </button>
          {coApplicants.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setSelectedTab(idx + 1)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                selectedTab === idx + 1
                  ? 'bg-[#7042C1] text-white'
                  : 'bg-[#F0EAFB] text-[#625A78] hover:text-[#211936]'
              }`}
            >
              Co-applicant {idx + 1}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {selectedTab === 0 ? (
            <div className="space-y-4">
              <p className="text-xs font-bold text-[#7042C1]">APPLICANT DETAILS</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#625A78] mb-1">
                    Applicant Name *
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setError('');
                    }}
                    placeholder="Full name"
                    className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#625A78] mb-1">
                    Relationship
                  </label>
                  <select
                    value={relationship}
                    onChange={(e) => setRelationship(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
                  >
                    <option value="">Select relationship</option>
                    {RELATIONSHIPS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#625A78] mb-1">
                  Mobile Number * (10 digits)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    value={mobile}
                    onChange={(e) => {
                      setMobile(e.target.value.replace(/\D/g, '').slice(0, 10));
                      setError('');
                    }}
                    placeholder="10-digit mobile number"
                    className="flex-1 px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm font-mono-nums text-[#211936] focus:outline-none focus:border-[#7042C1]"
                  />
                  <span className="text-xs font-mono-nums text-[#77718A]">{mobile.length}/10 digits</span>
                </div>
              </div>

              <AddressFields
                title="ADDRESS DETAILS • સરનામાની વિગતો"
                value={applicantAddress}
                onChange={(updated) => {
                  setApplicantAddress(updated);
                  setCoApplicants((prev) =>
                    prev.map((co) => (co.sameAsApplicant ? { ...co, address: updated } : co))
                  );
                }}
              />

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#625A78] mb-1">
                    Working or Not Working
                  </label>
                  <select
                    value={workStatus}
                    onChange={(e) => {
                      const val = e.target.value;
                      setWorkStatus(val);
                      if (val === 'Not Working') {
                        setBusiness('');
                        setSalary('');
                        setSalaryMode('');
                        setBankAccountNumber('');
                        setBankName('');
                        setAccountHolderName('');
                        setIfsc('');
                        setBankBranch('');
                        setCheckAvailable('');
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
                  >
                    {WORK_OPTIONS.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#625A78] mb-1">
                    ITR Available?
                  </label>
                  <select
                    value={itrStatus}
                    onChange={(e) => setItrStatus(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
                  >
                    <option value="No">No</option>
                    <option value="Yes">Yes</option>
                  </select>
                </div>
              </div>

              {workStatus !== 'Not Working' && (
                <div className="space-y-3 p-4 rounded-2xl bg-[#FAF8FD] border border-[#E3D9F4]">
                  <div>
                    <label className="block text-xs font-semibold text-[#625A78] mb-1">
                      Business Description
                    </label>
                    <textarea
                      rows={2}
                      value={business}
                      onChange={(e) => setBusiness(e.target.value)}
                      placeholder="Describe occupation or business"
                      className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
                    />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#625A78] mb-1">
                        Salary / Income
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={salary}
                        onChange={(e) => setSalary(e.target.value.replace(/[^\d.,]/g, ''))}
                        placeholder="Monthly income"
                        className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm font-mono-nums text-[#211936] focus:outline-none focus:border-[#7042C1]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#625A78] mb-1">
                        Salary in Account or Cash
                      </label>
                      <select
                        value={salaryMode}
                        onChange={(e) => setSalaryMode(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
                      >
                        <option value="">Select mode</option>
                        {SALARY_MODES.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {salaryMode === 'In Account' && (
                    <BankFields
                      accountNumber={bankAccountNumber}
                      onAccountNumber={setBankAccountNumber}
                      bankName={bankName}
                      onBankName={setBankName}
                      holderName={accountHolderName}
                      onHolderName={setAccountHolderName}
                      ifsc={ifsc}
                      onIfsc={setIfsc}
                      branchName={bankBranch}
                      onBranchName={setBankBranch}
                      checkAvailable={checkAvailable}
                      onCheckAvailable={setCheckAvailable}
                    />
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#625A78] mb-1">Email ID</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value.trim())}
                  placeholder="applicant@example.com"
                  className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
                />
              </div>

              <div className="pt-3 border-t border-[#E3D9F4] space-y-3">
                <p className="text-xs font-bold text-[#7042C1]">HOUSEHOLD & LOAN DETAILS</p>
                <div className="grid sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#625A78] mb-1">
                      Total Members in Home
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={3}
                      value={totalMembers}
                      onChange={(e) => setTotalMembers(e.target.value.replace(/\D/g, '').slice(0, 3))}
                      placeholder="e.g. 4"
                      className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm font-mono-nums text-[#211936] focus:outline-none focus:border-[#7042C1]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#625A78] mb-1">
                      Loan Type
                    </label>
                    <select
                      value={loanType}
                      onChange={(e) => setLoanType(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
                    >
                      <option value="">Select loan type</option>
                      {loanOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#625A78] mb-1">
                      Loan amount
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={loanAmount}
                      onChange={(e) => setLoanAmount(e.target.value.replace(/[^\d.,]/g, ''))}
                      placeholder="e.g. 500000"
                      className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm font-mono-nums text-[#211936] focus:outline-none focus:border-[#7042C1]"
                    />
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-xs font-semibold text-[#625A78] mb-1">
                      Customer ID
                    </label>
                    <input
                      type="text"
                      value={customerId}
                      onChange={(e) => setCustomerId(e.target.value)}
                      placeholder="Enter Customer ID"
                      className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm font-mono-nums text-[#211936] focus:outline-none focus:border-[#7042C1]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#625A78] mb-1">
                      Loan ID
                    </label>
                    <input
                      type="text"
                      value={loanId}
                      onChange={(e) => setLoanId(e.target.value)}
                      placeholder="Enter Loan ID"
                      className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm font-mono-nums text-[#211936] focus:outline-none focus:border-[#7042C1]"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-[#77718A]">
                  Customer ID and Loan ID reflect on the dashboard and profile when file status is Approved.
                </p>
              </div>
            </div>
          ) : (
            (() => {
              const idx = selectedTab - 1;
              const person = coApplicants[idx];
              if (!person) return null;
              return (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-[#7042C1]">
                      CO-APPLICANT {idx + 1} DETAILS
                    </p>
                    {coApplicants.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setCoApplicants((prev) => prev.filter((_, i) => i !== idx));
                          setSelectedTab((prev) => Math.max(0, prev - 1));
                        }}
                        className="text-xs font-semibold text-[#B3261E] flex items-center gap-1 hover:underline"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#625A78] mb-1">
                        Co-applicant Name
                      </label>
                      <input
                        type="text"
                        value={person.name}
                        onChange={(e) => updateCo(idx, { name: e.target.value })}
                        placeholder="Full name"
                        className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#625A78] mb-1">
                        Relationship
                      </label>
                      <select
                        value={person.relationship}
                        onChange={(e) => updateCo(idx, { relationship: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
                      >
                        <option value="">Select relationship</option>
                        {RELATIONSHIPS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#625A78] mb-1">
                      Mobile Number (10 digits)
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="tel"
                        inputMode="numeric"
                        maxLength={10}
                        value={person.mobile}
                        onChange={(e) =>
                          updateCo(idx, { mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })
                        }
                        placeholder="10-digit mobile number"
                        className="flex-1 px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm font-mono-nums text-[#211936] focus:outline-none focus:border-[#7042C1]"
                      />
                      <span className="text-xs font-mono-nums text-[#77718A]">
                        {person.mobile.length}/10 digits
                      </span>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-xs font-semibold text-[#7042C1] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={person.sameAsApplicant}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        updateCo(idx, {
                          sameAsApplicant: checked,
                          address: checked ? applicantAddress : person.address,
                        });
                      }}
                      className="w-4 h-4 accent-[#7042C1]"
                    />
                    Same as Applicant • અરજદાર જેવું જ સરનામું
                  </label>

                  <AddressFields
                    title="ADDRESS DETAILS • સરનામાની વિગતો"
                    value={person.address}
                    onChange={(updated) =>
                      updateCo(idx, { address: updated, sameAsApplicant: false })
                    }
                  />

                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#625A78] mb-1">
                        Working or Not Working
                      </label>
                      <select
                        value={person.workStatus}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'Not Working') {
                            updateCo(idx, {
                              workStatus: val,
                              business: '',
                              salary: '',
                              salaryMode: '',
                              bankAccountNumber: '',
                              bankName: '',
                              accountHolderName: '',
                              ifsc: '',
                              branchName: '',
                              checkAvailable: '',
                            });
                          } else {
                            updateCo(idx, { workStatus: val });
                          }
                        }}
                        className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
                      >
                        {WORK_OPTIONS.map((w) => (
                          <option key={w} value={w}>
                            {w}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#625A78] mb-1">
                        ITR Available?
                      </label>
                      <select
                        value={person.itrStatus}
                        onChange={(e) => updateCo(idx, { itrStatus: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
                      >
                        <option value="No">No</option>
                        <option value="Yes">Yes</option>
                      </select>
                    </div>
                  </div>

                  {person.workStatus !== 'Not Working' && (
                    <div className="space-y-3 p-4 rounded-2xl bg-[#FAF8FD] border border-[#E3D9F4]">
                      <div>
                        <label className="block text-xs font-semibold text-[#625A78] mb-1">
                          Business Description
                        </label>
                        <textarea
                          rows={2}
                          value={person.business}
                          onChange={(e) => updateCo(idx, { business: e.target.value })}
                          placeholder="Describe occupation or business"
                          className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
                        />
                      </div>
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-[#625A78] mb-1">
                            Salary / Income
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={person.salary}
                            onChange={(e) =>
                              updateCo(idx, { salary: e.target.value.replace(/[^\d.,]/g, '') })
                            }
                            placeholder="Monthly income"
                            className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm font-mono-nums text-[#211936] focus:outline-none focus:border-[#7042C1]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-[#625A78] mb-1">
                            Salary in Account or Cash
                          </label>
                          <select
                            value={person.salaryMode}
                            onChange={(e) => updateCo(idx, { salaryMode: e.target.value })}
                            className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
                          >
                            <option value="">Select mode</option>
                            {SALARY_MODES.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {person.salaryMode === 'In Account' && (
                        <BankFields
                          accountNumber={person.bankAccountNumber}
                          onAccountNumber={(v) => updateCo(idx, { bankAccountNumber: v })}
                          bankName={person.bankName}
                          onBankName={(v) => updateCo(idx, { bankName: v })}
                          holderName={person.accountHolderName}
                          onHolderName={(v) => updateCo(idx, { accountHolderName: v })}
                          ifsc={person.ifsc}
                          onIfsc={(v) => updateCo(idx, { ifsc: v })}
                          branchName={person.branchName}
                          onBranchName={(v) => updateCo(idx, { branchName: v })}
                          checkAvailable={person.checkAvailable}
                          onCheckAvailable={(v) => updateCo(idx, { checkAvailable: v })}
                        />
                      )}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-[#625A78] mb-1">Email ID</label>
                    <input
                      type="email"
                      value={person.email}
                      onChange={(e) => updateCo(idx, { email: e.target.value.trim() })}
                      placeholder="coapplicant@example.com"
                      className="w-full px-3 py-2 rounded-xl border border-[#D4D8E1] bg-white text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
                    />
                  </div>
                </div>
              );
            })()
          )}

          <button
            type="button"
            onClick={() => {
              if (coApplicants.length < 10) {
                setCoApplicants((prev) => [...prev, emptyCoApplicant()]);
                setSelectedTab(coApplicants.length + 1);
                setError('');
              } else {
                setError('Maximum 10 co-applicants can be added');
              }
            }}
            className="w-full py-2.5 px-4 rounded-xl border border-[#E3D9F4] text-[#7042C1] text-xs font-bold flex items-center justify-center gap-2 hover:bg-[#F0EAFB]"
          >
            <UserPlus className="w-4 h-4" />
            Add More Co-applicant
          </button>

          {error && <p className="text-xs font-semibold text-[#B3261E]">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-white border-t border-[#E3D9F4] flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onDismiss}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-[#43536D] hover:bg-[#F5F1FC]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="px-5 py-2.5 rounded-xl bg-[#7042C1] hover:bg-[#5E35A8] text-white text-sm font-semibold transition-colors disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save customer'}
          </button>
        </div>
      </div>
    </div>
  );
};
