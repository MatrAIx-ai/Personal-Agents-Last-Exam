/**
 * Deterministic Synthetic Dataset Generator for PALE Personal Records (Milestone 4)
 * Generates:
 * 1. fixtures/truth.json: Scenario reference slice (20 active documents, < 1 MiB decoded payload)
 * 2. fixtures/corpus.json: Full personal records archive (160 documents across 8 domains)
 */

const fs = require('fs');
const path = require('path');

const PERSONA = {
  name: 'Alex Mercer',
  ssn_last4: '4821',
  employer: 'Apex Technologies Inc',
  landlord: 'Skyline Urban Living LLC',
  insurer: 'GuardPoint Mutual Insurance',
  bank: 'First Horizon National Bank'
};

const CATEGORIES = [
  'employment',
  'tax',
  'insurance',
  'property',
  'utilities',
  'healthcare',
  'banking',
  'legal'
];

function buildDocument(id, category, title, text, tags, validUntil, expectedFields, evidenceSpans = []) {
  // Validate that all evidence spans match text slices exactly
  for (const span of evidenceSpans) {
    const actualSlice = text.slice(span.start, span.end);
    if (actualSlice !== span.text) {
      throw new Error(
        `Span mismatch in doc ${id} for '${span.label}': Expected '${span.text}', Found '${actualSlice}'`
      );
    }
  }

  return {
    fixture_id: id,
    title,
    category,
    mime_type: 'text/plain',
    content_text: text,
    tags,
    valid_until: validUntil || null,
    expected_fields: expectedFields,
    evidence_spans: evidenceSpans
  };
}

