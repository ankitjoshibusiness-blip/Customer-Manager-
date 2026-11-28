# Customer Manager

A React + TypeScript + Vite web application for managing loan customer profiles, co-applicants, document checklists, GPS-stamped photos/videos, EMI calculations, and encrypted local backups.

## Features

- **App Security Gate & Settings**: PIN (4–8 digits) or 3×3 interactive Pattern lock using PBKDF2-SHA256 hashing, 10-character recovery code, failed-attempt lockout protection, background/inactivity auto-lock, and an audit activity log.
- **Customer Dashboard**: Overview metrics (Total, Pending, Approved, Rejected), live search by name or mobile number, inline status updates, and automatic first-launch demo customer seeding.
- **Applicant & Co-Applicant Forms**: Separate tabs for primary applicant and up to 10 co-applicants, bilingual (English + Gujarati) address fields with automatic 6-digit Indian PIN code lookup, IFSC bank branch auto-lookup, and "Same as Applicant" address syncing.
- **Customer Profile Workspace**:
  - Customizable left navigation menu (`Application`, `Photos`, `Videos`, `Documents`, `Notes`).
  - **Profile Photo Cropper**: Upload or capture a customer photo with a 1:1 square pan/zoom cropper.
  - **Photos & Videos + GPS Camera**: Live browser camera capture with real-time geolocation, reverse-geocoded address, Esri satellite map thumbnail, and burned-in GPS stamp overlay for photos and videos, plus multi-select ZIP download and sharing.
  - **Documents Checklist**: Track `Identity`, `Banking`, `Occupation`, `Property`, and custom documents per applicant/co-applicant, with file import, multi-image camera-to-PDF scanning, and an in-app document viewer.
  - **Notes & PDF Export**: Save and export notes (`.txt`) or generate a complete Customer Profile PDF.
- **EMI Calculator (`EmiCal`)**: Bilingual English / Gujarati (`EN` / `ગુજ`) calculator with Principal vs Interest breakdown, calculation history, and planner views.
- **Encrypted Backup & Restore**: Password-protected AES-GCM-256 (`.cmbak`) encrypted ZIP archives containing all customer records and IndexedDB media blobs.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run lint
npm run build
```
