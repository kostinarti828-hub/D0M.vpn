function readVlessSubscriptionUrl(env = process.env) {
  const value = env.VLESS_SUBSCRIPTION_URL?.trim();
  if (!value) return null;
  if (value.length > 2048 || /[\r\n]/.test(value)) {
    throw new Error('VLESS_SUBSCRIPTION_URL must be a single valid VLESS URL.');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('VLESS_SUBSCRIPTION_URL must be a valid VLESS URL.');
  }
  if (url.protocol !== 'vless:' || !url.username || !url.hostname || !url.port) {
    throw new Error('VLESS_SUBSCRIPTION_URL must include a VLESS UUID, host, and port.');
  }
  return value;
}

module.exports = { readVlessSubscriptionUrl };