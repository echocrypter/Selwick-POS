import { Sale, StoreSettings } from '@/types/pos';
import { RECEIPT_VENDOR_LINE, RECEIPT_VENDOR_PHONE } from '@/utils/receiptBranding';
import { escHtml } from '@/utils/escapeHtml';

export const printThermalReceipt = (sale: Sale, settings: StoreSettings) => {
  if (typeof window === 'undefined') return;

  const is58mm = settings.printerPaperWidth === '58mm';
  const widthStyle = is58mm ? 'max-width:58mm' : 'max-width:80mm';
  const fontSize = is58mm ? '11px' : '12px';

  const printWindow = window.open('', '_blank', 'width=420,height=650');
  if (!printWindow) {
    alert('Please allow popups to print receipt');
    return;
  }

  // All dynamic fields are passed through escHtml() to prevent XSS.
  const itemsHtml = sale.items
    .map(
      (item) => `
      <tr>
        <td style="padding: 3px 0; text-align: left; vertical-align: top;">
          <div style="font-weight: 600;">${escHtml(item.product.name)}</div>
          <div style="font-size: 10px; color: #555;">${escHtml(item.product.sku)} | ${escHtml(item.quantity)} x ${escHtml(settings.currencySymbol)} ${escHtml((item.customPrice ?? item.product.price).toLocaleString())}</div>
        </td>
        <td style="padding: 3px 0; text-align: right; vertical-align: top; font-weight: 600;">
          ${escHtml(settings.currencySymbol)} ${escHtml(((item.customPrice ?? item.product.price) * item.quantity - (item.discount || 0)).toLocaleString())}
        </td>
      </tr>
    `
    )
    .join('');

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Receipt ${escHtml(sale.invoiceNumber)}</title>
        <style>
          @page {
            size: ${escHtml(settings.printerPaperWidth)} auto;
            margin: 0;
          }
          body {
            font-family: 'Courier New', Courier, monospace;
            font-size: ${fontSize};
            line-height: 1.35;
            color: #000;
            background: #fff;
            margin: 0;
            padding: 10px;
            display: flex;
            justify-content: center;
          }
          .receipt-container {
            width: 100%;
            ${widthStyle};
          }
          .center { text-align: center; }
          .right { text-align: right; }
          .bold { font-weight: bold; }
          .divider {
            border-top: 1px dashed #000;
            margin: 6px 0;
          }
          .double-divider {
            border-top: 2px dashed #000;
            margin: 6px 0;
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          .totals-row td {
            padding: 2px 0;
          }
          .grand-total {
            font-size: 15px;
            font-weight: bold;
          }
          .barcode-box {
            letter-spacing: 5px;
            font-size: 20px;
            font-family: 'Libre Barcode 39', 'Courier New', monospace;
            margin: 8px 0;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="receipt-container">
          <div class="center bold" style="font-size: 16px; text-transform: uppercase;">${escHtml(settings.storeName)}</div>
          <div class="center" style="font-size: 11px; text-transform: uppercase;">${escHtml(settings.tagline)}</div>
          <div class="center" style="font-size: 10px; margin-top: 2px;">${escHtml(settings.address)}</div>
          <div class="center" style="font-size: 10px;">Ph: ${escHtml(settings.phone)}</div>
          <div class="center" style="font-size: 10px;">Terminal: ${escHtml(settings.terminalId)}</div>
          
          <div class="divider"></div>
          
          <div style="display: flex; justify-content: space-between; font-size: 11px;">
            <span>Inv: <span class="bold">${escHtml(sale.invoiceNumber)}</span></span>
            <span>${escHtml(sale.paymentMethod.toUpperCase())}</span>
          </div>
          <div style="font-size: 10px; color: #444;">${escHtml(sale.dateStr)}</div>
          <div style="font-size: 10px; margin-top: 2px;">
            Cust: <span class="bold">${escHtml(sale.customerName)}</span>
            ${sale.customerPhone ? ` (${escHtml(sale.customerPhone)})` : ''}
          </div>

          <div class="divider"></div>

          <table>
            <thead>
              <tr style="border-bottom: 1px dashed #000; font-size: 11px;">
                <th style="text-align: left; padding-bottom: 3px;">ITEM</th>
                <th style="text-align: right; padding-bottom: 3px;">AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          <div class="divider"></div>

          <table class="totals-row">
            <tr>
              <td>Subtotal:</td>
              <td class="right">${escHtml(settings.currencySymbol)} ${escHtml(sale.subtotal.toLocaleString())}</td>
            </tr>
            ${
              sale.discount > 0
                ? `<tr>
                    <td>Discount:</td>
                    <td class="right">-${escHtml(settings.currencySymbol)} ${escHtml(sale.discount.toLocaleString())}</td>
                  </tr>`
                : ''
            }
            ${
              sale.tax > 0
                ? `<tr>
                    <td>Tax:</td>
                    <td class="right">+${escHtml(settings.currencySymbol)} ${escHtml(sale.tax.toLocaleString())}</td>
                  </tr>`
                : ''
            }
            <tr class="grand-total" style="border-top: 1px dashed #000; border-bottom: 1px dashed #000;">
              <td style="padding: 4px 0;">TOTAL:</td>
              <td class="right" style="padding: 4px 0;">${escHtml(settings.currencySymbol)} ${escHtml(sale.total.toLocaleString())}</td>
            </tr>
            <tr>
              <td style="padding-top: 4px;">Tendered:</td>
              <td class="right" style="padding-top: 4px;">${escHtml(settings.currencySymbol)} ${escHtml(sale.amountTendered.toLocaleString())}</td>
            </tr>
            <tr>
              <td class="bold">Change Due:</td>
              <td class="right bold">${escHtml(settings.currencySymbol)} ${escHtml(sale.changeDue.toLocaleString())}</td>
            </tr>
          </table>

          <div class="double-divider"></div>

          <div class="center" style="font-size: 10px; white-space: pre-line; margin-top: 4px;">
            ${escHtml(settings.receiptFooter)}
          </div>

          <div class="center" style="margin-top: 10px; font-size: 10px; letter-spacing: 2px;">
            * ${escHtml(sale.invoiceNumber)} *
          </div>
          <div class="center" style="font-size: 9px; color: #666; margin-top: 4px;">
            ${escHtml(RECEIPT_VENDOR_LINE)}<br />${escHtml(RECEIPT_VENDOR_PHONE)}
          </div>
        </div>

        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 300);
          }
        </script>
      </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
};
