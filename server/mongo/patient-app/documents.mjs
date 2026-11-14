import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

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
