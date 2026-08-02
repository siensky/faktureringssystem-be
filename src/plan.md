

rojektbeskrivning: Automatiserat faktureringssystem med betalningsmatchning

Detta projekt syftar till att utveckla ett webbaserat faktureringssystem som automatiserar hela faktureringsprocessen – från skapande av fakturor till uppföljning av betalningar.

Systemet ska möjliggöra skapande av både engångsfakturor och återkommande fakturor (t.ex. månadsvis). Varje faktura tilldelas ett unikt OCR-nummer som används för att identifiera inkommande betalningar. En PDF-genereras och ett mejl skickas till kunden med PDFen bifogad alternativt länkad.

En central funktion i systemet är integration med banktransaktioner, där systemet automatiskt analyserar inkommande betalningar och matchar dessa mot fakturor baserat på OCR-nummer. När en betalning identifieras markeras fakturan som betald.
För obetalda fakturor efter förfallodatum ska systemet automatiskt generera och skicka påminnelsefakturor via e-post. Den ska kunna uppdatera skulden genom att tillsätta en påminnelseavgift, och om en kund har gjort en ofullständig inbetalning ska den även dra av det från skulden.

Projektet inkluderar:
- En backend server med administrativa endpoints för att hantera kunder, fakturor och betalningar
- En backoffice frontend gränssnitt för administratörer
- En kundportal frontend ("Mina sidor") där kunder kan logga in och se sina fakturor och betalstatus.

Målet är att skapa ett skalbart och automatiserat system som minskar manuellt arbete och förbättrar uppföljning av betalningar.

planen är sen att bryta ut dessa i mikrotjänster och att få dem att fungera med rabbit mq och att skriva en av mikrotjänsterna i python

# admin 
- skapa ny faktura
- ta bort faktura
- redigera faktura
- se kunder
- se fakturor
- se kunders fakturor
- se en faktura i taget

# kundportal 
- register
- login
- se alla fakturor
- klicka på en faktura
- betala en faktura

funktioner
- skapa ny faktura generera automatiskt ocr nummer
- när fakturan skapas en pdf med faktura som automatiskt skickas till kunden via mejl. 
- skapa engångs faktura eller återkommande faktura
- när en betalning görs så letar man efter matchande ocr nummer och markerar den som betalad
- funktion som kollar om fakturor är obetalade varje dag och genererar en ny påminnelse faktura med nytt belopp och skapar pdf och skickar mejlpå det. 
- funktion som uppdaterar fakturan till nytt belopp om kund gör ofullständig inbetalning.
- logga in med bankid

- admin creates customer

    Email + lösenord
* JWT auth
* Email verification
* Optional magic link

 POST /auth/login

POST /auth/register

POST /auth/logout

POST /auth/refresh

POST /auth/forgot-password

POST /auth/reset-password


övriga:
- errors
- auth
- mappers


# endpoints

POST /auth/bankid
POST /admin/login

POST /admin/invoice s 
PUT /admin/invoics/:id
DELETE /admin/invoices/:id
GET /admin/invoices
GET /admin/invoices/:id
POST /admin/customers
PUT /admin/customers/:id
GET /admin/customers
GET /admin/customers/:id

GET /invoices
GET /invoices/:id
GET /payments
GET /payments/:id
POST /payments


admin is my companys admin or is it each company as an own admin

saas when companies register invoice alown



# databas postgres


customers:
id
uuid
social_security_number


admin:


payments:

invoice:



CREATE TABLE admins (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    auth0_id TEXT UNIQUE NOT NULL,
    company_name TEXT NOT NULL,
    org_number TEXT UNIQUE NOT NULL,
    bankgiro TEXT NOT NULL,
    vat_number TEXT,
    address_street TEXT,
    zip_code TEXT,
    city TEXT,
    logo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TYPE customer_type AS ENUM ('company', 'private');

CREATE TABLE customers (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    admin_id INTEGER NOT NULL,
    type customer_type NOT NULL DEFAULT 'company',
    name TEXT NOT NULL,
    org_or_pnr TEXT NOT NULL,
    email TEXT NOT NULL,
    address_street TEXT,
    zip_code TEXT,
    city TEXT,
    payment_terms_days INTEGER DEFAULT 30,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
);

CREATE TYPE invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue', 'credited');


CREATE TABLE invoices (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    admin_id INTEGER NOT NULL,
    invoice_number INTEGER NOT NULL,
    ocr_number TEXT UNIQUE NOT NULL,
    status invoice_status DEFAULT 'draft',
    date_issued DATE NOT NULL DEFAULT CURRENT_DATE,
    date_due DATE NOT NULL,
    currency VARCHAR(3) DEFAULT 'SEK',
    total_excl_vat DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    total_vat DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    total_incl_vat DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    parent_template_id INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
);

CREATE TYPE recurrence_interval AS ENUM ('monthly', 'quarterly', 'yearly');

CREATE TABLE invoice_templates (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    admin_id INTEGER NOT NULL,
    customer_id INTEGER NOT NULL,
    interval recurrence_interval NOT NULL,
    next_generation_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    template_data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE invoice_items (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    quantity DECIMAL(12, 2) NOT NULL DEFAULT 1.00,
    unit TEXT DEFAULT 'st',
    price_per_unit DECIMAL(15, 2) NOT NULL,
    vat_rate DECIMAL(5, 2) NOT NULL,
    total_price DECIMAL(15, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);
`);
};