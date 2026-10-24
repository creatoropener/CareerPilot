import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreJob } from '../src/lib/matcher';
import { DEFAULT_PROFILE } from '../src/lib/types';

test('preferred location \"City, Country\" grants location points when listing contains the city', () => {
  const profile = { ...DEFAULT_PROFILE, targetRoles: 'Supply Chain Manager', location: 'Mumbai, India' };
  const job = { title: 'Supply Chain Manager — Mumbai', url: 'https://jobs.example.com/scm', content: 'Apply now' };
  assert.equal(scoreJob(job, profile).matchScore, 65);
});

test('preferred location \"City, Country\" grants location points when listing contains the full string', () => {
  const profile = { ...DEFAULT_PROFILE, targetRoles: 'Supply Chain Manager', location: 'Mumbai, India' };
  const job = { title: 'Supply Chain Manager — Mumbai, India', url: 'https://jobs.example.com/scm', content: 'Apply now' };
  assert.equal(scoreJob(job, profile).matchScore, 65);
});

test('preferred location \"City\" continues to work as before', () => {
  const profile = { ...DEFAULT_PROFILE, targetRoles: 'Supply Chain Manager', location: 'Mumbai' };
  const job = { title: 'Supply Chain Manager — Mumbai', url: 'https://jobs.example.com/scm', content: 'Apply now' };
  assert.equal(scoreJob(job, profile).matchScore, 65);
});

test('different city yields no location points for \"City, Country\" profile', () => {
  const profile = { ...DEFAULT_PROFILE, targetRoles: 'Supply Chain Manager', location: 'Mumbai, India' };
  const job = { title: 'Supply Chain Manager — Pune', url: 'https://jobs.example.com/scm', content: 'Apply now' };
  assert.equal(scoreJob(job, profile).matchScore, 50);
});
