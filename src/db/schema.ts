/**
 * Pocket Ops — Multi-Tenant Database Foundation (Module 1)
 *
 * Invariants:
 *  - Every table except `tenants` carries an indexed, non-null `tenant_id`.
 *  - All money is stored as integer cents. Never floats.
 *  - Columns marked SENSITIVE are masked for technician/apprentice roles
 *    (see src/lib/masking.ts) and must never reach those clients.
 *  - Public access tokens (jobs.clientToken) are >=21-char NanoIDs, never
 *    sequential ids.
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const createdAt = () =>
  integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`);

const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`);

// ---------------------------------------------------------------------------
// Tenancy root
// ---------------------------------------------------------------------------

export const tenants = sqliteTable('tenants', {
  id: text('id').primaryKey(), // nanoid
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  email: text('email'),
  phone: text('phone'),
  currency: text('currency').notNull().default('gbp'),
  timezone: text('timezone').notNull().default('Europe/London'),
  plan: text('plan', { enum: ['trial', 'solo', 'crew', 'company'] })
    .notNull()
    .default('trial'),
  // Stripe Connect (Standard) — payments settle in the tenant's own Stripe
  // account; chargesEnabled mirrors account.charges_enabled after onboarding
  stripeAccountId: text('stripe_account_id'),
  stripeChargesEnabled: integer('stripe_charges_enabled', { mode: 'boolean' })
    .notNull()
    .default(false),
  // E.164 Twilio number — inbound voice webhooks map `To` → tenant (Module 7)
  twilioNumber: text('twilio_number').unique(),
  // Google/Yelp review URL sent after payment (Module 8)
  reviewLinkUrl: text('review_link_url'),
  // VAT rate in basis points (2000 = 20% UK standard); applied on totals recompute
  taxRateBps: integer('tax_rate_bps').notNull().default(2000),
  // Shown on customer invoices — legally required for VAT-registered businesses
  vatNumber: text('vat_number'),
  // Deposit requested when a customer accepts a quote (2500 = 25%); 0 = none
  depositRateBps: integer('deposit_rate_bps').notNull().default(0),
  // Custom SMS templates; {name} and {link} placeholders supported
  missedCallMessage: text('missed_call_message'),
  reviewMessage: text('review_message'),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Price book — reusable line items (configured in Settings, used on jobs)
// ---------------------------------------------------------------------------

export const priceBookItems = sqliteTable(
  'price_book_items',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    kind: text('kind', { enum: ['labor', 'material', 'fee'] }).notNull().default('labor'),
    description: text('description').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    unitCostCents: integer('unit_cost_cents'), // SENSITIVE
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('price_book_tenant_idx').on(t.tenantId)],
);

// ---------------------------------------------------------------------------
// Identity & sessions (Module 2 consumes these)
// ---------------------------------------------------------------------------

export const USER_ROLES = ['owner', 'admin', 'technician', 'apprentice'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    email: text('email').notNull().unique(), // global-unique: login key
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    role: text('role', { enum: USER_ROLES }).notNull().default('technician'),
    hourlyCostCents: integer('hourly_cost_cents'), // SENSITIVE
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('users_tenant_idx').on(t.tenantId)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    // SHA-256 hash of the cookie token — raw token is never stored,
    // so a D1 leak cannot be replayed into a live session.
    tokenHash: text('token_hash').notNull().unique(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_tenant_idx').on(t.tenantId)],
);

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export const customers = sqliteTable(
  'customers',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'), // E.164 — matched by missed-call text-back
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    city: text('city'),
    region: text('region'),
    postalCode: text('postal_code'),
    notes: text('notes'),
    // Client hub: permanent magic link to their job/invoice/certificate history
    portalToken: text('portal_token'),
    createdAt: createdAt(),
  },
  (t) => [
    index('customers_tenant_idx').on(t.tenantId),
    index('customers_tenant_phone_idx').on(t.tenantId, t.phone),
    uniqueIndex('customers_portal_token_idx').on(t.portalToken),
  ],
);

// ---------------------------------------------------------------------------
// Job lifecycle engine (Module 4)
// ---------------------------------------------------------------------------

export const JOB_STATUSES = [
  'lead',
  'quoted',
  'approved',
  'scheduled',
  'in_progress',
  'completed',
  'invoiced',
  'paid',
  'cancelled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),
    assignedUserId: text('assigned_user_id').references(() => users.id),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status', { enum: JOB_STATUSES }).notNull().default('lead'),
    // High-entropy public token for /approve/[client_token] — the ONLY
    // credential a homeowner needs. 24-char NanoID, never a sequential id.
    clientToken: text('client_token').notNull(),
    scheduledAt: integer('scheduled_at', { mode: 'timestamp' }),
    subtotalCents: integer('subtotal_cents').notNull().default(0),
    taxCents: integer('tax_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull().default(0),
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    invoicedAt: integer('invoiced_at', { mode: 'timestamp' }),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
    paidAt: integer('paid_at', { mode: 'timestamp' }),
    // Quote acceptance via the magic link (customer-side approval)
    quoteAcceptedAt: integer('quote_accepted_at', { mode: 'timestamp' }),
    quoteAcceptedName: text('quote_accepted_name'),
    depositPaidCents: integer('deposit_paid_cents').notNull().default(0),
    // Recurring work (annual boiler service etc.): spawn a new lead N months after paid
    recurrenceMonths: integer('recurrence_months'),
    recurrenceSpawned: integer('recurrence_spawned', { mode: 'boolean' }).notNull().default(false),
    // Overdue-invoice chasing state (daily automations)
    lastChasedAt: integer('last_chased_at', { mode: 'timestamp' }),
    chaseCount: integer('chase_count').notNull().default(0),
    // CIS subcontractor invoice: VAT reverse charge + 20% deduction on labour
    cisReverseCharge: integer('cis_reverse_charge', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('jobs_tenant_idx').on(t.tenantId),
    index('jobs_tenant_status_idx').on(t.tenantId, t.status),
    index('jobs_tenant_assigned_idx').on(t.tenantId, t.assignedUserId),
    uniqueIndex('jobs_client_token_idx').on(t.clientToken),
  ],
);

export const jobLineItems = sqliteTable(
  'job_line_items',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id),
    kind: text('kind', { enum: ['labor', 'material', 'fee'] }).notNull(),
    description: text('description').notNull(),
    quantity: real('quantity').notNull().default(1),
    unitPriceCents: integer('unit_price_cents').notNull(), // customer-facing
    unitCostCents: integer('unit_cost_cents'), // SENSITIVE — supplier cost
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    index('line_items_tenant_idx').on(t.tenantId),
    index('line_items_job_idx').on(t.jobId),
  ],
);

// ---------------------------------------------------------------------------
// Sign-on-glass (Module 5)
// ---------------------------------------------------------------------------

export const signatures = sqliteTable(
  'signatures',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id),
    signerName: text('signer_name').notNull(),
    // data:image/png;base64 from the canvas. Migrate to R2 keys if size bites.
    imageDataUrl: text('image_data_url').notNull(),
    ip: text('ip'),
    signedAt: integer('signed_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index('signatures_tenant_idx').on(t.tenantId),
    index('signatures_job_idx').on(t.jobId),
  ],
);

// ---------------------------------------------------------------------------
// Payments (Module 6 webhook writes here)
// ---------------------------------------------------------------------------

export const payments = sqliteTable(
  'payments',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('gbp'),
    method: text('method', {
      enum: ['card', 'apple_pay', 'google_pay', 'cash', 'check', 'other'],
    }).notNull(),
    status: text('status', {
      enum: ['pending', 'succeeded', 'failed', 'refunded'],
    })
      .notNull()
      .default('pending'),
    stripePaymentIntentId: text('stripe_payment_intent_id').unique(),
    paidAt: integer('paid_at', { mode: 'timestamp' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('payments_tenant_idx').on(t.tenantId),
    index('payments_job_idx').on(t.jobId),
  ],
);

// ---------------------------------------------------------------------------
// Two-way SMS inbox — every text in and out, threaded by counterparty phone
// ---------------------------------------------------------------------------

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    customerId: text('customer_id').references(() => customers.id),
    direction: text('direction', { enum: ['in', 'out'] }).notNull(),
    kind: text('kind', { enum: ['sms', 'email'] }).notNull().default('sms'),
    phone: text('phone').notNull(), // counterparty: E.164 for SMS, email address for email
    subject: text('subject'), // email only
    body: text('body').notNull(),
    twilioSid: text('twilio_sid'), // external id (Twilio SID / Gmail id / Graph id) for dedupe
    readAt: integer('read_at', { mode: 'timestamp' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('messages_tenant_idx').on(t.tenantId),
    index('messages_tenant_phone_idx').on(t.tenantId, t.phone),
  ],
);

// Connected Gmail / Outlook mailboxes (Settings → Email)
export const emailAccounts = sqliteTable(
  'email_accounts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    provider: text('provider', { enum: ['gmail', 'outlook'] }).notNull(),
    emailAddress: text('email_address').notNull(),
    accessToken: text('access_token').notNull(), // SENSITIVE
    refreshToken: text('refresh_token').notNull(), // SENSITIVE
    tokenExpiresAt: integer('token_expires_at', { mode: 'timestamp' }),
    status: text('status', { enum: ['active', 'error'] }).notNull().default('active'),
    lastSyncedAt: integer('last_synced_at', { mode: 'timestamp' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('email_accounts_tenant_idx').on(t.tenantId),
    uniqueIndex('email_accounts_tenant_provider_idx').on(t.tenantId, t.provider),
  ],
);

// ---------------------------------------------------------------------------
// Job photos (R2-backed), expenses, and time tracking
// ---------------------------------------------------------------------------

export const jobPhotos = sqliteTable(
  'job_photos',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id),
    r2Key: text('r2_key').notNull(),
    contentType: text('content_type').notNull(),
    uploadedBy: text('uploaded_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('job_photos_tenant_idx').on(t.tenantId),
    index('job_photos_job_idx').on(t.jobId),
  ],
);

export const expenses = sqliteTable(
  'expenses',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id),
    userId: text('user_id').references(() => users.id),
    description: text('description').notNull(),
    amountCents: integer('amount_cents').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('expenses_tenant_idx').on(t.tenantId),
    index('expenses_job_idx').on(t.jobId),
  ],
);

export const timeEntries = sqliteTable(
  'time_entries',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
    endedAt: integer('ended_at', { mode: 'timestamp' }), // null = clocked in
    // GPS-stamped check-in (captured on clock-in when the tech allows it)
    lat: real('lat'),
    lng: real('lng'),
  },
  (t) => [
    index('time_entries_tenant_idx').on(t.tenantId),
    index('time_entries_job_idx').on(t.jobId),
  ],
);

// ---------------------------------------------------------------------------
// Company document library — insurance, qualifications, T&Cs (R2-backed).
// Each doc has an unguessable share link; portal-visible docs also appear as
// "Our credentials" on quotes and the client hub.
// ---------------------------------------------------------------------------

export const tenantDocuments = sqliteTable(
  'tenant_documents',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    r2Key: text('r2_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    shareToken: text('share_token').notNull(),
    showOnPortal: integer('show_on_portal', { mode: 'boolean' }).notNull().default(true),
    uploadedBy: text('uploaded_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('tenant_docs_tenant_idx').on(t.tenantId),
    uniqueIndex('tenant_docs_share_idx').on(t.shareToken),
  ],
);

// ---------------------------------------------------------------------------
// Digital certificates & job forms (CP12, EICR, waste transfer, completion)
// ---------------------------------------------------------------------------

export const CERT_TYPES = ['cp12', 'eicr', 'waste_transfer', 'completion'] as const;
export type CertType = (typeof CERT_TYPES)[number];

export const certificates = sqliteTable(
  'certificates',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),
    type: text('type', { enum: CERT_TYPES }).notNull(),
    certNumber: text('cert_number').notNull(),
    // Form answers as JSON — field set varies per certificate type
    data: text('data').notNull(),
    engineerName: text('engineer_name').notNull(),
    registrationNumber: text('registration_number'), // Gas Safe / NICEIC / waste carrier no.
    issuedAt: integer('issued_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index('certificates_tenant_idx').on(t.tenantId),
    index('certificates_job_idx').on(t.jobId),
  ],
);

// ---------------------------------------------------------------------------
// Missed-call text-back (Module 7)
// ---------------------------------------------------------------------------

export const callEvents = sqliteTable(
  'call_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    twilioCallSid: text('twilio_call_sid').notNull().unique(),
    fromNumber: text('from_number').notNull(),
    toNumber: text('to_number').notNull(),
    status: text('status', { enum: ['missed', 'answered', 'voicemail'] }).notNull(),
    matchedCustomerId: text('matched_customer_id').references(() => customers.id),
    textBackSentAt: integer('text_back_sent_at', { mode: 'timestamp' }),
    createdAt: createdAt(),
  },
  (t) => [index('call_events_tenant_idx').on(t.tenantId)],
);

// ---------------------------------------------------------------------------
// Review automation loop (Module 8)
// ---------------------------------------------------------------------------

export const reviewRequests = sqliteTable(
  'review_requests',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),
    channel: text('channel', { enum: ['sms', 'email'] }).notNull(),
    reviewLink: text('review_link').notNull(),
    sentAt: integer('sent_at', { mode: 'timestamp' }),
    clickedAt: integer('clicked_at', { mode: 'timestamp' }),
    createdAt: createdAt(),
  },
  (t) => [index('review_requests_tenant_idx').on(t.tenantId)],
);

// ---------------------------------------------------------------------------
// Two-way financial sync (Module 9)
// ---------------------------------------------------------------------------

export const accountingConnections = sqliteTable(
  'accounting_connections',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    provider: text('provider', { enum: ['quickbooks', 'xero'] }).notNull(),
    accessToken: text('access_token').notNull(), // SENSITIVE
    refreshToken: text('refresh_token').notNull(), // SENSITIVE
    externalRealmId: text('external_realm_id'), // QBO realm / Xero tenant
    tokenExpiresAt: integer('token_expires_at', { mode: 'timestamp' }),
    status: text('status', { enum: ['active', 'expired', 'revoked'] })
      .notNull()
      .default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('acct_conn_tenant_idx').on(t.tenantId),
    uniqueIndex('acct_conn_tenant_provider_idx').on(t.tenantId, t.provider),
  ],
);

export const ledgerSyncRecords = sqliteTable(
  'ledger_sync_records',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    connectionId: text('connection_id')
      .notNull()
      .references(() => accountingConnections.id),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id),
    entity: text('entity', { enum: ['invoice', 'payment'] }).notNull(),
    externalId: text('external_id'), // id in QBO/Xero after push
    status: text('status', { enum: ['pending', 'synced', 'error'] })
      .notNull()
      .default('pending'),
    error: text('error'),
    syncedAt: integer('synced_at', { mode: 'timestamp' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('ledger_sync_tenant_idx').on(t.tenantId),
    index('ledger_sync_job_idx').on(t.jobId),
  ],
);
