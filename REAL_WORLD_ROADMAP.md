# Tomato real-world upgrade roadmap

Implemented sequentially so each release remains deployable and testable.

- [x] 01 — PostgreSQL production database + Prisma migrations + legacy SQLite import helper
- [x] 02 — Real payment gateway hardening (SSLCOMMERZ production flow alongside manual/COD)
- [x] 03 — Restaurant opening hours + temporary/holiday closure + accepting-orders control
- [x] 04 — Delivery zones, area-based fees, minimum order and free-delivery threshold
- [x] 05 — Scheduled delivery / pickup time slots and capacity
- [x] 06 — Live order timeline and customer-facing tracking
- [x] 07 — Order notifications (email/browser push foundation)
- [x] 08 — PWA installability and offline fallback
- [x] 09 — Guest checkout and post-order account linking
- [x] 10 — Product variants, sizes, add-ons and special instructions
- [x] 11 — Stronger stock/availability controls and concurrency safeguards
- [x] 12 — Saved addresses and one-click reorder
- [x] 13 — Advanced search, dietary filters, price/rating/popularity sorting
- [x] 14 — Expanded admin sales/customer/product analytics + CSV export
- [x] 15 — Kitchen display mode (NEW / PREPARING / READY) with timers
- [x] 16 — Printable/downloadable invoice and receipt workflow
- [ ] 17 — Customer cancellation windows + admin refund/reconciliation rules
- [ ] 18 — Auth hardening: email verification, password reset, admin 2FA/session controls
- [ ] 19 — Production monitoring, structured error tracking and operational health checks
- [ ] 20 — SEO, Open Graph, sitemap, robots and structured restaurant/product metadata
- [ ] Final — Cross-device QA, accessibility, security and deployment audit