function generateDataset() {
  const allDocuments = [];
  const allLinks = [];

  // ==========================================
  // 1. EMPLOYMENT (25 Documents: Contract, Payslips, Benefits)
  // ==========================================
  const contractText = `EMPLOYMENT AGREEMENT
Employer: Apex Technologies Inc
Employee: Alex Mercer
Role: Staff Systems Engineer
Effective Date: 2024-01-15
Base Salary: $120,000.00 annually
Health Benefits: Eligible for comprehensive medical/dental plan.
Termination Notice: 30 days written notice required.`;

  allDocuments.push(
    buildDocument(
      'doc_emp_contract_2024',
      'employment',
      'Employment Agreement 2024 - Apex Tech',
      contractText,
      ['employment', 'contract', 'salary'],
      null,
      { base_salary: 120000, employer: 'Apex Technologies Inc', role: 'Staff Systems Engineer' },
      [
        { label: 'salary', text: '$120,000.00', start: contractText.indexOf('$120,000.00'), end: contractText.indexOf('$120,000.00') + 11 },
        { label: 'employer', text: 'Apex Technologies Inc', start: contractText.indexOf('Apex Technologies Inc'), end: contractText.indexOf('Apex Technologies Inc') + 21 }
      ]
    )
  );

  // Generate 24 successive monthly payslips (2025 - 2026)
  for (let year = 2025; year <= 2026; year++) {
    for (let month = 1; month <= 12; month++) {
      const monthStr = month.toString().padStart(2, '0');
      const gross = year === 2026 && month >= 6 ? 10416.67 : 10000.00; // Raise in mid 2026
      const tax = (gross * 0.22).toFixed(2);
      const net = (gross - parseFloat(tax)).toFixed(2);

      const payslipText = `PAYSLIP FOR PERIOD: ${year}-${monthStr}
Employer: Apex Technologies Inc
Employee: Alex Mercer (ID: EMP-9042)
Gross Monthly Pay: $${gross.toFixed(2)}
Federal Income Tax: $${tax}
Net Disbursed Pay: $${net}
Deposit Date: ${year}-${monthStr}-28`;

      const docId = `doc_emp_payslip_${year}_${monthStr}`;
      allDocuments.push(
        buildDocument(
          docId,
          'employment',
          `Payslip ${year}-${monthStr} - Apex Tech`,
          payslipText,
          ['employment', 'payslip', 'salary'],
          null,
          { gross_pay: gross, net_pay: parseFloat(net), period: `${year}-${monthStr}` },
          [
            { label: 'net_pay', text: `$${net}`, start: payslipText.indexOf(`$${net}`), end: payslipText.indexOf(`$${net}`) + net.length + 1 }
          ]
        )
      );

      // Link payslip to parent contract
      allLinks.push({
        source_ref: docId,
        target_ref: 'doc_emp_contract_2024',
        relationship_type: 'receipt_for'
      });
    }
  }

  // ==========================================
  // 2. TAX (20 Documents: Annual Returns, W2s, Deductions)
  // ==========================================
  for (let year = 2024; year <= 2025; year++) {
    const w2Text = `FORM W-2 WAGE AND TAX STATEMENT ${year}
Employer Name: Apex Technologies Inc
Employee Name: Alex Mercer (SSN: ***-**-4821)
Box 1 Wages & Tips: $120,000.00
Box 2 Federal Tax Withheld: $26,400.00
State Tax Withheld: $6,000.00`;

    const w2Id = `doc_tax_w2_${year}`;
    allDocuments.push(
      buildDocument(
        w2Id,
        'tax',
        `Form W-2 Wage Statement ${year}`,
        w2Text,
        ['tax', 'w2', 'irs'],
        null,
        { wages: 120000, federal_withholding: 26400, tax_year: year },
        [
          { label: 'wages', text: '$120,000.00', start: w2Text.indexOf('$120,000.00'), end: w2Text.indexOf('$120,000.00') + 11 }
        ]
      )
    );

    const taxReturnText = `FORM 1040 U.S. INDIVIDUAL INCOME TAX RETURN ${year}
Taxpayer: Alex Mercer
Filing Status: Single
Total Adjusted Gross Income: $120,000.00
Standard Deduction: $14,600.00
Taxable Income: $105,400.00
Total Tax Liability: $18,450.00
Refund Amount: $1,950.00`;

    const tax1040Id = `doc_tax_1040_${year}`;
    allDocuments.push(
      buildDocument(
        tax1040Id,
        'tax',
        `Form 1040 Federal Tax Return ${year}`,
        taxReturnText,
        ['tax', '1040', 'filing'],
        null,
        { adjusted_gross_income: 120000, refund_amount: 1950, tax_year: year },
        [
          { label: 'refund', text: '$1,950.00', start: taxReturnText.indexOf('$1,950.00'), end: taxReturnText.indexOf('$1,950.00') + 9 }
        ]
      )
    );

    allLinks.push({
      source_ref: w2Id,
      target_ref: tax1040Id,
      relationship_type: 'tax_supporting_document'
    });
  }

  // 16 deductible donation & medical receipts
  for (let i = 1; i <= 16; i++) {
    const id = `doc_tax_receipt_${i}`;
    const amount = (50 + i * 25).toFixed(2);
    const receiptText = `CHARITABLE DONATION OFFICIAL TAX RECEIPT
Organization: Global Environmental Fund
Donor: Alex Mercer
Contribution Amount: $${amount}
Date: 2025-0${(i % 9) + 1}-15
Eligible under IRC Section 501(c)(3).`;

    allDocuments.push(
      buildDocument(
        id,
        'tax',
        `Donation Tax Receipt #${1000 + i}`,
        receiptText,
        ['tax', 'deduction', 'charity'],
        null,
        { donation_amount: parseFloat(amount) },
        [{ label: 'amount', text: `$${amount}`, start: receiptText.indexOf(`$${amount}`), end: receiptText.indexOf(`$${amount}`) + amount.length + 1 }]
      )
    );
  }

  // ==========================================
  // 3. INSURANCE (20 Documents: Health, Auto, Renter's Policies & Claims)
  // ==========================================
  const autoPolicyText = `AUTO INSURANCE POLICY SUMMARY
Carrier: GuardPoint Mutual Insurance
Policyholder: Alex Mercer
Vehicle: 2022 Honda Civic (VIN: 1HGCR2F83NA109432)
Policy Number: GP-AUTO-94022
Coverage Period: 2026-06-01 to 2027-05-31
Collision Deductible: $500.00
Six-Month Premium: $640.00`;

  allDocuments.push(
    buildDocument(
      'doc_ins_auto_2026',
      'insurance',
      'Auto Insurance Policy 2026-2027',
      autoPolicyText,
      ['insurance', 'auto', 'vehicle'],
      '2027-05-31T23:59:59Z',
      { policy_number: 'GP-AUTO-94022', deductible: 500, annual_premium: 1280 },
      [
        { label: 'policy_number', text: 'GP-AUTO-94022', start: autoPolicyText.indexOf('GP-AUTO-94022'), end: autoPolicyText.indexOf('GP-AUTO-94022') + 13 }
      ]
    )
  );

  for (let i = 1; i <= 19; i++) {
    const isHealth = i % 2 === 0;
    const policyNum = `GP-${isHealth ? 'HLTH' : 'RENT'}-${4000 + i}`;
    const insText = `INSURANCE SCHEDULE & BENEFIT OVERVIEW
Carrier: GuardPoint Mutual Insurance
Policy Number: ${policyNum}
Named Insured: Alex Mercer
Coverage Type: ${isHealth ? 'Comprehensive Medical & Vision' : "Tenant Renter's Liability"}
Effective Date: 2026-01-01
Expiry Date: 2026-12-31
Max Limit: $${isHealth ? '500,000.00' : '100,000.00'}`;

    allDocuments.push(
      buildDocument(
        `doc_ins_record_${i}`,
        'insurance',
        `${isHealth ? 'Health Benefit Notice' : 'Renters Policy Rider'} #${i}`,
        insText,
        ['insurance', isHealth ? 'health' : 'property'],
        '2026-12-31T23:59:59Z',
        { policy_number: policyNum }
      )
    );
  }

  // ==========================================
  // 4. PROPERTY (20 Documents: Leases, Amendments, Move-in Inspections)
  // ==========================================
  const leaseText = `RESIDENTIAL LEASE AGREEMENT
Landlord: Skyline Urban Living LLC
Tenant: Alex Mercer
Premises: Apt 4B, 742 Evergreen Terrace, Springfield
Lease Term: 2026-06-01 to 2027-05-31
Monthly Rent: $2,250.00 due on 1st of month.
Security Deposit: $2,250.00
Renewal Notice Window: 60 days prior to expiration.`;

  allDocuments.push(
    buildDocument(
      'doc_prop_lease_2026',
      'property',
      'Apartment Lease Agreement 2026-2027',
      leaseText,
      ['property', 'lease', 'housing'],
      '2027-05-31T23:59:59Z',
      { monthly_rent: 2250, deposit: 2250, premises: 'Apt 4B, 742 Evergreen Terrace' },
      [
        { label: 'monthly_rent', text: '$2,250.00', start: leaseText.indexOf('$2,250.00'), end: leaseText.indexOf('$2,250.00') + 9 }
      ]
    )
  );

  for (let i = 1; i <= 19; i++) {
    const rentText = `MONTHLY RENTAL RECEIPT
Landlord: Skyline Urban Living LLC
Tenant: Alex Mercer (Apt 4B)
Payment Amount Received: $2,250.00
Payment Method: ACH Transfer
Transaction Date: 2026-${(i % 12 + 1).toString().padStart(2, '0')}-01
Balance Remaining: $0.00`;

    const docId = `doc_prop_receipt_${i}`;
    allDocuments.push(
      buildDocument(
        docId,
        'property',
        `Rent Receipt #${200 + i}`,
        rentText,
        ['property', 'receipt', 'rent'],
        null,
        { rent_paid: 2250 }
      )
    );

    allLinks.push({
      source_ref: docId,
      target_ref: 'doc_prop_lease_2026',
      relationship_type: 'receipt_for'
    });
  }

  // ==========================================
  // 5. UTILITIES (25 Documents: Power, Fiber Internet, Water)
  // ==========================================
  for (let i = 1; i <= 25; i++) {
    const isElectric = i % 2 === 0;
    const amount = (isElectric ? 85.50 + (i % 5) * 12 : 65.00).toFixed(2);
    const utilText = `MONTHLY UTILITY INVOICE
Provider: ${isElectric ? 'Springfield Clean Energy Power Co' : 'Metro Fiber Broadband'}
Account Number: ACCT-UTIL-${5000 + i}
Customer Name: Alex Mercer
Billing Cycle: Month ${i}
Total Amount Due: $${amount}
Due Date: 2026-${((i % 12) + 1).toString().padStart(2, '0')}-20`;

    allDocuments.push(
      buildDocument(
        `doc_util_${i}`,
        'utilities',
        `${isElectric ? 'Electric Energy Bill' : 'Broadband Internet Bill'} #${i}`,
        utilText,
        ['utilities', isElectric ? 'electric' : 'internet'],
        `2026-${((i % 12) + 1).toString().padStart(2, '0')}-20T00:00:00Z`,
        { amount_due: parseFloat(amount) },
        [{ label: 'amount_due', text: `$${amount}`, start: utilText.indexOf(`$${amount}`), end: utilText.indexOf(`$${amount}`) + amount.length + 1 }]
      )
    );
  }

  // ==========================================
  // 6. HEALTHCARE (20 Documents: Summaries, Lab Results, Immunizations)
  // ==========================================
  for (let i = 1; i <= 20; i++) {
    const clinicText = `CLINICAL VISIT ENCOUNTER SUMMARY
Facility: St. Jude Health Medical Center
Attending Physician: Dr. Sarah Jenkins, MD
Patient Name: Alex Mercer (DOB: 1994-08-12)
Visit Date: 2026-0${(i % 9) + 1}-10
Chief Complaint: Annual Physical & Preventative Consultation
Blood Pressure: 118/76 mmHg
Diagnostic Assessment: Normal health profile, recommended annual follow-up.`;

    allDocuments.push(
      buildDocument(
        `doc_health_${i}`,
        'healthcare',
        `Medical Encounter Record #${i}`,
        clinicText,
        ['healthcare', 'medical', 'clinic'],
        null,
        { clinic: 'St. Jude Health Medical Center', doctor: 'Dr. Sarah Jenkins, MD' }
      )
    );
  }

  // ==========================================
  // 7. BANKING (20 Documents: Bank Statements, Savings Ledgers)
  // ==========================================
  for (let i = 1; i <= 20; i++) {
    const balance = (14500.00 + i * 350).toFixed(2);
    const bankText = `MONTHLY ACCOUNT STATEMENT
Bank: First Horizon National Bank
Account Holder: Alex Mercer
Account Number: *******3492 (Checking)
Statement Period: Month ${i}, 2026
Ending Cleared Balance: $${balance}
Interest Earned: $12.45
FDIC Insured up to $250,000.`;

    allDocuments.push(
      buildDocument(
        `doc_bank_${i}`,
        'banking',
        `Bank Statement Month ${i}`,
        bankText,
        ['banking', 'statement', 'checking'],
        null,
        { ending_balance: parseFloat(balance) },
        [{ label: 'balance', text: `$${balance}`, start: bankText.indexOf(`$${balance}`), end: bankText.indexOf(`$${balance}`) + balance.length + 1 }]
      )
    );
  }

  // ==========================================
  // 8. LEGAL (15 Documents: Passport scan, NDA, Power of Attorney)
  // ==========================================
  for (let i = 1; i <= 15; i++) {
    const isNDA = i % 2 === 0;
    const legalText = `LEGAL INSTRUMENT & FORMAL NOTICE
Classification: ${isNDA ? 'Mutual Non-Disclosure Agreement' : 'Statutory Power of Attorney'}
Parties: Alex Mercer & Affiliated Representatives
Executed Date: 2024-03-12
Expiration Date: 2029-03-12
Governing Law: State Jurisdiction
Status: Legally Binding & Active`;

    allDocuments.push(
      buildDocument(
        `doc_legal_${i}`,
        'legal',
        `${isNDA ? 'Mutual NDA' : 'Power of Attorney Document'} #${i}`,
        legalText,
        ['legal', isNDA ? 'nda' : 'poa'],
        '2029-03-12T00:00:00Z',
        { status: 'Legally Binding & Active' }
      )
    );
  }

  return { allDocuments, allLinks };
}

