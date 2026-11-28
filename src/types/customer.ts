export type CustomerStatus = 'Pending' | 'Approved' | 'Reject';

export interface AddressDraft {
  houseNo: string;
  street: string;
  villageCity: string;
  taluka: string;
  district: string;
  state: string;
  pinCode: string;
}

export interface UploadedDocFile {
  uri: string;
  name: string;
  source: 'Imported' | 'Scanner' | string;
}

export interface ChecklistBucket {
  [key: string]: boolean | string[] | UploadedDocFile[] | undefined;
}

export interface DocumentChecklistData {
  [bucketKey: string]: ChecklistBucket | undefined;
}

export interface ApplicationDetails {
  customerId?: string;
  loanId?: string;
  relationship?: string;
  workStatus?: string;
  business?: string;
  salary?: string;
  salaryMode?: string;
  email?: string;
  totalMembers?: string;
  bankAccountNumber?: string;
  bankName?: string;
  accountHolderName?: string;
  ifsc?: string;
  bankBranch?: string;
  checkAvailable?: string;
  addressHouseNo?: string;
  addressStreet?: string;
  villageCity?: string;
  addressTaluka?: string;
  addressDistrict?: string;
  addressState?: string;
  addressPinCode?: string;
  itrStatus?: string;
  documentChecklist?: DocumentChecklistData;
  [key: string]: unknown;
}

export interface CoApplicantData {
  name: string;
  relationship: string;
  mobile: string;
  address: string;
  addressHouseNo: string;
  addressStreet: string;
  villageCity: string;
  addressTaluka: string;
  addressDistrict: string;
  addressState: string;
  addressPinCode: string;
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
  bankBranch: string;
  checkAvailable: string;
  itrStatus: string;
}

export interface Customer {
  id: number;
  name: string;
  mobile: string;
  address: string;
  loanType: string;
  loanAmount: string;
  photoUri: string;
  photos: string;
  documents: string;
  videos: string;
  notes: string;
  createdAt: number;
  applicationDetails: string;
  coApplicantsJson: string;
  status: CustomerStatus;
}

export interface StoredBackupInfo {
  id: string;
  fileName: string;
  size: number;
  createdAt: number;
  blob: Blob;
}
