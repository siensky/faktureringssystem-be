admins (The Company/User issuing invoices)
id: UUID (Primary Key)

auth0_id: String (Unique link to Auth0)

company_name: String

org_number: String (Unique)

bankgiro: String

vat_number: String (Momsregistreringsnummer)

address_street, zip_code, city: String

logo_url: String (For the PDF)

2. customers
id: UUID

admin_id: UUID (Foreign Key -> admins.id)

type: Enum ('company', 'private')

name: String

org_or_pnr: String (Organization or Personal Number)

email: String

address_street, zip_code, city: String

payment_terms_days: Integer (Default e.g., 30)

3. invoices
id: UUID

customer_id: UUID (FK)

admin_id: UUID (FK)

invoice_number: Integer (Serial/Sequential)

ocr_number: String (Unique)

status: Enum ('draft', 'sent', 'paid', 'overdue', 'credited')

date_issued: Date

date_due: Date

currency: String (Default 'SEK')

total_excl_vat: Decimal

total_vat: Decimal

total_incl_vat: Decimal

4. invoice_items (The rows on the invoice)
id: UUID

invoice_id: UUID (FK -> invoices.id)

description: String

quantity: Decimal

unit: String (st, tim, etc.)

price_per_unit: Decimal

vat_rate: Decimal (0.25, 0.12, 0.06)

total_price: Decimal


plan




1. Administrative Endpoints (/api/admin)
These are the routes your Backoffice Frontend will use. They should be protected by Auth0 roles so only admins can access them.

Customer Management
POST /customers – Register a new customer (Företag/Privatperson).

GET /customers – List all customers with search/filter.

GET /customers/:id – View specific customer history (all their invoices).

PUT /customers/:id – Update contact details.

Invoice Management
POST /invoices – Create a new invoice (triggers OCR generation).

GET /invoices – List all invoices (filter by status: paid, overdue, pending).

GET /invoices/:id – Detailed view of a single invoice.

POST /invoices/:id/send – Manually trigger the email sending if needed.

POST /invoices/:id/credit – Create a credit invoice (if something went wrong).

Company/Profile Settings
GET /profile – Get the admin's company info (Org nr, Bankgiro).

PUT /profile – Update bank details or upload a logo.

2. Customer Portal Endpoints (/api/portal)
These routes are for "Mina Sidor." The Auth0 token here will be linked to a customer_id instead of an admin_id.

GET /my-invoices – Returns only the invoices belonging to the logged-in customer.

GET /my-invoices/:id/pdf – Secure link to download the PDF.

GET /account-summary – Shows total outstanding debt.

3. The "Automator" (Internal Logic & Workers)
These aren't necessarily public routes, but logic blocks or "Cron Jobs" that run on a schedule (e.g., every night at 03:00).

Payment Matcher: A function that reads an incoming file (like a Bankgiro .tlr file or a simulated bank API), loops through the transactions, and matches the OCR against the invoices table.

Late Payment Checker: A daily job that:

Checks for invoices where due_date < today and status != 'paid'.

Updates status to overdue.

Creates a Reminder Invoice (Påminnelsefaktura) with the added fee (usually 60 SEK in Sweden).

Recurring Invoice Generator: A monthly job that looks for templates and creates new invoices for the next period.

4. System & Integration Endpoints
POST /webhooks/payment-received – If you use a real payment provider (like Stripe or a mock bank), they will "ping" this route when money arrives.

GET /health – To check if the server is up.