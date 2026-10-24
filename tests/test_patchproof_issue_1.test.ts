import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreJob } from '../src/lib/matcher';
import { DEFAULT_PROFILE } from '../src/lib/types';

test('preferred location \"City, Country\" yields location credit when listing contains the city part', async () => {
  const profile = { ...DEFAULT_PROFILE, targetRoles: 'Supply Chain Manager', location: 'Mumbai, India' };
  const job = { title: 'Supply Chain Manager — Mumbai', url: 'https://jobs.example.com/scm', content: 'Apply now' };
  assert.equal(scoreJob(job, profile).matchScore, 65);
});
