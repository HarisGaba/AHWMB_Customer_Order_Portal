# AHWMB Urdu Customer Order Portal — Implementation Plan

## Product and architecture

The app remains a fully static React + Vite single-page application. The visible customer interface is native Urdu, with AHWMB kept as the short brand mark. It has three large customer fields, a responsive editable order table, ten starter rows, automatic bottom-row expansion, one optional notes/additional-items box, client-side A5 PDF generation, and a WhatsApp handoff.

- `src/App.tsx`: Urdu UI, customer form, order-row state, automatic row insertion, validation, PDF creation with exact generation timestamp, and WhatsApp message construction.
- `src/styles.css`: Noto Naskh Arabic typography, RTL layout, large inputs, taller rows, large touch targets, and responsive table scrolling.
- `public/manus-routes.json`: single `/` route declaration.
- `app.config.ts`: project logo metadata.

## Design direction

**Design movement:** native Urdu neighborhood-business order slip with a calm green storefront identity.

**Core principles:** every visible instruction is Urdu, typing is direct and obvious, row management happens automatically, and important actions are large and high contrast.

**Color philosophy:** deep green signals trust; yellow highlights the PDF action; soft mint backgrounds separate the table and shopkeeper-only fields.

**Layout paradigm:** a right-to-left vertical order sheet: AHWMB masthead, customer information, Urdu item table, extra notes, then PDF and WhatsApp actions.

**Signature elements:** bold Urdu labels, ten ready-to-use numbered rows, and large green `➕ اور سامان شامل کریں` control.

**Typography:** Noto Naskh Arabic for all visible portal text, with heavy weights for headings and controls.

## Required behavior

- Visible UI labels and helper text use native Urdu; the AHWMB brand mark remains recognizable.
- The section title is `اشیاء کی فہرست (سامان کا آرڈر)`.
- Table columns are `نمبر`, `سامان کا نام`, `مقدار`, `قیمت`, and `کل رقم`.
- Item and quantity placeholders are `مثلاً: آٹا، چینی، چائے` and `مثلاً: 10 کلو، 2 پیکٹ`.
- Locked rate and total cells display `دکاندار بھرے گا`.
- Ten empty rows render initially. When the customer types in the last available row, a new empty row is appended automatically. The large Urdu add-more button remains available as a simple fallback.
- Delete controls are large and touch-friendly.
- The PDF action is labeled `آرڈر کی پی ڈی ایف بنائیں` and the post-generation WhatsApp action is labeled `واٹس ایپ پر آرڈر بھیجیں`.
