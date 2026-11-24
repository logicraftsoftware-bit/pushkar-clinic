import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { readFile } from 'node:fs/promises';

async function paintClinicLogo(doc, logo) {
  const embedded = typeof logo === 'string' && logo.length <= 750000
    ? /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.exec(logo)
    : null;
  const images = embedded ? [logo] : [];
  try {
    images.push(await readFile(new URL('../../../public/branding/pushkar-logo.png', import.meta.url)));
  } catch {
    // The clinic name is still printed when the bundled image is unavailable.
  }
  for (const image of images) {
    try {
      const { width, height } = doc.getImageProperties(image);
      const scale = Math.min(47 / width, 23 / height);
      doc.addImage(image, 194 - width * scale, 12, width * scale, height * scale);
      return;
    } catch {
      // Unsupported clinic artwork falls back to the bundled PNG.
    }
  }
}

export async function patientPdf({ title, reference, clinic, logo, sections, qr }) {
  const doc = new jsPDF({ compress: true });
  let y;
  const start = () => {
    doc.setFillColor('#084b7e');
    doc.rect(0, 0, 210, 53, 'F');
    doc.setTextColor('#e5f3fb');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(clinic || 'PUSHKAR CLINIC ERP', 16, 17, { maxWidth: 125 });
    doc.setTextColor('#ffffff');
    doc.setFontSize(25);
    doc.text(title, 16, 32);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(String(reference ?? ''), 16, 43);
    y = 64;
  };
  const reserve = height => {
    if (y + height > 271) {
      doc.addPage();
      start();
    }
  };
  start();
  for (const section of sections) {
    reserve(24);
    doc.setFillColor('#eaf4fc');
    doc.roundedRect(16, y, 178, 10, 2, 2, 'F');
    doc.setTextColor('#084b7e');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(section.title, 20, y + 6.5);
    y += 12;
    for (const [label, value] of section.rows) {
      doc.setFont('helvetica', 'normal');
      const labels = doc.splitTextToSize(String(label), 82);
      const values = doc.splitTextToSize(String(value ?? '—').replace(/₹/g, 'INR '), 80);
      const height = Math.max(labels.length, values.length) * 5 + 5;
      reserve(height);
      doc.setTextColor('#456078');
      doc.text(labels, 20, y + 5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor('#102b45');
      doc.text(values, 190, y + 5, { align: 'right' });
      doc.setDrawColor('#dce7f0');
      doc.line(16, y + height, 194, y + height);
      y += height;
    }
    y += 8;
  }
  if (qr) {
    reserve(64);
    const image = await QRCode.toDataURL(qr, { width: 400, margin: 4 });
    doc.setFillColor('#eaf4fc');
    doc.roundedRect(16, y, 178, 58, 3, 3, 'F');
    doc.addImage(image, 'PNG', 20, y + 5, 48, 48);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor('#084b7e');
    doc.text('Appointment check-in', 76, y + 23);
    doc.setFont('helvetica', 'normal');
    doc.text('Show this QR code at clinic reception.', 76, y + 32);
  }
  for (let page = 1; page <= doc.getNumberOfPages(); page++) {
    doc.setPage(page);
    await paintClinicLogo(doc, logo);
    doc.setTextColor('#526b83');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Private patient document', 16, 286);
    doc.text(String(page), 194, 286, { align: 'right' });
  }
  return Buffer.from(doc.output('arraybuffer'));
}

export async function simplePdf(title, lines, qr) {
  const doc = new jsPDF();
  let y = 22;
  doc.setFontSize(19);
  doc.text(title, 16, y);
  y += 14;
  doc.setFontSize(11);
  for (const line of lines) {
    const wrapped = doc.splitTextToSize(String(line ?? ''), 178);
    for (const part of wrapped) {
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
      doc.text(part, 16, y);
      y += 7;
    }
    y += 2;
  }
  if (qr) {
    if (y > 220) {
      doc.addPage();
      y = 20;
    }
    const image = await QRCode.toDataURL(qr, { width: 220, margin: 2 });
    doc.addImage(image, 'PNG', 16, y, 48, 48);
  }
  return Buffer.from(doc.output('arraybuffer'));
}
export function sendPdf(res, name, bytes) {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${name.replace(
      /[^A-Za-z0-9_.-]/g,
      '_'
    )}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(bytes);
}
