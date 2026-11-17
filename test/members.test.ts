import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';

const cases = [
  { country: 'AE', national: '0501234567', international: '+971501234567' },
  { country: 'SA', national: '0551234567', international: '+966551234567' },
  { country: 'BH', national: '31234567', international: '+97331234567' },
] as const;

test('all countries and spellings normalize on creation and lookup', async (t) => {
  for (const { country, national, international } of cases) {
    const spellings = [national, international, international.slice(1), ` (${national.slice(0, 3)})-${national.slice(3)} `];
    for (const spelling of spellings) {
      await t.test(`${country}: ${spelling}`, async (t) => {
        const app = buildApp();
        t.after(() => app.close());
        const created = await app.inject({ method: 'POST', url: '/members', payload: { name: '  Noura Al Harbi  ', country, phone: spelling } });
        assert.equal(created.statusCode, 201);
        const member = created.json();
        assert.equal(typeof member.id, 'string');
        assert.ok(member.id.length > 0);
        assert.deepEqual(member, { id: member.id, name: 'Noura Al Harbi', country, phone: international });

        for (const phone of spellings) {
          const query = new URLSearchParams({ phone, country });
          const found = await app.inject({ url: `/members/lookup?${query}` });
          assert.equal(found.statusCode, 200);
          assert.deepEqual(found.json(), member);
        }
        for (const phone of [international, international.slice(1)]) {
          const found = await app.inject({ url: `/members/lookup?${new URLSearchParams({ phone })}` });
          assert.equal(found.statusCode, 200);
          assert.deepEqual(found.json(), member);
        }
      });
    }
  }
});

test('creation accepts foreign SIMs but lookup rejects a conflicting country', async (t) => {
  for (const memberCountry of cases) {
    for (const sim of cases.filter((entry) => entry.country !== memberCountry.country)) {
      for (const phone of [sim.international, sim.international.slice(1)]) {
        const app = buildApp();
        t.after(() => app.close());
        const response = await app.inject({ method: 'POST', url: '/members', payload: { name: 'Foreign SIM', country: memberCountry.country, phone } });
        assert.equal(response.statusCode, 201);
        assert.equal(response.json().country, memberCountry.country);
        const lookup = await app.inject({ url: `/members/lookup?${new URLSearchParams({ phone, country: memberCountry.country })}` });
        assert.equal(lookup.statusCode, 422);
        assert.equal(lookup.json().error.code, 'PHONE_COUNTRY_MISMATCH');
      }
    }
  }
});

test('phone errors follow national, international and character rules', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  for (const { national } of cases) {
    const response = await app.inject({ url: `/members/lookup?${new URLSearchParams({ phone: national })}` });
    assert.equal(response.statusCode, 422);
    assert.equal(response.json().error.code, 'PHONE_NEEDS_COUNTRY');
  }
  const invalidPhones = ['', ' ()- ', '00966551234567', '++966551234567', '966+551234567', '+0551234567',
    '055123456', '05512345678', '0451234567', '+971401234567', '+966051234567', '+973031234567',
    '+97341234567', '+973312345678', '+15512345678', '055abc4567', '0551234567 ext 1', '055\t1234567', '٠٥٥١٢٣٤٥٦٧'];
  for (const phone of invalidPhones) {
    const create = await app.inject({ method: 'POST', url: '/members', payload: { name: 'Test', country: 'SA', phone } });
    const lookup = await app.inject({ url: `/members/lookup?${new URLSearchParams({ phone, country: 'SA' })}` });
    for (const response of [create, lookup]) {
      assert.equal(response.statusCode, 422, phone);
      assert.equal(response.json().error.code, 'INVALID_PHONE', phone);
    }
  }
  for (const [phone, country] of [['0551234567', 'BH'], ['31234567', 'SA']]) {
    for (const response of [
      await app.inject({ method: 'POST', url: '/members', payload: { name: 'Test', country, phone } }),
      await app.inject({ url: `/members/lookup?${new URLSearchParams({ phone: phone!, country: country! })}` }),
    ]) {
      assert.equal(response.statusCode, 422);
      assert.equal(response.json().error.code, 'INVALID_PHONE');
    }
  }
});

test('invalid bodies, fields, queries and JSON use the validation envelope', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  const valid = { name: 'Test', country: 'SA', phone: '0551234567' };
  const payloads = [null, [], 'text', {},
    ...[undefined, null, 7, '', '   ', 'x'.repeat(121)].map((name) => ({ ...valid, name })),
    ...[undefined, null, 7, '', 'sa', 'US', 'toString'].map((country) => ({ ...valid, country })),
    ...[undefined, null, 551234567, [], {}].map((phone) => ({ ...valid, phone })),
  ];
  for (const payload of payloads) {
    const response = await app.inject({ method: 'POST', url: '/members', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
    assert.equal(response.statusCode, 422);
    assert.equal(response.json().error.code, 'VALIDATION');
    assert.equal(typeof response.json().error.message, 'string');
  }
  for (const query of ['', 'country=SA', 'phone=0551234567&country=US', 'phone=0551234567&country=', 'phone=0551234567&phone=0551234567', 'phone=0551234567&country=SA&country=BH']) {
    const response = await app.inject({ url: `/members/lookup?${query}` });
    assert.equal(response.statusCode, 422);
    assert.equal(response.json().error.code, 'VALIDATION');
  }
  const malformed = await app.inject({ method: 'POST', url: '/members', headers: { 'content-type': 'application/json' }, payload: '{' });
  assert.equal(malformed.statusCode, 422);
  assert.equal(malformed.json().error.code, 'VALIDATION');

  const boundary = await app.inject({ method: 'POST', url: '/members', payload: { ...valid, name: ` ${'x'.repeat(120)} ` } });
  assert.equal(boundary.statusCode, 201);
  assert.equal(boundary.json().name.length, 120);
});

test('concurrent spellings have one winner and duplicates identify that member', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  const spellings = ['0551234567', '+966551234567', '966551234567', '(055) 123-4567'];
  const responses = await Promise.all(Array.from({ length: 40 }, (_, index) => app.inject({
    method: 'POST', url: '/members', payload: { name: `Member ${index}`, country: 'SA', phone: spellings[index % spellings.length] },
  })));
  const winners = responses.filter((response) => response.statusCode === 201);
  assert.equal(winners.length, 1);
  const winner = winners[0]!.json();
  for (const response of responses.filter((response) => response.statusCode !== 201)) {
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error.code, 'PHONE_TAKEN');
    assert.equal(response.json().error.existing_member_id, winner.id);
  }
  const found = await app.inject({ url: '/members/lookup?phone=966551234567' });
  assert.deepEqual(found.json(), winner);
  const second = await app.inject({ method: 'POST', url: '/members', payload: { name: 'Other', country: 'SA', phone: '0551234568' } });
  assert.equal(second.statusCode, 201);
  assert.notEqual(second.json().id, winner.id);
});

test('missing members return 404 and app instances start empty', async (t) => {
  const first = buildApp();
  const second = buildApp();
  t.after(() => Promise.all([first.close(), second.close()]));
  await first.inject({ method: 'POST', url: '/members', payload: { name: 'Test', country: 'SA', phone: '0551234567' } });
  const response = await second.inject({ url: '/members/lookup?phone=966551234567' });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, 'NOT_FOUND');
  const created = await second.inject({ method: 'POST', url: '/members', payload: { name: 'Fresh', country: 'SA', phone: '0551234567' } });
  assert.equal(created.statusCode, 201);
});
