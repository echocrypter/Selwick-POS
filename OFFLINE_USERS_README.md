# Offline Staff Users

Offline Mode now prompts for an Owner PIN (exactly 4 digits) the first time on each browser profile. This is stored separately from existing POS records. After login, open Users to add cashiers (and managers if Owner). Use the bottom-right Switch User / Lock button to change staff accounts. Cashiers see POS Register and Customers only.

**Limitations:** This is basic local UI access control, not secure authentication. Anyone who can modify browser storage, source code or developer tools can bypass restrictions. Do not use it as a security boundary for sensitive data or high-trust staff. Use Supabase Cloud Mode for server-enforced permissions. Local users do not sync across devices or cloud, and the PIN cannot be recovered if lost. Back up POS data before replacing files. No Supabase migration is required for this offline feature.

New Owner and staff PINs must be exactly 4 digits. Existing longer PINs remain usable for login to avoid locking out existing users.
