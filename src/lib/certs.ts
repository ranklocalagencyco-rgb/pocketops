/**
 * Digital certificates & job forms — one engine, per-trade templates.
 * cp12 (gas), eicr (electrical), waste_transfer (waste carriers),
 * completion (any trade). Answers stored as JSON on the certificate row;
 * PDFs rendered generically from these field definitions.
 */
import type { CertType } from '../db/schema';

export interface CertField {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'date' | 'select';
  options?: string[];
  required?: boolean;
  placeholder?: string;
}

export const CERT_DEFS: Record<CertType, { title: string; regLabel: string; fields: CertField[] }> = {
  cp12: {
    title: 'Landlord Gas Safety Record (CP12)',
    regLabel: 'Gas Safe registration no.',
    fields: [
      { key: 'appliances', label: 'Appliances inspected (one per line: location — type — make — result)', kind: 'textarea', required: true, placeholder: 'Kitchen — Boiler — Worcester Greenstar — Pass' },
      { key: 'flue', label: 'Flue / chimney condition', kind: 'select', options: ['Satisfactory', 'Unsatisfactory', 'N/A'] },
      { key: 'ventilation', label: 'Ventilation provision', kind: 'select', options: ['Satisfactory', 'Unsatisfactory', 'N/A'] },
      { key: 'tightness', label: 'Gas tightness test', kind: 'select', options: ['Pass', 'Fail', 'Not tested'] },
      { key: 'defects', label: 'Defects identified / remedial action', kind: 'textarea' },
      { key: 'nextDue', label: 'Next inspection due', kind: 'date', required: true },
    ],
  },
  eicr: {
    title: 'Electrical Installation Condition Report (summary)',
    regLabel: 'NICEIC / NAPIT registration no.',
    fields: [
      { key: 'extent', label: 'Extent of installation covered', kind: 'textarea', required: true },
      { key: 'assessment', label: 'Overall assessment', kind: 'select', options: ['Satisfactory', 'Unsatisfactory'], required: true },
      { key: 'observations', label: 'Observations & classification codes (C1/C2/C3/FI)', kind: 'textarea' },
      { key: 'nextDue', label: 'Next inspection recommended', kind: 'date', required: true },
    ],
  },
  waste_transfer: {
    title: 'Waste Transfer Note',
    regLabel: 'Waste carrier registration no.',
    fields: [
      { key: 'description', label: 'Description of waste', kind: 'textarea', required: true },
      { key: 'ewc', label: 'EWC code(s)', kind: 'text', placeholder: 'e.g. 17 01 07' },
      { key: 'container', label: 'Quantity / container type', kind: 'text' },
      { key: 'disposalSite', label: 'Disposal / transfer site', kind: 'text', required: true },
      { key: 'transferDate', label: 'Date of transfer', kind: 'date', required: true },
    ],
  },
  completion: {
    title: 'Certificate of Work Completion',
    regLabel: 'Trade body membership no. (optional)',
    fields: [
      { key: 'summary', label: 'Work carried out', kind: 'textarea', required: true },
      { key: 'materials', label: 'Key materials used', kind: 'textarea' },
      { key: 'guarantee', label: 'Guarantee period (months)', kind: 'text', placeholder: 'e.g. 12' },
      { key: 'notes', label: 'Care / maintenance notes', kind: 'textarea' },
    ],
  },
};

export const CERT_LABELS: Record<CertType, string> = {
  cp12: 'Gas Safety (CP12)',
  eicr: 'EICR',
  waste_transfer: 'Waste Transfer Note',
  completion: 'Completion Certificate',
};
