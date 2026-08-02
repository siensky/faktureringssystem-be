/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`

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

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS invoice_items;
    DROP TABLE IF EXISTS invoice_templates;
    DROP TABLE IF EXISTS invoices;
    DROP TABLE IF EXISTS customers;
    DROP TABLE IF EXISTS admins;

    DROP TYPE IF EXISTS recurrence_interval;
    DROP TYPE IF EXISTS invoice_status;
    DROP TYPE IF EXISTS customer_type;
  `);
};