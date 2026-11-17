/**
 * Default invoice & payment email templates (company overrides live in public.fin_email_templates).
 * Wording rules: a manually recorded payment that hasn't been verified is "recorded", never "confirmed"
 * or "cleared"; we never claim a bank confirmed anything.
 */
export const TEMPLATE_KINDS = [
  "deposit", "progress", "final", "time_materials", "change_order", "balance_reminder", "overdue_reminder", "receipt", "partial_payment", "final_thanks", "credit_refund",
] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export const TONES = ["friendly", "professional", "brief"] as const;
export type Tone = (typeof TONES)[number];

export interface Template { subject: string; body: string }

/** Placeholders: {customer_first_name} {company_name} {sender_name} {project_name} {invoice_number} {amount_due} {due_date}
 * {milestone} {schedule} {balance} {payment_amount} {payment_date} {payment_status_sentence} {credit_amount} {change_order} {contract_total} {pay_instructions} */
const GREETING: Record<Tone, string> = { friendly: "Hi {customer_first_name},", professional: "Hello {customer_first_name},", brief: "Hi {customer_first_name}," };
// Signed with the company name by default (owner decision 2026-11-17); {sender_name} stays available to edit in.
const SIGN: Record<Tone, string> = { friendly: "Thanks so much,\n{company_name}", professional: "Thank you,\n{company_name}", brief: "Thanks,\n{company_name}" };

const BODIES: Record<TemplateKind, Record<Tone, string>> = {
  deposit: {
    friendly: "We're excited to get started on {project_name}! Attached is invoice {invoice_number} for the deposit of {amount_due}, due {due_date}.\n\nHere's the payment schedule from your signed agreement:\n{schedule}\n\n{pay_instructions}",
    professional: "Please find invoice {invoice_number} for the deposit on {project_name}: {amount_due}, due {due_date}.\n\nPayment schedule per the signed agreement:\n{schedule}\n\n{pay_instructions}",
    brief: "Deposit invoice {invoice_number} for {project_name}: {amount_due}, due {due_date}.\n{schedule}\n{pay_instructions}",
  },
  progress: {
    friendly: "Great progress on {project_name}! Invoice {invoice_number} covers {milestone}: {amount_due}, due {due_date}.\n\n{pay_instructions}",
    professional: "Invoice {invoice_number} for {milestone} on {project_name} is attached: {amount_due}, due {due_date}.\n\n{pay_instructions}",
    brief: "Invoice {invoice_number} ({milestone}): {amount_due}, due {due_date}.\n{pay_instructions}",
  },
  final: {
    friendly: "{project_name} is complete, and we hope you love it! Your final invoice {invoice_number} is {amount_due}, due {due_date}.\n\n{pay_instructions}",
    professional: "With {project_name} complete, please find final invoice {invoice_number}: {amount_due}, due {due_date}.\n\n{pay_instructions}",
    brief: "Final invoice {invoice_number} for {project_name}: {amount_due}, due {due_date}.\n{pay_instructions}",
  },
  time_materials: {
    friendly: "Here's invoice {invoice_number} for the time and materials on {project_name}: {amount_due}, due {due_date}. The details are itemized on the invoice.\n\n{pay_instructions}",
    professional: "Invoice {invoice_number} for time and materials on {project_name} is attached: {amount_due}, due {due_date}.\n\n{pay_instructions}",
    brief: "T&M invoice {invoice_number}: {amount_due}, due {due_date}.\n{pay_instructions}",
  },
  change_order: {
    friendly: "Thanks for approving {change_order}. Invoice {invoice_number} for it is {amount_due}, due {due_date}. Your updated contract total is {contract_total}.\n\n{pay_instructions}",
    professional: "Invoice {invoice_number} for approved {change_order}: {amount_due}, due {due_date}. Updated contract total: {contract_total}.\n\n{pay_instructions}",
    brief: "Invoice {invoice_number} ({change_order}): {amount_due}, due {due_date}.\n{pay_instructions}",
  },
  balance_reminder: {
    friendly: "Just a friendly reminder that invoice {invoice_number} for {project_name} has a balance of {balance}, due {due_date}.\n\n{pay_instructions}",
    professional: "This is a reminder that invoice {invoice_number} has a balance of {balance}, due {due_date}.\n\n{pay_instructions}",
    brief: "Reminder: invoice {invoice_number}, {balance} due {due_date}.\n{pay_instructions}",
  },
  overdue_reminder: {
    friendly: "Our records show invoice {invoice_number} for {project_name} still has {balance} open; it was due {due_date}. If you've already sent payment, thank you, and please ignore this note.\n\n{pay_instructions}",
    professional: "Invoice {invoice_number} has an outstanding balance of {balance}, which was due {due_date}. If payment is already on its way, please disregard this message.\n\n{pay_instructions}",
    brief: "Invoice {invoice_number}: {balance} past due since {due_date}. Please disregard if already paid.\n{pay_instructions}",
  },
  receipt: {
    friendly: "{payment_status_sentence} Thank you!\n\nRemaining balance on {project_name}: {balance}.",
    professional: "{payment_status_sentence}\n\nRemaining balance on {project_name}: {balance}.",
    brief: "{payment_status_sentence} Balance: {balance}.",
  },
  partial_payment: {
    friendly: "{payment_status_sentence} Thank you! Invoice {invoice_number} has {balance} remaining, due {due_date}.",
    professional: "{payment_status_sentence} Invoice {invoice_number} has a remaining balance of {balance}, due {due_date}.",
    brief: "{payment_status_sentence} Remaining on {invoice_number}: {balance}.",
  },
  final_thanks: {
    friendly: "{payment_status_sentence} {project_name} is all settled up. It was a pleasure working with you!",
    professional: "{payment_status_sentence} Your account for {project_name} now shows no balance due. Thank you for your business.",
    brief: "{payment_status_sentence} {project_name}: paid in full. Thank you.",
  },
  credit_refund: {
    friendly: "We've issued a credit of {credit_amount} on {project_name}. Thanks for your patience!",
    professional: "A credit of {credit_amount} has been issued on your account for {project_name}.",
    brief: "Credit issued: {credit_amount} ({project_name}).",
  },
};

const SUBJECTS: Record<TemplateKind, string> = {
  deposit: "Deposit invoice {invoice_number} - {project_name}",
  progress: "Invoice {invoice_number} - {milestone}",
  final: "Final invoice {invoice_number} - {project_name}",
  time_materials: "Invoice {invoice_number} - time & materials",
  change_order: "Invoice {invoice_number} - {change_order}",
  balance_reminder: "Reminder: invoice {invoice_number}",
  overdue_reminder: "Past due: invoice {invoice_number}",
  receipt: "Payment recorded - {project_name}",
  partial_payment: "Payment recorded - invoice {invoice_number}",
  final_thanks: "Thank you - {project_name}",
  credit_refund: "Credit issued - {project_name}",
};

export function defaultTemplate(kind: TemplateKind, tone: Tone): Template {
  return { subject: SUBJECTS[kind], body: `${GREETING[tone]}\n\n${BODIES[kind][tone]}\n\n${SIGN[tone]}` };
}
