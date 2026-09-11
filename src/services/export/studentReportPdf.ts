// src/services/export/studentReportPdf.ts
import { StudentAnalytics } from '../../types/analytics';

/**
 * 將指定 DOM 元素匯出為 A4 PDF
 *
 * 設計要點：
 *   1. 動態載入 html2canvas 與 jspdf（避免影響首屏）
 *   2. scale: 2 提高列印解析度
 *   3. 圖片等比例縮放到 A4 內容區（190mm 寬）
 *   4. 若圖片超過一頁高度，自動縮小塞進一頁
 */
export async function generateStudentReportPdf(
  element: HTMLElement,
  analytics: StudentAnalytics
): Promise<void> {
  // 1. 動態載入套件（Vite 會自動把它們拆成獨立 chunk）
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  // 2. 截圖
  const canvas = await html2canvas(element, {
    scale: 2,               // 提高解析度，列印才清楚
    backgroundColor: '#ffffff', // 強制白底（避免透明）
    useCORS: true,          // 允許跨域資源（Recharts SVG 需要）
    logging: false,
  });

  const imgData = canvas.toDataURL('image/png');

  // 3. 建立 A4 直式 PDF
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 10;
  const contentWidth = pageWidth - margin * 2; // 190mm
  const maxContentHeight = pageHeight - margin * 2; // 277mm

  // 4. 計算圖片尺寸（等比例縮放）
  const imgWidth = contentWidth;
  const naturalHeight = (canvas.height * imgWidth) / canvas.width;

  let finalWidth = contentWidth;
  let finalHeight = naturalHeight;

  // 若圖片太高，縮小以塞進一頁
  if (naturalHeight > maxContentHeight) {
    const ratio = maxContentHeight / naturalHeight;
    finalWidth = contentWidth * ratio;
    finalHeight = maxContentHeight;
  }

  // 5. 水平居中
  const xOffset = (pageWidth - finalWidth) / 2;
  pdf.addImage(imgData, 'PNG', xOffset, margin, finalWidth, finalHeight);

  // 6. 檔名：林佑綸_709_學習診斷_2026-09-11.pdf
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `${analytics.name}_${analytics.className}_學習診斷_${dateStr}.pdf`;
  pdf.save(filename);
}