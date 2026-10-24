import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreJob } from '../src/lib/matcher';
import { DEFAULT_PROFILE } from '../src/lib/types';

// Existing behavior that must keep working: a plain "City" location matches a listing that names the city.
test('a plain city location earns the location points', () => {
  const profile = { ...DEFAULT_PROFILE, targetRoles: 'Supply Chain Manager', location: 'Mumbai' };
  const job = { title: 'Supply Chain Manager — Mumbai', url: 'https://jobs.example.com/scm', content: 'Apply now' };
  assert.equal(scoreJob(job, profile).matchScore, 65);
});

test('a different city earns no location points', () => {
  const profile = { ...DEFAULT_PROFILE, targetRoles: 'Supply Chain Manager', location: 'Mumbai' };
  const job = { title: 'Supply Chain Manager — Pune', url: 'https://jobs.example.com/scm', content: 'Apply now' };
  assert.equal(scoreJob(job, profile).matchScore, 50);
});
