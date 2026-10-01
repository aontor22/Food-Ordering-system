# UI Layout Stabilization — Authentication + Admin

This release is a frontend-only layout hardening pass based on the post-Step-20/final-QA source.

## Authentication modal

- Removed the dialog's nested vertical scrollbar for normal laptop/desktop sign-in heights.
- The overlay owns overflow on genuinely short viewports, so content remains reachable without a scrollbar cutting through the modal.
- Added a compact layout for short laptop screens (`max-height: 820px`).
- Kept the mobile bottom-sheet presentation and safe-area padding.
- Locked Google Identity Services content to the same available width as the form controls and clipped provider-owned iframe overflow.
- Reduced vertical spacing only where necessary; registration, reset, admin MFA and recovery-code modes remain supported.

## Admin shell

- Moved the sidebar to drawer mode at `1040px` instead of waiting until `820px`, preventing a fixed 264px sidebar from squeezing tablet/small-laptop content.
- Sidebar navigation now scrolls independently while the footer remains reachable.
- Drawer open state locks background scrolling and supports Escape-to-close.
- Added `aria-controls` / `aria-expanded` to the menu trigger.
- Hardened topbar/profile/title wrapping and truncation.

## Admin pages

- Normalized metric grids with auto-fitting columns.
- Page headers, toolbars, action groups and card headers now wrap without forcing page width.
- Tables remain horizontally scrollable only inside their own wrapper; ordinary cell text can wrap instead of expanding the whole page.
- Long identifiers/errors/metadata wrap safely.
- Admin dialogs use overlay-level scrolling rather than a second nested scrollbar.
- Product-option editor, inventory ledger, analytics charts, monitoring tables, KDS lanes, fulfillment controls and store-hours forms are constrained to their parent width.
- Mobile/tablet spacing and action-button stacking were normalized down to 320px.

## Data / backend impact

None. No Prisma schema change, migration, API change, environment variable or production-data mutation is required.

## Verification

Check at least these viewport sizes after Vercel deploy:

- 1366×768 laptop
- 1440×900 desktop
- 1024×768 tablet landscape
- 768×1024 tablet portrait
- 390×844 phone
- 360×800 phone
- 320×568 compact phone

Verify sign-in/register/forgot-password/admin-MFA modals plus every Admin navigation page, with special attention to Products, Inventory, Orders, Kitchen, Analytics, Monitoring, Store hours, Delivery zones and Scheduling.
