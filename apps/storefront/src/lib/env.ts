/**
 * Server-side configuration, validated once at startup.
 *
 * Astro exposes env vars through `import.meta.env`. Anything NOT prefixed with
 * `PUBLIC_` is server-only — it is stripped from the client bundle entirely, so
 * importing this module from a client-side script would fail at build time
 * rather than leak a key. That is the guarantee this file relies on.
 *
 * Failing loudly here beats a confusing 401 from Payload three files away.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value === 'REPLACE_ME') {
    throw new Error(
      `Missing env var ${name}. Copy .env.example to .env, then run ` +
        `\`npm run seed\` in apps/cms and \`npm run bootstrap\` in apps/commerce ` +
        `to obtain the keys they print.`,
    )
  }
  return value
}

export const env = {
  payload: {
    url: import.meta.env.PAYLOAD_URL ?? 'http://localhost:3000',
    apiKey: required('PAYLOAD_API_KEY', import.meta.env.PAYLOAD_API_KEY),
  },
  medusa: {
    url: import.meta.env.MEDUSA_URL ?? 'http://localhost:9000',
    publishableKey: required('MEDUSA_PUBLISHABLE_KEY', import.meta.env.MEDUSA_PUBLISHABLE_KEY),
    adminEmail: import.meta.env.MEDUSA_ADMIN_EMAIL ?? 'admin@local.test',
    adminPassword: import.meta.env.MEDUSA_ADMIN_PASSWORD ?? 'supersecret',
  },
} as const
