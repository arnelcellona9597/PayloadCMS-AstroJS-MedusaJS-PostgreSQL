import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import type { ExecArgs } from "@medusajs/framework/types"

/**
 * Prints everything the Astro storefront needs to talk to this backend.
 *
 *   npm run bootstrap
 *
 * Run via `medusa exec`, which boots the full Medusa container and hands it to
 * this function — so `container.resolve(...)` works exactly as it does inside a
 * route handler. That is the intended way to script against Medusa; there is no
 * "connect to the database directly" step.
 *
 * The publishable API key is the thing people get stuck on. Every /store/* route
 * demands one, including the custom ones in src/api/store/. It identifies a SALES
 * CHANNEL rather than a user, which is why it is safe to ship to a browser and
 * why it is not enough on its own to reach /admin/*.
 */
export default async function bootstrap({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const apiKeyService = container.resolve(Modules.API_KEY)
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)
  const link = container.resolve(ContainerRegistrationKeys.LINK)

  // ── Sales channel ─────────────────────────────────────────────────────────
  const channels = await salesChannelService.listSalesChannels({}, { take: 1 })

  if (channels.length === 0) {
    throw new Error("No sales channel found. Run `npm run seed` first.")
  }

  const channel = channels[0]

  // ── Publishable key ───────────────────────────────────────────────────────
  const existing = await apiKeyService.listApiKeys({ type: "publishable" }, { take: 1 })

  let key = existing[0]

  if (!key) {
    key = await apiKeyService.createApiKeys({
      title: "Astro storefront",
      type: "publishable",
      created_by: "bootstrap-script",
    })
    logger.info(`Created publishable API key: ${key.title}`)
  } else {
    logger.info(`Reusing publishable API key: ${key.title}`)
  }

  /**
   * A key with no sales channel attached still authenticates, but scopes the
   * caller to nothing — product listings come back empty and it looks like a bug
   * in your query. Attaching the channel is not optional in practice.
   *
   * The attachment is itself a module LINK (api_key ←→ sales_channel), the same
   * mechanism as product ←→ review in src/links/. Medusa uses it internally too.
   */
  try {
    await link.create({
      [Modules.API_KEY]: { publishable_key_id: key.id },
      [Modules.SALES_CHANNEL]: { sales_channel_id: channel.id },
    })
    logger.info(`Linked key to sales channel: ${channel.name}`)
  } catch {
    logger.info(`Key already linked to sales channel: ${channel.name}`)
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const email = process.env.MEDUSA_ADMIN_EMAIL ?? "admin@local.test"
  const password = process.env.MEDUSA_ADMIN_PASSWORD ?? "supersecret"

  /* eslint-disable no-console */
  console.log("\n" + "─".repeat(72))
  console.log("  Commerce backend ready.")
  console.log("─".repeat(72))
  console.log(`  Admin dashboard   http://localhost:9000/app`)
  console.log(`  Login             ${email} / ${password}`)
  console.log("")
  console.log("  Put this in apps/storefront/.env :")
  console.log("")
  console.log(`  MEDUSA_PUBLISHABLE_KEY=${key.token}`)
  console.log("")
  console.log("  Required on EVERY /store/* request:")
  console.log(`    x-publishable-api-key: ${key.token}`)
  console.log("─".repeat(72) + "\n")
  /* eslint-enable no-console */
}
