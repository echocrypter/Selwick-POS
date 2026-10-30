# Selwick POS — final UI polish

- Removed the offline-first notification strip above the app.
- Moved local account name, role, terminal information, and Switch User / Lock into **Users → My Account**. Cashiers can access only this account panel, not team management.
- Updated Sales History's date-range buttons and XLSX export button to royal purple.
- Made the POS checkout panel use a four-row grid so the cart is independently scrollable while the totals and Pay & Charge remain visible. Responsive small-screen layout no longer forces a 650px-tall register.

This is a UI/navigation change. Existing data storage, sales, PINs, and backups were not intentionally modified.

Note: A complete Next.js build and browser validation could not be run in this environment because the installed dependencies were not available in working form. Please test at your actual screen height.
