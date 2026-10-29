import { describe, expect, it } from 'vitest';
import { classifyListing, describeListing, isIndividualVacancy, listingKey } from '../lib/listings';

const ok = (title: string, url: string) => expect(classifyListing({ title, url }), `${title} | ${url}`).toEqual({ ok: true });
const no = (title: string, url: string) => expect(isIndividualVacancy({ title, url }), `${title} | ${url}`).toBe(false);

describe('classifyListing: bulk and search pages are rejected', () => {
  it('rejects "N vacancies" and "jobs in" pages', () => {
    no('15,000 Supply Chain Manager Jobs in Mumbai - Naukri.com', 'https://www.naukri.com/supply-chain-manager-jobs-in-mumbai');
    no('1,200+ Import Manager jobs in Dubai | LinkedIn', 'https://ae.linkedin.com/jobs/import-manager-jobs-dubai');
    no('Supply Chain Manager Jobs in Dubai - Indeed', 'https://ae.indeed.com/q-supply-chain-manager-l-dubai-jobs.html');
    no('Supply chain manager jobs in Dubai | Glassdoor', 'https://www.glassdoor.com/Job/dubai-supply-chain-manager-jobs-SRCH_IL.0,5_IC2204498_KO6,28.htm');
    no('Supply Chain Jobs', 'https://www.bayt.com/en/uae/jobs/supply-chain-jobs/');
  });
  it('rejects company, salary, review and search pages', () => {
    no('Careers at Acme', 'https://jobs.lever.co/acme');
    no('Acme Careers', 'https://boards.greenhouse.io/acme');
    no('Supply Chain Manager salaries in Mumbai', 'https://www.glassdoor.co.in/Salaries/mumbai-supply-chain-manager-salary-SRCH_IL.0,6_IM1.htm');
    no('Import Manager', 'https://in.indeed.com/jobs?q=import+manager&l=Mumbai');
    no('Acme jobs', 'https://in.indeed.com/cmp/Acme/jobs');
    no('Import Manager', 'https://www.linkedin.com/jobs/search/?keywords=import%20manager');
    no('Import Manager', 'https://www.linkedin.com/jobs/collections/recommended/');
    no('', 'https://www.naukri.com/job-listings-import-manager-123456');
  });
});

describe('classifyListing: single vacancies are accepted', () => {
  it('accepts the common portals', () => {
    ok('Import Manager - ABC Logistics - Navi Mumbai | Naukri.com', 'https://www.naukri.com/job-listings-import-manager-abc-logistics-navi-mumbai-5-to-10-years-123456789012');
    ok('ABC Logistics hiring Import Manager in Navi Mumbai | LinkedIn', 'https://in.linkedin.com/jobs/view/import-manager-at-abc-logistics-3812345678');
    ok('Supply Chain Manager - XYZ Company - Dubai - Indeed.com', 'https://ae.indeed.com/viewjob?jk=abc123def456');
    ok('Supply Chain Manager Job in Dubai at XYZ Company | Glassdoor', 'https://www.glassdoor.com/job-listing/supply-chain-manager-xyz-company-JV_IC2204498_KO0,20_KE21,32.htm?jl=1009');
  });
  it('accepts employer career sites', () => {
    ok('Supply Chain Manager at Acme', 'https://boards.greenhouse.io/acme/jobs/4567890123');
    ok('Acme - Supply Chain Manager', 'https://jobs.lever.co/acme/1b2c3d4e-1111-2222-3333-444455556666');
    ok('Supply Chain Manager', 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Mumbai/Supply-Chain-Manager_R12345');
    ok('Supply Chain Manager', 'https://jobs.ashbyhq.com/acme/9f8e7d6c-1111-2222-3333-444455556666');
    ok('Supply Chain Manager', 'https://apply.workable.com/acme/j/ABC123DEF4/');
  });
  it('does not mistake a posting with a small number in its title for an index', () => {
    ok('Warehouse Operator - 2 openings - Dubai', 'https://www.bayt.com/en/uae/jobs/warehouse-operator-4567890/');
    ok('Job Opening: Import Manager', 'https://www.bayt.com/en/uae/jobs/import-manager-4567891/');
  });
  it('rejects unknown links that are not specific', () => {
    no('Import Manager', 'https://example.com/careers');
    no('Import Manager', 'https://example.com/about/team');
  });
});

describe('describeListing: "Role — Company"', () => {
  const places = ['Navi Mumbai, India', 'Dubai, United Arab Emirates'];
  it('reads the usual title shapes', () => {
    expect(describeListing('ABC Logistics hiring Import Manager in Navi Mumbai, Maharashtra, India | LinkedIn', places).title).toBe('Import Manager — ABC Logistics');
    expect(describeListing('Supply Chain Manager - XYZ Company - Dubai - Indeed.com', places).title).toBe('Supply Chain Manager — XYZ Company');
    expect(describeListing('Supply Chain Manager Job in Dubai at XYZ Company | Glassdoor', places).title).toBe('Supply Chain Manager — XYZ Company');
    expect(describeListing('Import Manager - ABC Logistics - 5 to 10 years in Navi Mumbai | Naukri.com', places).title).toBe('Import Manager — ABC Logistics');
    expect(describeListing('Supply Chain Manager at Acme', places).title).toBe('Supply Chain Manager — Acme');
  });
  it('puts the company first only for Lever pages', () => {
    expect(describeListing('Acme - Supply Chain Manager', [], 'https://jobs.lever.co/acme/1b2c3d4e').title).toBe('Supply Chain Manager — Acme');
    expect(describeListing('Acme - Supply Chain Manager', [], 'https://example.com/job/1').title).toBe('Acme — Supply Chain Manager');
  });
  it('shows just the role when the company is not in the title', () => {
    expect(describeListing('Import Manager - Navi Mumbai, Maharashtra - Indeed.com', places).title).toBe('Import Manager');
    expect(describeListing('Job Opening: Warehouse Operator - 10 positions', places).title).toBe('Warehouse Operator');
  });
});

describe('listingKey', () => {
  it('gives one key to the same posting on different hosts or with tracking parameters', () => {
    expect(listingKey('https://in.linkedin.com/jobs/view/import-manager-at-abc-3812345678?refId=x')).toBe(listingKey('https://www.linkedin.com/jobs/view/3812345678'));
    expect(listingKey('https://in.indeed.com/viewjob?jk=abc123&from=serp')).toBe(listingKey('https://ae.indeed.com/viewjob?jk=abc123'));
    expect(listingKey('https://www.naukri.com/job-listings-a-1/?utm=x')).toBe(listingKey('https://naukri.com/job-listings-a-1'));
  });
  it('keeps different postings apart', () => {
    expect(listingKey('https://in.indeed.com/viewjob?jk=a1')).not.toBe(listingKey('https://in.indeed.com/viewjob?jk=a2'));
  });
});
