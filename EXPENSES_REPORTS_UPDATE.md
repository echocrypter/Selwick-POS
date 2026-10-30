# Expenses & Reports (Offline-First)

- Owner/Manager sidebar: Expenses & Reports. Cashiers cannot access it through the UI.
- Add, edit, delete expenses (date, category, description, amount).
- Monthly and yearly revenue, cost of goods sold, gross profit, expenses and estimated net profit.
- Completed sales only; refunds and cancelled sales excluded.
- Export Excel workbook with Summary, Expenses and Sales sheets.
- Expenses are stored locally in `pos_expenses`, separate from the existing POS records.
- Local backup format v3 now includes `pos_expenses`; older v1/v2 backups remain importable. Restoring an older backup does not overwrite expenses (because they were absent in the backup).
- No changes to cloud database schemas; expenses screen is only shown in Offline Mode.
- Important: This is an estimated profit report based on the product cost stored in each sale. Zero/missing cost is flagged; it is not a tax, accrual-accounting or cash-flow report.
