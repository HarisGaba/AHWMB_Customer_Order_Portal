

# Part 2 invoice implementation notes

- The supplied black-and-white invoice reference is stored at `public/invoice-template.png` and is used as the PDF canvas background so its border, logo, typography treatment, table structure, balance section, total plaque, and footer remain aligned to the reference.
- The admin invoice editor now provides Total Balance, Deposit, and a calculated Remaining Balance (`Total Balance - Deposit`). The three values are rendered in the PDF and persisted on `orders` through `total_balance`, `deposit`, and `remaining_balance` columns after applying `supabase/schema.sql`.
- Save & Print downloads the PDF and invokes print preview through a hidden iframe in the current window. It does not open a new browser tab or popup.
- The Share PDF File action uses the Web Share API with a PDF `File` only. It does not include the admin route, dashboard URL, or any internal link. Unsupported browsers keep the downloaded PDF available for manual attachment.
