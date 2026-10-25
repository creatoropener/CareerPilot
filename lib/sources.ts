// Catalogue of job sites a user can choose to search. Shared by the browser and the search function.
// Each entry lists the public hostnames used to restrict the search; subdomains match automatically
// (for example "in.indeed.com" matches "indeed.com").

export interface SourceDef {
  id: string;
  label: string;
  group: string;
  domains: string[];
}

export const ATS_GROUP = 'Company career sites';

export const SOURCE_GROUPS = [
  'Global',
  'India',
  'United States & Canada',
  'United Kingdom & Ireland',
  'Europe',
  'Middle East & Africa',
  'Asia-Pacific',
  'Latin America',
  'Remote & startups',
  ATS_GROUP,
] as const;

const s = (id: string, label: string, group: (typeof SOURCE_GROUPS)[number], domains: string[]): SourceDef => ({ id, label, group, domains });

export const SOURCES: SourceDef[] = [
  // Global
  s('linkedin', 'LinkedIn', 'Global', ['linkedin.com']),
  s('indeed', 'Indeed', 'Global', ['indeed.com']),
  s('glassdoor', 'Glassdoor', 'Global', ['glassdoor.com', 'glassdoor.co.in', 'glassdoor.co.uk', 'glassdoor.ca', 'glassdoor.com.au']),
  s('monster', 'Monster', 'Global', ['monster.com']),
  s('jooble', 'Jooble', 'Global', ['jooble.org']),
  s('adzuna', 'Adzuna', 'Global', ['adzuna.com', 'adzuna.co.uk', 'adzuna.in', 'adzuna.com.au', 'adzuna.ca']),
  s('talent-com', 'Talent.com', 'Global', ['talent.com']),
  s('careerjet', 'Careerjet', 'Global', ['careerjet.com', 'careerjet.co.in', 'careerjet.co.uk']),
  s('jobrapido', 'Jobrapido', 'Global', ['jobrapido.com']),

  // India
  s('naukri', 'Naukri', 'India', ['naukri.com']),
  s('foundit', 'foundit (Monster India)', 'India', ['foundit.in']),
  s('shine', 'Shine', 'India', ['shine.com']),
  s('timesjobs', 'TimesJobs', 'India', ['timesjobs.com']),
  s('apna', 'apna', 'India', ['apna.co']),
  s('instahyre', 'Instahyre', 'India', ['instahyre.com']),
  s('iimjobs', 'iimjobs', 'India', ['iimjobs.com']),
  s('hirist', 'Hirist (tech)', 'India', ['hirist.tech']),
  s('cutshort', 'Cutshort (tech)', 'India', ['cutshort.io']),
  s('freshersworld', 'Freshersworld', 'India', ['freshersworld.com']),
  s('internshala', 'Internshala (internships)', 'India', ['internshala.com']),

  // United States & Canada
  s('ziprecruiter', 'ZipRecruiter', 'United States & Canada', ['ziprecruiter.com']),
  s('simplyhired', 'SimplyHired', 'United States & Canada', ['simplyhired.com']),
  s('careerbuilder', 'CareerBuilder', 'United States & Canada', ['careerbuilder.com']),
  s('dice', 'Dice (tech)', 'United States & Canada', ['dice.com']),
  s('usajobs', 'USAJOBS (US government)', 'United States & Canada', ['usajobs.gov']),
  s('snagajob', 'Snagajob (hourly)', 'United States & Canada', ['snagajob.com']),
  s('theladders', 'The Ladders', 'United States & Canada', ['theladders.com']),
  s('idealist', 'Idealist (non-profit)', 'United States & Canada', ['idealist.org']),
  s('jobbank-ca', 'Job Bank (Canada)', 'United States & Canada', ['jobbank.gc.ca']),

  // United Kingdom & Ireland
  s('reed', 'Reed', 'United Kingdom & Ireland', ['reed.co.uk']),
  s('totaljobs', 'Totaljobs', 'United Kingdom & Ireland', ['totaljobs.com']),
  s('cv-library', 'CV-Library', 'United Kingdom & Ireland', ['cv-library.co.uk']),
  s('find-a-job-uk', 'Find a job (UK government)', 'United Kingdom & Ireland', ['findajob.dwp.gov.uk']),
  s('guardian-jobs', 'Guardian Jobs', 'United Kingdom & Ireland', ['jobs.theguardian.com']),
  s('jobs-ac-uk', 'jobs.ac.uk (academic)', 'United Kingdom & Ireland', ['jobs.ac.uk']),
  s('irishjobs', 'IrishJobs', 'United Kingdom & Ireland', ['irishjobs.ie']),
  s('jobs-ie', 'Jobs.ie', 'United Kingdom & Ireland', ['jobs.ie']),

  // Europe
  s('stepstone', 'StepStone', 'Europe', ['stepstone.de', 'stepstone.at', 'stepstone.be', 'stepstone.fr']),
  s('xing', 'XING', 'Europe', ['xing.com']),
  s('welcome-to-the-jungle', 'Welcome to the Jungle', 'Europe', ['welcometothejungle.com']),
  s('arbeitsagentur', 'Bundesagentur für Arbeit (Germany)', 'Europe', ['arbeitsagentur.de']),
  s('france-travail', 'France Travail', 'Europe', ['francetravail.fr']),
  s('apec', 'APEC (France, managers)', 'Europe', ['apec.fr']),
  s('infojobs-es', 'InfoJobs (Spain)', 'Europe', ['infojobs.net']),
  s('jobs-ch', 'jobs.ch (Switzerland)', 'Europe', ['jobs.ch']),
  s('karriere-at', 'karriere.at (Austria)', 'Europe', ['karriere.at']),
  s('pracuj', 'Pracuj.pl (Poland)', 'Europe', ['pracuj.pl']),
  s('nofluffjobs', 'No Fluff Jobs (tech, Europe)', 'Europe', ['nofluffjobs.com']),
  s('jobindex', 'Jobindex (Denmark)', 'Europe', ['jobindex.dk']),
  s('finn', 'FINN.no (Norway)', 'Europe', ['finn.no']),
  s('arbetsformedlingen', 'Arbetsförmedlingen (Sweden)', 'Europe', ['arbetsformedlingen.se']),
  s('eures', 'EURES (EU job mobility portal)', 'Europe', ['eures.europa.eu']),

  // Middle East & Africa
  s('bayt', 'Bayt', 'Middle East & Africa', ['bayt.com']),
  s('naukrigulf', 'Naukrigulf', 'Middle East & Africa', ['naukrigulf.com']),
  s('gulftalent', 'GulfTalent', 'Middle East & Africa', ['gulftalent.com']),
  s('dubizzle', 'dubizzle (UAE)', 'Middle East & Africa', ['dubizzle.com']),
  s('akhtaboot', 'Akhtaboot (Jordan)', 'Middle East & Africa', ['akhtaboot.com']),
  s('wuzzuf', 'Wuzzuf (Egypt)', 'Middle East & Africa', ['wuzzuf.net']),
  s('brightermonday', 'BrighterMonday (East Africa)', 'Middle East & Africa', ['brightermonday.co.ke', 'brightermonday.co.ug', 'brightermonday.co.tz']),
  s('jobberman', 'Jobberman (Nigeria)', 'Middle East & Africa', ['jobberman.com']),
  s('pnet', 'PNet (South Africa)', 'Middle East & Africa', ['pnet.co.za']),
  s('careers24', 'Careers24 (South Africa)', 'Middle East & Africa', ['careers24.com']),

  // Asia-Pacific
  s('seek-au', 'SEEK (Australia)', 'Asia-Pacific', ['seek.com.au']),
  s('seek-nz', 'SEEK (New Zealand)', 'Asia-Pacific', ['seek.co.nz']),
  s('jora', 'Jora (Australia / NZ)', 'Asia-Pacific', ['jora.com']),
  s('jobstreet', 'JobStreet (SE Asia)', 'Asia-Pacific', ['jobstreet.com']),
  s('jobsdb', 'JobsDB (Hong Kong / Thailand)', 'Asia-Pacific', ['jobsdb.com']),
  s('mycareersfuture', 'MyCareersFuture (Singapore)', 'Asia-Pacific', ['mycareersfuture.gov.sg']),
  s('glints', 'Glints (SE Asia)', 'Asia-Pacific', ['glints.com']),
  s('kalibrr', 'Kalibrr (Philippines / Indonesia)', 'Asia-Pacific', ['kalibrr.com']),
  s('vietnamworks', 'VietnamWorks', 'Asia-Pacific', ['vietnamworks.com']),
  s('bdjobs', 'Bdjobs (Bangladesh)', 'Asia-Pacific', ['bdjobs.com']),
  s('rozee', 'Rozee.pk (Pakistan)', 'Asia-Pacific', ['rozee.pk']),
  s('topjobs-lk', 'Topjobs (Sri Lanka)', 'Asia-Pacific', ['topjobs.lk']),
  s('jobkorea', 'JobKorea', 'Asia-Pacific', ['jobkorea.co.kr']),
  s('saramin', 'Saramin (Korea)', 'Asia-Pacific', ['saramin.co.kr']),
  s('wantedly', 'Wantedly (Japan)', 'Asia-Pacific', ['wantedly.com']),
  s('51job', '51job (China)', 'Asia-Pacific', ['51job.com']),
  s('zhaopin', 'Zhaopin (China)', 'Asia-Pacific', ['zhaopin.com']),

  // Latin America
  s('computrabajo', 'Computrabajo', 'Latin America', ['computrabajo.com']),
  s('occ', 'OCC Mundial (Mexico)', 'Latin America', ['occ.com.mx']),
  s('bumeran', 'Bumeran', 'Latin America', ['bumeran.com']),
  s('zonajobs', 'ZonaJobs (Argentina)', 'Latin America', ['zonajobs.com.ar']),
  s('infojobs-br', 'InfoJobs (Brazil)', 'Latin America', ['infojobs.com.br']),
  s('catho', 'Catho (Brazil)', 'Latin America', ['catho.com.br']),
  s('gupy', 'Gupy (Brazil)', 'Latin America', ['gupy.io']),

  // Remote & startups
  s('wellfound', 'Wellfound (startups)', 'Remote & startups', ['wellfound.com']),
  s('workatastartup', 'Work at a Startup (Y Combinator)', 'Remote & startups', ['workatastartup.com']),
  s('builtin', 'Built In (tech)', 'Remote & startups', ['builtin.com']),
  s('themuse', 'The Muse', 'Remote & startups', ['themuse.com']),
  s('remote-co', 'Remote.co', 'Remote & startups', ['remote.co']),
  s('weworkremotely', 'We Work Remotely', 'Remote & startups', ['weworkremotely.com']),
  s('remoteok', 'Remote OK', 'Remote & startups', ['remoteok.com']),
  s('remotive', 'Remotive', 'Remote & startups', ['remotive.com']),
  s('flexjobs', 'FlexJobs', 'Remote & startups', ['flexjobs.com']),
  s('workingnomads', 'Working Nomads', 'Remote & startups', ['workingnomads.com']),

  // Company career sites (applicant-tracking systems used by employers)
  s('ats', 'Employer career pages (Greenhouse, Lever, Workday, Ashby, SmartRecruiters, Workable…)', ATS_GROUP, [
    'greenhouse.io', 'lever.co', 'myworkdayjobs.com', 'ashbyhq.com', 'smartrecruiters.com', 'workable.com', 'jobvite.com', 'recruitee.com', 'teamtailor.com',
  ]),
];

export type SourceId = string;

const BY_ID = new Map(SOURCES.map((source) => [source.id, source]));

export const isSourceId = (value: unknown): value is SourceId => typeof value === 'string' && BY_ID.has(value);
export const getSource = (id: string): SourceDef | undefined => BY_ID.get(id);
