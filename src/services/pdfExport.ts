import { jsPDF } from 'jspdf';
import type { Customer } from '../types/customer';
import { triggerBlobDownload } from './backup';

function labelFor(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function exportCustomerProfilePdf(customer: Customer): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 46;
  const maxWidth = pageWidth - margin * 2;
  let y = 54;

  const ensureSpace = (needed = 22) => {
    if (y > pageHeight - needed - 40) {
      doc.addPage();
      y = 54;
    }
  };

  const drawWrappedLine = (text: string, fontSize = 11, color: [number, number, number] = [38, 31, 55], bold = false, gap = 16) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(fontSize);
    doc.setTextColor(color[0], color[1], color[2]);
    const lines = doc.splitTextToSize(text, maxWidth) as string[];
    for (const line of lines) {
      ensureSpace(gap);
      doc.text(line, margin, y);
      y += gap;
    }
  };

  const drawSection = (title: string) => {
    ensureSpace(60);
    y += 10;
    drawWrappedLine(title, 15, [112, 66, 193], true, 20);
    doc.setDrawColor(225, 216, 239);
    doc.setLineWidth(1);
    doc.line(margin, y - 10, pageWidth - margin, y - 10);
    y += 4;
  };

  const appendObject = (obj: Record<string, unknown>, prefix = '') => {
    for (const [key, value] of Object.entries(obj)) {
      const normalized = key.toLowerCase();
      if (
        normalized.includes('document') ||
        normalized.includes('fileuri') ||
        normalized === 'files' ||
        normalized === 'attachments' ||
        normalized.includes('scanuri') ||
        normalized.includes('documenturi')
      ) {
        continue;
      }
      if (value === null || value === undefined || value === '') continue;
      const label = prefix ? `${prefix} • ${labelFor(key)}` : labelFor(key);
      if (Array.isArray(value)) {
        value.forEach((child, idx) => {
          if (child && typeof child === 'object') {
            drawWrappedLine(`${label} – ${idx + 1}`, 12, [38, 31, 55], true, 18);
            appendObject(child as Record<string, unknown>);
          } else if (child !== null && child !== undefined) {
            drawWrappedLine(`${label}: ${String(child)}`);
          }
        });
      } else if (typeof value === 'object') {
        appendObject(value as Record<string, unknown>, label);
      } else {
        drawWrappedLine(`${label}: ${String(value)}`);
      }
    }
  };

  drawWrappedLine('CUSTOMER MANAGER', 17, [112, 66, 193], true, 24);
  drawWrappedLine('COMPLETE CUSTOMER PROFILE', 12.5, [38, 31, 55], true, 22);

  drawSection('Customer Details');
  drawWrappedLine(`Name: ${customer.name}`);
  drawWrappedLine(`Mobile: ${customer.mobile}`);
  drawWrappedLine(`Address: ${customer.address || '—'}`);
  drawWrappedLine(`Loan Type: ${customer.loanType || '—'}`);
  drawWrappedLine(`Loan Amount: ${customer.loanAmount || '—'}`);
  drawWrappedLine(`Status: ${customer.status}`);
  drawWrappedLine(
    `Created: ${new Date(customer.createdAt).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })}`
  );

  let details: Record<string, unknown> = {};
  try {
    details = JSON.parse(customer.applicationDetails || '{}');
  } catch {
    details = {};
  }
  if (customer.status !== 'Approved') {
    delete details.customerId;
    delete details.loanId;
  }
  drawSection('Applicant – Complete Details');
  appendObject(details);

  let coApplicants: Array<Record<string, unknown>> = [];
  try {
    coApplicants = JSON.parse(customer.coApplicantsJson || '[]');
  } catch {
    coApplicants = [];
  }
  coApplicants.forEach((co, index) => {
    const coName = typeof co.name === 'string' && co.name.trim() ? co.name : 'Details';
    drawSection(`Co-Applicant ${index + 1} – ${coName}`);
    appendObject(co);
  });

  drawSection('Notes');
  drawWrappedLine(customer.notes?.trim() || 'No notes added');

  const safeName = (customer.name || 'Customer').replace(/[^A-Za-z0-9_-]/g, '_');
  const pdfBlob = doc.output('blob');
  triggerBlobDownload(pdfBlob, `${safeName}-details.pdf`);
}

async function normalizeImageForPdf(
  blob: Blob
): Promise<{ dataUrl: string; width: number; height: number }> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode image file'));
      el.src = objectUrl;
    });

    const srcW = img.naturalWidth || img.width || 1;
    const srcH = img.naturalHeight || img.height || 1;
    const maxDim = 2000;
    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    const targetW = Math.max(1, Math.round(srcW * scale));
    const targetH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      const dataUrl = await blobToDataUrl(blob);
      return { dataUrl, width: srcW, height: srcH };
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);
    return {
      dataUrl: canvas.toDataURL('image/jpeg', 0.9),
      width: targetW,
      height: targetH,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

export async function createPdfFromImageBlobs(
  items: Array<{ blob: Blob; mimeType?: string }>
): Promise<Blob> {
  if (items.length === 0) throw new Error('No images selected');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let i = 0; i < items.length; i++) {
    if (i > 0) doc.addPage();
    const { dataUrl, width, height } = await normalizeImageForPdf(items[i].blob);
    const scale = Math.min((pageWidth - 32) / width, (pageHeight - 32) / height);
    const drawW = width * scale;
    const drawH = height * scale;
    const x = (pageWidth - drawW) / 2;
    const y = (pageHeight - drawH) / 2;
    doc.addImage(dataUrl, 'JPEG', x, y, drawW, drawH);
  }

  return doc.output('blob');
}
