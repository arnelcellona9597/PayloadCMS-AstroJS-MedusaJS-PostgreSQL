import { Module } from "@medusajs/framework/utils"

import OpsModuleService from "./service"

/**
 * The ops module — uptime history.
 *
 * Registered in medusa-config.ts exactly like the review module. Note there is
 * no link between ops and anything else: uptime data is about infrastructure,
 * not commerce, and it has no business knowing what a product is.
 */
export const OPS_MODULE = "ops"

export default Module(OPS_MODULE, {
  service: OpsModuleService,
})