// Build Corpus & Reference Slice
const { allDocuments, allLinks } = generateDataset();

// 1. Full Corpus Archive (~165 Documents)
const corpusManifest = {
  scenario_id: "personal_records_full_corpus",
  account_id: "acc_demo_user",
  total_documents: allDocuments.length,
  total_links: allLinks.length,
  documents: allDocuments,
  links: allLinks
};

// 2. Reference Scenario Slice (20 Documents, strictly < 1 MiB decoded payload)
const referenceSliceDocuments = [
  allDocuments.find((d) => d.fixture_id === 'doc_emp_contract_2024'),
  allDocuments.find((d) => d.fixture_id === 'doc_emp_payslip_2026_11'),
  allDocuments.find((d) => d.fixture_id === 'doc_emp_payslip_2026_12'),
  allDocuments.find((d) => d.fixture_id === 'doc_tax_w2_2025'),
  allDocuments.find((d) => d.fixture_id === 'doc_tax_1040_2025'),
  allDocuments.find((d) => d.fixture_id === 'doc_tax_receipt_1'),
  allDocuments.find((d) => d.fixture_id === 'doc_ins_auto_2026'),
  allDocuments.find((d) => d.fixture_id === 'doc_ins_record_1'),
  allDocuments.find((d) => d.fixture_id === 'doc_prop_lease_2026'),
  allDocuments.find((d) => d.fixture_id === 'doc_prop_receipt_1'),
  allDocuments.find((d) => d.fixture_id === 'doc_util_1'),
  allDocuments.find((d) => d.fixture_id === 'doc_util_2'),
  allDocuments.find((d) => d.fixture_id === 'doc_health_1'),
  allDocuments.find((d) => d.fixture_id === 'doc_health_2'),
  allDocuments.find((d) => d.fixture_id === 'doc_bank_1'),
  allDocuments.find((d) => d.fixture_id === 'doc_bank_2'),
  allDocuments.find((d) => d.fixture_id === 'doc_legal_1'),
  allDocuments.find((d) => d.fixture_id === 'doc_legal_2'),
  allDocuments.find((d) => d.fixture_id === 'doc_emp_payslip_2025_12'),
  allDocuments.find((d) => d.fixture_id === 'doc_tax_receipt_2')
].filter(Boolean);

const referenceSliceLinks = allLinks.filter((l) =>
  referenceSliceDocuments.some((d) => d.fixture_id === l.source_ref) &&
  referenceSliceDocuments.some((d) => d.fixture_id === l.target_ref)
);

const referenceSliceManifest = {
  scenario_id: "tax_and_employment_audit",
  account_id: "acc_user_123",
  total_documents: referenceSliceDocuments.length,
  documents: referenceSliceDocuments,
  links: referenceSliceLinks
};

// Write to files
const fixturesDir = __dirname;
fs.writeFileSync(path.join(fixturesDir, 'truth.json'), JSON.stringify(referenceSliceManifest, null, 2));
fs.writeFileSync(path.join(fixturesDir, 'corpus.json'), JSON.stringify(corpusManifest, null, 2));

console.log(`[OK] Generated full corpus: ${allDocuments.length} documents, ${allLinks.length} links -> fixtures/corpus.json`);
console.log(`[OK] Generated reference slice: ${referenceSliceDocuments.length} documents -> fixtures/truth.json`);

module.exports = { generateDataset };
