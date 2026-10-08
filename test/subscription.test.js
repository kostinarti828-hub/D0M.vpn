const test = require('node:test');
const assert = require('node:assert/strict');
const { readVlessSubscriptionUrl } = require('../subscription');

test('subscription stays disabled until a VLESS URL is configured', () => {
  assert.equal(readVlessSubscriptionUrl({}), null);
});

test('accepts a VLESS URI with UUID, server, port, and query parameters', () => {
  const url = 'vless://uuid@vpn.example.test:443?security=none&type=tcp#DomVPN';
  assert.equal(readVlessSubscriptionUrl({ VLESS_SUBSCRIPTION_URL: url }), url);
});

test('rejects non-VLESS values and multiline secret input', () => {
  assert.throws(() => readVlessSubscriptionUrl({ VLESS_SUBSCRIPTION_URL: 'https://example.test/' }), /VLESS/);
  assert.throws(() => readVlessSubscriptionUrl({ VLESS_SUBSCRIPTION_URL: 'vless://uuid@host.test:443\nsecond-line' }), /single valid/);
});